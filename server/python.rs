//! Python projects: runs `python tracer.py --worker` (pg_logger, from the python branch) and turns its trace
//! into TraceLab trace events.
//!
//! As in that branch's `tracer.rs`, every run gets its own Python process (pg_logger swaps sys.stdout
//! globally), the worker gets a scrubbed environment, and one spare worker is kept started so a run doesn't
//! wait for Python's startup. TraceLab adds cancellation, a cap on the trace size, and the conversion.
//!
//! The raw pg_logger result is also sent to the browser in a `native` event, because the Python Tutor
//! questions (web/pyquiz) read that format. Raw step `i` is the `i`-th recorded step of the run.

use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::{Duration, Instant},
};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, process::{Child, Command}, sync::Mutex};

const SENTINEL: &str = "@@KIRO_TRACE@@";
const SETUP_EXIT_CODE: i32 = 3;
const ENV_WHITELIST: &[&str] = &["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"];
const MAX_OBJECTS: usize = 160;
const MAX_ELEMENTS: usize = 64;
const MAX_FRAMES: usize = 48;

pub struct Python {
    python: PathBuf,
    dir: PathBuf,
    pub version: Option<String>,
    allow_all_modules: bool,
    spare: Mutex<Option<Child>>,
}

/// How a worker process ended.
pub enum Finish {
    /// The worker's JSON: a raw trace (trace mode) or a plain-run result (run mode).
    Done(Value),
    Timeout,
    Cancelled,
    TooLarge,
    Crashed(String),
}

impl Python {
    /// `TRACELAB_PYTHON` names the interpreter; otherwise `python` (Windows) or `python3`.
    pub fn new(root: &std::path::Path) -> Self {
        let python = std::env::var_os("TRACELAB_PYTHON").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let version = std::process::Command::new(&python).arg("--version").stdin(Stdio::null()).output().ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(if o.stdout.is_empty() { &o.stderr } else { &o.stdout }).trim().trim_start_matches("Python ").to_string())
            .filter(|v| v.split('.').nth(1).and_then(|m| m.parse::<u32>().ok()).is_some_and(|minor| v.starts_with("3.") && minor >= 10));
        Python { python, dir: root.join("worker/python"), version, allow_all_modules: std::env::var("TRACE_ALLOW_ALL_MODULES").as_deref() == Ok("1"), spare: Mutex::new(None) }
    }

    pub fn ready(&self) -> bool {
        self.version.is_some() && ["tracer.py", "pg_logger.py", "pg_encoder.py", "capped_output.py"].iter().all(|f| self.dir.join(f).is_file())
    }

    pub async fn warm(&self) {
        if !self.ready() { return; }
        let mut spare = self.spare.lock().await;
        if spare.is_none() { *spare = self.spawn_worker().ok(); }
    }

    fn spawn_worker(&self) -> std::io::Result<Child> {
        let mut cmd = Command::new(&self.python);
        cmd.args(["-X", "utf8", "-W", "ignore"]).arg(self.dir.join("tracer.py")).arg("--worker")
            .current_dir(&self.dir).env_clear()
            .env("PYTHONIOENCODING", "utf-8").env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        for (key, value) in std::env::vars_os() {
            if key.to_str().is_some_and(|k| ENV_WHITELIST.iter().any(|w| w.eq_ignore_ascii_case(k))) { cmd.env(&key, &value); }
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd.spawn()
    }

    /// Runs one program. `stdin` is split into the lines `input()` returns.
    pub async fn run(self: &Arc<Self>, code: &str, stdin: &str, mode: &str, max_steps: usize, timeout: Duration, max_bytes: usize, cancel: Arc<AtomicBool>) -> Result<Finish, String> {
        if !self.ready() { return Err("Python 3.10 or newer is needed for Python projects. Install it, or set TRACELAB_PYTHON to its path, then restart TraceLab.".into()); }
        let payload = serde_json::to_vec(&json!({"code": code, "stdin": input_lines(stdin), "mode": mode, "max_steps": max_steps, "allow_all_modules": self.allow_all_modules})).unwrap();
        let spare = self.spare.lock().await.take();
        let again = Arc::clone(self);
        tokio::spawn(async move { again.warm().await });
        let child = match spare { Some(child) => child, None => self.spawn_worker().map_err(|e| format!("Cannot start Python ({}): {e}", self.python.display()))? };
        match self.execute(child, &payload, timeout, max_bytes, &cancel).await {
            Ok(finish) => Ok(finish),
            // The spare died while idle: retry once with a fresh worker.
            Err(_) => {
                let child = self.spawn_worker().map_err(|e| format!("Cannot start Python ({}): {e}", self.python.display()))?;
                self.execute(child, &payload, timeout, max_bytes, &cancel).await.map_err(|e| format!("The Python worker failed: {e}"))
            }
        }
    }

    async fn execute(&self, mut child: Child, payload: &[u8], timeout: Duration, max_bytes: usize, cancel: &AtomicBool) -> std::io::Result<Finish> {
        let mut stdin = child.stdin.take().ok_or_else(|| std::io::Error::other("worker has no stdin"))?;
        stdin.write_all(payload).await?;
        drop(stdin);
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        // stderr is drained separately, so a worker blocked on a full stdout pipe can still be killed.
        let errors = tokio::spawn(async move {
            let mut err = Vec::new();
            let _ = (&mut stderr).take(16_384).read_to_end(&mut err).await;
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
            err
        });
        let read = async {
            let mut out = Vec::new();
            (&mut stdout).take(max_bytes as u64 + 1).read_to_end(&mut out).await.map(|_| out)
        };
        let started = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(80));
        tokio::pin!(read);
        let out = loop {
            tokio::select! {
                result = &mut read => break result?,
                _ = tick.tick() => {
                    if cancel.load(Ordering::Relaxed) { let _ = child.kill().await; return Ok(Finish::Cancelled); }
                    if started.elapsed() > timeout { let _ = child.kill().await; return Ok(Finish::Timeout); }
                }
            }
        };
        if out.len() > max_bytes { let _ = child.kill().await; return Ok(Finish::TooLarge); }
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait()).await.ok().and_then(|s| s.ok());
        let err = tokio::time::timeout(Duration::from_secs(1), errors).await.ok().and_then(|r| r.ok()).unwrap_or_default();
        let text = String::from_utf8_lossy(&out);
        if status.and_then(|s| s.code()) == Some(SETUP_EXIT_CODE) { return Ok(Finish::Crashed(format!("pg_logger failed to load: {}", text.trim()))); }
        let Some(at) = text.rfind(SENTINEL) else {
            let stderr = String::from_utf8_lossy(&err);
            let detail = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no output").trim().to_owned();
            return Ok(Finish::Crashed(format!("The Python process exited unexpectedly ({detail}).")));
        };
        serde_json::from_str(&text[at + SENTINEL.len()..]).map(Finish::Done).map_err(|e| std::io::Error::other(format!("tracer returned invalid JSON: {e}")))
    }
}

/// The lines `input()` returns: the Input text split at line breaks, without a final empty line.
fn input_lines(stdin: &str) -> Vec<String> {
    let text = stdin.replace("\r\n", "\n");
    let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(|l| l.is_empty()) { lines.pop(); }
    lines
}

fn event_name(step: &Value) -> &str { step.get("event").and_then(Value::as_str).unwrap_or("") }

/// pg_logger's steps from the worker's compact trace (tracer.py `compact`): frames and heap entries are
/// stored once and referred to by index, and each step's output is a length into the final output.
fn expand(compact: &Value) -> Vec<Value> {
    let empty = Vec::new();
    let frames = compact["frames"].as_array().unwrap_or(&empty);
    let heap = compact["heap"].as_array().unwrap_or(&empty);
    let output = compact["stdout"].as_str().unwrap_or("");
    let offsets: Vec<usize> = output.char_indices().map(|(i, _)| i).chain(std::iter::once(output.len())).collect();
    compact["trace"].as_array().unwrap_or(&empty).iter().map(|step| {
        let mut step = step.clone();
        if let Some(indexes) = step.get("stack_to_render").and_then(Value::as_array) {
            step["stack_to_render"] = Value::Array(indexes.iter().filter_map(|i| frames.get(i.as_u64()? as usize).cloned()).collect());
        }
        if let Some(indexes) = step.get("heap").and_then(Value::as_array) {
            let objects: Map<String, Value> = indexes.iter().filter_map(|i| heap.get(i.as_u64()? as usize)?.as_array())
                .filter_map(|pair| Some((pair.first()?.as_str()?.to_string(), pair.get(1)?.clone()))).collect();
            step["heap"] = Value::Object(objects);
        }
        if let Some(length) = step.get("stdout").and_then(Value::as_u64) {
            step["stdout"] = json!(&output[..offsets[(length as usize).min(offsets.len() - 1)]]);
        }
        step
    }).collect()
}

/// The python branch's `summarize`, keeping the column of a syntax error.
pub fn summarize(raw: Vec<Value>) -> Value {
    let (status, message, last_line, offset) = match raw.last() {
        None => ("ok", None, None, None),
        Some(last) => {
            let status = match event_name(last) { "exception" | "uncaught_exception" => "error", "instruction_limit_reached" => "step_limit", "raw_input" => "needs_input", _ => "ok" };
            let key = if status == "needs_input" { "prompt" } else { "exception_msg" };
            (status, last.get(key).and_then(Value::as_str).map(str::to_owned), last.get("line").and_then(Value::as_u64), last.get("offset").and_then(Value::as_u64))
        }
    };
    // Marker entries (syntax errors, step limit, input requests) have no memory snapshot.
    let trace: Vec<Value> = raw.into_iter().filter(|s| s.get("heap").is_some()).collect();
    let (mut error_line, mut error_step) = (None, None);
    if status == "error" {
        error_line = last_line;
        if trace.last().is_some_and(|s| event_name(s) == "exception") {
            // An uncaught exception emits one 'exception' event per frame while unwinding; find where it was raised.
            let mut k = trace.len() - 1;
            while k > 0 && matches!(event_name(&trace[k - 1]), "exception" | "return") { k -= 1; }
            let idx = (k..trace.len()).find(|&i| event_name(&trace[i]) == "exception").unwrap_or(trace.len() - 1);
            error_step = Some(idx);
            error_line = trace[idx].get("line").and_then(Value::as_u64).or(error_line);
        }
    }
    let stdout = trace.last().and_then(|s| s.get("stdout")).and_then(Value::as_str).unwrap_or("").to_owned();
    json!({"status": status, "message": message, "error_line": error_line, "error_step": error_step, "error_offset": offset, "step_count": trace.len(), "stdout": stdout, "trace": trace})
}

/// Python's repr() of a string.
fn py_repr(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') { '"' } else { '\'' };
    let mut out = String::from(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => { out.push('\\'); out.push(c); }
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

fn py_float(x: f64) -> String {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 1e16 { format!("{x:.1}") } else { format!("{x}") }
}

struct Heap<'a> { raw: &'a Map<String, Value>, links: HashMap<String, std::collections::HashSet<String>> }

impl Heap<'_> {
    fn entry(&self, id: &Value) -> Option<&Vec<Value>> { self.raw.get(&id.to_string().trim_matches('"').to_string()).and_then(Value::as_array) }

    /// Function, class and module objects read better inline than as heap cards.
    fn inline(&self, entry: &[Value]) -> Option<(String, String)> {
        let tag = entry.first()?.as_str()?;
        let text = |i: usize| entry.get(i).and_then(Value::as_str).unwrap_or("").to_string();
        match tag {
            "FUNCTION" => Some(("function".into(), format!("function {}", text(1)))),
            "CLASS" => Some(("class".into(), format!("class {}", text(1)))),
            "module" => Some(("module".into(), format!("module {}", text(1)))),
            _ => None,
        }
    }

    fn type_of(&self, entry: &[Value]) -> String {
        match entry.first().and_then(Value::as_str).unwrap_or("object") {
            "LIST" => "list".into(), "TUPLE" => "tuple".into(), "SET" => "set".into(), "DICT" => "dict".into(),
            "INSTANCE" | "INSTANCE_PPRINT" => entry.get(1).and_then(Value::as_str).unwrap_or("object").to_string(),
            other => other.to_string(),
        }
    }

    fn value(&self, v: &Value) -> Value {
        match v {
            Value::Null => json!({"kind": "null", "type": "NoneType", "value": "None"}),
            Value::Bool(b) => json!({"kind": "primitive", "type": "bool", "value": if *b { "True" } else { "False" }}),
            Value::Number(n) if n.is_i64() || n.is_u64() => json!({"kind": "primitive", "type": "int", "value": n.to_string()}),
            Value::Number(n) => json!({"kind": "primitive", "type": "float", "value": py_float(n.as_f64().unwrap_or(0.0))}),
            Value::String(s) => json!({"kind": "primitive", "type": "str", "value": py_repr(s)}),
            Value::Array(items) => match items.first().and_then(Value::as_str) {
                Some("REF") => {
                    let id = items.get(1).cloned().unwrap_or(Value::Null);
                    match self.entry(&id) {
                        Some(entry) => match self.inline(entry) {
                            Some((kind, text)) => json!({"kind": "primitive", "type": kind, "value": text}),
                            None => json!({"kind": "reference", "type": self.type_of(entry), "ref": format!("o{}", id.to_string().trim_matches('"'))}),
                        },
                        None => json!({"kind": "reference", "type": "object", "ref": format!("o{}", id.to_string().trim_matches('"')), "omitted": true}),
                    }
                }
                Some("SPECIAL_FLOAT") => {
                    let text = items.get(1).and_then(Value::as_str).unwrap_or("nan");
                    json!({"kind": "primitive", "type": "float", "value": match text { "Infinity" => "inf", "-Infinity" => "-inf", "NaN" => "nan", other => other }})
                }
                Some("IMPORTED_FAUX_PRIMITIVE") => json!({"kind": "primitive", "type": "object", "value": items.get(1).and_then(Value::as_str).unwrap_or("object")}),
                Some("HEAP_PRIMITIVE") => self.value(items.get(2).unwrap_or(&Value::Null)),
                _ => json!({"kind": "primitive", "type": "object", "value": v.to_string()}),
            },
            Value::Object(_) => json!({"kind": "primitive", "type": "object", "value": v.to_string()}),
        }
    }

    fn variable(&self, name: &str, v: &Value) -> Value {
        let value = self.value(v);
        json!({"name": name, "type": value["type"].clone(), "value": value})
    }

    fn object(&self, id: &str, entry: &[Value]) -> Option<Value> {
        let tag = entry.first()?.as_str()?;
        if self.inline(entry).is_some() { return None; }
        let oid = format!("o{id}");
        let items = |from: usize| -> (Vec<Value>, usize) {
            let all = entry.get(from..).unwrap_or(&[]);
            (all.iter().take(MAX_ELEMENTS).map(|e| self.value(e)).collect(), all.len())
        };
        let pairs = |from: usize| entry.get(from..).unwrap_or(&[]).iter().filter_map(|p| p.as_array().filter(|p| p.len() == 2)).collect::<Vec<_>>();
        let mut object = match tag {
            "LIST" | "TUPLE" | "SET" => {
                let (elements, length) = items(1);
                let mut o = json!({"id": oid, "type": self.type_of(entry), "kind": if tag == "SET" { "set" } else { "list" }, "length": length, "elements": elements});
                if length > MAX_ELEMENTS { o["truncated"] = json!(true); }
                o
            }
            "DICT" => {
                let all = pairs(1);
                let mut o = json!({"id": oid, "type": "dict", "kind": "map", "length": all.len(), "entries": all.iter().take(MAX_ELEMENTS).map(|p| json!({"key": self.value(&p[0]), "value": self.value(&p[1])})).collect::<Vec<_>>()});
                if all.len() > MAX_ELEMENTS { o["truncated"] = json!(true); }
                o
            }
            "INSTANCE" | "INSTANCE_PPRINT" => {
                let from = if tag == "INSTANCE" { 2 } else { 3 };
                let class = self.type_of(entry);
                let fields: Vec<Value> = pairs(from).iter().take(24).map(|p| {
                    let name = p[0].as_str().unwrap_or("?");
                    let mut field = self.variable(name, &p[1]);
                    // A link to the same class (next, left, …) has that class as its type even while it is None,
                    // as a Java field would, so the debugger's chain and tree views find it.
                    if self.links.get(&class).is_some_and(|names| names.contains(name)) { field["type"] = json!(class); }
                    field
                }).collect();
                let text = entry.get(2).and_then(Value::as_str).filter(|_| tag == "INSTANCE_PPRINT");
                match text {
                    Some(text) if fields.is_empty() => json!({"id": oid, "type": self.type_of(entry), "kind": "value", "text": text}),
                    Some(text) => json!({"id": oid, "type": self.type_of(entry), "kind": "object", "fields": fields, "message": text}),
                    None => json!({"id": oid, "type": self.type_of(entry), "kind": "object", "fields": fields}),
                }
            }
            other => json!({"id": oid, "type": other, "kind": "value", "text": entry.get(1).and_then(Value::as_str).unwrap_or("")}),
        };
        if object.get("fields").is_some_and(|f| f.as_array().is_some_and(|f| f.is_empty())) && tag == "INSTANCE" { object["message"] = json!("No attributes."); }
        Some(object)
    }

    /// For each class, the attributes that refer to an instance of the same class somewhere in this step.
    fn self_links(&self) -> HashMap<String, std::collections::HashSet<String>> {
        let mut links: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
        for entry in self.raw.values().filter_map(Value::as_array) {
            let tag = entry.first().and_then(Value::as_str).unwrap_or("");
            if tag != "INSTANCE" && tag != "INSTANCE_PPRINT" { continue; }
            let class = self.type_of(entry);
            for pair in entry.get(if tag == "INSTANCE" { 2 } else { 3 }..).unwrap_or(&[]).iter().filter_map(Value::as_array) {
                let (Some(name), Some(Value::Array(v))) = (pair.first().and_then(Value::as_str), pair.get(1)) else { continue };
                if v.first().and_then(Value::as_str) != Some("REF") { continue; }
                if self.entry(v.get(1).unwrap_or(&Value::Null)).is_some_and(|target| matches!(target.first().and_then(Value::as_str), Some("INSTANCE" | "INSTANCE_PPRINT")) && self.type_of(target) == class) {
                    links.entry(class.clone()).or_default().insert(name.to_string());
                }
            }
        }
        links
    }

    fn objects(&self) -> (Vec<Value>, bool) {
        let mut ids: Vec<&String> = self.raw.keys().collect();
        ids.sort_by_key(|id| id.parse::<u64>().unwrap_or(u64::MAX));
        let objects: Vec<Value> = ids.iter().filter_map(|id| self.object(id, self.raw[*id].as_array()?)).collect();
        let truncated = objects.len() > MAX_OBJECTS;
        (objects.into_iter().take(MAX_OBJECTS).collect(), truncated)
    }
}

/// One raw step as a `line` (or `exception`) event. `lines` remembers each frame's last line, so callers
/// show the line of their call.
fn step_event(step: &Value, file: &str, lines: &mut HashMap<String, u64>, returns: Vec<Value>, caught: bool) -> Value {
    let empty = Map::new();
    let mut heap = Heap { raw: step.get("heap").and_then(Value::as_object).unwrap_or(&empty), links: HashMap::new() };
    heap.links = heap.self_links();
    let line = step.get("line").and_then(Value::as_u64).unwrap_or(1).max(1);
    let stack: Vec<&Value> = step.get("stack_to_render").and_then(Value::as_array).map(|s| s.iter().filter(|f| f.get("is_zombie") != Some(&Value::Bool(true))).collect()).unwrap_or_default();
    let top_id = stack.iter().find(|f| f.get("is_highlighted") == Some(&Value::Bool(true))).or(stack.last()).map(|f| format!("py{}", f.get("frame_id").map(|v| v.to_string()).unwrap_or_default()));
    let current = top_id.clone().unwrap_or_else(|| "py-module".into());
    lines.insert(current.clone(), line);
    let mut frames: Vec<Value> = stack.iter().rev().map(|f| {
        let id = format!("py{}", f.get("frame_id").map(|v| v.to_string()).unwrap_or_default());
        let locals_raw = f.get("encoded_locals").and_then(Value::as_object);
        let locals: Vec<Value> = f.get("ordered_varnames").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str)
            .filter_map(|name| locals_raw.and_then(|l| l.get(name)).map(|v| heap.variable(if name == "__return__" { "Return value" } else { name }, v)))
            .collect();
        json!({"id": id, "method": f.get("func_name").and_then(Value::as_str).unwrap_or("?"), "file": file, "line": lines.get(&id).copied().unwrap_or(line), "locals": locals})
    }).collect();
    let globals_raw = step.get("globals").and_then(Value::as_object);
    let globals: Vec<Value> = step.get("ordered_globals").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str)
        .filter_map(|name| globals_raw.and_then(|g| g.get(name)).map(|v| heap.variable(name, v))).collect();
    // The same budget as the Java worker: 48 frames per step, the innermost ones and the module.
    let frames_truncated = frames.len() > MAX_FRAMES - 1;
    frames.truncate(MAX_FRAMES - 1);
    frames.push(json!({"id": "py-module", "method": "<module>", "file": file, "line": lines.get("py-module").copied().unwrap_or(line), "locals": globals}));
    let (objects, truncated) = heap.objects();
    let mut event = json!({"kind": "line", "location": {"file": file, "line": line, "phase": "before"}, "frames": frames, "statics": [], "heap": objects});
    if truncated { event["heapTruncated"] = json!(true); }
    if frames_truncated { event["framesTruncated"] = json!(true); }
    if !returns.is_empty() { event["returns"] = json!(returns); }
    if event_name(step) == "exception" {
        let message = step.get("exception_msg").and_then(Value::as_str).unwrap_or("");
        let (kind, text) = message.split_once(": ").unwrap_or((message, ""));
        event["kind"] = json!("exception");
        event["exception"] = json!({"type": kind, "message": text, "caught": caught});
    }
    event
}

/// Python's own wording without the "(<string>, line N)" suffix of syntax errors.
fn clean_message(message: &str) -> String {
    match message.find(" (<string>, line ") { Some(at) => message[..at].to_string(), None => message.to_string() }
}

/// Events for a Python run. In trace mode the first event is `native` with the raw pg_logger result.
pub fn events(file: &str, finish: Finish, record: bool) -> Vec<Value> {
    let mut out = Vec::new();
    let end = |reason: &str, message: String| json!({"kind": "terminated", "stopReason": reason, "message": message, "recorded": record});
    let value = match finish {
        Finish::Done(value) => value,
        Finish::Timeout => { out.push(end("timeout", "The program ran out of time and was stopped. Look for a loop that doesn't end or a very slow line.".into())); return out; }
        Finish::Cancelled => { out.push(end("cancelled", "Stopped.".into())); return out; }
        Finish::TooLarge => { out.push(end("trace-limit", "The recording grew too large. Lower the step limit or shrink the data the program builds.".into())); return out; }
        Finish::Crashed(message) => { out.push(end("worker-error", message)); return out; }
    };
    if !record {
        // A plain run (tests): output, then the outcome.
        let stdout = value.get("stdout").and_then(Value::as_str).unwrap_or("");
        if !stdout.is_empty() { out.push(json!({"kind": "output", "stream": "stdout", "text": stdout})); }
        let message = value.get("message").and_then(Value::as_str).unwrap_or("").to_string();
        let terminated = match value.get("status").and_then(Value::as_str).unwrap_or("ok") {
            "error" if message.starts_with("SyntaxError") || message.starts_with("IndentationError") || message.starts_with("TabError") => {
                out.push(json!({"kind": "diagnostic", "severity": "error", "file": file, "line": value.get("error_line").and_then(Value::as_u64).unwrap_or(1), "column": 1, "message": clean_message(&message)}));
                end("compile-error", "Python couldn't read the program, so it didn't run.".into())
            }
            "error" if message.starts_with("OutputLimitExceeded") => { let mut e = end("output-limit", "The program printed more than 32,768 characters, which usually means a loop that doesn't end.".into()); e["outputTruncated"] = json!(true); e }
            "error" => {
                let (kind, text) = message.split_once(": ").unwrap_or((&message, ""));
                let exception = json!({"type": kind, "message": text, "caught": false});
                let mut ev = json!({"kind": "exception", "exception": exception});
                if let Some(line) = value.get("error_line").and_then(Value::as_u64) { ev["location"] = json!({"file": file, "line": line, "phase": "before"}); }
                out.push(ev);
                let mut e = end("exception", format!("The program stopped with {message}."));
                e["exception"] = exception;
                e
            }
            "needs_input" => end("needs-input", needs_input(&message)),
            _ => { let mut e = end("completed", "The program finished.".into()); e["exitCode"] = json!(0); e }
        };
        out.push(terminated);
        return out;
    }
    let compact = value.get("format").and_then(Value::as_str) == Some("compact-1");
    let raw: Vec<Value> = if compact { expand(&value) } else { value.as_array().cloned().unwrap_or_default() };
    let summary = summarize(raw);
    let status = summary["status"].as_str().unwrap_or("ok").to_string();
    let message = summary["message"].as_str().unwrap_or("").to_string();
    let trace = summary["trace"].as_array().cloned().unwrap_or_default();
    let error_step = summary["error_step"].as_u64().map(|s| s as usize);
    // The browser gets the compact form (web/pyquiz/adapter.ts expands it), with the same steps kept.
    let mut native = summary.clone();
    if compact {
        native["trace"] = Value::Array(value["trace"].as_array().map(|t| t.iter().filter(|s| s.get("heap").is_some()).cloned().collect()).unwrap_or_default());
        for key in ["format", "frames", "heap"] { native[key] = value[key].clone(); }
        native["output"] = value["stdout"].clone();
    }
    out.push(json!({"kind": "native", "language": "python", "result": native}));
    if trace.is_empty() && status == "error" {
        let line = summary["error_line"].as_u64().unwrap_or(1).max(1);
        let column = summary["error_offset"].as_u64().unwrap_or(1).max(1);
        if message.starts_with("SyntaxError") || message.starts_with("IndentationError") || message.starts_with("TabError") {
            out.push(json!({"kind": "diagnostic", "severity": "error", "file": file, "line": line, "column": column, "message": clean_message(&message)}));
            out.push(json!({"kind": "terminated", "stopReason": "compile-error", "message": "Python couldn't read the program, so it didn't run.", "steps": 0, "recorded": true}));
            return out;
        }
    }
    let mut lines = HashMap::new();
    let mut printed = 0usize;
    let mut pending: Vec<Value> = Vec::new();
    let mut last_event: Option<Value> = None;
    for (i, step) in trace.iter().enumerate() {
        let stdout = step.get("stdout").and_then(Value::as_str).unwrap_or("");
        if stdout.len() > printed && stdout.is_char_boundary(printed) {
            out.push(json!({"kind": "output", "stream": "stdout", "text": &stdout[printed..]}));
            printed = stdout.len();
        }
        let caught = !(status == "error" && error_step.is_some_and(|k| i >= k));
        let event = step_event(step, file, &mut lines, std::mem::take(&mut pending), caught);
        // A function's return value is reported on the next step, as `returns`.
        if event_name(step) == "return" && step.get("func_name").and_then(Value::as_str) != Some("<module>") {
            if let Some(top) = event["frames"].get(0) {
                let value = top["locals"].as_array().and_then(|l| l.iter().find(|v| v["name"] == "Return value")).map(|v| v["value"].clone());
                pending.push(match value { Some(v) if v["kind"] != "null" => json!({"method": top["method"], "frameId": top["id"], "value": v}), _ => json!({"method": top["method"], "frameId": top["id"], "void": true}) });
            }
        }
        last_event = Some(event.clone());
        out.push(event);
    }
    let steps = trace.len();
    let terminated = match status.as_str() {
        "error" if message.starts_with("OutputLimitExceeded") => json!({"kind": "terminated", "stopReason": "output-limit", "message": "The program printed more than 32,768 characters, which usually means a loop that doesn't end.", "outputTruncated": true, "steps": steps, "recorded": true}),
        "error" => {
            let (kind, text) = message.split_once(": ").unwrap_or((&message, ""));
            let exception = json!({"type": kind, "message": text, "caught": false});
            if error_step.is_none() {
                // An error pg_logger reported without a step of its own: show it on the last recorded state.
                let mut ev = last_event.unwrap_or_else(|| json!({"kind": "exception"}));
                ev["kind"] = json!("exception");
                ev["exception"] = exception.clone();
                if let Some(line) = summary["error_line"].as_u64() { ev["location"] = json!({"file": file, "line": line, "phase": "before"}); }
                out.push(ev);
            }
            json!({"kind": "terminated", "stopReason": "exception", "message": format!("The program stopped with {}.", clean_message(&message)), "exception": exception, "steps": steps, "recorded": true})
        }
        "step_limit" => json!({"kind": "terminated", "stopReason": "step-limit", "message": format!("Recording stopped after {steps} steps. Raise the step limit in Project settings, or look for a loop that doesn't end."), "steps": steps, "recorded": true}),
        "needs_input" => json!({"kind": "terminated", "stopReason": "needs-input", "message": needs_input(&message), "steps": steps, "recorded": true}),
        _ => json!({"kind": "terminated", "stopReason": "completed", "message": "The program finished.", "exitCode": 0, "steps": steps, "recorded": true}),
    };
    out.push(terminated);
    out
}

fn needs_input(prompt: &str) -> String {
    format!("The program called input(){} but the Input tab has no more lines. Add a line to Input and run again.", if prompt.is_empty() { String::new() } else { format!(" with the prompt {}", py_repr(prompt)) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(line: u64, event: &str, stack: Value, globals: Value, heap: Value, stdout: &str) -> Value {
        json!({"line": line, "event": event, "func_name": "f", "globals": globals, "ordered_globals": globals.as_object().map(|g| g.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(), "stack_to_render": stack, "heap": heap, "stdout": stdout})
    }

    #[test]
    fn values_and_heap_objects_map_to_tracelab_shapes() {
        let heap = json!({"1": ["FUNCTION", "length(n)", null], "2": ["LIST", 1, 2.5, "a'b", null, true, ["REF", 3]], "3": ["INSTANCE", "Node", ["next", null], ["val", 1]], "4": ["DICT", ["k", ["SPECIAL_FLOAT", "3.0"]]]});
        let raw = vec![step(3, "step_line", json!([]), json!({"length": ["REF", 1], "xs": ["REF", 2], "d": ["REF", 4]}), heap, "hi\n")];
        let events = events("main.py", Finish::Done(Value::Array(raw)), true);
        assert_eq!(events[0]["kind"], "native");
        assert_eq!(events[1]["kind"], "output");
        let line = &events[2];
        let globals = line["frames"][0]["locals"].as_array().unwrap();
        assert_eq!(line["frames"][0]["method"], "<module>");
        assert_eq!(globals.iter().find(|g| g["name"] == "length").unwrap()["value"]["value"], "function length(n)");
        let list = line["heap"].as_array().unwrap().iter().find(|o| o["id"] == "o2").unwrap();
        let values: Vec<&str> = list["elements"].as_array().unwrap().iter().map(|e| e["value"].as_str().unwrap_or("")).collect();
        assert_eq!(values[..5], ["1", "2.5", "\"a'b\"", "None", "True"]);
        assert_eq!(list["elements"][5]["ref"], "o3");
        let dict = line["heap"].as_array().unwrap().iter().find(|o| o["kind"] == "map").unwrap();
        assert_eq!(dict["entries"][0]["value"]["value"], "3.0");
        assert_eq!(events.last().unwrap()["stopReason"], "completed");
    }

    #[test]
    fn uncaught_exceptions_returns_and_caller_lines() {
        let frame = |id: u64, name: &str, locals: Value, top: bool| json!({"func_name": name, "frame_id": id, "is_highlighted": top, "is_zombie": false, "ordered_varnames": locals.as_object().unwrap().keys().cloned().collect::<Vec<_>>(), "encoded_locals": locals});
        let raw = vec![
            step(5, "step_line", json!([]), json!({}), json!({}), ""),
            step(1, "call", json!([frame(1, "half", json!({"n": 4}), true)]), json!({}), json!({}), ""),
            step(2, "return", json!([frame(1, "half", json!({"n": 4, "__return__": 2}), true)]), json!({}), json!({}), ""),
            step(6, "step_line", json!([]), json!({"x": 2}), json!({}), ""),
            json!({"line": 6, "event": "exception", "func_name": "<module>", "globals": {"x": 2}, "ordered_globals": ["x"], "stack_to_render": [], "heap": {}, "stdout": "", "exception_msg": "ZeroDivisionError: division by zero"}),
        ];
        let events = events("main.py", Finish::Done(Value::Array(raw)), true);
        let lines: Vec<&Value> = events.iter().filter(|e| e["kind"] == "line" || e["kind"] == "exception").collect();
        assert_eq!(lines[1]["frames"][1]["line"], 5, "the module frame shows the line of the call");
        assert!(lines[2]["frames"][0]["locals"].as_array().unwrap().iter().any(|v| v["name"] == "Return value"));
        assert_eq!(lines[3]["returns"][0]["value"]["value"], "2");
        assert_eq!(lines[4]["exception"]["type"], "ZeroDivisionError");
        assert_eq!(lines[4]["exception"]["caught"], false);
        assert_eq!(events.last().unwrap()["stopReason"], "exception");
        assert_eq!(events[0]["result"]["error_step"], 4);
    }

    #[test]
    fn the_compact_trace_expands_to_the_same_events() {
        let raw = vec![
            json!({"line": 1, "event": "step_line", "func_name": "<module>", "globals": {}, "ordered_globals": [], "stack_to_render": [], "heap": {}, "stdout": ""}),
            json!({"line": 2, "event": "step_line", "func_name": "<module>", "globals": {"xs": ["REF", 1]}, "ordered_globals": ["xs"], "stack_to_render": [], "heap": {"1": ["LIST", 1, 2]}, "stdout": "é\n"}),
            json!({"line": 3, "event": "step_line", "func_name": "<module>", "globals": {"xs": ["REF", 1]}, "ordered_globals": ["xs"], "stack_to_render": [], "heap": {"1": ["LIST", 1, 2]}, "stdout": "é\nok\n"}),
        ];
        let compact = json!({"format": "compact-1", "frames": [], "heap": [["1", ["LIST", 1, 2]]], "stdout": "é\nok\n", "trace": [
            {"line": 1, "event": "step_line", "func_name": "<module>", "globals": {}, "ordered_globals": [], "stack_to_render": [], "heap": [], "stdout": 0},
            {"line": 2, "event": "step_line", "func_name": "<module>", "globals": {"xs": ["REF", 1]}, "ordered_globals": ["xs"], "stack_to_render": [], "heap": [0], "stdout": 2},
            {"line": 3, "event": "step_line", "func_name": "<module>", "globals": {"xs": ["REF", 1]}, "ordered_globals": ["xs"], "stack_to_render": [], "heap": [0], "stdout": 5},
        ]});
        assert_eq!(expand(&compact), raw);
        let a = events("main.py", Finish::Done(Value::Array(raw)), true);
        let b = events("main.py", Finish::Done(compact), true);
        assert_eq!(a[1..], b[1..]);
        assert_eq!(b[0]["result"]["format"], "compact-1");
    }

    #[test]
    fn syntax_errors_input_requests_and_plain_runs() {
        let syntax = vec![json!({"event": "uncaught_exception", "line": 2, "offset": 9, "exception_msg": "SyntaxError: expected ':' (<string>, line 2)"})];
        let events = events("main.py", Finish::Done(Value::Array(syntax)), true);
        assert_eq!(events[1]["kind"], "diagnostic");
        assert_eq!(events[1]["message"], "SyntaxError: expected ':'");
        assert_eq!(events[1]["column"], 9);
        let input = vec![step(1, "step_line", json!([]), json!({}), json!({}), ""), json!({"event": "raw_input", "prompt": "Name? "})];
        assert_eq!(super::events("main.py", Finish::Done(Value::Array(input)), true).last().unwrap()["stopReason"], "needs-input");
        let plain = super::events("main.py", Finish::Done(json!({"status": "error", "message": "ValueError: bad", "error_line": 3, "stdout": "a\n"})), false);
        assert_eq!(plain[0]["text"], "a\n");
        assert_eq!(plain[1]["exception"]["type"], "ValueError");
        assert_eq!(plain[2]["stopReason"], "exception");
        assert_eq!(input_lines("1\r\n2\n"), vec!["1", "2"]);
        assert_eq!(py_repr("it's\n"), "\"it's\\n\"");
    }
}
