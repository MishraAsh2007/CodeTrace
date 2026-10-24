//! C language support: lex -> parse -> interpret -> ExecutionTrace.

pub mod ast;
pub mod interp;
pub mod lexer;
pub mod parser;

use crate::trace::ExecutionTrace;

/// A user-facing error from running C code, with an optional source line.
#[derive(Debug, Clone)]
pub struct CError {
    /// "lex" | "parse" | "runtime".
    pub stage: &'static str,
    pub message: String,
    pub line: Option<usize>,
    /// Machine-readable classification so the tutor can pick a hint sequence
    /// without re-parsing the human message. See `classify_runtime`.
    pub kind: &'static str,
}

/// Classify a runtime error message into a stable `kind` the tutor keys on.
/// Messages are produced by the interpreter and are stable, so matching on
/// substrings here is reliable.
fn classify_runtime(message: &str) -> &'static str {
    if message.contains("out of bounds") {
        "index_out_of_bounds"
    } else if message.contains("negative array index") {
        "negative_index"
    } else if message.contains("division by zero") {
        "division_by_zero"
    } else if message.contains("modulo by zero") {
        "modulo_by_zero"
    } else if message.contains("null pointer") {
        "null_deref"
    } else if message.contains("null/invalid pointer") {
        "null_deref"
    } else if message.contains("undeclared variable") {
        "undeclared_variable"
    } else if message.contains("unknown function") {
        "unknown_function"
    } else if message.contains("recursion too deep")
        || message.contains("call stack overflow")
    {
        "stack_overflow"
    } else if message.contains("infinite loop") || message.contains("step limit") {
        "infinite_loop"
    } else if message.contains("no 'main'") {
        "no_main"
    } else {
        "runtime_other"
    }
}

/// Lex, parse, and interpret a C program, producing an execution trace.
pub fn run(source: &str) -> Result<ExecutionTrace, CError> {
    let tokens = lexer::lex(source).map_err(|e| CError {
        stage: "lex",
        message: e.message,
        line: Some(e.line),
    })?;

    let mut parser = parser::Parser::new(tokens);
    let program = parser.parse_program().map_err(|e| CError {
        stage: "parse",
        message: e.message,
        line: Some(e.line),
    })?;

    let interp = interp::Interp::new(&program);
    interp.run().map_err(|e| CError {
        stage: "runtime",
        message: e.message,
        line: if e.line == 0 { None } else { Some(e.line) },
    })
}
