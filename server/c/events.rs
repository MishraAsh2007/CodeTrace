//! TraceLab: turns the C interpreter's states into TraceLab trace events (see docs/PROTOCOL.md).
//!
//! The interpreter records a state after each statement runs (and at loop checks and function entry), so
//! line events have `phase: "after"`. Frames are listed innermost first, like the Java worker's.

use super::interp::{Outcome, Stop};
use super::trace::{HeapObject, ProgramState, RefTarget, Value as CValue, Variable as CVariable};
use super::CError;
use serde_json::{json, Value};
use std::collections::HashMap;

/// A readable name for each runtime error kind, used as the exception's type.
fn kind_title(kind: &str) -> &'static str {
    match kind {
        "index_out_of_bounds" => "Index out of bounds",
        "negative_index" => "Negative array index",
        "division_by_zero" => "Division by zero",
        "modulo_by_zero" => "Modulo by zero",
        "null_deref" => "NULL pointer",
        "undeclared_variable" => "Undeclared variable",
        "unknown_function" => "Unknown function",
        "stack_overflow" => "Stack overflow",
        "arg_count_mismatch" => "Wrong number of arguments",
        "no_such_field" => "No such field",
        "not_indexable" => "Not an array",
        "not_a_struct" => "Not a struct",
        "bad_deref" => "Not a pointer",
        "bad_assign_target" => "Invalid assignment",
        _ => "Runtime error",
    }
}

/// Rust's `escape_default` writes the null character as `'\u{0}'`; C programmers write `'\0'`.
fn display(text: &str) -> String { text.replace("\\u{0}", "\\0") }

struct Types<'a> { heap: &'a std::collections::BTreeMap<String, HeapObject> }

impl Types<'_> {
    fn object_type(&self, id: &str) -> Option<String> {
        match self.heap.get(id)? {
            HeapObject::Array { element_type, elements, length, .. } => Some(format!("{}[{}]", element_type.as_deref().unwrap_or("int"), length.unwrap_or(elements.len()))),
            HeapObject::Struct { type_name, .. } => Some(type_name.clone()),
        }
    }

    fn value(&self, value: &CValue, declared: Option<&str>, frames: &HashMap<String, String>, current: &str) -> Value {
        match value {
            CValue::Primitive { display: text, type_name } => json!({"kind": "primitive", "type": declared.or(type_name.as_deref()).unwrap_or("int"), "value": display(text)}),
            CValue::Ref { target: None } => json!({"kind": "null", "type": declared.unwrap_or("pointer"), "value": "NULL"}),
            CValue::Ref { target: Some(RefTarget::Heap { id }) } => {
                let target = self.object_type(id);
                // A pointer variable shows its declared type; an array variable shows the array.
                let shown = match (declared, &target) {
                    (Some(d), Some(t)) if !d.contains('*') && t.contains('[') => t.clone(),
                    (Some(d), _) => d.to_string(),
                    (None, Some(t)) => t.clone(),
                    (None, None) => "pointer".into(),
                };
                if self.heap.contains_key(id) { json!({"kind": "reference", "type": shown, "ref": id}) } else { json!({"kind": "reference", "type": shown, "ref": id, "omitted": true}) }
            }
            // TraceLab draws arrows to heap objects only, so a pointer to a variable reads `&x`.
            CValue::Ref { target: Some(RefTarget::Stack { frame_id, name }) } => {
                let owner = if frame_id == current { String::new() } else { frames.get(frame_id).map(|f| format!(" in {f}")).unwrap_or_default() };
                json!({"kind": "primitive", "type": declared.unwrap_or("pointer"), "value": format!("&{name}{owner}")})
            }
        }
    }

    fn variable(&self, v: &CVariable, frames: &HashMap<String, String>, current: &str) -> Value {
        let value = self.value(&v.value, v.declared_type.as_deref(), frames, current);
        json!({"name": v.name, "type": value["type"].clone(), "value": value})
    }
}

/// The location, frames, heap and returns of one state.
fn state_event(state: &ProgramState, file: &str, fallback_line: usize) -> Value {
    let types = Types { heap: &state.heap };
    let names: HashMap<String, String> = state.stack.iter().map(|f| (f.id.clone(), f.function_name.clone())).collect();
    let line = state.line.unwrap_or(fallback_line).max(1);
    // The same budget as the Java worker: the 48 innermost frames.
    let frames: Vec<Value> = state.stack.iter().rev().take(48).enumerate().map(|(i, f)| {
        let frame_line = if i == 0 { line } else { f.line.unwrap_or(line).max(1) };
        json!({"id": f.id, "method": f.function_name, "file": file, "line": frame_line,
            "locals": f.variables.iter().map(|v| types.variable(v, &names, &f.id)).collect::<Vec<_>>()})
    }).collect();
    let current = state.stack.last().map(|f| f.id.clone()).unwrap_or_default();
    let ordered = if state.heap_order.is_empty() { state.heap.keys().cloned().collect() } else { state.heap_order.clone() };
    let heap: Vec<Value> = ordered.iter().filter_map(|id| state.heap.get(id)).map(|object| match object {
        HeapObject::Array { id, elements, length, .. } => {
            let length = length.unwrap_or(elements.len());
            let mut o = json!({"id": id, "type": types.object_type(id), "kind": "array", "length": length,
                "elements": elements.iter().map(|e| types.value(e, None, &names, &current)).collect::<Vec<_>>()});
            if length > elements.len() { o["truncated"] = json!(true); }
            o
        }
        HeapObject::Struct { id, type_name, fields } => json!({"id": id, "type": type_name, "kind": "object",
            "fields": fields.iter().map(|f| types.variable(f, &names, &current)).collect::<Vec<_>>()}),
    }).collect();
    let mut event = json!({"kind": "line", "location": {"file": file, "line": line, "phase": "after"}, "frames": frames, "statics": [], "heap": heap});
    if state.heap_truncated { event["heapTruncated"] = json!(true); }
    if state.stack.len() > 48 { event["framesTruncated"] = json!(true); }
    if let Some(note) = &state.note { event["note"] = json!(note); }
    if !state.returns.is_empty() {
        event["returns"] = state.returns.iter().map(|r| match &r.value {
            Some(v) => json!({"method": r.method, "frameId": r.frame_id, "value": types.value(v, None, &names, &current)}),
            None => json!({"method": r.method, "frameId": r.frame_id, "void": true}),
        }).collect();
    }
    event
}

/// Events for a C run: diagnostics for lex and parse errors, or one event per recorded state with output
/// in between, then `terminated`. `record` is false for plain runs (tests), which have no line events.
pub fn events(file: &str, result: Result<Outcome, CError>, record: bool) -> Vec<Value> {
    let outcome = match result {
        Ok(outcome) => outcome,
        Err(e) => return compile_error(file, &e.message, e.line.unwrap_or(1), e.kind, e.stage),
    };
    let mut out = Vec::new();
    let mut printed = 0usize;
    let mut last_line = 1usize;
    let error = match &outcome.stop { Stop::Error(e) => Some(e), _ => None };
    let kind = error.map(|e| super::runtime_kind(&e.message)).unwrap_or("");
    if kind == "no_main" { return compile_error(file, "no 'main' function found", 1, kind, "runtime"); }
    let failed = error.is_some() && kind != "infinite_loop";
    let count = outcome.states.len();
    for (i, state) in outcome.states.iter().enumerate() {
        let stdout = state.stdout.as_deref().unwrap_or("");
        if stdout.len() > printed {
            out.push(json!({"kind": "output", "stream": "stdout", "text": &stdout[printed..]}));
            printed = stdout.len();
        }
        let mut event = state_event(state, file, last_line);
        last_line = event["location"]["line"].as_u64().unwrap_or(1) as usize;
        // The interpreter records the moment of a runtime error as the last state.
        if failed && i + 1 == count && state.note.as_deref() == Some("error") {
            let e = error.unwrap();
            event["kind"] = json!("exception");
            event["exception"] = json!({"type": kind_title(kind), "message": e.message, "caught": false});
            event["errorKind"] = json!(kind);
            if let Some(o) = event.as_object_mut() { o.remove("note"); }
        }
        out.push(event);
    }
    if outcome.stdout.len() > printed {
        out.push(json!({"kind": "output", "stream": "stdout", "text": &outcome.stdout[printed..]}));
    }
    let steps = count;
    let end = match &outcome.stop {
        Stop::Finished { exit_code } => json!({"kind": "terminated", "stopReason": "completed", "message": format!("The program finished{}.", match exit_code { Some(c) if *c != 0 => format!(" with exit status {c}"), _ => String::new() }), "exitCode": exit_code.unwrap_or(0), "steps": steps, "recorded": record}),
        Stop::StateLimit => json!({"kind": "terminated", "stopReason": "step-limit", "message": format!("Recording stopped after {steps} steps. Raise the step limit in Project settings, or look for a loop that doesn't end."), "steps": steps, "recorded": record}),
        Stop::Timeout => json!({"kind": "terminated", "stopReason": "timeout", "message": "The program ran out of time. Look for a loop that doesn't end.", "steps": steps, "recorded": record}),
        Stop::Cancelled => json!({"kind": "terminated", "stopReason": "cancelled", "message": "Stopped.", "steps": steps, "recorded": record}),
        Stop::OutputLimit => json!({"kind": "terminated", "stopReason": "output-limit", "message": "The program printed too much output and was stopped, which usually means a loop that doesn't end.", "steps": steps, "recorded": record, "outputTruncated": true}),
        Stop::Error(e) if kind == "infinite_loop" => json!({"kind": "terminated", "stopReason": "step-limit", "message": format!("The interpreter stopped the program: {}.", e.message), "errorKind": kind, "steps": steps, "recorded": record}),
        Stop::Error(e) => {
            let exception = json!({"type": kind_title(kind), "message": e.message, "caught": false});
            if !out.iter().any(|ev| ev["kind"] == "exception") {
                // A plain run has no states: report the error on its own, at the line where it happened.
                let mut ev = json!({"kind": "exception", "exception": exception, "errorKind": kind});
                if e.line > 0 { ev["location"] = json!({"file": file, "line": e.line, "phase": "after"}); }
                out.push(ev);
            }
            json!({"kind": "terminated", "stopReason": "exception", "message": format!("The program stopped with a runtime error: {}.", e.message), "exception": exception, "errorKind": kind, "steps": steps, "recorded": record})
        }
    };
    out.push(end);
    out
}

fn compile_error(file: &str, message: &str, line: usize, kind: &str, stage: &str) -> Vec<Value> {
    vec![
        json!({"kind": "diagnostic", "severity": "error", "file": file, "line": line.max(1), "column": 1, "message": message, "errorKind": kind, "stage": stage}),
        json!({"kind": "terminated", "stopReason": "compile-error", "message": "The C program has an error, so it didn't run.", "errorKind": kind, "steps": 0}),
    ]
}
