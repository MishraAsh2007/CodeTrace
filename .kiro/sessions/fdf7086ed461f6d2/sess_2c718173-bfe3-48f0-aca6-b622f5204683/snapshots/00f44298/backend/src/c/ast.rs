//! AST for the supported subset of C.

/// A declared/base type. Pointers are tracked by `pointer_depth`.
#[derive(Debug, Clone, PartialEq)]
pub enum BaseType {
    Int,
    Char,
    Double,
    Float,
    Long,
    Void,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CType {
    pub base: BaseType,
    /// Number of `*` levels (0 = plain value, 1 = `int*`, etc.).
    pub pointer_depth: u32,
}

impl CType {
    pub fn display(&self) -> String {
        let base = match self.base {
            BaseType::Int => "int",
            BaseType::Char => "char",
            BaseType::Double => "double",
            BaseType::Float => "float",
            BaseType::Long => "long",
            BaseType::Void => "void",
        };
        format!("{}{}", base, "*".repeat(self.pointer_depth as usize))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UnOp {
    Neg,
    Not,
    /// Address-of: &x
    AddrOf,
    /// Dereference: *p
    Deref,
}

#[derive(Debug, Clone)]
pub enum Expr {
    IntLit(i64),
    FloatLit(f64),
    CharLit(char),
    StrLit(String),
    Ident(String),
    /// Array indexing: base[index]
    Index(Box<Expr>, Box<Expr>),
    /// Unary operation.
    Unary(UnOp, Box<Expr>),
    /// Binary operation.
    Binary(BinOp, Box<Expr>, Box<Expr>),
    /// Assignment: target = value. Target is an lvalue expression.
    Assign(Box<Expr>, Box<Expr>),
    /// Function call: name(args...).
    Call(String, Vec<Expr>),
    /// Pre/post increment/decrement; bool = is_prefix, i64 = +1/-1.
    IncDec { target: Box<Expr>, delta: i64, prefix: bool },
}

#[derive(Debug, Clone)]
pub enum Stmt {
    /// Variable declaration, optionally with an initializer.
    /// For arrays, `array_len` is Some(n).
    VarDecl {
        ty: CType,
        name: String,
        array_len: Option<usize>,
        init: Option<Expr>,
        /// For `int a[] = {1,2,3}` or `int a[3] = {...}`.
        array_init: Option<Vec<Expr>>,
        line: usize,
    },
    ExprStmt(Expr, usize),
    If {
        cond: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Option<Vec<Stmt>>,
        line: usize,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
        line: usize,
    },
    For {
        init: Option<Box<Stmt>>,
        cond: Option<Expr>,
        step: Option<Expr>,
        body: Vec<Stmt>,
        line: usize,
    },
    Return(Option<Expr>, usize),
    Break(usize),
    Continue(usize),
    Block(Vec<Stmt>),
}

#[derive(Debug, Clone)]
pub struct Param {
    pub ty: CType,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Function {
    pub ret: CType,
    pub name: String,
    pub params: Vec<Param>,
    pub body: Vec<Stmt>,
}

#[derive(Debug, Clone)]
pub struct Program {
    pub functions: Vec<Function>,
}
