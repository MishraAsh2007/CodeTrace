//! A lexer for the supported subset of C.
//!
//! Produces a flat token stream with 1-based line numbers. Preprocessor
//! directives (lines starting with `#`, e.g. `#include`) are skipped, and
//! both `//` and `/* */` comments are stripped.

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    // Literals / identifiers
    Ident(String),
    Int(i64),
    Float(f64),
    Char(char),
    Str(String),

    // Keywords
    KwInt,
    KwChar,
    KwDouble,
    KwFloat,
    KwVoid,
    KwLong,
    KwIf,
    KwElse,
    KwWhile,
    KwFor,
    KwReturn,
    KwBreak,
    KwContinue,

    // Punctuation / operators
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Semicolon,
    Comma,
    Assign,     // =
    Plus,       // +
    Minus,      // -
    Star,       // *
    Slash,      // /
    Percent,    // %
    Amp,        // &
    PlusPlus,   // ++
    MinusMinus, // --
    PlusEq,     // +=
    MinusEq,    // -=
    StarEq,     // *=
    SlashEq,    // /=
    Eq,         // ==
    Ne,         // !=
    Lt,         // <
    Gt,         // >
    Le,         // <=
    Ge,         // >=
    AndAnd,     // &&
    OrOr,       // ||
    Not,        // !
    Arrow,      // ->
    Dot,        // .

    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    pub line: usize,
}

#[derive(Debug)]
pub struct LexError {
    pub message: String,
    pub line: usize,
}

pub fn lex(src: &str) -> Result<Vec<Token>, LexError> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0usize;
    let mut line = 1usize;
    let mut out: Vec<Token> = Vec::new();

    let n = chars.len();
    while i < n {
        let c = chars[i];

        // Newlines
        if c == '\n' {
            line += 1;
            i += 1;
            continue;
        }
        // Whitespace
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        // Preprocessor directive: skip to end of line.
        if c == '#' {
            while i < n && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        // Comments
        if c == '/' && i + 1 < n && chars[i + 1] == '/' {
            while i < n && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < n && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < n && !(chars[i] == '*' && chars[i + 1] == '/') {
                if chars[i] == '\n' {
                    line += 1;
                }
                i += 1;
            }
            i += 2; // consume */
            continue;
        }

        // Identifiers / keywords
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < n && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let tok = match word.as_str() {
                "int" => Tok::KwInt,
                "char" => Tok::KwChar,
                "double" => Tok::KwDouble,
                "float" => Tok::KwFloat,
                "void" => Tok::KwVoid,
                "long" => Tok::KwLong,
                "if" => Tok::KwIf,
                "else" => Tok::KwElse,
                "while" => Tok::KwWhile,
                "for" => Tok::KwFor,
                "return" => Tok::KwReturn,
                "break" => Tok::KwBreak,
                "continue" => Tok::KwContinue,
                _ => Tok::Ident(word),
            };
            out.push(Token { tok, line });
            continue;
        }

        // Numbers (int or float)
        if c.is_ascii_digit() {
            let start = i;
            let mut is_float = false;
            while i < n && (chars[i].is_ascii_digit() || chars[i] == '.') {
                if chars[i] == '.' {
                    is_float = true;
                }
                i += 1;
            }
            // Optional float suffix f/F
            if i < n && (chars[i] == 'f' || chars[i] == 'F') {
                is_float = true;
                i += 1;
            }
            let text: String = chars[start..i].iter().filter(|c| **c != 'f' && **c != 'F').collect();
            if is_float {
                let v: f64 = text.parse().map_err(|_| LexError {
                    message: format!("invalid float literal '{}'", text),
                    line,
                })?;
                out.push(Token { tok: Tok::Float(v), line });
            } else {
                let v: i64 = text.parse().map_err(|_| LexError {
                    message: format!("invalid integer literal '{}'", text),
                    line,
                })?;
                out.push(Token { tok: Tok::Int(v), line });
            }
            continue;
        }

        // Char literal
        if c == '\'' {
            i += 1;
            if i >= n {
                return Err(LexError { message: "unterminated char literal".into(), line });
            }
            let ch = if chars[i] == '\\' {
                i += 1;
                if i >= n {
                    return Err(LexError { message: "unterminated escape".into(), line });
                }
                let e = decode_escape(chars[i]);
                i += 1;
                e
            } else {
                let ch = chars[i];
                i += 1;
                ch
            };
            if i >= n || chars[i] != '\'' {
                return Err(LexError { message: "unterminated char literal".into(), line });
            }
            i += 1; // closing '
            out.push(Token { tok: Tok::Char(ch), line });
            continue;
        }

        // String literal
        if c == '"' {
            i += 1;
            let mut s = String::new();
            while i < n && chars[i] != '"' {
                if chars[i] == '\\' {
                    i += 1;
                    if i >= n {
                        return Err(LexError { message: "unterminated escape".into(), line });
                    }
                    s.push(decode_escape(chars[i]));
                    i += 1;
                } else {
                    if chars[i] == '\n' {
                        line += 1;
                    }
                    s.push(chars[i]);
                    i += 1;
                }
            }
            if i >= n {
                return Err(LexError { message: "unterminated string literal".into(), line });
            }
            i += 1; // closing "
            out.push(Token { tok: Tok::Str(s), line });
            continue;
        }

        // Operators / punctuation (two-char first)
        let two: Option<Tok> = if i + 1 < n {
            match (c, chars[i + 1]) {
                ('+', '+') => Some(Tok::PlusPlus),
                ('-', '-') => Some(Tok::MinusMinus),
                ('+', '=') => Some(Tok::PlusEq),
                ('-', '=') => Some(Tok::MinusEq),
                ('*', '=') => Some(Tok::StarEq),
                ('/', '=') => Some(Tok::SlashEq),
                ('=', '=') => Some(Tok::Eq),
                ('!', '=') => Some(Tok::Ne),
                ('<', '=') => Some(Tok::Le),
                ('>', '=') => Some(Tok::Ge),
                ('&', '&') => Some(Tok::AndAnd),
                ('|', '|') => Some(Tok::OrOr),
                ('-', '>') => Some(Tok::Arrow),
                _ => None,
            }
        } else {
            None
        };
        if let Some(tok) = two {
            out.push(Token { tok, line });
            i += 2;
            continue;
        }

        let one = match c {
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '[' => Tok::LBracket,
            ']' => Tok::RBracket,
            ';' => Tok::Semicolon,
            ',' => Tok::Comma,
            '=' => Tok::Assign,
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '*' => Tok::Star,
            '/' => Tok::Slash,
            '%' => Tok::Percent,
            '&' => Tok::Amp,
            '<' => Tok::Lt,
            '>' => Tok::Gt,
            '!' => Tok::Not,
            '.' => Tok::Dot,
            other => {
                return Err(LexError {
                    message: format!("unexpected character '{}'", other),
                    line,
                })
            }
        };
        out.push(Token { tok: one, line });
        i += 1;
    }

    out.push(Token { tok: Tok::Eof, line });
    Ok(out)
}

fn decode_escape(c: char) -> char {
    match c {
        'n' => '\n',
        't' => '\t',
        'r' => '\r',
        '0' => '\0',
        '\\' => '\\',
        '\'' => '\'',
        '"' => '"',
        other => other,
    }
}
