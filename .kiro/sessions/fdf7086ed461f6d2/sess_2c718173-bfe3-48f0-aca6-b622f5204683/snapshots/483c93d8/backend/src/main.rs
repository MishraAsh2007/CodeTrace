//! CodeTutor backend HTTP server.
//!
//! Exposes `POST /api/run` which takes `{ language, code }` and returns an
//! execution trace for the visualizer (or structured errors for the alert
//! panel). Only C is implemented here; other languages are handled by
//! teammates and currently return a "not implemented" response.

mod c;
mod trace;

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

#[derive(Debug, Deserialize)]
struct RunRequest {
    language: String,
    code: String,
}

/// A problem surfaced to the frontend AlertPanel.
#[derive(Debug, Serialize)]
struct ApiError {
    severity: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    stage: String,
    /// Machine-readable classification the tutor uses to pick a hint sequence.
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum RunResponse {
    Ok {
        ok: bool,
        trace: trace::ExecutionTrace,
    },
    Err {
        ok: bool,
        errors: Vec<ApiError>,
    },
}

#[tokio::main]
async fn main() {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/run", post(run_handler))
        .layer(cors);

    let addr = "127.0.0.1:8080";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind address");
    println!("CodeTutor backend listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("server error");
}

async fn health() -> &'static str {
    "ok"
}

async fn run_handler(Json(req): Json<RunRequest>) -> impl IntoResponse {
    match req.language.as_str() {
        "c" => match c::run(&req.code) {
            Ok(trace) => (
                StatusCode::OK,
                Json(RunResponse::Ok { ok: true, trace }),
            ),
            Err(err) => (
                StatusCode::OK,
                Json(RunResponse::Err {
                    ok: false,
                    errors: vec![ApiError {
                        severity: "error".into(),
                        message: err.message,
                        line: err.line,
                        stage: err.stage.into(),
                        kind: err.kind.into(),
                    }],
                }),
            ),
        },
        other => (
            StatusCode::OK,
            Json(RunResponse::Err {
                ok: false,
                errors: vec![ApiError {
                    severity: "info".into(),
                    message: format!(
                        "language '{}' is not implemented in this backend yet",
                        other
                    ),
                    line: None,
                    stage: "dispatch".into(),
                }],
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_c(src: &str) -> trace::ExecutionTrace {
        c::run(src).expect("program should run")
    }

    #[test]
    fn runs_simple_loop_and_array() {
        let src = r#"
            int main(void) {
                int values[3] = {4, 5, 6};
                int sum = 0;
                for (int i = 0; i < 3; i++) {
                    sum += values[i];
                }
                return sum;
            }
        "#;
        let trace = run_c(src);
        assert!(!trace.states.is_empty());
        // The final state should have a frame with sum = 15.
        let last = trace.states.last().unwrap();
        let main_frame = last.stack.last().unwrap();
        let sum = main_frame
            .variables
            .iter()
            .find(|v| v.name == "sum")
            .expect("sum var present");
        if let trace::Value::Primitive { display, .. } = &sum.value {
            assert_eq!(display, "15");
        } else {
            panic!("sum should be a primitive");
        }
    }

    #[test]
    fn pointer_and_deref() {
        let src = r#"
            int main(void) {
                int x = 7;
                int* p = &x;
                *p = 42;
                return x;
            }
        "#;
        let trace = run_c(src);
        let last = trace.states.last().unwrap();
        let main_frame = last.stack.last().unwrap();
        let x = main_frame.variables.iter().find(|v| v.name == "x").unwrap();
        if let trace::Value::Primitive { display, .. } = &x.value {
            assert_eq!(display, "42");
        } else {
            panic!("x should be a primitive");
        }
    }

    #[test]
    fn reports_division_by_zero() {
        let src = r#"
            int main(void) {
                int a = 1;
                int b = 0;
                int c = a / b;
                return c;
            }
        "#;
        let err = c::run(src).unwrap_err();
        assert_eq!(err.stage, "runtime");
        assert!(err.message.contains("division by zero"));
    }
}
