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
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::time::Instant;

use super::ast::*;
use super::trace::{
    ExecutionTrace, HeapObject, ProgramState, Return as TReturn, StackFrame, Value as TValue, Variable as TVariable,
};

const MAX_STEPS: usize = 2000;

/// TraceLab: limits for one run. `max_states` caps recorded snapshots (the step budget); `max_work` caps
/// statements plus loop-condition checks, so a loop with an empty body (which never runs a statement) still
/// stops. `record: false` runs without snapshots, for tests.
pub struct Limits {
    pub record: bool,
    pub max_states: usize,
    pub max_work: usize,
    pub deadline: Option<Instant>,
    pub max_output: usize,
    /// Set by the runner when the user presses Stop.
    pub cancel: Option<Arc<AtomicBool>>,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { record: true, max_states: usize::MAX, max_work: MAX_STEPS, deadline: None, max_output: 1 << 20, cancel: None }
    }
}

/// Why a run ended, with every state recorded up to that point (TraceLab keeps partial traces).
pub struct Outcome {
    pub states: Vec<ProgramState>,
    pub stdout: String,
    pub stop: Stop,
}

pub enum Stop {
    Finished { exit_code: Option<i64> },
    /// The recording budget (`max_states`) ran out.
    StateLimit,
    /// The wall-clock deadline passed.
    Timeout,
    /// Output passed `max_output` characters.
    OutputLimit,
    /// The user pressed Stop.
    Cancelled,
    /// A runtime error. When recording, the last state is the moment of the error.
    Error(RuntimeError),
}

// Sentinels unwound through `RuntimeError` like the original `__exit__`.
const STATE_LIMIT: &str = "__state_limit__";
const TIMEOUT: &str = "__timeout__";
const OUTPUT_LIMIT: &str = "__output_limit__";
const CANCELLED: &str = "__cancelled__";

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
    /// The whole heap object (struct), identified by id. This is what a
    /// `StructName *` pointer targets.
    HeapObj { id: String },
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
    /// TraceLab: a number unique to this call, so two calls at the same depth have different frame ids.
    activation: usize,
    /// TraceLab: the line of the statement this frame is running (for a caller, the line of the call).
    line: usize,
    function_name: String,
    /// Insertion-ordered variable names for stable display.
    order: Vec<String>,
    slots: HashMap<String, Slot>,
    declared: HashMap<String, CType>,
    /// Return type of this function (used to type a `return malloc(...)`).
    ret_type: CType,
}

/// A heap array of scalars (we keep raw scalars + element type).
struct HeapArray {
    element_type: BaseType,
    cells: Vec<Scalar>,
}

/// A heap struct instance. Fields are kept in declaration order for stable
/// display; each field holds a `Slot` (scalar or pointer).
struct HeapStruct {
    type_name: String,
    fields: Vec<(String, Slot)>,
}

impl HeapStruct {
    fn field(&self, name: &str) -> Option<&Slot> {
        self.fields.iter().find(|(n, _)| n == name).map(|(_, s)| s)
    }

    fn field_mut(&mut self, name: &str) -> Option<&mut Slot> {
        self.fields
            .iter_mut()
            .find(|(n, _)| n == name)
            .map(|(_, s)| s)
    }
}

/// Anything that can live on the heap in the runtime.
enum HeapObjectRuntime {
    Array(HeapArray),
    Struct(HeapStruct),
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
    /// Struct definitions keyed by canonical name (tag or alias). Used to
    /// default-initialize malloc'd structs and order their fields.
    structs: HashMap<String, &'a StructDef>,
    frames: Vec<Frame>,
    heap: HashMap<String, HeapObjectRuntime>,
    next_heap_id: usize,
    states: Vec<ProgramState>,
    stdout: String,
    step_counter: usize,
    /// Program stdin, consumed by scanf / getchar.
    stdin: Vec<char>,
    stdin_pos: usize,
    limits: Limits,
    /// Statements run plus loop-condition checks (see `Limits::max_work`).
    work: usize,
    next_activation: usize,
    /// Functions that returned since the last snapshot, reported on the next one.
    pending_returns: Vec<TReturn>,
    exit_code: Option<i64>,
}

impl<'a> Interp<'a> {
    pub fn new(program: &'a Program) -> Self {
        let mut functions = HashMap::new();
        for f in &program.functions {
            functions.insert(f.name.clone(), f);
        }
        let mut structs = HashMap::new();
        for s in &program.structs {
            structs.insert(s.name.clone(), s);
        }
        Interp {
            program,
            functions,
            structs,
            frames: Vec::new(),
            heap: HashMap::new(),
            next_heap_id: 0,
            states: Vec::new(),
            stdout: String::new(),
            step_counter: 0,
            stdin: Vec::new(),
            stdin_pos: 0,
            limits: Limits::default(),
            work: 0,
            next_activation: 0,
            pending_returns: Vec::new(),
            exit_code: None,
        }
    }

    /// TraceLab: replace the default limits (their 2,000-statement cap, no state cap).
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// Counts work and checks the time limit. Called for every statement and every snapshot point, so
    /// `while (1) {}` stops too.
    fn tick(&mut self, line: usize) -> Result<(), RuntimeError> {
        self.work += 1;
        if self.work > self.limits.max_work {
            return Err(RuntimeError {
                message: "execution step limit exceeded (possible infinite loop)".into(),
                line,
            });
        }
        if self.work % 1024 == 0 {
            if let Some(deadline) = self.limits.deadline {
                if Instant::now() > deadline {
                    return Err(RuntimeError { message: TIMEOUT.into(), line });
                }
            }
            if self.limits.cancel.as_ref().is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Err(RuntimeError { message: CANCELLED.into(), line });
            }
        }
        if self.stdout.len() > self.limits.max_output {
            return Err(RuntimeError { message: OUTPUT_LIMIT.into(), line });
        }
        Ok(())
    }

    /// TraceLab: runs `main` and keeps the states recorded before any error.
    pub fn run_traced(mut self) -> Outcome {
        let main = match self.functions.get("main").copied() {
            Some(main) => main,
            None => {
                return Outcome {
                    states: Vec::new(),
                    stdout: String::new(),
                    stop: Stop::Error(RuntimeError { message: "no 'main' function found".into(), line: 0 }),
                }
            }
        };
        let result = self.call_function(main, Vec::new(), 0);
        let stop = match result {
            Ok(value) => Stop::Finished {
                exit_code: match value {
                    RValue::Scalar(s) => Some(s.as_i64()),
                    _ => Some(0),
                },
            },
            Err(e) if e.message == "__exit__" => Stop::Finished { exit_code: self.exit_code },
            Err(e) if e.message == STATE_LIMIT => Stop::StateLimit,
            Err(e) if e.message == TIMEOUT => Stop::Timeout,
            Err(e) if e.message == OUTPUT_LIMIT => Stop::OutputLimit,
            Err(e) if e.message == CANCELLED => Stop::Cancelled,
            Err(mut e) => {
                // Frames are not popped while an error unwinds, so they still show the moment it happened.
                let line = self.frames.last().map(|f| f.line).filter(|l| *l != 0);
                if e.line == 0 {
                    e.line = line.unwrap_or(0);
                }
                // The statement cap is reported as a step limit, without an error state.
                if self.limits.record && !self.frames.is_empty() && !e.message.contains("step limit") {
                    self.push_state(line.or(Some(e.line)).filter(|l| *l != 0), Some("error".into()));
                }
                Stop::Error(e)
            }
        };
        Outcome { states: self.states, stdout: self.stdout, stop }
    }

    /// Construct an interpreter with a stdin buffer supplied.
    pub fn with_stdin(program: &'a Program, stdin: String) -> Self {
        let mut interp = Self::new(program);
        interp.set_stdin(stdin);
        interp
    }

    /// Supply (or replace) the program's stdin buffer.
    pub fn set_stdin(&mut self, s: String) {
        self.stdin = s.chars().collect();
        self.stdin_pos = 0;
    }

    // ---- stdin helpers ----------------------------------------------------

    /// Peek the next input char without consuming it.
    fn stdin_peek(&self) -> Option<char> {
        self.stdin.get(self.stdin_pos).copied()
    }

    /// Consume and return the next input char.
    fn stdin_next(&mut self) -> Option<char> {
        let c = self.stdin.get(self.stdin_pos).copied();
        if c.is_some() {
            self.stdin_pos += 1;
        }
        c
    }

    /// Skip leading whitespace in the input buffer (standard scanf behavior
    /// for numeric and %s conversions).
    fn stdin_skip_ws(&mut self) {
        while let Some(c) = self.stdin_peek() {
            if c.is_whitespace() {
                self.stdin_pos += 1;
            } else {
                break;
            }
        }
    }

    /// Read a whitespace-delimited token (assumes leading whitespace already
    /// skipped). Returns None if at end of input.
    fn stdin_read_token(&mut self) -> Option<String> {
        let mut tok = String::new();
        while let Some(c) = self.stdin_peek() {
            if c.is_whitespace() {
                break;
            }
            tok.push(c);
            self.stdin_pos += 1;
        }
        if tok.is_empty() {
            None
        } else {
            Some(tok)
        }
    }

    /// Read a numeric token: an optional sign, then characters valid for the
    /// requested kind (digits, and for floats '.', 'e', 'E', signs). Assumes
    /// leading whitespace already skipped. Returns None if no token.
    fn stdin_read_number(&mut self, float: bool) -> Option<String> {
        let mut tok = String::new();
        // Optional leading sign.
        if let Some(c) = self.stdin_peek() {
            if c == '+' || c == '-' {
                tok.push(c);
                self.stdin_pos += 1;
            }
        }
        while let Some(c) = self.stdin_peek() {
            let ok = if float {
                c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-'
            } else {
                c.is_ascii_digit()
            };
            if ok {
                tok.push(c);
                self.stdin_pos += 1;
            } else {
                break;
            }
        }
        if tok.is_empty() || tok == "+" || tok == "-" {
            None
        } else {
            Some(tok)
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn run(mut self) -> Result<ExecutionTrace, RuntimeError> {
        let main = self.functions.get("main").copied().ok_or(RuntimeError {
            message: "no 'main' function found".into(),
            line: 0,
        })?;
        match self.call_function(main, Vec::new(), 0) {
            Ok(_) => Ok(ExecutionTrace { states: self.states }),
            // `exit(code)` unwinds here: finish the trace successfully rather
            // than reporting a runtime error.
            Err(e) if e.message == "__exit__" => Ok(ExecutionTrace { states: self.states }),
            Err(e) => Err(e),
        }
    }

    /// Allocate a default-initialized heap struct of the named type, returning
    /// its heap id. Scalars default to 0; pointers default to null. Unknown
    /// types get an empty struct so the program can still run.
    fn alloc_struct(&mut self, type_name: &str) -> String {
        let id = self.fresh_heap_id("node");
        let mut fields: Vec<(String, Slot)> = Vec::new();
        if let Some(def) = self.structs.get(type_name).copied() {
            for (ty, fname) in &def.fields {
                let slot = if ty.pointer_depth > 0 {
                    Slot::Pointer(None)
                } else {
                    Slot::Scalar(default_scalar(&ty.base))
                };
                fields.push((fname.clone(), slot));
            }
        }
        self.heap.insert(
            id.clone(),
            HeapObjectRuntime::Struct(HeapStruct {
                type_name: type_name.to_string(),
                fields,
            }),
        );
        id
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

        if args.len() != func.params.len() {
            return Err(RuntimeError {
                message: format!(
                    "function '{}' expects {} argument(s) but got {}",
                    func.name,
                    func.params.len(),
                    args.len()
                ),
                line,
            });
        }

        self.next_activation += 1;
        let mut frame = Frame {
            activation: self.next_activation,
            line: func.body.first().map(stmt_line).unwrap_or(0),
            function_name: func.name.clone(),
            order: Vec::new(),
            slots: HashMap::new(),
            declared: HashMap::new(),
            ret_type: func.ret.clone(),
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
        self.snapshot(entry_line, Some(format!("Enter {}()", func.name)))?;

        let flow = self.exec_block(&func.body)?;
        let ret = match flow {
            Flow::Return(v) => v,
            _ => RValue::Void,
        };

        // TraceLab: report the return value on the next snapshot, like the Java worker's `returns`.
        if self.limits.record {
            let frame_id = self.frame_id(self.frames.len() - 1);
            let value = match &ret {
                RValue::Scalar(s) => Some(TValue::primitive(s.display(), s.type_name())),
                RValue::Pointer(p) => Some(self.pointer_to_value(p)),
                RValue::Void => None,
            };
            let is_void = value.is_none() || matches!(func.ret, CType { base: BaseType::Void, pointer_depth: 0 });
            self.pending_returns.push(TReturn { method: func.name.clone(), frame_id, value: if is_void { None } else { value } });
        }
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
        let line = stmt_line(stmt);
        if line != 0 {
            if let Some(frame) = self.frames.last_mut() {
                frame.line = line;
            }
        }
        // TraceLab: `tick` applies the statement cap (their MAX_STEPS by default) and the time limit.
        self.tick(line)?;

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
                self.snapshot(Some(*line), Some(format!("Declared {}", name)))?;
                Ok(Flow::Normal)
            }
            Stmt::ExprStmt(expr, line) => {
                self.eval_expr(expr)?;
                self.snapshot(Some(*line), None)?;
                Ok(Flow::Normal)
            }
            Stmt::If {
                cond,
                then_branch,
                else_branch,
                line,
            } => {
                let c = self.eval_scalar(cond)?;
                self.snapshot(Some(*line), Some(format!("if (...) -> {}", c.truthy())))?;
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
                    // TraceLab: the loop header is this frame's line again while the condition is checked.
                    if let Some(frame) = self.frames.last_mut() {
                        frame.line = *line;
                    }
                    self.snapshot(
                        Some(*line),
                        Some(format!("while (...) iteration {}, cond = {}", iter, c.truthy())),
                    )?;
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
                    if let Some(frame) = self.frames.last_mut() {
                        frame.line = *line;
                    }
                    self.snapshot(
                        Some(*line),
                        Some(format!("for loop iteration {}, cond = {}", iter, keep)),
                    )?;
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
                    Some(e) if is_malloc_call(e) => {
                        // `return malloc(...)` in a function returning a struct
                        // pointer: allocate a heap struct of the return type.
                        let ret_ty = self.frames.last().map(|f| f.ret_type.clone());
                        match ret_ty {
                            Some(CType { base: BaseType::Struct(name), pointer_depth })
                                if pointer_depth > 0 =>
                            {
                                let id = self.alloc_struct(&name);
                                RValue::Pointer(Some(Location::HeapObj { id }))
                            }
                            _ => self.eval_expr(e)?,
                        }
                    }
                    Some(e) => self.eval_expr(e)?,
                    None => RValue::Void,
                };
                self.snapshot(Some(*line), Some("return".into()))?;
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
                HeapObjectRuntime::Array(HeapArray {
                    element_type: ty.base.clone(),
                    cells,
                }),
            );
            let frame = self.frames.last_mut().unwrap();
            // TraceLab: a declaration inside a loop runs again each pass; list the variable once.
            if !frame.order.iter().any(|n| n == name) {
                frame.order.push(name.to_string());
            }
            frame
                .slots
                .insert(name.to_string(), Slot::ArrayRef { id, element_type: ty.base.clone() });
            frame.declared.insert(name.to_string(), ty.clone());
            return Ok(());
        }

        // Scalar or pointer.
        let slot = if ty.pointer_depth > 0 {
            // Special case: `StructName *x = malloc(...)` allocates a heap
            // struct of the declared type (we know the type from `ty`).
            let struct_type = match &ty.base {
                BaseType::Struct(name) => Some(name.clone()),
                _ => None,
            };
            match init {
                Some(e) if struct_type.is_some() && is_malloc_call(e) => {
                    let id = self.alloc_struct(struct_type.as_ref().unwrap());
                    Slot::Pointer(Some(Location::HeapObj { id }))
                }
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
        if !frame.order.iter().any(|n| n == name) {
            frame.order.push(name.to_string());
        }
        frame.slots.insert(name.to_string(), slot);
        frame.declared.insert(name.to_string(), ty.clone());
        Ok(())
    }

    // ---- expression evaluation -------------------------------------------

    fn eval_scalar(&mut self, expr: &Expr) -> Result<Scalar, RuntimeError> {
        match self.eval_expr(expr)? {
            RValue::Scalar(s) => Ok(s),
            // TraceLab: a pointer is true when it isn't NULL, so `if (p)`, `while (cur)` and `!p` work.
            RValue::Pointer(p) => Ok(Scalar::Int(bool_i(p.is_some()))),
            RValue::Void => Ok(Scalar::Int(0)),
        }
    }

    /// Synthetic size (in abstract "units") for a sizeof operand. We don't
    /// model bytes; instead a scalar/pointer is 1 unit and an array is its
    /// element count. This makes `sizeof arr / sizeof arr[0]` yield the array
    /// length, the standard C idiom. `None` (sizeof(type)) is 1 unit.
    fn sizeof_units(&self, operand: &Option<Box<Expr>>) -> i64 {
        let Some(expr) = operand else { return 1 };
        // An array variable's size is its length; everything else is 1 unit
        // (scalars, pointers, array elements like `arr[0]`, `*p`).
        if let Expr::Ident(name) = expr.as_ref() {
            if let Some(top) = self.frames.len().checked_sub(1) {
                if let Some(Slot::ArrayRef { id, .. }) = self.frames[top].slots.get(name) {
                    if let Some(HeapObjectRuntime::Array(arr)) = self.heap.get(id) {
                        return arr.cells.len() as i64;
                    }
                }
            }
        }
        1
    }

    fn eval_expr(&mut self, expr: &Expr) -> Result<RValue, RuntimeError> {
        match expr {
            Expr::IntLit(n) => Ok(RValue::Scalar(Scalar::Int(*n))),
            Expr::FloatLit(f) => Ok(RValue::Scalar(Scalar::Double(*f))),
            Expr::CharLit(c) => Ok(RValue::Scalar(Scalar::Char(*c))),
            Expr::StrLit(_) => Ok(RValue::Scalar(Scalar::Int(0))), // strings only used in printf
            Expr::Null => Ok(RValue::Pointer(None)),
            Expr::Sizeof(operand) => {
                Ok(RValue::Scalar(Scalar::Int(self.sizeof_units(operand))))
            }
            Expr::Ident(name) => self.read_ident(name),
            Expr::Ternary { cond, then_expr, else_expr } => {
                let c = self.eval_scalar(cond)?;
                if c.truthy() {
                    self.eval_expr(then_expr)
                } else {
                    self.eval_expr(else_expr)
                }
            }
            Expr::Member { .. } => {
                let loc = self.lvalue_of_member(expr)?;
                self.read_location(&loc)
            }
            Expr::Index(base, idx) => {
                let loc = self.lvalue_of_index(base, idx)?;
                self.read_location(&loc)
            }
            Expr::Unary(op, inner) => self.eval_unary(op, inner),
            Expr::Binary(op, l, r) => self.eval_binary(op, l, r),
            Expr::Assign(target, value) => {
                // `x = malloc(...)` where x is a struct pointer: allocate a
                // heap struct of x's declared struct type.
                if is_malloc_call(value) {
                    if let Some(type_name) = self.struct_type_of_target(target) {
                        let id = self.alloc_struct(&type_name);
                        let v = RValue::Pointer(Some(Location::HeapObj { id }));
                        let loc = self.lvalue_of(target)?;
                        self.write_location(&loc, v.clone())?;
                        return Ok(v);
                    }
                }
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
                let new_s = Scalar::Int(old_s.as_i64().wrapping_add(*delta));
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
                    other => Scalar::Int(other.as_i64().wrapping_neg()),
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

        // Equality/inequality may involve pointers (e.g. `root == NULL`).
        if matches!(op, BinOp::Eq | BinOp::Ne) {
            let lr = self.eval_expr(l)?;
            let rr = self.eval_expr(r)?;
            if matches!(lr, RValue::Pointer(_)) || matches!(rr, RValue::Pointer(_)) {
                let eq = pointers_equal(&lr, &rr);
                let res = match op {
                    BinOp::Eq => eq,
                    _ => !eq,
                };
                return Ok(RValue::Scalar(Scalar::Int(bool_i(res))));
            }
            // Neither is a pointer: fall through to scalar comparison using the
            // already-evaluated values.
            let lv = scalar_from(lr);
            let rv = scalar_from(rr);
            let use_float = matches!(lv, Scalar::Double(_)) || matches!(rv, Scalar::Double(_));
            let eq = if use_float {
                lv.as_f64() == rv.as_f64()
            } else {
                lv.as_i64() == rv.as_i64()
            };
            let res = match op {
                BinOp::Eq => eq,
                _ => !eq,
            };
            return Ok(RValue::Scalar(Scalar::Int(bool_i(res))));
        }

        let lv = self.eval_scalar(l)?;
        let rv = self.eval_scalar(r)?;
        let use_float = matches!(lv, Scalar::Double(_)) || matches!(rv, Scalar::Double(_));

        let result = match op {
            BinOp::Add if use_float => Scalar::Double(lv.as_f64() + rv.as_f64()),
            BinOp::Sub if use_float => Scalar::Double(lv.as_f64() - rv.as_f64()),
            BinOp::Mul if use_float => Scalar::Double(lv.as_f64() * rv.as_f64()),
            BinOp::Div if use_float => Scalar::Double(lv.as_f64() / rv.as_f64()),
            BinOp::Add => Scalar::Int(lv.as_i64().wrapping_add(rv.as_i64())),
            BinOp::Sub => Scalar::Int(lv.as_i64().wrapping_sub(rv.as_i64())),
            BinOp::Mul => Scalar::Int(lv.as_i64().wrapping_mul(rv.as_i64())),
            BinOp::Div => {
                if rv.as_i64() == 0 {
                    return Err(RuntimeError { message: "division by zero".into(), line: 0 });
                }
                // TraceLab: wrapping, because i64::MIN / -1 would panic and stop the runner's thread.
                Scalar::Int(lv.as_i64().wrapping_div(rv.as_i64()))
            }
            BinOp::Mod => {
                if rv.as_i64() == 0 {
                    return Err(RuntimeError { message: "modulo by zero".into(), line: 0 });
                }
                Scalar::Int(lv.as_i64().wrapping_rem(rv.as_i64()))
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
            // Untyped malloc (not assigned to a struct pointer): model as a
            // 1-cell int heap array. The struct-typed cases are handled at the
            // declaration / assignment / return sites which know the type.
            let id = self.fresh_heap_id("heap");
            self.heap.insert(
                id.clone(),
                HeapObjectRuntime::Array(HeapArray {
                    element_type: BaseType::Int,
                    cells: vec![Scalar::Int(0)],
                }),
            );
            return Ok(RValue::Pointer(Some(Location::HeapCell { id, index: 0 })));
        }
        if name == "free" {
            // No-op in the model; keep the object so the trace stays readable.
            return Ok(RValue::Void);
        }
        if name == "exit" {
            // TraceLab: keep the exit status for the run's result.
            self.exit_code = Some(match args.first() {
                Some(e) => self.eval_scalar(e)?.as_i64(),
                None => 0,
            });
            // Stop execution cleanly: unwind all frames via a sentinel error
            // that `run()` recognizes and treats as a successful finish.
            return Err(RuntimeError { message: "__exit__".into(), line: 0 });
        }
        if name == "perror" {
            // Print the message to stdout (we don't model stderr separately).
            if let Some(Expr::StrLit(s)) = args.first() {
                self.stdout.push_str(s);
                self.stdout.push('\n');
            }
            return Ok(RValue::Void);
        }
        if name == "scanf" {
            return self.eval_scanf(args);
        }
        if name == "getchar" {
            // Read one char; return its code, or EOF (-1) at end of input.
            let code = match self.stdin_next() {
                Some(c) => c as i64,
                None => -1,
            };
            return Ok(RValue::Scalar(Scalar::Int(code)));
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
                // TraceLab: read flags, width, precision and length modifiers (`%5d`, `%.2f`, `%ld`) before
                // the conversion, so they no longer print as text and use up an argument.
                let mut j = i + 1;
                let mut flags = String::new();
                while j < chars.len() && "-+ 0#".contains(chars[j]) {
                    flags.push(chars[j]);
                    j += 1;
                }
                let mut width = String::new();
                while j < chars.len() && chars[j].is_ascii_digit() {
                    width.push(chars[j]);
                    j += 1;
                }
                let mut precision: Option<usize> = None;
                if j < chars.len() && chars[j] == '.' {
                    j += 1;
                    let mut digits = String::new();
                    while j < chars.len() && chars[j].is_ascii_digit() {
                        digits.push(chars[j]);
                        j += 1;
                    }
                    precision = Some(digits.parse().unwrap_or(0));
                }
                while j < chars.len() && "hlLzjt".contains(chars[j]) {
                    j += 1;
                }
                if j >= chars.len() {
                    out.extend(&chars[i..]);
                    break;
                }
                let spec = chars[j];
                i = j + 1;
                if spec == '%' {
                    out.push('%');
                    continue;
                }
                let arg = args.get(arg_idx);
                let val = if arg_idx < args.len() {
                    let v = self.eval_expr(&args[arg_idx])?;
                    arg_idx += 1;
                    v
                } else {
                    RValue::Scalar(Scalar::Int(0))
                };
                let text = match spec {
                    'd' | 'i' | 'u' => {
                        let n = scalar_from(val).as_i64();
                        if flags.contains('+') && n >= 0 { format!("+{n}") } else { n.to_string() }
                    }
                    'f' | 'F' | 'e' | 'g' => {
                        let x = scalar_from(val).as_f64();
                        // The original printed `{}` (3.0 as "3"); with a precision, or for %f as in C, use six digits.
                        match (spec, precision) {
                            ('g', None) => format!("{}", x),
                            ('e', p) => format!("{:.*e}", p.unwrap_or(6), x),
                            (_, p) => format!("{:.*}", p.unwrap_or(6), x),
                        }
                    }
                    'c' => {
                        let code = scalar_from(val).as_i64();
                        char::from_u32(code as u32).map(String::from).unwrap_or_default()
                    }
                    // TraceLab: a string literal argument prints its text; other strings aren't modeled.
                    's' => match arg {
                        Some(Expr::StrLit(s)) => match precision { Some(p) => s.chars().take(p).collect(), None => s.clone() },
                        _ => "(str)".into(),
                    },
                    'x' | 'X' => {
                        let n = scalar_from(val).as_i64() as u64;
                        if spec == 'x' { format!("{:x}", n) } else { format!("{:X}", n) }
                    }
                    'p' => "(ptr)".into(),
                    _ => {
                        out.push('%');
                        out.push(spec);
                        continue;
                    }
                };
                let width: usize = width.parse().unwrap_or(0);
                let len = text.chars().count();
                if len >= width {
                    out.push_str(&text);
                } else if flags.contains('-') {
                    out.push_str(&text);
                    out.extend(std::iter::repeat(' ').take(width - len));
                } else if flags.contains('0') && !matches!(spec, 's' | 'c') {
                    let (sign, digits) = match text.strip_prefix('-') { Some(rest) => ("-", rest), None => ("", text.as_str()) };
                    out.push_str(sign);
                    out.extend(std::iter::repeat('0').take(width - len));
                    out.push_str(digits);
                } else {
                    out.extend(std::iter::repeat(' ').take(width - len));
                    out.push_str(&text);
                }
            } else {
                out.push(chars[i]);
                i += 1;
            }
        }
        self.stdout.push_str(&out);
        Ok(RValue::Scalar(Scalar::Int(out.len() as i64)))
    }

    /// `scanf(fmt, &a, &b, ...)`. Walks the format string, performing one
    /// conversion per `%` spec into the corresponding pointer argument.
    ///
    /// Returns the number of items successfully assigned. If end-of-input is
    /// hit before the first conversion, returns EOF (-1) so idioms like
    /// `while (scanf("%d", &x) == 1)` and `!= EOF` work.
    fn eval_scanf(&mut self, args: &[Expr]) -> Result<RValue, RuntimeError> {
        let fmt = match args.first() {
            Some(Expr::StrLit(s)) => s.clone(),
            _ => String::new(),
        };
        let chars: Vec<char> = fmt.chars().collect();
        let mut i = 0;
        let mut arg_idx = 1; // args[0] is the format string
        let mut assigned: i64 = 0;
        let mut hit_eof_first = false;

        while i < chars.len() {
            let c = chars[i];

            if c == '%' {
                i += 1;
                if i >= chars.len() {
                    break;
                }
                // Optional length modifier (l / ll / h) — consume and ignore.
                while i < chars.len() && (chars[i] == 'l' || chars[i] == 'h') {
                    i += 1;
                }
                if i >= chars.len() {
                    break;
                }
                let spec = chars[i];
                i += 1;

                if spec == '%' {
                    // Literal percent: match a '%' in input.
                    if self.stdin_peek() == Some('%') {
                        self.stdin_pos += 1;
                    }
                    continue;
                }

                // Perform the conversion into a parsed Scalar.
                let parsed: Option<Scalar> = match spec {
                    'd' | 'i' => {
                        self.stdin_skip_ws();
                        self.stdin_read_number(false)
                            .and_then(|t| t.parse::<i64>().ok())
                            .map(Scalar::Int)
                    }
                    'u' => {
                        self.stdin_skip_ws();
                        self.stdin_read_number(false)
                            .and_then(|t| t.parse::<i64>().ok())
                            .map(Scalar::Int)
                    }
                    'f' | 'g' | 'e' => {
                        self.stdin_skip_ws();
                        self.stdin_read_number(true)
                            .and_then(|t| t.parse::<f64>().ok())
                            .map(Scalar::Double)
                    }
                    'c' => {
                        // %c does NOT skip leading whitespace.
                        self.stdin_next().map(Scalar::Char)
                    }
                    's' => {
                        self.stdin_skip_ws();
                        self.stdin_read_token().map(|t| {
                            // Store the first char code of the token (we don't
                            // model char buffers); good enough for the model.
                            Scalar::Int(t.chars().next().map(|c| c as i64).unwrap_or(0))
                        })
                    }
                    _ => None,
                };

                match parsed {
                    Some(value) => {
                        // Evaluate the matching pointer arg and write into it.
                        let arg = match args.get(arg_idx) {
                            Some(a) => a,
                            None => {
                                // No more args: stop assigning.
                                break;
                            }
                        };
                        arg_idx += 1;
                        let ptr = self.eval_expr(arg)?;
                        match ptr {
                            RValue::Pointer(Some(loc)) => {
                                self.write_location(&loc, RValue::Scalar(value))?;
                                assigned += 1;
                            }
                            RValue::Pointer(None) => {
                                return Err(RuntimeError {
                                    message: "scanf into a null pointer".into(),
                                    line: 0,
                                });
                            }
                            _ => {
                                return Err(RuntimeError {
                                    message: "scanf argument is not a pointer".into(),
                                    line: 0,
                                });
                            }
                        }
                    }
                    None => {
                        // Conversion failed (end of input or no match). Stop.
                        if assigned == 0 {
                            hit_eof_first = true;
                        }
                        break;
                    }
                }
            } else if c.is_whitespace() {
                // Whitespace in the format: skip whitespace in input.
                self.stdin_skip_ws();
                i += 1;
            } else {
                // Literal char in the format: lenient match — consume a
                // matching char in input if present, then continue.
                self.stdin_skip_ws();
                if self.stdin_peek() == Some(c) {
                    self.stdin_pos += 1;
                }
                i += 1;
            }
        }

        if hit_eof_first {
            Ok(RValue::Scalar(Scalar::Int(-1)))
        } else {
            Ok(RValue::Scalar(Scalar::Int(assigned)))
        }
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
            Expr::Member { .. } => self.lvalue_of_member(expr),
            Expr::Unary(UnOp::Deref, inner) => {
                let v = self.eval_expr(inner)?;
                match v {
                    RValue::Pointer(Some(loc)) => Ok(loc),
                    RValue::Pointer(None) => Err(RuntimeError {
                        message: "cannot assign through a null pointer".into(),
                        line: 0,
                    }),
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

        let len = match self.heap.get(&id) {
            Some(HeapObjectRuntime::Array(a)) => a.cells.len(),
            _ => 0,
        };
        if (index as usize) >= len {
            return Err(RuntimeError {
                message: format!("array index {} out of bounds (len {})", index, len),
                line: 0,
            });
        }
        Ok(Location::HeapCell { id, index: index as usize })
    }

    /// Resolve a `base.field` / `base->field` expression to a HeapField
    /// location identifying (struct id, field name). For `->`, the base is a
    /// pointer we dereference; for `.`, the base is a struct value/lvalue that
    /// must resolve to a heap struct.
    fn lvalue_of_member(&mut self, expr: &Expr) -> Result<Location, RuntimeError> {
        let (base, field, arrow) = match expr {
            Expr::Member { base, field, arrow } => (base, field.clone(), *arrow),
            _ => {
                return Err(RuntimeError {
                    message: "not a member access".into(),
                    line: 0,
                })
            }
        };

        let id = if arrow {
            // p->field : p is a pointer to a struct.
            let v = self.eval_expr(base)?;
            match v {
                RValue::Pointer(Some(Location::HeapObj { id })) => id,
                RValue::Pointer(Some(Location::HeapField { id, .. })) => id,
                RValue::Pointer(None) => {
                    return Err(RuntimeError {
                        message: "dereferenced a null pointer (->)".into(),
                        line: 0,
                    })
                }
                _ => {
                    return Err(RuntimeError {
                        message: "left of -> is not a struct pointer".into(),
                        line: 0,
                    })
                }
            }
        } else {
            // s.field : s must resolve to a heap struct object.
            let loc = self.lvalue_of(base)?;
            match loc {
                Location::HeapObj { id } => id,
                Location::Local { frame, name } => {
                    // The variable holds a pointer to a heap struct (we model
                    // struct values via heap objects).
                    match self.frames[frame].slots.get(&name) {
                        Some(Slot::Pointer(Some(Location::HeapObj { id }))) => id.clone(),
                        _ => {
                            return Err(RuntimeError {
                                message: "left of . is not a struct".into(),
                                line: 0,
                            })
                        }
                    }
                }
                _ => {
                    return Err(RuntimeError {
                        message: "left of . is not a struct".into(),
                        line: 0,
                    })
                }
            }
        };

        // Validate the field exists.
        match self.heap.get(&id) {
            Some(HeapObjectRuntime::Struct(s)) if s.field(&field).is_some() => {}
            Some(HeapObjectRuntime::Struct(s)) => {
                return Err(RuntimeError {
                    message: format!("struct '{}' has no field '{}'", s.type_name, field),
                    line: 0,
                })
            }
            _ => {
                return Err(RuntimeError {
                    message: "member access on a non-struct heap object".into(),
                    line: 0,
                })
            }
        }
        Ok(Location::HeapField { id, field })
    }

    /// If `target` is (or declares) a pointer to a struct type, return the
    /// struct's type name. Used to type a `target = malloc(...)`.
    fn struct_type_of_target(&self, target: &Expr) -> Option<String> {
        match target {
            Expr::Ident(name) => {
                let frame = self.find_var_frame(name)?;
                match self.frames[frame].declared.get(name) {
                    Some(CType { base: BaseType::Struct(s), pointer_depth }) if *pointer_depth > 0 => {
                        Some(s.clone())
                    }
                    _ => None,
                }
            }
            _ => None,
        }
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
            Location::HeapCell { id, index } => match self.heap.get(id) {
                Some(HeapObjectRuntime::Array(arr)) => {
                    Ok(RValue::Scalar(arr.cells[*index].clone()))
                }
                _ => Err(RuntimeError {
                    message: "dangling heap reference".into(),
                    line: 0,
                }),
            },
            Location::HeapField { id, field } => match self.heap.get(id) {
                Some(HeapObjectRuntime::Struct(s)) => match s.field(field) {
                    Some(Slot::Scalar(sc)) => Ok(RValue::Scalar(sc.clone())),
                    Some(Slot::Pointer(p)) => Ok(RValue::Pointer(p.clone())),
                    Some(Slot::ArrayRef { id, .. }) => Ok(RValue::Pointer(Some(
                        Location::HeapCell { id: id.clone(), index: 0 },
                    ))),
                    None => Err(RuntimeError {
                        message: format!("struct field '{}' not found", field),
                        line: 0,
                    }),
                },
                _ => Err(RuntimeError {
                    message: "field read on a non-struct heap object".into(),
                    line: 0,
                }),
            },
            Location::HeapObj { id } => {
                // Reading "the struct itself" yields a pointer to it.
                Ok(RValue::Pointer(Some(Location::HeapObj { id: id.clone() })))
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
                let arr = match self.heap.get_mut(id) {
                    Some(HeapObjectRuntime::Array(arr)) => arr,
                    _ => {
                        return Err(RuntimeError {
                            message: "write to dangling heap reference".into(),
                            line: 0,
                        })
                    }
                };
                let elem_kind = arr.element_type.clone();
                let s = match value {
                    RValue::Scalar(s) => coerce_scalar(s, &elem_kind),
                    _ => default_scalar(&elem_kind),
                };
                arr.cells[*index] = s;
                Ok(())
            }
            Location::HeapField { id, field } => {
                let s = match self.heap.get_mut(id) {
                    Some(HeapObjectRuntime::Struct(s)) => s,
                    _ => {
                        return Err(RuntimeError {
                            message: "write to a non-struct heap object".into(),
                            line: 0,
                        })
                    }
                };
                let slot = s.field_mut(field).ok_or(RuntimeError {
                    message: format!("struct field '{}' not found", field),
                    line: 0,
                })?;
                let new_slot = match value {
                    RValue::Pointer(p) => Slot::Pointer(p),
                    RValue::Scalar(sc) => match slot {
                        Slot::Scalar(old) => Slot::Scalar(coerce_to_kind(sc, old)),
                        _ => Slot::Scalar(sc),
                    },
                    RValue::Void => return Ok(()),
                };
                *slot = new_slot;
                Ok(())
            }
            Location::HeapObj { .. } => {
                // Assigning to a whole struct object isn't modeled; ignore.
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
        // TraceLab: the activation number instead of the stack index, so each call keeps its own id.
        let (activation, name) = self
            .frames
            .get(fi)
            .map(|f| (f.activation, f.function_name.as_str()))
            .unwrap_or((0, "?"));
        format!("frame_{}_{}", activation, name)
    }

    /// Convert a pointer slot into a trace Value, resolving its target to a
    /// heap object or a stack variable slot (so the arrow layer can draw it).
    fn pointer_to_value(&self, p: &Option<Location>) -> TValue {
        match p {
            Some(Location::HeapCell { id, .. }) => TValue::heap_ref(id.clone()),
            Some(Location::HeapField { id, .. }) => TValue::heap_ref(id.clone()),
            Some(Location::HeapObj { id }) => TValue::heap_ref(id.clone()),
            Some(Location::Local { frame, name }) => {
                TValue::stack_ref(self.frame_id(*frame), name.clone())
            }
            None => TValue::reference(None),
        }
    }

    /// TraceLab: counts the step against the limits, then records it (unless recording is off).
    fn snapshot(&mut self, line: Option<usize>, note: Option<String>) -> Result<(), RuntimeError> {
        self.tick(line.unwrap_or(0))?;
        if !self.limits.record {
            return Ok(());
        }
        if self.states.len() >= self.limits.max_states {
            return Err(RuntimeError { message: STATE_LIMIT.into(), line: line.unwrap_or(0) });
        }
        self.push_state(line, note);
        Ok(())
    }

    fn push_state(&mut self, line: Option<usize>, note: Option<String>) {
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
                line: Some(frame.line).filter(|l| *l != 0),
            });
        }

        // TraceLab: every state used to copy the whole heap, which grows without bound when a loop calls
        // malloc. Objects reachable from the stack come first (in allocation order), then unreachable ones
        // (leaks), up to MAX_OBJECTS; arrays keep their first MAX_ELEMENTS cells.
        const MAX_OBJECTS: usize = 160;
        const MAX_ELEMENTS: usize = 64;
        let alloc_order = |id: &str| id.rsplit('_').next().and_then(|n| n.parse::<usize>().ok()).unwrap_or(usize::MAX);
        let mut reachable: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut queue = std::collections::VecDeque::new();
        let slot_target = |slot: &Slot| -> Option<String> {
            match slot {
                Slot::Pointer(Some(Location::HeapCell { id, .. } | Location::HeapField { id, .. } | Location::HeapObj { id })) => Some(id.clone()),
                Slot::ArrayRef { id, .. } => Some(id.clone()),
                _ => None,
            }
        };
        for frame in &self.frames {
            for vname in &frame.order {
                if let Some(id) = frame.slots.get(vname).and_then(slot_target) {
                    queue.push_back(id);
                }
            }
        }
        while let Some(id) = queue.pop_front() {
            if !self.heap.contains_key(&id) || !seen.insert(id.clone()) {
                continue;
            }
            if let Some(HeapObjectRuntime::Struct(s)) = self.heap.get(&id) {
                for (_, slot) in &s.fields {
                    if let Some(next) = slot_target(slot) {
                        queue.push_back(next);
                    }
                }
            }
            reachable.push(id);
        }
        reachable.sort_by_key(|id| alloc_order(id));
        let mut leaked: Vec<String> = self.heap.keys().filter(|id| !seen.contains(*id)).cloned().collect();
        leaked.sort_by_key(|id| alloc_order(id));
        let all = reachable.len() + leaked.len();
        let chosen: Vec<String> = reachable.into_iter().chain(leaked).take(MAX_OBJECTS).collect();
        let heap_truncated = all > chosen.len();

        // Build heap objects for the trace.
        let mut heap: BTreeMap<String, HeapObject> = BTreeMap::new();
        for id in &chosen {
            let obj = &self.heap[id];
            match obj {
                HeapObjectRuntime::Array(arr) => {
                    let elements = arr
                        .cells
                        .iter()
                        .take(MAX_ELEMENTS)
                        .map(|s| TValue::primitive(s.display(), s.type_name()))
                        .collect();
                    heap.insert(
                        id.clone(),
                        HeapObject::Array {
                            id: id.clone(),
                            element_type: Some(base_type_name(&arr.element_type).to_string()),
                            elements,
                            length: Some(arr.cells.len()),
                        },
                    );
                }
                HeapObjectRuntime::Struct(s) => {
                    // TraceLab: field types from the struct definition, for the debugger's labels.
                    let def = self.structs.get(&s.type_name).copied();
                    let fields = s
                        .fields
                        .iter()
                        .map(|(fname, slot)| {
                            let value = match slot {
                                Slot::Scalar(sc) => TValue::primitive(sc.display(), sc.type_name()),
                                // A pointer field pointing at another heap
                                // struct becomes a heap ref so the frontend
                                // draws the node->node arrow; null -> no arrow.
                                Slot::Pointer(p) => self.pointer_to_value(p),
                                Slot::ArrayRef { id, .. } => TValue::heap_ref(id.clone()),
                            };
                            TVariable {
                                name: fname.clone(),
                                value,
                                declared_type: def.and_then(|d| d.fields.iter().find(|(_, n)| n == fname)).map(|(t, _)| t.display()),
                            }
                        })
                        .collect();
                    heap.insert(
                        id.clone(),
                        HeapObject::Struct {
                            id: id.clone(),
                            type_name: s.type_name.clone(),
                            fields,
                        },
                    );
                }
            }
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
            returns: std::mem::take(&mut self.pending_returns),
            heap_order: chosen,
            heap_truncated,
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

fn base_type_name(base: &BaseType) -> String {
    match base {
        BaseType::Int => "int".into(),
        BaseType::Char => "char".into(),
        BaseType::Double => "double".into(),
        BaseType::Float => "float".into(),
        BaseType::Long => "long".into(),
        BaseType::Void => "void".into(),
        BaseType::Struct(name) => format!("struct {}", name),
    }
}

/// True if `e` is a direct call to `malloc(...)` (possibly the only form we
/// type-infer for struct allocation).
fn is_malloc_call(e: &Expr) -> bool {
    matches!(e, Expr::Call(name, _) if name == "malloc")
}

/// Pointer-aware equality. A pointer compares equal to NULL/0 iff it is null;
/// two pointers compare equal iff they target the same location.
fn pointers_equal(a: &RValue, b: &RValue) -> bool {
    fn is_nullish(v: &RValue) -> bool {
        match v {
            RValue::Pointer(None) => true,
            RValue::Scalar(s) => s.as_i64() == 0,
            RValue::Void => true,
            _ => false,
        }
    }
    match (a, b) {
        (RValue::Pointer(pa), RValue::Pointer(pb)) => match (pa, pb) {
            (None, None) => true,
            (Some(la), Some(lb)) => locations_equal(la, lb),
            _ => false,
        },
        // One side is a pointer, the other a scalar (typically 0 / NULL).
        (RValue::Pointer(p), other) | (other, RValue::Pointer(p)) => {
            p.is_none() && is_nullish(other)
        }
        _ => false,
    }
}

fn locations_equal(a: &Location, b: &Location) -> bool {
    match (a, b) {
        (Location::HeapObj { id: x }, Location::HeapObj { id: y }) => x == y,
        (Location::HeapField { id: x, field: fx }, Location::HeapField { id: y, field: fy }) => {
            x == y && fx == fy
        }
        (Location::HeapCell { id: x, index: ix }, Location::HeapCell { id: y, index: iy }) => {
            x == y && ix == iy
        }
        (Location::Local { frame: fa, name: na }, Location::Local { frame: fb, name: nb }) => {
            fa == fb && na == nb
        }
        _ => false,
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
