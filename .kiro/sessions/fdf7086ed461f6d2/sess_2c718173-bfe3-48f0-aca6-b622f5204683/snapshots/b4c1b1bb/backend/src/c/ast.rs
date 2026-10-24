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
    /// A user-defined struct type, carrying the canonical struct name.
    Struct(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct CType {
    pub base: BaseType,
    /// Number of `*` levels (0 = plain value, 1 = `int*`, etc.).
    pub pointer_depth: u32,
}

impl CType {
    pub fn display(&self) -> String {
        let base = match &self.base {
            BaseType::Int => "int".to_string(),
            BaseType::Char => "char".to_string(),
            BaseType::Double => "double".to_string(),
            BaseType::Float => "float".to_string(),
            BaseType::Long => "long".to_string(),
            BaseType::Void => "void".to_string(),
            BaseType::Struct(name) => format!("struct {}", name),
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
    /// Ternary conditional: cond ? then_expr : else_expr.
    Ternary {
        cond: Box<Expr>,
        then_expr: Box<Expr>,
        else_expr: Box<Expr>,
    },
    /// Struct member access: base.field or base->field (arrow = true for ->).
    Member {
        base: Box<Expr>,
        field: String,
        arrow: bool,
    },
    /// sizeof operator; we don't model real sizes, just a positive integer.
    Sizeof,
    /// Null pointer literal (NULL).
    Null,
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
    /// Return type (kept for future type checking / coercion of return values).
    #[allow(dead_code)]
    pub ret: CType,
    pub name: String,
    pub params: Vec<Param>,
    pub body: Vec<Stmt>,
}

/// A struct type definition: `struct Name { CType field; ... }`.
#[derive(Debug, Clone)]
pub struct StructDef {
    /// The canonical struct name (the tag after `struct`, or the typedef alias
    /// when there is no tag).
    pub name: String,
    pub fields: Vec<(CType, String)>,
}

#[derive(Debug, Clone)]
pub struct Program {
    pub functions: Vec<Function>,
    pub structs: Vec<StructDef>,
}
