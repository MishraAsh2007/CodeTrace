// Trace data model for the CodeTutor visualizer.
//
// This is the contract between the (future) Rust backend and the frontend.
// The backend interprets the user's Java/Python/C program step by step and
// emits an ExecutionTrace: an ordered list of ProgramState snapshots, one per
// executed step. The frontend is a pure renderer of this model and does not
// care how the trace was produced.
//
// The central idea is distinguishing VALUE semantics from REFERENCE semantics:
//   - A `primitive` value lives inline in a variable box (x -> [ 3 ]).
//   - A `ref` value is a pointer into the heap; the box holds an arrow that
//     points at a heap object (values -> [ ][ ][ ] ... -> objects).

/** A pointer to an object living in the heap. Null ref models null/None. */
export interface RefValue {
  kind: "ref";
  /** Heap object id this reference points at, or null for null/None. */
  target: HeapId | null;
}

/** An inline, copied-by-value scalar (int, double, char, bool, etc.). */
export interface PrimitiveValue {
  kind: "primitive";
  /** Display text for the value, e.g. "3", "true", "'a'", "3.14". */
  display: string;
  /** Optional finer type hint for styling, e.g. "int", "char", "bool". */
  typeName?: string;
}

/** A value stored in a variable slot or an object field / array cell. */
export type Value = PrimitiveValue | RefValue;

/** Stable identifier for a heap-allocated object. */
export type HeapId = string;

/** A named binding inside a stack frame (a local variable or parameter). */
export interface Variable {
  name: string;
  value: Value;
  /** Static/declared type if known, e.g. "int[]", "Node", "String". */
  declaredType?: string;
}

/** One function/method activation on the call stack. */
export interface StackFrame {
  /** Stable id so the renderer can key frames across steps. */
  id: string;
  /** Function or method name, e.g. "main", "fib". */
  functionName: string;
  /** Locals + parameters visible in this frame. */
  variables: Variable[];
  /** True for the currently executing (top) frame. */
  isActive?: boolean;
}

/** An array object in the heap (contiguous indexed cells). */
export interface ArrayObject {
  kind: "array";
  id: HeapId;
  /** Element type if known, e.g. "int", "Node". */
  elementType?: string;
  /** Cells in index order; each is a value (primitive or ref). */
  elements: Value[];
}

/** A record/struct/class instance in the heap (named fields). */
export interface StructObject {
  kind: "struct";
  id: HeapId;
  /** Class/struct name shown as the object label, e.g. "Node", "o1". */
  typeName: string;
  fields: Variable[];
}

/** Anything that can live in the heap. */
export type HeapObject = ArrayObject | StructObject;

/** A single snapshot of the program at one execution step. */
export interface ProgramState {
  /** 0-based index of this step within the trace. */
  step: number;
  /** 1-based source line about to execute / just executed, if known. */
  line?: number;
  /** Call stack, outermost frame first, active frame last. */
  stack: StackFrame[];
  /** Heap objects keyed by id. */
  heap: Record<HeapId, HeapObject>;
  /** Optional human note for this step, e.g. "i = 1, swapped a and b". */
  note?: string;
  /** Standard output produced so far, if the backend tracks it. */
  stdout?: string;
}

/** The full execution trace: an ordered list of states to scrub through. */
export interface ExecutionTrace {
  states: ProgramState[];
}

// ---- Type guards (handy for the renderer) --------------------------------

export function isRef(v: Value): v is RefValue {
  return v.kind === "ref";
}

export function isPrimitive(v: Value): v is PrimitiveValue {
  return v.kind === "primitive";
}

export function isArray(o: HeapObject): o is ArrayObject {
  return o.kind === "array";
}

export function isStruct(o: HeapObject): o is StructObject {
  return o.kind === "struct";
}
