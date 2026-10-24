use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{Arc, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, BufReader}, process::Command, sync::{Mutex, Semaphore}};
use tower_http::services::{ServeDir, ServeFile};

mod assist;
mod lsp;

const MAX_TRACE_BYTES: usize = 24 * 1024 * 1024;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
struct SourceFile { name: String, content: String }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    files: Vec<SourceFile>,
    main_class: String,
    #[serde(default)] stdin: String,
    #[serde(default = "default_steps")] max_steps: usize,
    #[serde(default = "default_timeout")] timeout_ms: u64,
    /// "trace" records with JDI; "run" runs without recording; "compile" only compiles.
    #[serde(default = "default_mode")] mode: String,
}
fn default_mode() -> String { "trace".into() }
fn default_steps() -> usize { 500 }
fn default_timeout() -> u64 { 8000 }

struct Run {
    id: String,
    request: RunRequest,
    events: Vec<Value>,
    status: String,
    cancel: Arc<AtomicBool>,
}
type SharedRun = Arc<Mutex<Run>>;

#[derive(Clone)]
struct AppState {
    runs: Arc<Mutex<HashMap<String, SharedRun>>>,
    slots: Arc<Semaphore>,
    root: PathBuf,
    java: PathBuf,
    lsp: Arc<lsp::Lsp>,
    assist: Arc<assist::Assist>,
}

type ApiError = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: &str) -> ApiError { (status, Json(json!({"error": message}))) }
fn identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn validate(request: &RunRequest) -> Result<(), &'static str> {
    if request.files.is_empty() || request.files.len() > 20 { return Err("Provide between 1 and 20 Java source files."); }
    if request.main_class.len() > 200 || !request.main_class.split('.').all(identifier) { return Err("The entry class must be a Java class name, such as Main or demo.Main."); }
    if request.stdin.len() > 16_384 { return Err("Input is limited to 16 KiB."); }
    if !(10..=2000).contains(&request.max_steps) { return Err("The trace budget must be between 10 and 2,000 steps."); }
    if !(500..=15000).contains(&request.timeout_ms) { return Err("The time budget must be between 500 and 15,000 ms."); }
    if !["trace", "run", "compile"].contains(&request.mode.as_str()) { return Err("The mode must be trace, run or compile."); }
    check_files(&request.files)
}

/// Path, name and size rules shared by runs and the language-server workspace.
fn check_files(files: &[SourceFile]) -> Result<(), &'static str> {
    let mut total = 0;
    let mut names = HashSet::new();
    for file in files {
        let Some(stem) = file.name.strip_suffix(".java") else { return Err("Only .java files are supported."); };
        if file.name.len() > 180 || !stem.split('/').all(identifier) { return Err("Use relative Java paths such as Main.java or demo/Main.java."); }
        for part in stem.split('/') {
            let upper = part.to_ascii_uppercase();
            if ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(&upper.as_str()) { return Err("A source path uses a reserved system name."); }
        }
        if !names.insert(file.name.to_ascii_lowercase()) { return Err("Source file names must be unique, ignoring case."); }
        if file.content.len() > 65_536 { return Err("Each source file is limited to 64 KiB."); }
        total += file.content.len();
    }
    if total > 262_144 { return Err("A project is limited to 256 KiB of source."); }
    Ok(())
}

async fn guard(req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !["localhost:4317", "127.0.0.1:4317"].contains(&host) {
        return error(StatusCode::FORBIDDEN, "This development runner accepts localhost requests only.").into_response();
    }
    if let Some(origin) = req.headers().get(header::ORIGIN) {
        let origin = origin.to_str().unwrap_or("");
        if !["http://localhost:4317", "http://127.0.0.1:4317", "http://localhost:5173", "http://127.0.0.1:5173"].contains(&origin) {
            return error(StatusCode::FORBIDDEN, "Cross-origin access is disabled.").into_response();
        }
    }
    if req.uri().path().starts_with("/api/") && req.uri().path() != "/api/health"
        && req.headers().get("x-tracelab-client").and_then(|v| v.to_str().ok()) != Some("browser-v1") {
        return error(StatusCode::FORBIDDEN, "Missing TraceLab client header.").into_response();
    }
    let mut response = next.run(req).await;
    response.headers_mut().insert("x-content-type-options", "nosniff".parse().unwrap());
    response.headers_mut().insert("referrer-policy", "no-referrer".parse().unwrap());
    response.headers_mut().insert("cache-control", "no-store".parse().unwrap());
    response
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"ok": true, "language": "Java 21", "mode": "local-trusted", "engine": "Rust + JDI", "workerReady": state.root.join(".local/worker/TraceWorker.class").exists(), "languageServer": state.lsp.status().await["state"]}))
}

async fn create_run(State(state): State<AppState>, Json(request): Json<RunRequest>) -> Result<Json<Value>, ApiError> {
    validate(&request).map_err(|msg| error(StatusCode::BAD_REQUEST, msg))?;
    let permit = state.slots.clone().try_acquire_owned().map_err(|_| error(StatusCode::CONFLICT, "A program is already running. Stop it or wait for it to finish."))?;
    let id = format!("{}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis(), NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let run = Arc::new(Mutex::new(Run { id: id.clone(), request: request.clone(), events: Vec::new(), status: "running".into(), cancel: Arc::new(AtomicBool::new(false)) }));
    {
        let mut runs = state.runs.lock().await;
        if runs.len() >= 8 {
            let oldest = runs.keys().min().cloned();
            if let Some(key) = oldest { runs.remove(&key); }
        }
        runs.insert(id.clone(), run.clone());
    }
    tokio::spawn(async move {
        if let Err(message) = execute(&state, &request, &run).await {
            append(&run, json!({"kind": "terminated", "stopReason": "worker-error", "message": message})).await;
        }
        // Release the job slot before reporting completion, so a client that starts its next run
        // as soon as it sees "finished" is never rejected as busy.
        drop(permit);
        run.lock().await.status = "finished".into();
    });
    Ok(Json(json!({"id": id})))
}

#[derive(Deserialize)]
struct EventsQuery { since: Option<usize> }

/// Returns the run with events whose sequence is at least `since` (default 0), so pollers can fetch increments.
async fn get_run(State(state): State<AppState>, Path(id): Path<String>, Query(query): Query<EventsQuery>) -> Result<Json<Value>, ApiError> {
    let run = state.runs.lock().await.get(&id).cloned().ok_or_else(|| error(StatusCode::NOT_FOUND, "Run not found. Runs are retained in memory until restart or eviction."))?;
    let run = run.lock().await;
    let since = query.since.unwrap_or(0).min(run.events.len());
    Ok(Json(json!({"id": run.id, "status": run.status, "request": run.request, "since": since, "total": run.events.len(), "events": &run.events[since..]})))
}

async fn cancel_run(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let run = state.runs.lock().await.get(&id).cloned().ok_or_else(|| error(StatusCode::NOT_FOUND, "Run not found."))?;
    run.lock().await.cancel.store(true, Ordering::Relaxed);
    Ok(Json(json!({"ok": true})))
}

// ---------- AI assistant (optional) ----------

async fn assist_config(State(state): State<AppState>) -> Json<Value> { Json(state.assist.status()) }
async fn assist_save(State(state): State<AppState>, Json(body): Json<assist::ConfigUpdate>) -> Result<Json<Value>, ApiError> {
    state.assist.save(body).map(Json).map_err(|msg| error(StatusCode::BAD_REQUEST, &msg))
}
async fn assist_clear(State(state): State<AppState>) -> Json<Value> { Json(state.assist.clear()) }
async fn assist_models(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    state.assist.models().await.map(|ids| Json(json!({"models": ids}))).map_err(|msg| error(StatusCode::BAD_GATEWAY, &msg))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest { messages: Vec<assist::ChatMessage>, #[serde(default = "default_tokens")] max_tokens: u32 }
fn default_tokens() -> u32 { 900 }
async fn assist_chat(State(state): State<AppState>, Json(body): Json<ChatRequest>) -> Result<Json<Value>, ApiError> {
    state.assist.start_chat(body.messages, body.max_tokens).await.map(|id| Json(json!({"id": id}))).map_err(|msg| error(StatusCode::CONFLICT, &msg))
}
async fn assist_poll(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    state.assist.chat(&id).await.map(Json).ok_or_else(|| error(StatusCode::NOT_FOUND, "That answer is no longer available."))
}
async fn assist_cancel(State(state): State<AppState>, Path(id): Path<String>) -> Json<Value> { state.assist.cancel(&id).await; Json(json!({"ok": true})) }

// ---------- Language server ----------

async fn lsp_status(State(state): State<AppState>) -> Json<Value> { Json(state.lsp.status().await) }

async fn lsp_stop(State(state): State<AppState>) -> Json<Value> { state.lsp.stop().await; Json(state.lsp.status().await) }

async fn lsp_start(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    state.lsp.start().await.map(Json).map_err(|msg| error(StatusCode::SERVICE_UNAVAILABLE, &msg))
}

#[derive(Deserialize)]
struct LspFiles { files: Vec<SourceFile> }
async fn lsp_files(State(state): State<AppState>, Json(body): Json<LspFiles>) -> Result<Json<Value>, ApiError> {
    if body.files.len() > 20 { return Err(error(StatusCode::BAD_REQUEST, "Provide at most 20 Java source files.")); }
    check_files(&body.files).map_err(|msg| error(StatusCode::BAD_REQUEST, msg))?;
    state.lsp.write_files(&body.files).await.map(Json).map_err(|msg| error(StatusCode::INTERNAL_SERVER_ERROR, &msg))
}

#[derive(Deserialize)]
struct LspSend { session: u64, messages: Vec<Value> }
async fn lsp_send(State(state): State<AppState>, Json(body): Json<LspSend>) -> Result<Json<Value>, ApiError> {
    if body.messages.len() > 200 { return Err(error(StatusCode::BAD_REQUEST, "Too many messages in one request.")); }
    state.lsp.send(body.session, &body.messages).await.map(|_| Json(json!({"ok": true}))).map_err(|msg| error(StatusCode::CONFLICT, &msg))
}

#[derive(Deserialize)]
struct LspReceive { session: u64, since: usize, wait: Option<u64> }
async fn lsp_receive(State(state): State<AppState>, Query(query): Query<LspReceive>) -> Json<Value> {
    Json(state.lsp.receive(query.session, query.since, Duration::from_millis(query.wait.unwrap_or(15_000).min(25_000))).await)
}

async fn append(run: &SharedRun, mut event: Value) {
    let mut run = run.lock().await;
    event["sequence"] = json!(run.events.len());
    event["schemaVersion"] = json!(1);
    event["runId"] = json!(run.id);
    run.events.push(event);
}

async fn kill_tree(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        { let _ = Command::new("taskkill.exe").args(["/PID", &pid.to_string(), "/T", "/F"]).output().await; }
        #[cfg(unix)]
        { let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pid}")]).output().await; }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn execute(state: &AppState, request: &RunRequest, run: &SharedRun) -> Result<(), String> {
    let jobs = state.root.join(".local/jobs");
    tokio::fs::create_dir_all(&jobs).await.map_err(|e| e.to_string())?;
    let dir = tempfile::Builder::new().prefix("run-").tempdir_in(&jobs).map_err(|e| e.to_string())?;
    for file in &request.files {
        let dest = dir.path().join("src").join(&file.name);
        tokio::fs::create_dir_all(dest.parent().unwrap()).await.map_err(|e| e.to_string())?;
        tokio::fs::write(dest, &file.content).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(dir.path().join("stdin.txt"), &request.stdin).await.map_err(|e| e.to_string())?;
    let mut command = Command::new(&state.java);
    command.args(["-Xmx256m", "--add-modules", "jdk.jdi", "-cp"])
        .arg(state.root.join(".local/worker")).arg("TraceWorker")
        .arg(dir.path()).arg(&request.main_class).arg(request.max_steps.to_string()).arg(request.timeout_ms.to_string()).arg(&request.mode)
        .current_dir(dir.path()).stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    // Prevent inherited JVM options from altering the compiler, target, or NDJSON protocol.
    for key in ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH"] { command.env_remove(key); }
    #[cfg(unix)]
    { use std::os::unix::process::CommandExt; command.as_std_mut().process_group(0); }
    let mut child = command.spawn().map_err(|e| format!("Cannot start the JDK worker: {e}"))?;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let stderr = child.stderr.take().unwrap();
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.take(16_384).read_to_string(&mut text).await;
        text
    });
    let deadline = tokio::time::sleep(Duration::from_millis(request.timeout_ms + 15_000));
    tokio::pin!(deadline);
    let cancel = run.lock().await.cancel.clone();
    let mut cancelled_at = None;
    let mut bytes = 0;
    let mut terminated = false;
    let mut forced_reason = None;
    let mut control_tick = tokio::time::interval(Duration::from_millis(80));
    loop {
        tokio::select! {
            _ = &mut deadline => { forced_reason = Some("timeout"); break; }
            _ = control_tick.tick() => {
                if cancel.load(Ordering::Relaxed) && cancelled_at.is_none() {
                    let _ = tokio::fs::write(dir.path().join("cancel"), "cancel").await;
                    cancelled_at = Some(std::time::Instant::now());
                }
                if cancelled_at.is_some_and(|t| t.elapsed() > Duration::from_secs(2)) { forced_reason = Some("cancelled"); break; }
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        bytes += line.len();
                        if bytes > MAX_TRACE_BYTES { forced_reason = Some("trace-limit"); break; }
                        match serde_json::from_str::<Value>(&line) {
                            Ok(event) if event.is_object() => {
                                terminated |= event["kind"] == "terminated";
                                append(run, event).await;
                            }
                            _ => { forced_reason = Some("worker-error"); break; }
                        }
                    }
                    Ok(None) => break,
                    Err(_) => { forced_reason = Some("worker-error"); break; }
                }
            }
        }
    }
    if let Some(reason) = forced_reason {
        kill_tree(&mut child).await;
        if !terminated { append(run, json!({"kind": "terminated", "stopReason": reason, "message": "Execution stopped. All available trace events have been preserved."})).await; }
    } else {
        match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(_) => {},
            Err(_) => { kill_tree(&mut child).await; }
        }
    }
    let stderr = stderr_task.await.unwrap_or_default();
    if !terminated && forced_reason.is_none() {
        return Err(format!("The trace worker stopped unexpectedly. {}", stderr.chars().take(2000).collect::<String>()));
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let root = std::env::var_os("TRACELAB_ROOT").map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap());
    let java_home = std::env::var_os("JAVA_HOME").expect("Set JAVA_HOME to a JDK 21+ or start with npm start.");
    let state = AppState { runs: Arc::new(Mutex::new(HashMap::new())), slots: Arc::new(Semaphore::new(1)), root: root.clone(), java: PathBuf::from(&java_home).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" }), lsp: lsp::Lsp::new(&root),
        assist: assist::Assist::new(&root, PathBuf::from(&java_home).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" })) };
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/runs", post(create_run))
        .route("/api/runs/{id}", get(get_run).merge(delete(cancel_run)))
        .route("/api/assist/config", get(assist_config).merge(post(assist_save)).merge(delete(assist_clear)))
        .route("/api/assist/models", post(assist_models))
        .route("/api/assist/chat", post(assist_chat))
        .route("/api/assist/chat/{id}", get(assist_poll).merge(delete(assist_cancel)))
        .route("/api/lsp/status", get(lsp_status))
        .route("/api/lsp/start", post(lsp_start))
        .route("/api/lsp/stop", post(lsp_stop))
        .route("/api/lsp/files", post(lsp_files))
        .route("/api/lsp/send", post(lsp_send))
        .route("/api/lsp/receive", get(lsp_receive))
        .fallback_service(ServeDir::new(root.join("dist")).not_found_service(ServeFile::new(root.join("dist/404.html"))))
        .layer(DefaultBodyLimit::max(512 * 1024))
        .layer(middleware::from_fn(guard))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4317").await.expect("Port 4317 is in use.");
    println!("TraceLab: http://127.0.0.1:4317\nLocal trusted-code runner · Java 21 · Rust + JDI");
    axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = tokio::signal::ctrl_c().await;
        for run in state.runs.lock().await.values() { run.lock().await.cancel.store(true, Ordering::Relaxed); }
        state.lsp.stop().await;
        tokio::time::sleep(Duration::from_secs(3)).await;
    }).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(name: &str) -> RunRequest {
        RunRequest { files: vec![SourceFile { name: name.into(), content: "class Main {}".into() }], main_class: "Main".into(), stdin: String::new(), max_steps: 100, timeout_ms: 1000, mode: "trace".into() }
    }
    #[test] fn paths_cannot_escape_workspace() {
        for name in ["../Main.java", "/Main.java", "C:/Main.java", "a\\Main.java", "a/../Main.java", "CON.java", "Main.java.exe"] { assert!(validate(&request(name)).is_err(), "{name}"); }
        assert!(validate(&request("demo/Main.java")).is_ok());
    }
    #[test] fn duplicate_paths_and_invalid_main_are_rejected() {
        let mut req = request("Main.java");
        req.files.push(SourceFile { name: "main.java".into(), content: "".into() });
        assert!(validate(&req).is_err());
        let mut req = request("Main.java"); req.main_class = "Main -javaagent:bad".into();
        assert!(validate(&req).is_err());
        let mut req = request("Main.java"); req.mode = "shell".into();
        assert!(validate(&req).is_err());
    }
}
