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
