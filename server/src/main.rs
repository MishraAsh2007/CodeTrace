//! CodeTrace Python Visualizer: Rust API server.
//!
//! Serves the React IDE (frontend/dist) and a small JSON API:
//!   GET  /api/health    is the tracer ready? which Python?
//!   POST /api/run-code  run Python code, return the step-by-step pg_logger trace
//!
//! Python is only used for tracing: each run is handed to `python tracer.py --worker`.
//! The AI tutor runs in the browser. Users pick a provider, model and API key in the
//! IDE's AI settings, so this server never sees or stores an AI key.

mod tracer;

use std::{
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State, rejection::JsonRejection},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
};

const MAX_CODE_CHARS: usize = 50_000;
const MAX_STDIN_LINES: usize = 200;

struct AppState {
    tracer: Arc<tracer::Tracer>,
    python_version: String,
}

type Shared = Arc<AppState>;

// ---------------------------------------------------------------------------
// Errors: always {"detail": "..."} so the frontend has one shape to handle
// ---------------------------------------------------------------------------

pub struct ApiError {
    status: StatusCode,
    detail: String,
}

impl ApiError {
    pub fn new(status: StatusCode, detail: impl Into<String>) -> Self {
        Self { status, detail: detail.into() }
    }
    fn invalid(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, detail)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.detail }))).into_response()
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        Self::new(rejection.status(), rejection.body_text())
    }
}

type ApiResult<T> = Result<T, ApiError>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RunCodeRequest {
    code: String,
    #[serde(default)]
    stdin: Vec<String>,
}

fn check_code(code: &str) -> ApiResult<()> {
    if code.chars().count() > MAX_CODE_CHARS {
        return Err(ApiError::invalid(format!("code is longer than {MAX_CODE_CHARS} characters")));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health(State(state): State<Shared>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "tracer_ready": state.tracer.is_ready(),
        "python": state.python_version,
        "server": "rust",
    }))
}

async fn run_code(
    State(state): State<Shared>,
    body: Result<Json<RunCodeRequest>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    let Json(req) = body?;
    check_code(&req.code)?;
    if req.stdin.len() > MAX_STDIN_LINES {
        return Err(ApiError::invalid(format!("stdin has more than {MAX_STDIN_LINES} lines")));
    }
    // Bugs in the user's program come back as `status: "error"` with HTTP 200.
    // Only a broken tracer setup is an HTTP error.
    let result = state
        .tracer
        .run(&req.code, &req.stdin)
        .await
        .map_err(|e| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    Ok(Json(result))
}

async fn api_not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Unknown API route")
}

async fn frontend_missing() -> (StatusCode, Html<&'static str>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Html("<h1>Frontend not built</h1><p>Run <code>.\\run.ps1</code> from the project folder; it builds the React app first.</p>"),
    )
}

/// Vite puts content hashes in /assets/* filenames, so those can be cached forever.
/// Everything else (index.html) is revalidated so rebuilds show up on reload.
async fn cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut res = next.run(req).await;
    if !path.starts_with("/api") {
        let value = if path.starts_with("/assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    res
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/// The project root holds tracer.py, pg_logger.py, .env and frontend/.
fn project_root() -> PathBuf {
    if let Ok(root) = env::var("KIRO_ROOT") {
        return PathBuf::from(root);
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for dir in [cwd.as_path(), cwd.parent().unwrap_or(&cwd)] {
        if dir.join("tracer.py").is_file() {
            return dir.to_path_buf();
        }
    }
    cwd
}

fn find_python(root: &Path) -> PathBuf {
    if let Ok(p) = env::var("PYTHON") {
        return PathBuf::from(p);
    }
    let venv = if cfg!(windows) { root.join(".venv/Scripts/python.exe") } else { root.join(".venv/bin/python") };
    if venv.is_file() {
        return venv;
    }
    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

fn python_version(python: &Path) -> String {
    std::process::Command::new(python)
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(if o.stdout.is_empty() { &o.stderr } else { &o.stdout }).trim().replace("Python ", ""))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "not found".into())
}

fn env_number<T: std::str::FromStr>(name: &str, default: T) -> T {
    env::var(name).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default)
}

#[tokio::main]
async fn main() {
    let root = project_root();
    let _ = dotenvy::from_path(root.join(".env")); // optional: only tracer/port settings live there

    let python = find_python(&root);
    let python_version = python_version(&python);
    let tracer = Arc::new(tracer::Tracer::new(
        python.clone(),
        root.clone(),
        Duration::from_secs_f64(env_number("TRACE_TIMEOUT_SECONDS", 5.0)),
        env::var("TRACE_ALLOW_ALL_MODULES").is_ok_and(|v| v.trim() == "1"),
    ));
    tracer.warm().await;

    let state = Arc::new(AppState { tracer, python_version: python_version.clone() });

    let dist = root.join("frontend").join("dist");
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/run-code", post(run_code))
        .route("/api/{*rest}", any(api_not_found))
        .with_state(state.clone());

    let app = if dist.join("index.html").is_file() {
        let spa = ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html")));
        api.fallback_service(spa)
    } else {
        api.fallback(frontend_missing)
    };
    let app = app
        .layer(middleware::from_fn(cache_headers))
        .layer(CompressionLayer::new())        // traces are big, repetitive JSON: gzip shrinks them ~10x
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024));

    // Localhost only: the tracer runs arbitrary code and the API has no auth.
    let host: std::net::IpAddr = env::var("HOST").ok().and_then(|h| h.parse().ok()).unwrap_or([127, 0, 0, 1].into());
    let port: u16 = env_number("PORT", 8000);
    let addr = SocketAddr::new(host, port);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Can't listen on {addr}: {e}");
            eprintln!("Is the server already running in another terminal? Close it, or set PORT=8001 in .env.");
            std::process::exit(1);
        }
    };

    println!("CodeTrace Python Visualizer (Rust server)");
    println!("  Python : {} ({})", python.display(), python_version);
    println!("  Tracer : {}", if state.tracer.is_ready() { "ready" } else { "MISSING pg_logger.py / pg_encoder.py" });
    println!("  Tutor  : built-in quiz bank; AI provider + key are set in the IDE (gear icon / AI settings)");
    println!("  Open   : http://localhost:{port}");
    println!("Press Ctrl+C to stop.");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            println!("Shutting down.");
        })
        .await
        .expect("server error");
}
