// Trace and project shapes used by Database.ts (the Java/JVM question generator).
// Reconstructed from how Database.ts reads them; the app's Python tracer uses ../../types.ts instead.

export interface SourceFile {
  name: string;
  content: string;
}

export interface Check {
  name: string;
  /** 'output' (default) compares program stdout; 'call' tests a method and is evaluated elsewhere. */
  kind?: "output" | "call";
  stdin: string;
  expectedOutput: string;
  call?: string;
  target?: string;
}

export interface Project {
  version: 1;
  name: string;
  example: string;
  mainClass: string;
  stdin: string;
  maxSteps: number;
  files: SourceFile[];
  checks: Check[];
}

export interface TraceValue {
  kind: "primitive" | "reference" | "null";
  /** Primitive values are recorded as text, e.g. "42", "3.0", "true". */
  value?: string;
  /** Heap object id for references. */
  ref?: string;
}

export interface Variable {
  name: string;
  type: string;
  value: TraceValue;
  /** True for method parameters. */
  argument?: boolean;
}

export interface Frame {
  id: string;
  /** Qualified method name, e.g. "Main.sum". */
  method: string;
  file: string;
  locals: Variable[];
}

export interface Field {
  /** Qualified field name, e.g. "Cart.items". */
  name: string;
  value: TraceValue;
}

export interface HeapObject {
  id: string;
  kind: "object" | "array" | "list" | "map" | "set" | "string" | "other";
  type: string;
  fields?: Field[];
  elements?: TraceValue[];
  length?: number;
  /** String contents (kind 'string'). */
  text?: string;
  truncated?: boolean;
}

export interface Location {
  file: string;
  line: number;
}

export interface ExceptionInfo {
  type: string;
  message: string;
  caught: boolean;
}

export interface ReturnInfo {
  method: string;
  frameId?: string;
  void?: boolean;
  value?: TraceValue;
}

export type StopReason = "completed" | "exception" | "step-limit" | "timeout" | "compile-error";

export interface TraceEvent {
  kind: "line" | "exception" | "terminated" | "output" | "diagnostic";
  sequence: number;
  /** output events */
  stream?: "stdout" | "stderr";
  text?: string;
  /** terminated events */
  stopReason?: StopReason;
  /** line / exception events */
  location?: Location;
  /** Innermost frame first. */
  frames?: Frame[];
  heap?: HeapObject[];
  exception?: ExceptionInfo;
  returns?: ReturnInfo[];
  /** diagnostic events (javac) */
  severity?: "error" | "warning";
  file?: string;
  line?: number;
  message?: string;
}

export interface RunRequest {
  files: SourceFile[];
  mainClass: string;
  stdin: string;
}

export interface Run {
  status: "running" | "finished" | "failed";
  request: RunRequest;
  events: TraceEvent[];
}

export type QuestionKind = "explain" | "predict" | "repair";

export interface Question {
  id: string;
  kind: QuestionKind;
  concept: string;
  title: string;
  context: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  hints: string[];
  /** Snapshot index the question refers to; -1 for compile errors (no snapshot). */
  step: number;
  focus?: Location;
  code?: string;
}
