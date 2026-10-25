//! Tests from the C_ver branch (backend/src/main.rs), run against TraceLab's copy of the interpreter,
//! followed by tests for the TraceLab changes.
#![allow(clippy::all)]
use super::trace;

fn run_c(src: &str) -> trace::ExecutionTrace {
    super::run(src, "").expect("program should run")
}

fn run_c_stdin(src: &str, stdin: &str) -> trace::ExecutionTrace {
    super::run(src, stdin).expect("program should run")
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
    let err = super::run(src, "").unwrap_err();
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
    let err = super::run(src, "").unwrap_err();
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
    let err = super::run(src, "").unwrap_err();
    assert_eq!(err.kind, "null_deref");
}

#[test]
fn classifies_missing_semicolon() {
    // `int x = 5` with no semicolon before `return`.
    let src = "int main(void) { int x = 5 return 0; }";
    let err = super::run(src, "").unwrap_err();
    assert_eq!(err.stage, "parse");
    assert_eq!(err.kind, "parse_missing_semicolon");
}

#[test]
fn classifies_unexpected_char() {
    let src = "int main(void) { int x = @; return 0; }";
    let err = super::run(src, "").unwrap_err();
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

/// Read the display string of a named variable in the final main frame.
fn final_var_display(trace: &trace::ExecutionTrace, name: &str) -> String {
    let last = trace.states.last().expect("at least one state");
    let main_frame = last.stack.last().expect("a frame");
    let var = main_frame
        .variables
        .iter()
        .find(|v| v.name == name)
        .unwrap_or_else(|| panic!("variable '{}' present", name));
    match &var.value {
        trace::Value::Primitive { display, .. } => display.clone(),
        _ => panic!("variable '{}' should be a primitive", name),
    }
}

#[test]
fn scanf_reads_ints() {
    let src = r#"
        int main(void) {
            int a;
            int b;
            int sum;
            scanf("%d %d", &a, &b);
            sum = a + b;
            printf("%d", sum);
            return 0;
        }
    "#;
    let trace = run_c_stdin(src, "3 4");
    assert_eq!(final_var_display(&trace, "sum"), "7");
}

#[test]
fn scanf_loop_until_eof() {
    let src = r#"
        int main(void) {
            int x;
            int sum = 0;
            while (scanf("%d", &x) == 1) {
                sum += x;
            }
            printf("%d", sum);
            return 0;
        }
    "#;
    let trace = run_c_stdin(src, "1 2 3 4");
    assert_eq!(final_var_display(&trace, "sum"), "10");
}

#[test]
fn getchar_reads() {
    let src = r#"
        int main(void) {
            int c;
            c = getchar();
            return 0;
        }
    "#;
    let trace = run_c_stdin(src, "A");
    assert_eq!(final_var_display(&trace, "c"), "65");
}

#[test]
fn arity_mismatch_errors() {
    let src = r#"
        int add(int a, int b) {
            return a + b;
        }
        int main(void) {
            int r = add(1);
            return r;
        }
    "#;
    let err = super::run(src, "").unwrap_err();
    assert_eq!(err.stage, "runtime");
    assert_eq!(err.kind, "arg_count_mismatch");
}

#[test]
fn no_field_classified() {
    let src = r#"
        typedef struct Node {
            int value;
            struct Node *next;
        } Node;

        int main(void) {
            Node *p = malloc(sizeof *p);
            p->value = 1;
            int bad = p->missing;
            return bad;
        }
    "#;
    let err = super::run(src, "").unwrap_err();
    assert_eq!(err.stage, "runtime");
    assert_eq!(err.kind, "no_such_field");
}

#[test]
fn overflow_does_not_panic() {
    // Multiplying large ints would overflow i64; with wrapping ops this
    // must NOT panic and the program should run to completion.
    let src = r#"
        int main(void) {
            int a = 1000000000000;
            int b = 1000000000000;
            int c = a * b;
            return 0;
        }
    "#;
    assert!(super::run(src, "").is_ok());
}

// ---------- TraceLab changes ----------

use super::interp::{Limits, Stop};
use serde_json::Value;

fn traced(src: &str, stdin: &str, max_states: usize) -> super::interp::Outcome {
    super::trace(src, stdin, Limits { record: true, max_states, max_work: 100_000, deadline: None, max_output: 32_768, cancel: None }).ok().expect("parses")
}
fn events_of(src: &str, stdin: &str) -> Vec<Value> { super::events::events("main.c", super::trace(src, stdin, Limits { record: true, max_states: 500, max_work: 100_000, deadline: None, max_output: 32_768, cancel: None }), true) }

#[test]
fn empty_loop_bodies_stop_at_the_budget() {
    for src in ["int main(void) { while (1) {} return 0; }", "int main(void) { for (;;) {} return 0; }"] {
        let outcome = traced(src, "", 50);
        assert!(matches!(outcome.stop, Stop::StateLimit), "{src}");
        assert_eq!(outcome.states.len(), 50);
        let plain = super::trace(src, "", Limits { record: false, max_states: 0, max_work: 10_000, deadline: None, max_output: 1024, cancel: None }).ok().unwrap();
        assert!(matches!(plain.stop, Stop::Error(ref e) if e.message.contains("step limit")), "{src}");
    }
}

#[test]
fn runtime_errors_keep_the_states_before_them_and_the_line() {
    let src = "int main(void) {\n    int a[3] = {1, 2, 3};\n    int i = 3;\n    int x = a[i];\n    return x;\n}\n";
    let outcome = traced(src, "", 100);
    let Stop::Error(e) = &outcome.stop else { panic!("expected an error") };
    assert_eq!(e.line, 4);
    assert!(outcome.states.len() >= 3);
    let events = events_of(src, "");
    let exception = events.iter().find(|e| e["kind"] == "exception").expect("exception event");
    assert_eq!(exception["location"]["line"], 4);
    assert_eq!(exception["errorKind"], "index_out_of_bounds");
    assert_eq!(exception["frames"][0]["locals"][1]["value"]["value"], "3");
    assert_eq!(events.last().unwrap()["stopReason"], "exception");
}

#[test]
fn frames_are_innermost_first_with_distinct_activations_lines_and_returns() {
    let src = "int fact(int n) {\n    if (n <= 1) return 1;\n    return n * fact(n - 1);\n}\nint main(void) {\n    int r = fact(3);\n    printf(\"%d\\n\", r);\n    return 0;\n}\n";
    let events = events_of(src, "");
    let lines: Vec<&Value> = events.iter().filter(|e| e["kind"] == "line").collect();
    let deepest = lines.iter().max_by_key(|e| e["frames"].as_array().unwrap().len()).unwrap();
    let frames = deepest["frames"].as_array().unwrap();
    assert_eq!(frames.len(), 4);
    assert_eq!(frames[0]["method"], "fact");
    assert_eq!(frames[3]["method"], "main");
    assert_eq!(frames[3]["line"], 6, "the caller's line is the line of the call");
    let ids: std::collections::HashSet<&str> = frames.iter().map(|f| f["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 4);
    let returned: Vec<&Value> = lines.iter().flat_map(|e| e["returns"].as_array().cloned().unwrap_or_default().into_iter().map(|_| *e)).collect();
    assert!(!returned.is_empty());
    let last_return = lines.iter().rev().find_map(|e| e["returns"].as_array().and_then(|r| r.last().cloned())).unwrap();
    assert_eq!(last_return["value"]["value"], "6");
    assert!(events.iter().any(|e| e["kind"] == "output" && e["text"] == "6\n"));
    assert_eq!(events.last().unwrap()["stopReason"], "completed");
}

#[test]
fn structs_arrays_and_pointers_become_heap_objects_and_references() {
    let src = "typedef struct Node { int value; struct Node *next; } Node;\nint main(void) {\n    Node *head = malloc(sizeof(Node));\n    head->value = 7;\n    head->next = NULL;\n    int xs[2] = {4, 5};\n    int x = 1;\n    int *p = &x;\n    if (head) { x = 2; }\n    return 0;\n}\n";
    let events = events_of(src, "");
    let last = events.iter().filter(|e| e["kind"] == "line").last().unwrap();
    let locals = last["frames"][0]["locals"].as_array().unwrap();
    let by_name = |n: &str| locals.iter().find(|v| v["name"] == n).unwrap();
    assert_eq!(by_name("head")["value"]["kind"], "reference");
    assert_eq!(by_name("xs")["type"], "int[2]");
    assert_eq!(by_name("p")["value"]["value"], "&x");
    assert_eq!(by_name("x")["value"]["value"], "2", "a non-NULL pointer is true");
    let node = last["heap"].as_array().unwrap().iter().find(|o| o["kind"] == "object").unwrap();
    assert_eq!(node["type"], "Node");
    assert_eq!(node["fields"][1]["value"]["kind"], "null");
    assert_eq!(node["fields"][0]["type"], "int");
}

#[test]
fn declarations_in_loops_are_listed_once_and_printf_formats_work() {
    let src = "int main(void) {\n    for (int i = 0; i < 3; i++) {\n        int sq = i * i;\n        printf(\"%2d|%-3d|%.2f|%s\\n\", sq, i, 1.5, \"ok\");\n    }\n    return 0;\n}\n";
    let events = events_of(src, "");
    for e in events.iter().filter(|e| e["kind"] == "line") {
        let names: Vec<&str> = e["frames"][0]["locals"].as_array().unwrap().iter().map(|v| v["name"].as_str().unwrap()).collect();
        let unique: std::collections::HashSet<&&str> = names.iter().collect();
        assert_eq!(names.len(), unique.len(), "{names:?}");
    }
    let printed: String = events.iter().filter(|e| e["kind"] == "output").map(|e| e["text"].as_str().unwrap()).collect();
    assert_eq!(printed, " 0|0  |1.50|ok\n 1|1  |1.50|ok\n 4|2  |1.50|ok\n");
}

#[test]
fn compile_errors_and_missing_main_are_diagnostics() {
    let events = events_of("int main(void) {\n    int x = 5\n    return 0;\n}\n", "");
    assert_eq!(events[0]["kind"], "diagnostic");
    assert_eq!(events[0]["errorKind"], "parse_missing_semicolon");
    assert_eq!(events.last().unwrap()["stopReason"], "compile-error");
    let events = events_of("int helper(void) { return 1; }\n", "");
    assert_eq!(events[0]["errorKind"], "no_main");
    let deep = format!("int main(void) {{ return {}1{}; }}", "(".repeat(300), ")".repeat(300));
    assert_eq!(events_of(&deep, "")[0]["kind"], "diagnostic");
}

#[test]
fn many_allocations_are_capped_per_step() {
    let src = "typedef struct Node { int v; struct Node *next; } Node;\nint main(void) {\n    Node *head = NULL;\n    for (int i = 0; i < 200; i++) {\n        Node *n = malloc(sizeof(Node));\n        n->v = i;\n        n->next = head;\n        head = n;\n    }\n    return 0;\n}\n";
    let events = super::events::events("main.c", super::trace(src, "", Limits { record: true, max_states: 2000, max_work: 100_000, deadline: None, max_output: 32_768, cancel: None }), true);
    assert_eq!(events.last().unwrap()["stopReason"], "completed");
    let line = events.iter().filter(|e| e["kind"] == "line").last().unwrap();
    assert!(line["heap"].as_array().unwrap().len() <= 160);
    assert_eq!(line["heapTruncated"], true);
}

#[test]
fn division_overflow_and_exit_codes_do_not_panic() {
    let events = events_of("int main(void) {\n    int m = -9223372036854775807 - 1;\n    int d = -1;\n    int q = m / d;\n    exit(3);\n}\n", "");
    assert_eq!(events.last().unwrap()["stopReason"], "completed");
    assert_eq!(events.last().unwrap()["exitCode"], 3);
}
