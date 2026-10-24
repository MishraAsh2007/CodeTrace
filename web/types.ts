export type SourceFile = { name: string; content: string };
/**
 * A test. `output` tests (the default) compare standard output for the given input.
 * `call` tests evaluate a Java expression such as `sum(new int[]{1, 2})` on `target` and compare its value,
 * or `throws ExceptionName`, with `expectedOutput`.
 */
export type Check = { name: string; stdin: string; expectedOutput: string; kind?: 'output' | 'call'; target?: string; call?: string };
export type Project = { version: 1; name: string; example: string; files: SourceFile[]; mainClass: string; stdin: string; maxSteps: number; checks: Check[] };
export type TraceValue = { kind: 'null' | 'primitive' | 'reference'; type?: string; value?: string; ref?: string; omitted?: boolean };
export type Variable = { name: string; type: string; value: TraceValue; argument?: boolean };
export type Frame = { id: string; method: string; file: string; line: number; locals: Variable[]; truncated?: boolean };
export type MapEntry = { key: TraceValue; value: TraceValue };
export type HeapObject = {
  id: string; type: string;
  kind: 'array' | 'list' | 'set' | 'map' | 'object' | 'string' | 'opaque' | 'unavailable';
  length?: number; elements?: TraceValue[]; entries?: MapEntry[]; fields?: Variable[]; text?: string; truncated?: boolean; message?: string;
};
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
};
export type RunRequest = { files: SourceFile[]; mainClass: string; stdin: string; maxSteps: number; timeoutMs: number };
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
