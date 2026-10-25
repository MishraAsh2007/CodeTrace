//! C language support: lex -> parse -> interpret -> ExecutionTrace.

//!
//! TraceLab embeds this interpreter (from the C_ver branch) in its runner. `events` turns its states into
//! TraceLab trace events; the changes inside the interpreter are marked "TraceLab:".

pub mod ast;
pub mod events;
pub mod interp;
pub mod lexer;
pub mod parser;
pub mod trace;
#[cfg(test)]
mod tests;

use trace::ExecutionTrace;

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

/// Classify a lexer error message into a stable `kind` the tutor keys on.
fn classify_lex(message: &str) -> &'static str {
    if message.contains("unexpected character") {
        "lex_unexpected_char"
    } else if message.contains("unterminated string") {
        "lex_unterminated_string"
    } else if message.contains("unterminated char") || message.contains("unterminated escape") {
        "lex_unterminated_char"
    } else if message.contains("invalid integer") || message.contains("invalid float") {
        "lex_invalid_number"
    } else {
        "lex_error"
    }
}

/// Classify a parser error message into a stable `kind` the tutor keys on.
/// The parser's messages are stable, so substring matching is reliable.
fn classify_parse(message: &str) -> &'static str {
    // Specific "expected X, found Y" cases first.
    if message.contains("expected Semicolon") {
        "parse_missing_semicolon"
    } else if message.contains("expected RParen") {
        "parse_missing_rparen"
    } else if message.contains("expected LParen") {
        "parse_missing_lparen"
    } else if message.contains("expected RBrace") {
        "parse_missing_rbrace"
    } else if message.contains("expected LBrace") {
        "parse_missing_lbrace"
    } else if message.contains("expected RBracket") {
        "parse_missing_rbracket"
    } else if message.contains("expected identifier") {
        "parse_expected_identifier"
    } else if message.contains("expected a type") {
        "parse_expected_type"
    } else if message.contains("unexpected token in expression") {
        "parse_unexpected_in_expr"
    } else {
        "parse_error"
    }
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
    } else if message.contains("expects") && message.contains("argument(s) but got") {
        "arg_count_mismatch"
    } else if message.contains("has no field") {
        "no_such_field"
    } else if message.contains("is not an array or pointer")
        || message.contains("indexing a non-array expression")
    {
        "not_indexable"
    } else if message.contains("not a struct")
        || message.contains("not a struct pointer")
        || message.contains("non-struct heap object")
    {
        "not_a_struct"
    } else if message.contains("cannot dereference a non-pointer") {
        "bad_deref"
    } else if message.contains("invalid assignment target") {
        "bad_assign_target"
    } else {
        "runtime_other"
    }
}

/// Lex, parse, and interpret a C program, producing an execution trace.
/// (The C_ver branch's API; TraceLab's runner uses `trace`, and the ported tests use this.)
#[cfg_attr(not(test), allow(dead_code))]
/// `stdin` is supplied to the program's scanf / getchar calls.
pub fn run(source: &str, stdin: &str) -> Result<ExecutionTrace, CError> {
    let tokens = lexer::lex(source).map_err(|e| CError {
        stage: "lex",
        kind: classify_lex(&e.message),
        message: e.message,
        line: Some(e.line),
    })?;

    let mut parser = parser::Parser::new(tokens);
    let program = parser.parse_program().map_err(|e| CError {
        stage: "parse",
        kind: classify_parse(&e.message),
        message: e.message,
        line: Some(e.line),
    })?;

    let interp = interp::Interp::with_stdin(&program, stdin.to_string());
    interp.run().map_err(|e| CError {
        stage: "runtime",
        kind: classify_runtime(&e.message),
        message: e.message,
        line: if e.line == 0 { None } else { Some(e.line) },
    })
}

/// Deepest bracket nesting accepted. The parser and interpreter recurse once per level, so very deep
/// nesting would overflow the thread's stack instead of failing with a message.
const MAX_NESTING: usize = 200;

/// TraceLab: lex and parse (errors come back as `CError`), then run with `limits`, keeping every state
/// recorded before a runtime error or limit.
pub fn trace(source: &str, stdin: &str, limits: interp::Limits) -> Result<interp::Outcome, CError> {
    let mut depth = 0usize;
    for (i, line) in source.lines().enumerate() {
        for c in line.chars() {
            match c {
                '(' | '[' | '{' => depth += 1,
                ')' | ']' | '}' => depth = depth.saturating_sub(1),
                _ => {}
            }
            if depth > MAX_NESTING {
                return Err(CError { stage: "parse", kind: "parse_error", message: format!("brackets are nested more than {MAX_NESTING} levels deep"), line: Some(i + 1) });
            }
        }
    }
    let tokens = lexer::lex(source).map_err(|e| CError { stage: "lex", kind: classify_lex(&e.message), message: e.message, line: Some(e.line) })?;
    let program = parser::Parser::new(tokens).parse_program().map_err(|e| CError { stage: "parse", kind: classify_parse(&e.message), message: e.message, line: Some(e.line) })?;
    Ok(interp::Interp::with_stdin(&program, stdin.to_string()).with_limits(limits).run_traced())
}

/// The tutor's classification of a runtime error message (see `classify_runtime`).
pub fn runtime_kind(message: &str) -> &'static str { classify_runtime(message) }
