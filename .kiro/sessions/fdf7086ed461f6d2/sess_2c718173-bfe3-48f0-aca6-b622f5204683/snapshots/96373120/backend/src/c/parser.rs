//! Recursive-descent parser for the supported subset of C.

use std::collections::HashSet;

use super::ast::*;
use super::lexer::{Tok, Token};

#[derive(Debug)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
}

pub struct Parser {
    toks: Vec<Token>,
    pos: usize,
    /// Names (struct tags + typedef aliases) known to name a struct type.
    type_names: HashSet<String>,
}

type PResult<T> = Result<T, ParseError>;

impl Parser {
    pub fn new(toks: Vec<Token>) -> Self {
        let type_names = Self::collect_type_names(&toks);
        Parser { toks, pos: 0, type_names }
    }

    /// Pre-pass over the token stream to collect every identifier that names a
    /// struct type (the tag after `struct Name`, and any typedef alias). This
    /// lets `parse_type` recognize struct type names wherever they appear,
    /// regardless of definition order.
    fn collect_type_names(toks: &[Token]) -> HashSet<String> {
        let mut names = HashSet::new();
        let n = toks.len();
        let mut i = 0;
        while i < n {
            // `struct Name` -> Name is a type.
            if toks[i].tok == Tok::KwStruct {
                if let Tok::Ident(name) = &toks[i + 1.min(n - 1 - i)].tok {
                    names.insert(name.clone());
                }
            }
            // `typedef struct [Name] { ... } Alias;` -> Alias is a type.
            if toks[i].tok == Tok::KwTypedef {
                // Walk to the matching close brace, then the next ident before ';'.
                let mut j = i + 1;
                // skip to '{'
                while j < n && toks[j].tok != Tok::LBrace && toks[j].tok != Tok::Semicolon {
                    j += 1;
                }
                if j < n && toks[j].tok == Tok::LBrace {
                    let mut depth = 0;
                    while j < n {
                        match toks[j].tok {
                            Tok::LBrace => depth += 1,
                            Tok::RBrace => {
                                depth -= 1;
                                if depth == 0 {
                                    j += 1;
                                    break;
                                }
                            }
                            _ => {}
                        }
                        j += 1;
                    }
                    if j < n {
                        if let Tok::Ident(alias) = &toks[j].tok {
                            names.insert(alias.clone());
                        }
                    }
                }
            }
            i += 1;
        }
        names
    }

    pub fn parse_program(&mut self) -> PResult<Program> {
        let mut functions = Vec::new();
        let mut structs = Vec::new();
        while !self.check(&Tok::Eof) {
            match self.peek() {
                Tok::KwTypedef => {
                    let defs = self.parse_typedef()?;
                    structs.extend(defs);
                }
                Tok::KwStruct => {
                    // Could be a struct definition `struct Name { ... };` or a
                    // function/decl using a struct type like `struct Node *f(...)`.
                    if self.is_struct_definition() {
                        structs.push(self.parse_struct_def()?);
                    } else {
                        functions.push(self.parse_function()?);
                    }
                }
                _ => functions.push(self.parse_function()?),
            }
        }
        Ok(Program { functions, structs })
    }

    /// Returns true if the upcoming tokens are `struct Name { ... };`
    /// (a definition) rather than `struct Name * foo(...)` (a declaration/fn).
    fn is_struct_definition(&self) -> bool {
        // peek: KwStruct Ident LBrace ...
        self.peek() == &Tok::KwStruct
            && matches!(self.peek_at(1), Tok::Ident(_))
            && self.peek_at(2) == &Tok::LBrace
    }

    /// Parse the field list between `{` and `}` of a struct body. Assumes the
    /// opening `{` has NOT yet been consumed.
    fn parse_struct_body(&mut self) -> PResult<Vec<(CType, String)>> {
        self.eat(&Tok::LBrace)?;
        let mut fields = Vec::new();
        while !self.check(&Tok::RBrace) && !self.check(&Tok::Eof) {
            let ty = self.parse_type()?;
            let name = self.expect_ident()?;
            self.eat(&Tok::Semicolon)?;
            fields.push((ty, name));
        }
        self.eat(&Tok::RBrace)?;
        Ok(fields)
    }

    /// Parse `struct Name { fields };`.
    fn parse_struct_def(&mut self) -> PResult<StructDef> {
        self.eat(&Tok::KwStruct)?;
        let name = self.expect_ident()?;
        self.type_names.insert(name.clone());
        let fields = self.parse_struct_body()?;
        self.eat(&Tok::Semicolon)?;
        Ok(StructDef { name, fields })
    }

    /// Parse `typedef struct [Tag] { fields } Alias;`. Registers both the tag
    /// (if present) and the alias as names for the same struct, returning a
    /// StructDef for each so lookups by either name succeed.
    fn parse_typedef(&mut self) -> PResult<Vec<StructDef>> {
        self.eat(&Tok::KwTypedef)?;
        self.eat(&Tok::KwStruct)?;
        // Optional struct tag.
        let tag = if let Tok::Ident(name) = self.peek().clone() {
            self.advance();
            Some(name)
        } else {
            None
        };
        let fields = self.parse_struct_body()?;
        let alias = self.expect_ident()?;
        self.eat(&Tok::Semicolon)?;

        self.type_names.insert(alias.clone());
        if let Some(t) = &tag {
            self.type_names.insert(t.clone());
        }

        // Canonical name: prefer the tag so `struct Node` and alias `Node`
        // resolve to the same definition.
        let canonical = tag.clone().unwrap_or_else(|| alias.clone());
        let mut defs = vec![StructDef { name: canonical.clone(), fields: fields.clone() }];
        if alias != canonical {
            defs.push(StructDef { name: alias, fields });
        }
        Ok(defs)
    }

    // ---- token helpers ----------------------------------------------------

    fn peek(&self) -> &Tok {
        &self.toks[self.pos].tok
    }

    fn peek_at(&self, offset: usize) -> &Tok {
        let idx = (self.pos + offset).min(self.toks.len() - 1);
        &self.toks[idx].tok
    }

    fn line(&self) -> usize {
        self.toks[self.pos].line
    }

    fn check(&self, t: &Tok) -> bool {
        self.peek() == t
    }

    fn advance(&mut self) -> Tok {
        let t = self.toks[self.pos].tok.clone();
        if self.pos < self.toks.len() - 1 {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, t: &Tok) -> PResult<()> {
        if self.check(t) {
            self.advance();
            Ok(())
        } else {
            Err(ParseError {
                message: format!("expected {:?}, found {:?}", t, self.peek()),
                line: self.line(),
            })
        }
    }

    fn match_tok(&mut self, t: &Tok) -> bool {
        if self.check(t) {
            self.advance();
            true
        } else {
            false
        }
    }

    // ---- types ------------------------------------------------------------

    fn is_type_start(&self) -> bool {
        match self.peek() {
            Tok::KwInt
            | Tok::KwChar
            | Tok::KwDouble
            | Tok::KwFloat
            | Tok::KwVoid
            | Tok::KwLong
            | Tok::KwStruct => true,
            // A known struct type name, or `size_t`.
            Tok::Ident(name) => name == "size_t" || self.type_names.contains(name),
            _ => false,
        }
    }

    fn parse_type(&mut self) -> PResult<CType> {
        let base = match self.peek().clone() {
            Tok::KwInt => {
                self.advance();
                BaseType::Int
            }
            Tok::KwChar => {
                self.advance();
                BaseType::Char
            }
            Tok::KwDouble => {
                self.advance();
                BaseType::Double
            }
            Tok::KwFloat => {
                self.advance();
                BaseType::Float
            }
            Tok::KwLong => {
                self.advance();
                BaseType::Long
            }
            Tok::KwVoid => {
                self.advance();
                BaseType::Void
            }
            Tok::KwStruct => {
                self.advance();
                let name = self.expect_ident()?;
                BaseType::Struct(name)
            }
            Tok::Ident(name) if name == "size_t" => {
                self.advance();
                // Model size_t as a plain integer.
                BaseType::Long
            }
            Tok::Ident(name) if self.type_names.contains(&name) => {
                self.advance();
                BaseType::Struct(name)
            }
            other => {
                return Err(ParseError {
                    message: format!("expected a type, found {:?}", other),
                    line: self.line(),
                })
            }
        };
        let mut pointer_depth = 0;
        while self.match_tok(&Tok::Star) {
            pointer_depth += 1;
        }
        Ok(CType { base, pointer_depth })
    }

    fn expect_ident(&mut self) -> PResult<String> {
        match self.advance() {
            Tok::Ident(name) => Ok(name),
            other => Err(ParseError {
                message: format!("expected identifier, found {:?}", other),
                line: self.line(),
            }),
        }
    }

    // ---- functions --------------------------------------------------------

    fn parse_function(&mut self) -> PResult<Function> {
        let ret = self.parse_type()?;
        let name = self.expect_ident()?;
        self.eat(&Tok::LParen)?;
        let mut params = Vec::new();
        if !self.check(&Tok::RParen) {
            // Handle `void` param list.
            if self.check(&Tok::KwVoid) && self.peek_at(1) == &Tok::RParen {
                self.advance();
            } else {
                loop {
                    let ty = self.parse_type()?;
                    let pname = self.expect_ident()?;
                    params.push(Param { ty, name: pname });
                    if !self.match_tok(&Tok::Comma) {
                        break;
                    }
                }
            }
        }
        self.eat(&Tok::RParen)?;
        self.eat(&Tok::LBrace)?;
        let body = self.parse_block_body()?;
        Ok(Function { ret, name, params, body })
    }

    /// Parse statements until a closing brace (which is consumed).
    fn parse_block_body(&mut self) -> PResult<Vec<Stmt>> {
        let mut stmts = Vec::new();
        while !self.check(&Tok::RBrace) && !self.check(&Tok::Eof) {
            stmts.push(self.parse_stmt()?);
        }
        self.eat(&Tok::RBrace)?;
        Ok(stmts)
    }

    // ---- statements -------------------------------------------------------

    fn parse_stmt(&mut self) -> PResult<Stmt> {
        let line = self.line();
        match self.peek() {
            Tok::LBrace => {
                self.advance();
                Ok(Stmt::Block(self.parse_block_body()?))
            }
            Tok::KwIf => self.parse_if(),
            Tok::KwWhile => self.parse_while(),
            Tok::KwFor => self.parse_for(),
            Tok::KwReturn => {
                self.advance();
                let expr = if self.check(&Tok::Semicolon) {
                    None
                } else {
                    Some(self.parse_expr()?)
                };
                self.eat(&Tok::Semicolon)?;
                Ok(Stmt::Return(expr, line))
            }
            Tok::KwBreak => {
                self.advance();
                self.eat(&Tok::Semicolon)?;
                Ok(Stmt::Break(line))
            }
            Tok::KwContinue => {
                self.advance();
                self.eat(&Tok::Semicolon)?;
                Ok(Stmt::Continue(line))
            }
            _ if self.is_type_start() => self.parse_var_decl(),
            _ => {
                let expr = self.parse_expr()?;
                self.eat(&Tok::Semicolon)?;
                Ok(Stmt::ExprStmt(expr, line))
            }
        }
    }

    fn parse_var_decl(&mut self) -> PResult<Stmt> {
        let line = self.line();
        let ty = self.parse_type()?;
        let name = self.expect_ident()?;

        // Array declaration: name[len]
        let mut array_len = None;
        if self.match_tok(&Tok::LBracket) {
            if let Tok::Int(n) = self.peek().clone() {
                self.advance();
                array_len = Some(n as usize);
            } else {
                array_len = Some(0); // size inferred from initializer
            }
            self.eat(&Tok::RBracket)?;
        }

        let mut init = None;
        let mut array_init = None;
        if self.match_tok(&Tok::Assign) {
            if self.check(&Tok::LBrace) {
                // Array initializer list { a, b, c }
                self.advance();
                let mut elems = Vec::new();
                if !self.check(&Tok::RBrace) {
                    loop {
                        elems.push(self.parse_expr()?);
                        if !self.match_tok(&Tok::Comma) {
                            break;
                        }
                        if self.check(&Tok::RBrace) {
                            break;
                        }
                    }
                }
                self.eat(&Tok::RBrace)?;
                if array_len.is_none() {
                    array_len = Some(elems.len());
                }
                array_init = Some(elems);
            } else {
                init = Some(self.parse_expr()?);
            }
        }
        self.eat(&Tok::Semicolon)?;
        Ok(Stmt::VarDecl {
            ty,
            name,
            array_len,
            init,
            array_init,
            line,
        })
    }

    fn parse_if(&mut self) -> PResult<Stmt> {
        let line = self.line();
        self.eat(&Tok::KwIf)?;
        self.eat(&Tok::LParen)?;
        let cond = self.parse_expr()?;
        self.eat(&Tok::RParen)?;
        let then_branch = self.parse_stmt_as_block()?;
        let else_branch = if self.match_tok(&Tok::KwElse) {
            Some(self.parse_stmt_as_block()?)
        } else {
            None
        };
        Ok(Stmt::If { cond, then_branch, else_branch, line })
    }

    fn parse_while(&mut self) -> PResult<Stmt> {
        let line = self.line();
        self.eat(&Tok::KwWhile)?;
        self.eat(&Tok::LParen)?;
        let cond = self.parse_expr()?;
        self.eat(&Tok::RParen)?;
        let body = self.parse_stmt_as_block()?;
        Ok(Stmt::While { cond, body, line })
    }

    fn parse_for(&mut self) -> PResult<Stmt> {
        let line = self.line();
        self.eat(&Tok::KwFor)?;
        self.eat(&Tok::LParen)?;

        let init = if self.check(&Tok::Semicolon) {
            self.advance();
            None
        } else if self.is_type_start() {
            Some(Box::new(self.parse_var_decl()?))
        } else {
            let e = self.parse_expr()?;
            self.eat(&Tok::Semicolon)?;
            Some(Box::new(Stmt::ExprStmt(e, line)))
        };

        let cond = if self.check(&Tok::Semicolon) {
            None
        } else {
            Some(self.parse_expr()?)
        };
        self.eat(&Tok::Semicolon)?;

        let step = if self.check(&Tok::RParen) {
            None
        } else {
            Some(self.parse_expr()?)
        };
        self.eat(&Tok::RParen)?;

        let body = self.parse_stmt_as_block()?;
        Ok(Stmt::For { init, cond, step, body, line })
    }

    /// Parse a single statement, wrapping a non-block as a one-element block.
    fn parse_stmt_as_block(&mut self) -> PResult<Vec<Stmt>> {
        if self.check(&Tok::LBrace) {
            self.advance();
            self.parse_block_body()
        } else {
            Ok(vec![self.parse_stmt()?])
        }
    }

    // ---- expressions (precedence climbing) --------------------------------

    fn parse_expr(&mut self) -> PResult<Expr> {
        self.parse_assignment()
    }

    fn parse_assignment(&mut self) -> PResult<Expr> {
        let left = self.parse_ternary()?;
        match self.peek() {
            Tok::Assign => {
                self.advance();
                let right = self.parse_assignment()?;
                Ok(Expr::Assign(Box::new(left), Box::new(right)))
            }
            Tok::PlusEq | Tok::MinusEq | Tok::StarEq | Tok::SlashEq => {
                let op = match self.advance() {
                    Tok::PlusEq => BinOp::Add,
                    Tok::MinusEq => BinOp::Sub,
                    Tok::StarEq => BinOp::Mul,
                    Tok::SlashEq => BinOp::Div,
                    _ => unreachable!(),
                };
                let right = self.parse_assignment()?;
                // a += b  =>  a = a + b
                let combined = Expr::Binary(op, Box::new(left.clone()), Box::new(right));
                Ok(Expr::Assign(Box::new(left), Box::new(combined)))
            }
            _ => Ok(left),
        }
    }

    fn parse_ternary(&mut self) -> PResult<Expr> {
        let cond = self.parse_logic_or()?;
        if self.match_tok(&Tok::Question) {
            // then/else arms parse at assignment level, per C grammar.
            let then_expr = self.parse_assignment()?;
            self.eat(&Tok::Colon)?;
            let else_expr = self.parse_assignment()?;
            Ok(Expr::Ternary {
                cond: Box::new(cond),
                then_expr: Box::new(then_expr),
                else_expr: Box::new(else_expr),
            })
        } else {
            Ok(cond)
        }
    }

    fn parse_logic_or(&mut self) -> PResult<Expr> {
        let mut left = self.parse_logic_and()?;
        while self.check(&Tok::OrOr) {
            self.advance();
            let right = self.parse_logic_and()?;
            left = Expr::Binary(BinOp::Or, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_logic_and(&mut self) -> PResult<Expr> {
        let mut left = self.parse_equality()?;
        while self.check(&Tok::AndAnd) {
            self.advance();
            let right = self.parse_equality()?;
            left = Expr::Binary(BinOp::And, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_equality(&mut self) -> PResult<Expr> {
        let mut left = self.parse_relational()?;
        loop {
            let op = match self.peek() {
                Tok::Eq => BinOp::Eq,
                Tok::Ne => BinOp::Ne,
                _ => break,
            };
            self.advance();
            let right = self.parse_relational()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_relational(&mut self) -> PResult<Expr> {
        let mut left = self.parse_additive()?;
        loop {
            let op = match self.peek() {
                Tok::Lt => BinOp::Lt,
                Tok::Gt => BinOp::Gt,
                Tok::Le => BinOp::Le,
                Tok::Ge => BinOp::Ge,
                _ => break,
            };
            self.advance();
            let right = self.parse_additive()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_additive(&mut self) -> PResult<Expr> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let op = match self.peek() {
                Tok::Plus => BinOp::Add,
                Tok::Minus => BinOp::Sub,
                _ => break,
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> PResult<Expr> {
        let mut left = self.parse_unary()?;
        loop {
            let op = match self.peek() {
                Tok::Star => BinOp::Mul,
                Tok::Slash => BinOp::Div,
                Tok::Percent => BinOp::Mod,
                _ => break,
            };
            self.advance();
            let right = self.parse_unary()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> PResult<Expr> {
        match self.peek() {
            Tok::Minus => {
                self.advance();
                Ok(Expr::Unary(UnOp::Neg, Box::new(self.parse_unary()?)))
            }
            Tok::Not => {
                self.advance();
                Ok(Expr::Unary(UnOp::Not, Box::new(self.parse_unary()?)))
            }
            Tok::Amp => {
                self.advance();
                Ok(Expr::Unary(UnOp::AddrOf, Box::new(self.parse_unary()?)))
            }
            Tok::Star => {
                self.advance();
                Ok(Expr::Unary(UnOp::Deref, Box::new(self.parse_unary()?)))
            }
            Tok::PlusPlus => {
                self.advance();
                let e = self.parse_unary()?;
                Ok(Expr::IncDec { target: Box::new(e), delta: 1, prefix: true })
            }
            Tok::MinusMinus => {
                self.advance();
                let e = self.parse_unary()?;
                Ok(Expr::IncDec { target: Box::new(e), delta: -1, prefix: true })
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> PResult<Expr> {
        let mut expr = self.parse_primary()?;
        loop {
            match self.peek() {
                Tok::LBracket => {
                    self.advance();
                    let idx = self.parse_expr()?;
                    self.eat(&Tok::RBracket)?;
                    expr = Expr::Index(Box::new(expr), Box::new(idx));
                }
                Tok::Dot => {
                    self.advance();
                    let field = self.expect_ident()?;
                    expr = Expr::Member { base: Box::new(expr), field, arrow: false };
                }
                Tok::Arrow => {
                    self.advance();
                    let field = self.expect_ident()?;
                    expr = Expr::Member { base: Box::new(expr), field, arrow: true };
                }
                Tok::PlusPlus => {
                    self.advance();
                    expr = Expr::IncDec { target: Box::new(expr), delta: 1, prefix: false };
                }
                Tok::MinusMinus => {
                    self.advance();
                    expr = Expr::IncDec { target: Box::new(expr), delta: -1, prefix: false };
                }
                _ => break,
            }
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> PResult<Expr> {
        match self.peek().clone() {
            Tok::Int(n) => {
                self.advance();
                Ok(Expr::IntLit(n))
            }
            Tok::Float(f) => {
                self.advance();
                Ok(Expr::FloatLit(f))
            }
            Tok::Char(c) => {
                self.advance();
                Ok(Expr::CharLit(c))
            }
            Tok::Str(s) => {
                self.advance();
                Ok(Expr::StrLit(s))
            }
            Tok::LParen => {
                self.advance();
                let e = self.parse_expr()?;
                self.eat(&Tok::RParen)?;
                Ok(e)
            }
            Tok::Ident(name) => {
                self.advance();
                if self.check(&Tok::LParen) {
                    self.advance();
                    let mut args = Vec::new();
                    if !self.check(&Tok::RParen) {
                        loop {
                            args.push(self.parse_expr()?);
                            if !self.match_tok(&Tok::Comma) {
                                break;
                            }
                        }
                    }
                    self.eat(&Tok::RParen)?;
                    Ok(Expr::Call(name, args))
                } else {
                    Ok(Expr::Ident(name))
                }
            }
            other => Err(ParseError {
                message: format!("unexpected token in expression: {:?}", other),
                line: self.line(),
            }),
        }
    }
}
