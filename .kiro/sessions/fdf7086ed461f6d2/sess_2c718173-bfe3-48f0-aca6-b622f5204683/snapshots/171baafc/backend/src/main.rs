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
    /// Optional program input, fed to scanf / getchar. Defaults to empty so
    /// existing `{language, code}` requests still deserialize.
    #[serde(default)]
    stdin: Option<String>,
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
        "c" => match c::run(&req.code, &req.stdin.unwrap_or_default()) {
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
                    kind: "unsupported_language".into(),
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
        assert_eq!(err.kind, "division_by_zero");
        assert!(err.message.contains("division by zero"));
    }

    #[test]
    fn classifies_index_out_of_bounds() {
        let src = r#"
            int main(void) {
                int a[3] = {1, 2, 3};
                int y = a[5];
                return y;
            }
        "#;
        let err = c::run(src).unwrap_err();
        assert_eq!(err.stage, "runtime");
        assert_eq!(err.kind, "index_out_of_bounds");
    }

    #[test]
    fn classifies_null_deref() {
        let src = r#"
            int main(void) {
                int* p = 0;
                int y = *p;
                return y;
            }
        "#;
        let err = c::run(src).unwrap_err();
        assert_eq!(err.kind, "null_deref");
    }

    #[test]
    fn classifies_missing_semicolon() {
        // `int x = 5` with no semicolon before `return`.
        let src = "int main(void) { int x = 5 return 0; }";
        let err = c::run(src).unwrap_err();
        assert_eq!(err.stage, "parse");
        assert_eq!(err.kind, "parse_missing_semicolon");
    }

    #[test]
    fn classifies_unexpected_char() {
        let src = "int main(void) { int x = @; return 0; }";
        let err = c::run(src).unwrap_err();
        assert_eq!(err.stage, "lex");
        assert_eq!(err.kind, "lex_unexpected_char");
    }

    const BST_SRC: &str = r#"
        #include <stdio.h>
        #include <stdlib.h>

        typedef struct Node {
            int value;
            struct Node *left;
            struct Node *right;
        } Node;

        Node *insert(Node *root, int value) {
            if (root == NULL) {
                Node *node = malloc(sizeof *node);
                node->value = value;
                node->left = NULL;
                node->right = NULL;
                return node;
            }
            if (value < root->value) {
                root->left = insert(root->left, value);
            } else if (value > root->value) {
                root->right = insert(root->right, value);
            }
            return root;
        }

        void inorder(Node *root) {
            if (root == NULL) return;
            inorder(root->left);
            printf("%d ", root->value);
            inorder(root->right);
        }

        int main(void) {
            Node *root = NULL;
            int values[] = {8, 3, 10, 1, 6};
            int count = 5;
            for (int i = 0; i < count; i++) {
                root = insert(root, values[i]);
            }
            printf("Sorted: ");
            inorder(root);
            printf("\n");
            return 0;
        }
    "#;

    #[test]
    fn bst_builds_linked_node_structs() {
        let trace = run_c(BST_SRC);
        assert!(!trace.states.is_empty());
        let last = trace.states.last().unwrap();

        // At least one heap object is a Node struct.
        let node_structs: Vec<_> = last
            .heap
            .values()
            .filter_map(|o| match o {
                trace::HeapObject::Struct { type_name, fields, .. } if type_name == "Node" => {
                    Some(fields)
                }
                _ => None,
            })
            .collect();
        assert!(
            !node_structs.is_empty(),
            "expected at least one Node struct in the heap"
        );

        // At least one Node has a pointer field that references another heap
        // object (proving node->node linkage).
        let has_link = node_structs.iter().any(|fields| {
            fields.iter().any(|f| {
                matches!(
                    &f.value,
                    trace::Value::Ref {
                        target: Some(trace::RefTarget::Heap { .. })
                    }
                )
            })
        });
        assert!(has_link, "expected a Node with a pointer field linking to another node");
    }

    #[test]
    fn ternary_evaluates_true_branch() {
        let src = r#"
            int main(void) {
                int x = (1 < 2) ? 10 : 20;
                return x;
            }
        "#;
        let trace = run_c(src);
        let last = trace.states.last().unwrap();
        let main_frame = last.stack.last().unwrap();
        let x = main_frame.variables.iter().find(|v| v.name == "x").unwrap();
        if let trace::Value::Primitive { display, .. } = &x.value {
            assert_eq!(display, "10");
        } else {
            panic!("x should be a primitive");
        }
    }

    #[test]
    fn null_check_and_struct_field_roundtrip() {
        let src = r#"
            typedef struct Node {
                int value;
                struct Node *next;
            } Node;

            int main(void) {
                Node *p = NULL;
                int wasNull = (p == NULL) ? 1 : 0;
                p = malloc(sizeof *p);
                p->value = 42;
                p->next = NULL;
                int v = p->value;
                int notNull = (p != NULL) ? 1 : 0;
                return v;
            }
        "#;
        let trace = run_c(src);
        let last = trace.states.last().unwrap();
        let main_frame = last.stack.last().unwrap();

        let was_null = main_frame.variables.iter().find(|v| v.name == "wasNull").unwrap();
        if let trace::Value::Primitive { display, .. } = &was_null.value {
            assert_eq!(display, "1", "p == NULL should be true when p is NULL");
        } else {
            panic!("wasNull should be a primitive");
        }

        let not_null = main_frame.variables.iter().find(|v| v.name == "notNull").unwrap();
        if let trace::Value::Primitive { display, .. } = &not_null.value {
            assert_eq!(display, "1", "p != NULL should be true after malloc");
        }

        let v = main_frame.variables.iter().find(|v| v.name == "v").unwrap();
        if let trace::Value::Primitive { display, .. } = &v.value {
            assert_eq!(display, "42", "struct field written then read back");
        } else {
            panic!("v should be a primitive");
        }
    }
}
