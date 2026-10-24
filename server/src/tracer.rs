//! Runs user code through `python tracer.py --worker` (pg_logger) and summarizes the trace.
//!
//! Every run gets its own Python process, which gives us:
//!   - a hard timeout (pg_logger's 1000-step cap doesn't stop `10**10**8`): the process is killed
//!   - isolation: pg_logger swaps sys.stdout globally, so runs can't share a process
//!   - secrets stay safe: the worker gets a scrubbed environment (no GEMINI_API_KEY)
//!
//! To hide Python's startup time, one spare worker is kept started and waiting on stdin
//! (it has already imported pg_logger). A run takes the spare and a new one is warmed in
//! the background.
//!
//! Result shape (what the frontend gets):
//! { status: ok|error|step_limit|needs_input|timeout|crashed, message, error_line, error_step,
//!   trace: [...], step_count, stdout, duration_ms }

use std::{
    fmt,
    io,
    path::PathBuf,
    process::{Output, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::Mutex,
};

const SENTINEL: &str = "@@KIRO_TRACE@@";
const SETUP_EXIT_CODE: i32 = 3;
const ENV_WHITELIST: &[&str] = &["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"];

pub struct Tracer {
    python: PathBuf,
    root: PathBuf,
    timeout: Duration,
    allow_all_modules: bool,
    spare: Mutex<Option<Child>>,
}

#[derive(Debug)]
pub struct SetupError(String);

impl fmt::Display for SetupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

enum Outcome {
    Finished(Output),
    TimedOut,
}

impl Tracer {
    pub fn new(python: PathBuf, root: PathBuf, timeout: Duration, allow_all_modules: bool) -> Self {
        Self { python, root, timeout, allow_all_modules, spare: Mutex::new(None) }
    }

    pub fn is_ready(&self) -> bool {
        ["tracer.py", "pg_logger.py", "pg_encoder.py"].iter().all(|f| self.root.join(f).is_file())
    }

    /// Make sure a spare worker is waiting.
    pub async fn warm(&self) {
        if !self.is_ready() {
            return;
        }
        let mut spare = self.spare.lock().await;
        if spare.is_none() {
            *spare = self.spawn_worker().ok();
        }
    }

    fn spawn_worker(&self) -> io::Result<Child> {
        let mut cmd = Command::new(&self.python);
        cmd.arg("-X")
            .arg("utf8")
            .arg(self.root.join("tracer.py"))
            .arg("--worker")
            .current_dir(&self.root)
            .env_clear()
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (key, value) in std::env::vars_os() {
            let keep = key.to_str().is_some_and(|k| ENV_WHITELIST.iter().any(|w| w.eq_ignore_ascii_case(k)));
            if keep {
                cmd.env(&key, &value);
            }
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes
        cmd.spawn()
    }

    pub async fn run(self: &Arc<Self>, code: &str, stdin: &[String]) -> Result<Value, SetupError> {
        if !self.is_ready() {
            return Err(SetupError(
                "pg_logger.py and pg_encoder.py must sit next to tracer.py (from OnlinePythonTutor's v5-unity folder).".into(),
            ));
        }
        let payload = serde_json::to_vec(&json!({
            "code": code,
            "stdin": stdin,
            "allow_all_modules": self.allow_all_modules,
        }))
        .expect("serializable payload");

        let spare = self.spare.lock().await.take();
        let warm_again = Arc::clone(self);
        tokio::spawn(async move { warm_again.warm().await });

        let started = Instant::now();
        let outcome = match spare {
            Some(child) => match self.execute(child, &payload).await {
                Ok(outcome) => outcome,
                // The spare died while idle (or was killed): retry once with a fresh worker.
                Err(_) => self.execute_fresh(&payload).await?,
            },
            None => self.execute_fresh(&payload).await?,
        };
        let duration_ms = started.elapsed().as_millis() as u64;

        let output = match outcome {
            Outcome::TimedOut => {
                let secs = self.timeout.as_secs_f64();
                return Ok(result(
                    Vec::new(),
                    "timeout",
                    Some(format!(
                        "Execution took longer than {secs} seconds and was stopped. Look for an infinite loop or a very slow line."
                    )),
                    None,
                    None,
                    duration_ms,
                ));
            }
            Outcome::Finished(output) => output,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        if output.status.code() == Some(SETUP_EXIT_CODE) {
            return Err(SetupError(format!("pg_logger failed to load: {}", stdout.trim())));
        }
        let Some(at) = stdout.rfind(SENTINEL) else {
            // The interpreter died before pg_logger reported (os._exit, MemoryError, ...).
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no output").trim().to_owned();
            return Ok(result(
                Vec::new(),
                "crashed",
                Some(format!("The Python process exited unexpectedly ({detail}).")),
                None,
                None,
                duration_ms,
            ));
        };
        let raw: Vec<Value> = serde_json::from_str(&stdout[at + SENTINEL.len()..])
            .map_err(|e| SetupError(format!("tracer returned invalid JSON: {e}")))?;
        Ok(summarize(raw, duration_ms))
    }

    async fn execute_fresh(&self, payload: &[u8]) -> Result<Outcome, SetupError> {
        let child = self
            .spawn_worker()
            .map_err(|e| SetupError(format!("couldn't start Python ({}): {e}", self.python.display())))?;
        self.execute(child, payload)
            .await
            .map_err(|e| SetupError(format!("Python worker failed: {e}")))
    }

    async fn execute(&self, mut child: Child, payload: &[u8]) -> io::Result<Outcome> {
        let mut stdin = child.stdin.take().ok_or_else(|| io::Error::other("worker has no stdin"))?;
        stdin.write_all(payload).await?;
        drop(stdin); // EOF: the worker starts tracing
        // If the timeout fires, the child is dropped here and kill_on_drop terminates it.
        match tokio::time::timeout(self.timeout, child.wait_with_output()).await {
            Err(_) => Ok(Outcome::TimedOut),
            Ok(output) => Ok(Outcome::Finished(output?)),
        }
    }
}

fn event(step: &Value) -> &str {
    step.get("event").and_then(Value::as_str).unwrap_or("")
}

fn summarize(raw: Vec<Value>, duration_ms: u64) -> Value {
    let (status, message, last_line) = match raw.last() {
        None => ("ok", None, None),
        Some(last) => {
            let status = match event(last) {
                "exception" | "uncaught_exception" => "error",
                "instruction_limit_reached" => "step_limit",
                "raw_input" => "needs_input",
                _ => "ok",
            };
            let key = if status == "needs_input" { "prompt" } else { "exception_msg" };
            let message = last.get(key).and_then(Value::as_str).map(str::to_owned);
            (status, message, last.get("line").and_then(Value::as_u64))
        }
    };

    // Marker entries (syntax errors, step limit, input requests) have no memory snapshot.
    // Drop them so every step in `trace` can be drawn.
    let trace: Vec<Value> = raw.into_iter().filter(|s| s.get("heap").is_some()).collect();

    let (mut error_line, mut error_step) = (None, None);
    if status == "error" {
        error_line = last_line;
        if trace.last().is_some_and(|s| event(s) == "exception") {
            // An uncaught exception emits one 'exception' event per frame while unwinding.
            // Walk back through that chain to where it was first raised.
            let mut k = trace.len() - 1;
            while k > 0 && matches!(event(&trace[k - 1]), "exception" | "return") {
                k -= 1;
            }
            let idx = (k..trace.len()).find(|&i| event(&trace[i]) == "exception").unwrap_or(trace.len() - 1);
            error_step = Some(idx);
            error_line = trace[idx].get("line").and_then(Value::as_u64).or(error_line);
        }
    }
    result(trace, status, message, error_line, error_step, duration_ms)
}

fn result(
    trace: Vec<Value>,
    status: &str,
    message: Option<String>,
    error_line: Option<u64>,
    error_step: Option<usize>,
    duration_ms: u64,
) -> Value {
    let stdout = trace.last().and_then(|s| s.get("stdout")).and_then(Value::as_str).unwrap_or("").to_owned();
    json!({
        "status": status,
        "message": message,
        "error_line": error_line,
        "error_step": error_step,
        "step_count": trace.len(),
        "stdout": stdout,
        "duration_ms": duration_ms,
        "trace": trace,
    })
}
