//! Tree-walking interpreter for the supported subset of C.
//!
//! It evaluates the AST while recording a `ProgramState` snapshot after each
//! statement, assembling an `ExecutionTrace` for the visualizer. The runtime
//! value model distinguishes:
//!   - scalars (int/char/double) -> rendered as primitive boxes (value sem.)
//!   - pointers (address of a storage cell or heap object) -> rendered as
//!     reference arrows (reference semantics)
//!   - heap arrays / heap blocks from malloc -> heap objects

use std::collections::{BTreeMap, HashMap};

use super::ast::*;
use crate::trace::{
    ExecutionTrace, HeapObject, ProgramState, StackFrame, Value as TValue, Variable as TVariable,
};

const MAX_STEPS: usize = 2000;

#[derive(Debug)]
pub struct RuntimeError {
    pub message: String,
    pub line: usize,
}

/// A runtime scalar.
#[derive(Debug, Clone)]
enum Scalar {
    Int(i64),
    Double(f64),
    Char(char),
}

impl Scalar {
    fn as_i64(&self) -> i64 {
        match self {
            Scalar::Int(i) => *i,
            Scalar::Char(c) => *c as i64,
            Scalar::Double(d) => *d as i64,
        }
    }

    fn as_f64(&self) -> f64 {
        match self {
            Scalar::Int(i) => *i as f64,
            Scalar::Char(c) => *c as i64 as f64,
            Scalar::Double(d) => *d,
        }
    }

    fn truthy(&self) -> bool {
        match self {
            Scalar::Int(i) => *i != 0,
            Scalar::Char(c) => *c != '\0',
            Scalar::Double(d) => *d != 0.0,
        }
    }

    fn display(&self) -> String {
        match self {
            Scalar::Int(i) => i.to_string(),
            Scalar::Char(c) => format!("'{}'", c.escape_default()),
            Scalar::Double(d) => format!("{}", d),
        }
    }

    fn type_name(&self) -> &'static str {
        match self {
            Scalar::Int(_) => "int",
            Scalar::Char(_) => "char",
            Scalar::Double(_) => "double",
        }
    }
}

/// A runtime value: a scalar, a pointer, or a heap-array pointer (decayed).
#[derive(Debug, Clone)]
enum RValue {
    Scalar(Scalar),
    /// Pointer to a storage location (see `Location`). None = null pointer.
    Pointer(Option<Location>),
    /// Void / no value (e.g. result of a void call).
    Void,
}

/// Where a value is stored (the target of a pointer / an lvalue address).
#[derive(Debug, Clone)]
enum Location {
    /// A named variable slot in a stack frame (frame index + variable name).
    Local { frame: usize, name: String },
    /// A heap array cell: object id + index.
    HeapCell { id: String, index: usize },
    /// A field inside a heap struct instance: object id + field name.
    HeapField { id: String, field: String },
}

/// Runtime storage for one variable slot.
#[derive(Debug, Clone)]
enum Slot {
    Scalar(Scalar),
    Pointer(Option<Location>),
    /// A local array lives in the heap; the slot holds the heap id + type.
    /// `element_type` is retained for future element-type-aware coercion.
    ArrayRef {
        id: String,
        #[allow(dead_code)]
        element_type: BaseType,
    },
}

struct Frame {
    function_name: String,
    /// Insertion-ordered variable names for stable display.
    order: Vec<String>,
    slots: HashMap<String, Slot>,
    declared: HashMap<String, CType>,
}

/// A heap array of scalars (we keep raw scalars + element type).
struct HeapArray {
    element_type: BaseType,
    cells: Vec<Scalar>,
}

enum Flow {
    Normal,
    Break,
    Continue,
    Return(RValue),
}

pub struct Interp<'a> {
    program: &'a Program,
    functions: HashMap<String, &'a Function>,
    frames: Vec<Frame>,
    heap: HashMap<String, HeapArray>,
    next_heap_id: usize,
    states: Vec<ProgramState>,
    stdout: String,
    step_counter: usize,
}

impl<'a> Interp<'a> {
    pub fn new(program: &'a Program) -> Self {
        let mut functions = HashMap::new();
        for f in &program.functions {
            functions.insert(f.name.clone(), f);
        }
        Interp {
            program,
            functions,
            frames: Vec::new(),
            heap: HashMap::new(),
            next_heap_id: 0,
            states: Vec::new(),
            stdout: String::new(),
            step_counter: 0,
        }
    }

    pub fn run(mut self) -> Result<ExecutionTrace, RuntimeError> {
        let main = self.functions.get("main").copied().ok_or(RuntimeError {
            message: "no 'main' function found".into(),
            line: 0,
        })?;
        self.call_function(main, Vec::new(), 0)?;
        Ok(ExecutionTrace { states: self.states })
    }

    // ---- heap helpers -----------------------------------------------------

    fn fresh_heap_id(&mut self, prefix: &str) -> String {
        let id = format!("{}_{}", prefix, self.next_heap_id);
        self.next_heap_id += 1;
        id
    }

    // ---- function call ----------------------------------------------------

    fn call_function(
        &mut self,
        func: &'a Function,
        args: Vec<RValue>,
        line: usize,
    ) -> Result<RValue, RuntimeError> {
        if self.frames.len() > 100 {
            return Err(RuntimeError {
                message: "call stack overflow (recursion too deep)".into(),
                line,
            });
        }

        let mut frame = Frame {
            function_name: func.name.clone(),
            order: Vec::new(),
            slots: HashMap::new(),
            declared: HashMap::new(),
        };

        for (param, arg) in func.params.iter().zip(args.into_iter()) {
            let slot = match arg {
                RValue::Scalar(s) => Slot::Scalar(coerce_scalar(s, &param.ty.base)),
                RValue::Pointer(p) => Slot::Pointer(p),
                RValue::Void => Slot::Scalar(Scalar::Int(0)),
            };
            frame.order.push(param.name.clone());
            frame.slots.insert(param.name.clone(), slot);
            frame.declared.insert(param.name.clone(), param.ty.clone());
        }

        self.frames.push(frame);

        // Entry snapshot: anchor a state at this function's own call depth
        // before its first statement runs. This guarantees every depth level
        // has a state at its entry point, which the frontend debugger relies
        // on for intuitive step-into / step-over / step-out behavior (otherwise
        // a function whose first action is itself a call would have no state at
        // its own depth until after the nested call returned).
        let entry_line = func.body.first().map(stmt_line).filter(|l| *l != 0);
        self.snapshot(entry_line, Some(format!("Enter {}()", func.name)));

        let flow = self.exec_block(&func.body)?;
        let ret = match flow {
            Flow::Return(v) => v,
            _ => RValue::Void,
        };

        self.frames.pop();
        Ok(ret)
    }

    // ---- statements -------------------------------------------------------

    fn exec_block(&mut self, stmts: &[Stmt]) -> Result<Flow, RuntimeError> {
        for stmt in stmts {
            let flow = self.exec_stmt(stmt)?;
            if !matches!(flow, Flow::Normal) {
                return Ok(flow);
            }
        }
        Ok(Flow::Normal)
    }

    fn exec_stmt(&mut self, stmt: &Stmt) -> Result<Flow, RuntimeError> {
        self.step_counter += 1;
        if self.step_counter > MAX_STEPS {
            return Err(RuntimeError {
                message: "execution step limit exceeded (possible infinite loop)".into(),
                line: stmt_line(stmt),
            });
        }

        match stmt {
            Stmt::VarDecl {
                ty,
                name,
                array_len,
                init,
                array_init,
                line,
            } => {
                self.exec_var_decl(ty, name, *array_len, init, array_init, *line)?;
                self.snapshot(Some(*line), Some(format!("Declared {}", name)));
                Ok(Flow::Normal)
            }
            Stmt::ExprStmt(expr, line) => {
                self.eval_expr(expr)?;
                self.snapshot(Some(*line), None);
                Ok(Flow::Normal)
            }
            Stmt::If {
                cond,
                then_branch,
                else_branch,
                line,
            } => {
                let c = self.eval_scalar(cond)?;
                self.snapshot(Some(*line), Some(format!("if (...) -> {}", c.truthy())));
                if c.truthy() {
                    self.exec_block(then_branch)
                } else if let Some(eb) = else_branch {
                    self.exec_block(eb)
                } else {
                    Ok(Flow::Normal)
                }
            }
            Stmt::While { cond, body, line } => {
                let mut iter = 0;
                loop {
                    let c = self.eval_scalar(cond)?;
                    self.snapshot(
                        Some(*line),
                        Some(format!("while (...) iteration {}, cond = {}", iter, c.truthy())),
                    );
                    if !c.truthy() {
                        break;
                    }
                    match self.exec_block(body)? {
                        Flow::Break => break,
                        Flow::Return(v) => return Ok(Flow::Return(v)),
                        _ => {}
                    }
                    iter += 1;
                }
                Ok(Flow::Normal)
            }
            Stmt::For {
                init,
                cond,
                step,
                body,
                line,
            } => {
                if let Some(init_stmt) = init {
                    self.exec_stmt(init_stmt)?;
                }
                let mut iter = 0;
                loop {
                    let keep = match cond {
                        Some(c) => self.eval_scalar(c)?.truthy(),
                        None => true,
                    };
                    self.snapshot(
                        Some(*line),
                        Some(format!("for loop iteration {}, cond = {}", iter, keep)),
                    );
                    if !keep {
                        break;
                    }
                    match self.exec_block(body)? {
                        Flow::Break => break,
                        Flow::Return(v) => return Ok(Flow::Return(v)),
                        _ => {}
                    }
                    if let Some(s) = step {
                        self.eval_expr(s)?;
                    }
                    iter += 1;
                }
                Ok(Flow::Normal)
            }
            Stmt::Return(expr, line) => {
                let v = match expr {
                    Some(e) => self.eval_expr(e)?,
                    None => RValue::Void,
                };
                self.snapshot(Some(*line), Some("return".into()));
                Ok(Flow::Return(v))
            }
            Stmt::Break(_) => Ok(Flow::Break),
            Stmt::Continue(_) => Ok(Flow::Continue),
            Stmt::Block(stmts) => self.exec_block(stmts),
        }
    }

    fn exec_var_decl(
        &mut self,
        ty: &CType,
        name: &str,
        array_len: Option<usize>,
        init: &Option<Expr>,
        array_init: &Option<Vec<Expr>>,
        _line: usize,
    ) -> Result<(), RuntimeError> {
        if let Some(len) = array_len {
            // Local array -> allocate a heap array.
            let id = self.fresh_heap_id("arr");
            let mut cells: Vec<Scalar> = Vec::new();
            if let Some(elems) = array_init {
                for e in elems {
                    let s = self.eval_scalar(e)?;
                    cells.push(coerce_scalar(s, &ty.base));
                }
            }
            while cells.len() < len {
                cells.push(default_scalar(&ty.base));
            }
            self.heap.insert(
                id.clone(),
                HeapArray {
                    element_type: ty.base.clone(),
                    cells,
                },
            );
            let frame = self.frames.last_mut().unwrap();
            frame.order.push(name.to_string());
            frame
                .slots
                .insert(name.to_string(), Slot::ArrayRef { id, element_type: ty.base.clone() });
            frame.declared.insert(name.to_string(), ty.clone());
            return Ok(());
        }

        // Scalar or pointer.
        let slot = if ty.pointer_depth > 0 {
            match init {
                Some(e) => {
                    let v = self.eval_expr(e)?;
                    match v {
                        RValue::Pointer(p) => Slot::Pointer(p),
                        RValue::Scalar(s) if s.as_i64() == 0 => Slot::Pointer(None),
                        _ => Slot::Pointer(None),
                    }
                }
                None => Slot::Pointer(None),
            }
        } else {
            let s = match init {
                Some(e) => self.eval_scalar(e)?,
                None => default_scalar(&ty.base),
            };
            Slot::Scalar(coerce_scalar(s, &ty.base))
        };

        let frame = self.frames.last_mut().unwrap();
        frame.order.push(name.to_string());
        frame.slots.insert(name.to_string(), slot);
        frame.declared.insert(name.to_string(), ty.clone());
        Ok(())
    }

    // ---- expression evaluation -------------------------------------------

    fn eval_scalar(&mut self, expr: &Expr) -> Result<Scalar, RuntimeError> {
        match self.eval_expr(expr)? {
            RValue::Scalar(s) => Ok(s),
            RValue::Pointer(_) => Ok(Scalar::Int(0)),
            RValue::Void => Ok(Scalar::Int(0)),
        }
    }

    fn eval_expr(&mut self, expr: &Expr) -> Result<RValue, RuntimeError> {
        match expr {
            Expr::IntLit(n) => Ok(RValue::Scalar(Scalar::Int(*n))),
            Expr::FloatLit(f) => Ok(RValue::Scalar(Scalar::Double(*f))),
            Expr::CharLit(c) => Ok(RValue::Scalar(Scalar::Char(*c))),
            Expr::StrLit(_) => Ok(RValue::Scalar(Scalar::Int(0))), // strings only used in printf
            Expr::Ident(name) => self.read_ident(name),
            Expr::Index(base, idx) => {
                let loc = self.lvalue_of_index(base, idx)?;
                self.read_location(&loc)
            }
            Expr::Unary(op, inner) => self.eval_unary(op, inner),
            Expr::Binary(op, l, r) => self.eval_binary(op, l, r),
            Expr::Assign(target, value) => {
                let v = self.eval_expr(value)?;
                let loc = self.lvalue_of(target)?;
                self.write_location(&loc, v.clone())?;
                Ok(v)
            }
            Expr::IncDec { target, delta, prefix } => {
                let loc = self.lvalue_of(target)?;
                let old = self.read_location(&loc)?;
                let old_s = match old {
                    RValue::Scalar(s) => s,
                    _ => Scalar::Int(0),
                };
                let new_s = Scalar::Int(old_s.as_i64() + delta);
                self.write_location(&loc, RValue::Scalar(new_s.clone()))?;
                Ok(RValue::Scalar(if *prefix { new_s } else { old_s }))
            }
            Expr::Call(name, args) => self.eval_call(name, args),
        }
    }

    fn eval_unary(&mut self, op: &UnOp, inner: &Expr) -> Result<RValue, RuntimeError> {
        match op {
            UnOp::Neg => {
                let s = self.eval_scalar(inner)?;
                Ok(RValue::Scalar(match s {
                    Scalar::Double(d) => Scalar::Double(-d),
                    other => Scalar::Int(-other.as_i64()),
                }))
            }
            UnOp::Not => {
                let s = self.eval_scalar(inner)?;
                Ok(RValue::Scalar(Scalar::Int(if s.truthy() { 0 } else { 1 })))
            }
            UnOp::AddrOf => {
                let loc = self.lvalue_of(inner)?;
                Ok(RValue::Pointer(Some(loc)))
            }
            UnOp::Deref => {
                let v = self.eval_expr(inner)?;
                match v {
                    RValue::Pointer(Some(loc)) => self.read_location(&loc),
                    RValue::Pointer(None) => Err(RuntimeError {
                        message: "dereferenced a null pointer".into(),
                        line: 0,
                    }),
                    _ => Err(RuntimeError {
                        message: "cannot dereference a non-pointer".into(),
                        line: 0,
                    }),
                }
            }
        }
    }

    fn eval_binary(&mut self, op: &BinOp, l: &Expr, r: &Expr) -> Result<RValue, RuntimeError> {
        // Short-circuit logicals.
        if let BinOp::And = op {
            let lv = self.eval_scalar(l)?;
            if !lv.truthy() {
                return Ok(RValue::Scalar(Scalar::Int(0)));
            }
            let rv = self.eval_scalar(r)?;
            return Ok(RValue::Scalar(Scalar::Int(if rv.truthy() { 1 } else { 0 })));
        }
        if let BinOp::Or = op {
            let lv = self.eval_scalar(l)?;
            if lv.truthy() {
                return Ok(RValue::Scalar(Scalar::Int(1)));
            }
            let rv = self.eval_scalar(r)?;
            return Ok(RValue::Scalar(Scalar::Int(if rv.truthy() { 1 } else { 0 })));
        }

        let lv = self.eval_scalar(l)?;
        let rv = self.eval_scalar(r)?;
        let use_float = matches!(lv, Scalar::Double(_)) || matches!(rv, Scalar::Double(_));

        let result = match op {
            BinOp::Add if use_float => Scalar::Double(lv.as_f64() + rv.as_f64()),
            BinOp::Sub if use_float => Scalar::Double(lv.as_f64() - rv.as_f64()),
            BinOp::Mul if use_float => Scalar::Double(lv.as_f64() * rv.as_f64()),
            BinOp::Div if use_float => Scalar::Double(lv.as_f64() / rv.as_f64()),
            BinOp::Add => Scalar::Int(lv.as_i64() + rv.as_i64()),
            BinOp::Sub => Scalar::Int(lv.as_i64() - rv.as_i64()),
            BinOp::Mul => Scalar::Int(lv.as_i64() * rv.as_i64()),
            BinOp::Div => {
                if rv.as_i64() == 0 {
                    return Err(RuntimeError { message: "division by zero".into(), line: 0 });
                }
                Scalar::Int(lv.as_i64() / rv.as_i64())
            }
            BinOp::Mod => {
                if rv.as_i64() == 0 {
                    return Err(RuntimeError { message: "modulo by zero".into(), line: 0 });
                }
                Scalar::Int(lv.as_i64() % rv.as_i64())
            }
            BinOp::Eq => Scalar::Int(bool_i(if use_float {
                lv.as_f64() == rv.as_f64()
            } else {
                lv.as_i64() == rv.as_i64()
            })),
            BinOp::Ne => Scalar::Int(bool_i(if use_float {
                lv.as_f64() != rv.as_f64()
            } else {
                lv.as_i64() != rv.as_i64()
            })),
            BinOp::Lt => Scalar::Int(bool_i(lv.as_f64() < rv.as_f64())),
            BinOp::Gt => Scalar::Int(bool_i(lv.as_f64() > rv.as_f64())),
            BinOp::Le => Scalar::Int(bool_i(lv.as_f64() <= rv.as_f64())),
            BinOp::Ge => Scalar::Int(bool_i(lv.as_f64() >= rv.as_f64())),
            BinOp::And | BinOp::Or => unreachable!(),
        };
        Ok(RValue::Scalar(result))
    }

    fn eval_call(&mut self, name: &str, args: &[Expr]) -> Result<RValue, RuntimeError> {
        if name == "printf" {
            return self.eval_printf(args);
        }
        if name == "malloc" {
            // Model malloc as allocating a 1-cell int heap array and returning
            // a pointer to cell 0. A richer model can size this by the arg.
            let id = self.fresh_heap_id("heap");
            self.heap.insert(
                id.clone(),
                HeapArray { element_type: BaseType::Int, cells: vec![Scalar::Int(0)] },
            );
            return Ok(RValue::Pointer(Some(Location::HeapCell { id, index: 0 })));
        }
        if name == "free" {
            // No-op in the model; keep the object so the trace stays readable.
            return Ok(RValue::Void);
        }

        let func = *self.functions.get(name).ok_or(RuntimeError {
            message: format!("call to unknown function '{}'", name),
            line: 0,
        })?;

        let mut evaled = Vec::new();
        for a in args {
            evaled.push(self.eval_expr(a)?);
        }
        self.call_function(func, evaled, 0)
    }

    fn eval_printf(&mut self, args: &[Expr]) -> Result<RValue, RuntimeError> {
        if args.is_empty() {
            return Ok(RValue::Scalar(Scalar::Int(0)));
        }
        let fmt = match &args[0] {
            Expr::StrLit(s) => s.clone(),
            _ => String::new(),
        };
        let mut out = String::new();
        let mut arg_idx = 1;
        let chars: Vec<char> = fmt.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '%' && i + 1 < chars.len() {
                let spec = chars[i + 1];
                i += 2;
                if spec == '%' {
                    out.push('%');
                    continue;
                }
                let val = if arg_idx < args.len() {
                    let v = self.eval_expr(&args[arg_idx])?;
                    arg_idx += 1;
                    v
                } else {
                    RValue::Scalar(Scalar::Int(0))
                };
                match spec {
                    'd' | 'i' | 'l' => out.push_str(&scalar_from(val).as_i64().to_string()),
                    'f' | 'g' => out.push_str(&format!("{}", scalar_from(val).as_f64())),
                    'c' => {
                        let code = scalar_from(val).as_i64();
                        if let Some(c) = char::from_u32(code as u32) {
                            out.push(c);
                        }
                    }
                    's' => out.push_str("(str)"),
                    'p' => out.push_str("(ptr)"),
                    _ => {
                        out.push('%');
                        out.push(spec);
                    }
                }
            } else {
                out.push(chars[i]);
                i += 1;
            }
        }
        self.stdout.push_str(&out);
        Ok(RValue::Scalar(Scalar::Int(out.len() as i64)))
    }

    // ---- lvalues / locations ----------------------------------------------

    fn lvalue_of(&mut self, expr: &Expr) -> Result<Location, RuntimeError> {
        match expr {
            Expr::Ident(name) => {
                let frame = self.find_var_frame(name).ok_or(RuntimeError {
                    message: format!("use of undeclared variable '{}'", name),
                    line: 0,
                })?;
                Ok(Location::Local { frame, name: name.clone() })
            }
            Expr::Index(base, idx) => self.lvalue_of_index(base, idx),
            Expr::Unary(UnOp::Deref, inner) => {
                let v = self.eval_expr(inner)?;
                match v {
                    RValue::Pointer(Some(loc)) => Ok(loc),
                    _ => Err(RuntimeError {
                        message: "cannot assign through a null/invalid pointer".into(),
                        line: 0,
                    }),
                }
            }
            _ => Err(RuntimeError {
                message: "invalid assignment target".into(),
                line: 0,
            }),
        }
    }

    fn lvalue_of_index(&mut self, base: &Expr, idx: &Expr) -> Result<Location, RuntimeError> {
        let index = self.eval_scalar(idx)?.as_i64();
        if index < 0 {
            return Err(RuntimeError {
                message: "negative array index".into(),
                line: 0,
            });
        }
        // The base must resolve to an array/heap block.
        let id = match base {
            Expr::Ident(name) => {
                let frame = self.find_var_frame(name).ok_or(RuntimeError {
                    message: format!("use of undeclared variable '{}'", name),
                    line: 0,
                })?;
                match self.frames[frame].slots.get(name) {
                    Some(Slot::ArrayRef { id, .. }) => id.clone(),
                    Some(Slot::Pointer(Some(Location::HeapCell { id, .. }))) => id.clone(),
                    _ => {
                        return Err(RuntimeError {
                            message: format!("'{}' is not an array or pointer", name),
                            line: 0,
                        })
                    }
                }
            }
            _ => {
                let v = self.eval_expr(base)?;
                match v {
                    RValue::Pointer(Some(Location::HeapCell { id, .. })) => id,
                    _ => {
                        return Err(RuntimeError {
                            message: "indexing a non-array expression".into(),
                            line: 0,
                        })
                    }
                }
            }
        };

        let len = self.heap.get(&id).map(|a| a.cells.len()).unwrap_or(0);
        if (index as usize) >= len {
            return Err(RuntimeError {
                message: format!("array index {} out of bounds (len {})", index, len),
                line: 0,
            });
        }
        Ok(Location::HeapCell { id, index: index as usize })
    }

    fn read_location(&mut self, loc: &Location) -> Result<RValue, RuntimeError> {
        match loc {
            Location::Local { frame, name } => match self.frames[*frame].slots.get(name) {
                Some(Slot::Scalar(s)) => Ok(RValue::Scalar(s.clone())),
                Some(Slot::Pointer(p)) => Ok(RValue::Pointer(p.clone())),
                Some(Slot::ArrayRef { id, .. }) => {
                    Ok(RValue::Pointer(Some(Location::HeapCell { id: id.clone(), index: 0 })))
                }
                None => Err(RuntimeError {
                    message: format!("variable '{}' not found", name),
                    line: 0,
                }),
            },
            Location::HeapCell { id, index } => {
                let arr = self.heap.get(id).ok_or(RuntimeError {
                    message: "dangling heap reference".into(),
                    line: 0,
                })?;
                Ok(RValue::Scalar(arr.cells[*index].clone()))
            }
        }
    }

    fn write_location(&mut self, loc: &Location, value: RValue) -> Result<(), RuntimeError> {
        match loc {
            Location::Local { frame, name } => {
                let existing = self.frames[*frame].slots.get(name).cloned();
                let new_slot = match (existing, value) {
                    (Some(Slot::Pointer(_)), RValue::Pointer(p)) => Slot::Pointer(p),
                    (_, RValue::Pointer(p)) => Slot::Pointer(p),
                    (Some(Slot::Scalar(old)), RValue::Scalar(s)) => {
                        // Preserve the slot's scalar kind where sensible.
                        Slot::Scalar(coerce_to_kind(s, &old))
                    }
                    (_, RValue::Scalar(s)) => Slot::Scalar(s),
                    (Some(prev), RValue::Void) => prev,
                    (None, RValue::Void) => Slot::Scalar(Scalar::Int(0)),
                };
                self.frames[*frame].slots.insert(name.clone(), new_slot);
                Ok(())
            }
            Location::HeapCell { id, index } => {
                let arr = self.heap.get_mut(id).ok_or(RuntimeError {
                    message: "write to dangling heap reference".into(),
                    line: 0,
                })?;
                let elem_kind = arr.element_type.clone();
                let s = match value {
                    RValue::Scalar(s) => coerce_scalar(s, &elem_kind),
                    _ => default_scalar(&elem_kind),
                };
                arr.cells[*index] = s;
                Ok(())
            }
        }
    }

    fn read_ident(&mut self, name: &str) -> Result<RValue, RuntimeError> {
        let frame = self.find_var_frame(name).ok_or(RuntimeError {
            message: format!("use of undeclared variable '{}'", name),
            line: 0,
        })?;
        self.read_location(&Location::Local { frame, name: name.to_string() })
    }

    /// Find the frame index that declares `name`, searching the current frame
    /// only (C has no closures; globals are not modeled here).
    fn find_var_frame(&self, name: &str) -> Option<usize> {
        let top = self.frames.len().checked_sub(1)?;
        if self.frames[top].slots.contains_key(name) {
            Some(top)
        } else {
            None
        }
    }

    // ---- snapshotting -----------------------------------------------------

    /// Stable id for the frame at index `fi` (must match the id used when
    /// building the StackFrame so pointer arrows resolve to the right row).
    fn frame_id(&self, fi: usize) -> String {
        let name = self
            .frames
            .get(fi)
            .map(|f| f.function_name.as_str())
            .unwrap_or("?");
        format!("frame_{}_{}", fi, name)
    }

    /// Convert a pointer slot into a trace Value, resolving its target to a
    /// heap object or a stack variable slot (so the arrow layer can draw it).
    fn pointer_to_value(&self, p: &Option<Location>) -> TValue {
        match p {
            Some(Location::HeapCell { id, .. }) => TValue::heap_ref(id.clone()),
            Some(Location::Local { frame, name }) => {
                TValue::stack_ref(self.frame_id(*frame), name.clone())
            }
            None => TValue::reference(None),
        }
    }

    fn snapshot(&mut self, line: Option<usize>, note: Option<String>) {
        let step = self.states.len();

        // Build stack frames for the trace.
        let mut stack = Vec::new();
        let top = self.frames.len().saturating_sub(1);
        for (fi, frame) in self.frames.iter().enumerate() {
            let mut variables = Vec::new();
            for vname in &frame.order {
                let slot = &frame.slots[vname];
                let declared = frame.declared.get(vname).map(|t| t.display());
                let tvalue = match slot {
                    Slot::Scalar(s) => TValue::primitive(s.display(), s.type_name()),
                    Slot::Pointer(p) => self.pointer_to_value(p),
                    Slot::ArrayRef { id, .. } => TValue::heap_ref(id.clone()),
                };
                variables.push(TVariable {
                    name: vname.clone(),
                    value: tvalue,
                    declared_type: declared,
                });
            }
            stack.push(StackFrame {
                id: self.frame_id(fi),
                function_name: frame.function_name.clone(),
                variables,
                is_active: Some(fi == top),
            });
        }

        // Build heap objects for the trace.
        let mut heap: BTreeMap<String, HeapObject> = BTreeMap::new();
        for (id, arr) in &self.heap {
            let elements = arr
                .cells
                .iter()
                .map(|s| TValue::primitive(s.display(), s.type_name()))
                .collect();
            heap.insert(
                id.clone(),
                HeapObject::Array {
                    id: id.clone(),
                    element_type: Some(base_type_name(&arr.element_type).to_string()),
                    elements,
                },
            );
        }

        self.states.push(ProgramState {
            step,
            line,
            depth: self.frames.len(),
            stack,
            heap,
            note,
            stdout: if self.stdout.is_empty() {
                None
            } else {
                Some(self.stdout.clone())
            },
        });
    }

    #[allow(dead_code)]
    fn program(&self) -> &Program {
        self.program
    }
}

// ---- free helpers ---------------------------------------------------------

fn bool_i(b: bool) -> i64 {
    if b {
        1
    } else {
        0
    }
}

fn scalar_from(v: RValue) -> Scalar {
    match v {
        RValue::Scalar(s) => s,
        _ => Scalar::Int(0),
    }
}

fn default_scalar(base: &BaseType) -> Scalar {
    match base {
        BaseType::Double | BaseType::Float => Scalar::Double(0.0),
        BaseType::Char => Scalar::Char('\0'),
        _ => Scalar::Int(0),
    }
}

fn coerce_scalar(s: Scalar, base: &BaseType) -> Scalar {
    match base {
        BaseType::Double | BaseType::Float => Scalar::Double(s.as_f64()),
        BaseType::Char => Scalar::Char(char::from_u32((s.as_i64() & 0xff) as u32).unwrap_or('\0')),
        _ => Scalar::Int(s.as_i64()),
    }
}

fn coerce_to_kind(s: Scalar, like: &Scalar) -> Scalar {
    match like {
        Scalar::Double(_) => Scalar::Double(s.as_f64()),
        Scalar::Char(_) => {
            char::from_u32((s.as_i64() & 0xff) as u32).map(Scalar::Char).unwrap_or(Scalar::Int(s.as_i64()))
        }
        Scalar::Int(_) => Scalar::Int(s.as_i64()),
    }
}

fn base_type_name(base: &BaseType) -> &'static str {
    match base {
        BaseType::Int => "int",
        BaseType::Char => "char",
        BaseType::Double => "double",
        BaseType::Float => "float",
        BaseType::Long => "long",
        BaseType::Void => "void",
    }
}

fn stmt_line(stmt: &Stmt) -> usize {
    match stmt {
        Stmt::VarDecl { line, .. } => *line,
        Stmt::ExprStmt(_, line) => *line,
        Stmt::If { line, .. } => *line,
        Stmt::While { line, .. } => *line,
        Stmt::For { line, .. } => *line,
        Stmt::Return(_, line) => *line,
        Stmt::Break(line) => *line,
        Stmt::Continue(line) => *line,
        Stmt::Block(_) => 0,
    }
}
