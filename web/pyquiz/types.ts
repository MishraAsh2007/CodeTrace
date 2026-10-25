// Shapes of the JSON the Rust server returns (pg_logger's trace format underneath).

/** A value as pg_logger encodes it: a primitive, or a tagged list like ["REF", 5]. */
export type Encoded = null | boolean | number | string | unknown[];

/** A heap object: ["INSTANCE", "Node", ["val", 1], ...], ["LIST", ...], ["FUNCTION", name, parent], ... */
export type HeapObject = [string, ...unknown[]];

export interface StackFrame {
  func_name: string;
  frame_id: number | string;
  is_highlighted: boolean;
  is_zombie?: boolean;
  ordered_varnames: string[];
  encoded_locals: Record<string, Encoded>;
}

export interface TraceStep {
  event: string;
  line: number;
  func_name: string;
  globals: Record<string, Encoded>;
  ordered_globals: string[];
  heap: Record<string, HeapObject>;
  stack_to_render: StackFrame[];
  stdout: string;
  exception_msg?: string;
}

export type RunStatus = "ok" | "error" | "step_limit" | "needs_input" | "timeout" | "crashed";

export interface RunResult {
  status: RunStatus;
  message: string | null;
  error_line: number | null;
  error_step: number | null;
  trace: TraceStep[];
  step_count: number;
  stdout: string;
  duration_ms: number;
}

export interface Health {
  status: string;
  tracer_ready: boolean;
  python: string;
}
