export type SourceFile = { name: string; content: string };
/**
 * A test. `output` tests (the default) compare standard output for the given input.
 * `call` tests evaluate a Java expression such as `sum(new int[]{1, 2})` on `target` and compare its value,
 * or `throws ExceptionName`, with `expectedOutput`.
 */
export type Check = { name: string; stdin: string; expectedOutput: string; kind?: 'output' | 'call'; target?: string; call?: string; origin?: CheckOrigin };
/**
 * Where a test came from, which changes how a failure is explained: `template` tests came with a new-project
 * template and may not describe the student's program; `generated` tests recorded what the code returned when
 * they were made; `ai` tests are expectations suggested by the assistant. Tests without an origin were written
 * or confirmed by the student.
 */
export type CheckOrigin = 'template' | 'generated' | 'ai';
export type Project = { version: 1; name: string; example: string; files: SourceFile[]; mainClass: string; stdin: string; maxSteps: number; checks: Check[]; startAt?: StartAt };
export type TraceValue = { kind: 'null' | 'primitive' | 'reference'; type?: string; value?: string; ref?: string; omitted?: boolean };
export type Variable = { name: string; type: string; value: TraceValue; argument?: boolean };
export type Frame = { id: string; method: string; file: string; line: number; locals: Variable[]; truncated?: boolean };
export type MapEntry = { key: TraceValue; value: TraceValue };
export type HeapObject = {
  id: string; type: string;
  /** `value` is an immutable library value shown as text, such as a LocalDate or an AtomicInteger. */
  kind: 'array' | 'list' | 'set' | 'map' | 'object' | 'string' | 'value' | 'opaque' | 'unavailable';
  length?: number; elements?: TraceValue[]; entries?: MapEntry[]; fields?: Variable[]; text?: string; truncated?: boolean; message?: string;
  /** Wire form of primitive arrays, replaced by `elements` when events arrive (see expandEvents). */
  elementType?: string; values?: string[];
};
/** Where a traced run starts recording: before `line` runs with `condition` true for the `hit`-th time. */
export type StartAt = { file: string; line: number; condition?: string; hit?: number };
/** A user method that completed normally since the previous source stop. */
export type Return = { method: string; frameId: string | null; value?: TraceValue; void?: boolean };
export type TraceEvent = {
  schemaVersion: 1; sequence: number; runId: string;
  kind: 'line' | 'exception' | 'output' | 'diagnostic' | 'terminated' | 'status';
  location?: { file: string; line: number; phase: 'before' };
  frames?: Frame[]; statics?: Variable[]; heap?: HeapObject[]; returns?: Return[];
  framesTruncated?: boolean; heapTruncated?: boolean;
  exception?: { type: string; message: string; caught: boolean };
  stream?: 'stdout' | 'stderr'; text?: string;
  severity?: string; file?: string; line?: number; column?: number; message?: string;
  stopReason?: string; outputTruncated?: boolean;
  /** On `terminated` when the request had a start point: whether recording started, and why not. */
  start?: { reached: boolean; file: string; line: number; message?: string };
};
/** `trace` records with the debugger (default); `run` runs without recording; `compile` only compiles. */
export type RunMode = 'trace' | 'run' | 'compile';
export type RunRequest = { files: SourceFile[]; mainClass: string; stdin: string; maxSteps: number; timeoutMs: number; mode?: RunMode; startAt?: StartAt };
export type Run = { id: string; status: 'running' | 'finished'; request: RunRequest; events: TraceEvent[] };
export type QuestionKind = 'predict' | 'explain' | 'repair';
export type Question = {
  id: string; kind: QuestionKind; concept: string; title: string; context: string; prompt: string;
  options: string[]; correct: number; explanation: string; hints: string[]; step: number;
  /** Source line the question is about, in the recorded source of the run. */
  focus?: { file: string; line: number };
  /** Recorded source text quoted by the question. */
  code?: string;
};
