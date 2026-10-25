// core.ts: shared types and trace/code helpers for the question bank rules.

import type { Encoded, RunResult, StackFrame, TraceStep } from "./types.ts";
import { instanceAttrs, isInstance, isRef, liveFrames, primitiveText } from "./model.ts";

export type QuestionKind = "explain" | "predict" | "repair";

/** Rough category, used for ranking: bugs first, then pitfalls the trace proves, then the rest. */
export type Group = "bug" | "pitfall" | "algorithm" | "efficiency" | "basics" | "predict";

export type Topic =
  | "linked-list"
  | "tree"
  | "graphs"
  | "sorting"
  | "searching"
  | "stacks-queues"
  | "recursion"
  | "dp"
  | "loops"
  | "lists"
  | "dicts"
  | "strings"
  | "functions"
  | "classes"
  | "input";

export const TOPIC_LABELS: Record<Topic, string> = {
  "linked-list": "Linked lists",
  tree: "Trees",
  graphs: "Graphs",
  sorting: "Sorting",
  searching: "Searching",
  "stacks-queues": "Stacks & queues",
  recursion: "Recursion",
  dp: "Memoization",
  loops: "Loops",
  lists: "Lists",
  dicts: "Dictionaries",
  strings: "Strings",
  functions: "Functions",
  classes: "Classes",
  input: "Input",
};

/** How to apply a repair option to the source (used by the self-check script). */
export type RepairEdit =
  | { mode: "replace"; line: number } // replace this line, keeping its indentation
  | { mode: "replace-raw"; line: number } // replace this line exactly as written (fixes indentation)
  | { mode: "insert-start"; line: number } // insert as the first statement of the block opened at `line`
  | { mode: "insert-end"; line: number }; // insert as the last statement of the block opened at `line`

export interface Question {
  id: string;
  kind: QuestionKind;
  group: Group;
  concept: string;
  /** Short label for the quiz card, e.g. "Graphs". */
  topicLabel: string;
  title: string;
  context: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  hints: string[];
  /** Trace step the question is about (-1 when there's no trace, e.g. a syntax error). */
  step: number;
  /** Source line to highlight in the editor. */
  focusLine?: number;
  /** For repair questions: where each option goes in the code. */
  edit?: RepairEdit;
  /** Ranking score (higher = asked first). */
  score: number;
}

export type Draft = Omit<Question, "options" | "correct" | "topicLabel" | "score" | "group"> & { group: Group; score?: number };

/** Which topics each concept belongs to, for ranking and labels. */
export const CONCEPT_TOPICS: Record<string, Topic[]> = {
  "none-pointer": ["linked-list", "tree"],
  pointers: ["linked-list", "tree"],
  "list-length": ["linked-list"],
  "bst-min": ["tree"],
  aliasing: ["lists", "linked-list", "tree"],
  "recursion-return": ["tree", "recursion"],
  branching: ["tree", "searching"],
  recursion: ["recursion"],
  "recursion-depth": ["recursion"],
  "repeated-work": ["dp", "recursion"],
  memoization: ["dp", "recursion"],
  "return-values": ["functions", "recursion"],
  "graph-order": ["graphs"],
  "graph-kind": ["graphs"],
  "graph-visited": ["graphs"],
  "graph-cost": ["graphs"],
  "stack-queue": ["stacks-queues"],
  "sort-pass": ["sorting"],
  "sort-comparisons": ["sorting"],
  "sort-swaps": ["sorting"],
  "binary-search": ["searching"],
  "binary-search-steps": ["searching"],
  "dict-counting": ["dicts"],
  "loop-count": ["loops", "lists"],
  "loop-termination": ["loops"],
  "state-change": ["loops"],
  "list-bounds": ["lists", "loops"],
  "dict-missing-key": ["dicts"],
  "parsing-input": ["input"],
  "list-methods": ["lists"],
  "string-methods": ["strings"],
  "string-immutable": ["strings"],
  "mutable-default": ["functions", "lists"],
  "returns-none": ["functions"],
  "arguments": ["functions", "classes"],
  scope: ["functions"],
  slicing: ["lists", "strings"],
  division: [],
  "nested-loops": ["loops", "sorting"],
  "list-membership": ["lists", "loops"],
  "list-pop-front": ["stacks-queues", "lists"],
  "string-building": ["strings", "loops"],
  "sort-in-loop": ["sorting", "loops"],
};

export const CONCEPT_LABELS: Record<string, string> = {
  "none-pointer": "None pointers",
  pointers: "Pointers",
  aliasing: "References",
  "recursion-return": "Return values",
  branching: "Conditions",
  recursion: "Recursion",
  "recursion-depth": "Recursion",
  "repeated-work": "Efficiency",
  memoization: "Memoization",
  "return-values": "Return values",
  "loop-count": "Loops",
  "loop-termination": "Loops",
  "state-change": "Variables",
  "list-bounds": "List indexing",
  "dict-missing-key": "Dictionaries",
  "division-by-zero": "Arithmetic",
  types: "Types",
  "parsing-input": "Input",
  names: "Names",
  "error-types": "Errors",
  syntax: "Syntax",
  indentation: "Indentation",
  assertions: "Assertions",
  "nested-loops": "Efficiency",
  "list-membership": "Efficiency",
  "list-pop-front": "Efficiency",
  "string-building": "Efficiency",
  "sort-in-loop": "Efficiency",
  "graph-cost": "Efficiency",
  "sort-comparisons": "Efficiency",
  "binary-search-steps": "Efficiency",
  division: "Arithmetic",
  slicing: "Slicing",
  scope: "Scope",
  arguments: "Arguments",
  "mutable-default": "Default arguments",
  "returns-none": "Return values",
  "stack-queue": "Stacks & queues",
  "graph-order": "Graphs",
  "graph-kind": "Graphs",
  "graph-visited": "Graphs",
  "sort-pass": "Sorting",
  "binary-search": "Binary search",
  "dict-counting": "Dictionaries",
  "string-immutable": "Strings",
  "string-methods": "Strings",
  "list-methods": "Lists",
  loops: "Loops",
};

// ---------------------------------------------------------------------------
// Question construction
// ---------------------------------------------------------------------------

export const code = (text: string) => "`" + text + "`";

const BASE_SCORE: Record<Group, number> = { bug: 100, pitfall: 85, algorithm: 75, efficiency: 65, basics: 60, predict: 40 };

/** Builds a question; deterministically rotates options so the correct answer isn't always first. */
export function make(base: Draft, options: string[], answer: number): Question {
  let hash = 0;
  for (const c of base.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const shift = hash % options.length;
  return {
    ...base,
    score: base.score ?? BASE_SCORE[base.group],
    topicLabel: CONCEPT_LABELS[base.concept] ?? "Quick check",
    options: options.map((_, i) => options[(i + shift) % options.length]),
    correct: (answer - shift + options.length) % options.length,
  };
}

/** Keeps the correct option first, drops duplicates, and requires three choices. */
export function choices(correct: string, ...others: (string | undefined | null | false)[]): string[] | null {
  const out = [correct];
  for (const o of others) if (o && !out.includes(o)) out.push(o);
  return out.length >= 3 ? out.slice(0, 3) : null;
}

// ---------------------------------------------------------------------------
// Context and source helpers
// ---------------------------------------------------------------------------

export interface Ctx {
  result: RunResult;
  trace: TraceStep[];
  lines: string[];
  topics: Set<Topic>;
}

export const IDENT = "[A-Za-z_]\\w*";
export const CHAIN = `${IDENT}(?:\\.${IDENT})*`;
export const NUMBER = "-?\\d+(?:\\.\\d+)?";

export const PY_WORDS = new Set([
  "and", "or", "not", "is", "in", "None", "True", "False", "if", "elif", "else", "while", "for", "def", "return",
  "class", "self", "len", "range", "print", "int", "str", "float", "list", "dict", "set", "tuple", "input", "import",
  "from", "as", "pass", "break", "continue", "lambda", "global", "nonlocal", "try", "except", "finally", "raise",
  "with", "yield", "assert", "del", "abs", "min", "max", "sum", "sorted", "enumerate", "zip", "map", "filter",
]);

export const textAt = (ctx: Ctx, line: number) => (ctx.lines[line - 1] ?? "").trim();

export function indentOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

/** Last line (1-based) of the block opened by the header at `line`. */
export function blockEnd(ctx: Ctx, line: number): number {
  const own = indentOf(ctx.lines[line - 1] ?? "");
  let end = line;
  for (let n = line + 1; n <= ctx.lines.length; n++) {
    const raw = ctx.lines[n - 1];
    if (!raw.trim()) continue;
    if (indentOf(raw) <= own) break;
    end = n;
  }
  return end;
}

/** First non-empty, non-comment line after `line` (0 if none). */
export function nextCodeLine(ctx: Ctx, line: number): number {
  for (let n = line + 1; n <= ctx.lines.length; n++) {
    const t = ctx.lines[n - 1].trim();
    if (t && !t.startsWith("#")) return n;
  }
  return 0;
}

/** The headers (line numbers) of the blocks enclosing `line`, innermost first, stopping at a `def`. */
export function enclosingHeaders(ctx: Ctx, line: number): number[] {
  const out: number[] = [];
  let indent = indentOf(ctx.lines[line - 1] ?? "");
  for (let n = line - 1; n >= 1; n--) {
    const raw = ctx.lines[n - 1] ?? "";
    if (!raw.trim() || indentOf(raw) >= indent) continue;
    indent = indentOf(raw);
    out.push(n);
    if (/^\s*def\s/.test(raw)) break;
  }
  return out;
}

export const isLoopHeader = (ctx: Ctx, line: number) => /^(for|while)\b.*:$/.test(textAt(ctx, line));

/** The nearest enclosing `while` header for `line`, if the block directly containing it is a while loop. */
export function enclosingWhile(ctx: Ctx, line: number): { line: number; condition: string } | null {
  const header = enclosingHeaders(ctx, line)[0];
  if (!header) return null;
  const m = textAt(ctx, header).match(/^while\s+(.+):$/);
  return m ? { line: header, condition: m[1].trim() } : null;
}

/** Innermost enclosing loop header of `line` (0 if not in a loop). */
export const enclosingLoop = (ctx: Ctx, line: number) => enclosingHeaders(ctx, line).find((h) => isLoopHeader(ctx, h)) ?? 0;

export function defLine(ctx: Ctx, fn: string): number {
  return ctx.lines.findIndex((l) => new RegExp(`^\\s*def\\s+${fn}\\s*\\(`).test(l)) + 1;
}

/** True if function `fn` has a `return <value>` statement. */
export function returnsValue(ctx: Ctx, fn: string): boolean {
  const start = defLine(ctx, fn) - 1;
  if (start < 0) return false;
  const own = indentOf(ctx.lines[start]);
  for (let n = start + 1; n < ctx.lines.length; n++) {
    const raw = ctx.lines[n];
    if (raw.trim() && indentOf(raw) <= own) break;
    if (/^\s*return\s+\S/.test(raw)) return true;
  }
  return false;
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

export const currentFrame = (step: TraceStep): StackFrame | undefined => liveFrames(step).find((f) => f.is_highlighted);
export const frameId = (step: TraceStep) => currentFrame(step)?.frame_id ?? "global";
export const frameName = (step: TraceStep) => currentFrame(step)?.func_name ?? "<module>";

/** A variable's value in the current frame (then globals). `undefined` means "not recorded". */
export function lookup(step: TraceStep, name: string): Encoded | undefined {
  const f = currentFrame(step);
  if (f && f.encoded_locals && name in f.encoded_locals) return f.encoded_locals[name];
  if (step.globals && name in step.globals) return step.globals[name];
  return undefined;
}

/** Every variable visible in any frame at this step: [name, value]. */
export function allVars(step: TraceStep): [string, Encoded][] {
  const out: [string, Encoded][] = Object.entries(step.globals ?? {});
  for (const f of liveFrames(step)) out.push(...Object.entries(f.encoded_locals ?? {}));
  return out.filter(([n]) => !n.startsWith("__"));
}

/** Evaluates `a.b.c` against the recorded heap. `undefined` if any part isn't recorded. */
export function evalChain(step: TraceStep, chain: string): Encoded | undefined {
  const [first, ...attrs] = chain.split(".");
  let v = lookup(step, first);
  for (const attr of attrs) {
    if (v === undefined || !isRef(v)) return undefined;
    const obj = step.heap?.[String(v[1])];
    if (!obj || !isInstance(obj)) return undefined;
    const pair = instanceAttrs(obj).find(([k]) => k === attr);
    if (!pair) return undefined;
    v = pair[1];
  }
  return v;
}

/** A number from a literal or a recorded variable/attribute chain. */
export function operand(step: TraceStep, expr: string): number | undefined {
  if (new RegExp(`^${NUMBER}$`).test(expr)) return Number(expr);
  const v = evalChain(step, expr);
  return typeof v === "number" ? v : undefined;
}

export const asNumber = (v: Encoded | undefined): number | undefined => (typeof v === "number" ? v : undefined);

export function heapOf(step: TraceStep, v: Encoded | undefined) {
  return isRef(v) ? step.heap?.[String(v[1])] : undefined;
}

/** Parses the primitive items out of a repr like "deque(['a', 2])". */
export function parseReprItems(text: string): Encoded[] | null {
  const inner = text.match(/\[(.*)\]/s)?.[1];
  if (inner === undefined) return null;
  const tokens = inner.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|True|False|None/g) ?? [];
  return tokens.map((t) =>
    t === "True" ? true : t === "False" ? false : t === "None" ? null : /^['"]/.test(t) ? t.slice(1, -1) : Number(t),
  );
}

/** Items of a list / tuple / set / deque value (primitives or refs), or null if it isn't one. */
export function itemsOf(step: TraceStep, v: Encoded | undefined): Encoded[] | null {
  if (typeof v === "string") return null;
  const obj = heapOf(step, v);
  if (!obj) return null;
  if (obj[0] === "LIST" || obj[0] === "TUPLE" || obj[0] === "SET") return obj.slice(1) as Encoded[];
  if (obj[0] === "INSTANCE_PPRINT" && obj[1] === "deque") return parseReprItems(String(obj[2]));
  return null;
}

export const isPrimitive = (v: Encoded) => v === null || typeof v !== "object" || (Array.isArray(v) && v[0] === "SPECIAL_FLOAT");

export function lengthOf(step: TraceStep, v: Encoded | undefined): number | undefined {
  if (typeof v === "string") return v.length;
  const items = itemsOf(step, v);
  if (items) return items.length;
  const obj = heapOf(step, v);
  if (obj?.[0] === "DICT") return obj.length - 1;
  return undefined;
}

/** Python-style text for a value: 3, 'a', [1, 2], {'a': 1}, (1, 2), None. Refs to objects become descriptions. */
export function pyText(step: TraceStep, v: Encoded | undefined, depth = 0): string {
  if (v === undefined) return "not set yet";
  if (!isRef(v)) return primitiveText(v as Encoded);
  const obj = heapOf(step, v);
  if (!obj || depth > 2) return "…";
  const join = (xs: Encoded[]) => xs.slice(0, 12).map((x) => pyText(step, x, depth + 1)).join(", ") + (xs.length > 12 ? ", …" : "");
  switch (obj[0]) {
    case "LIST":
      return `[${join(obj.slice(1) as Encoded[])}]`;
    case "TUPLE":
      return obj.length === 2 ? `(${pyText(step, obj[1] as Encoded, depth + 1)},)` : `(${join(obj.slice(1) as Encoded[])})`;
    case "SET":
      return obj.length === 1 ? "set()" : `{${join(obj.slice(1) as Encoded[])}}`;
    case "DICT":
      return `{${(obj.slice(1) as [Encoded, Encoded][]).slice(0, 10).map(([k, x]) => `${pyText(step, k, depth + 1)}: ${pyText(step, x, depth + 1)}`).join(", ")}}`;
    case "INSTANCE_PPRINT":
      return String(obj[2]);
    default:
      return describe(step, v);
  }
}

/** Plain-language description of a value: "None", "the Node holding 3", "a list of 4 items". */
export function describe(step: TraceStep, v: Encoded | undefined): string {
  if (v === undefined) return "not set yet";
  if (v === null) return "None";
  if (isRef(v)) {
    const obj = step.heap?.[String(v[1])];
    if (obj && isInstance(obj)) {
      const attrs = instanceAttrs(obj);
      const data =
        attrs.find(([k, x]) => /^(val|value|data|key|item|name)$/.test(k) && !isRef(x) && x !== null) ??
        attrs.find(([, x]) => !isRef(x) && x !== null);
      return data ? `the ${String(obj[1])} holding ${primitiveText(data[1])}` : `a ${String(obj[1])} object`;
    }
    if (obj && (obj[0] === "LIST" || obj[0] === "TUPLE")) {
      const n = obj.length - 1;
      return `a ${obj[0].toLowerCase()} of ${n} item${n === 1 ? "" : "s"}`;
    }
    return "an object";
  }
  return primitiveText(v);
}

/** Value of a simple index expression: `3`, `i`, `i + 1`, `len(xs)`. */
export function evalIndex(step: TraceStep, expr: string): number | undefined {
  const e = expr.trim();
  if (/^-?\d+$/.test(e)) return Number(e);
  if (new RegExp(`^${IDENT}$`).test(e)) return asNumber(lookup(step, e));
  const len = e.match(new RegExp(`^len\\((${IDENT})\\)$`));
  if (len) return lengthOf(step, lookup(step, len[1]));
  const arith = e.match(new RegExp(`^(${IDENT})\\s*([+-])\\s*(\\d+)$`));
  if (arith) {
    const base = asNumber(lookup(step, arith[1]));
    return base === undefined ? undefined : arith[2] === "+" ? base + Number(arith[3]) : base - Number(arith[3]);
  }
  return undefined;
}

/** Indices of `step_line` events at `line` (optionally only in one frame). */
export function hitsOf(ctx: Ctx, line: number, frame?: string | number): number[] {
  const out: number[] = [];
  ctx.trace.forEach((s, i) => {
    if (s.event === "step_line" && s.line === line && (frame === undefined || frameId(s) === frame)) out.push(i);
  });
  return out;
}

/** Index of the next step in the same frame as step `i`, on a different line (-1 if none). */
export function nextInFrame(ctx: Ctx, i: number): number {
  const fid = frameId(ctx.trace[i]);
  const line = ctx.trace[i].line;
  for (let j = i + 1; j < ctx.trace.length; j++) {
    const s = ctx.trace[j];
    if (frameId(s) === fid && s.event === "step_line" && s.line !== line) return j;
    if (frameId(s) === fid && s.event === "return") return j;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Looking at the code
// ---------------------------------------------------------------------------

/** What the program is about, from its source alone. */
export function detectTopics(source: string): Set<Topic> {
  const t = new Set<Topic>();
  const lines = source.split(/\r?\n/);
  const has = (re: RegExp) => re.test(source);
  if (has(/\.next\b/)) t.add("linked-list");
  if (has(/\.(left|right)\b/)) t.add("tree");
  if (has(/\b(graph|adj\w*|neighbou?rs?|edges|visited|seen|bfs|dfs)\b/i) || has(/\{\s*['"]?\w+['"]?\s*:\s*\[/)) t.add("graphs");
  if (has(/\b(sort\w*|swap\w*|bubble|insertion|selection|merge|quick)\b/i) || has(/(\w+)\[[^\]]+\],\s*\1\[[^\]]+\]\s*=/)) t.add("sorting");
  if (has(/\b(lo|hi|low|high|left|right)\b/) && has(/\/\/\s*2\b/)) t.add("searching");
  if (has(/\b(stack|queue|deque|popleft|heapq|heappush|heappop)\b/i) || has(/\.pop\(0\)/) || (has(/\.pop\(/) && has(/\.append\(/))) t.add("stacks-queues");
  if (has(/\b(memo|cache|dp|lru_cache)\b/i)) t.add("dp");
  if (has(/^\s*(for|while)\b/m)) t.add("loops");
  if (has(/\[[^\]]*,[^\]]*\]|\.append\(|\blen\(|\[\s*\]/)) t.add("lists");
  if (has(/=\s*\{|\.get\(|\.items\(\)|\bdict\(/)) t.add("dicts");
  if (has(/\.(split|join|upper|lower|strip|replace|find)\(|\[::-1\]|\bstr\(/)) t.add("strings");
  if (has(/^\s*class\s/m)) t.add("classes");
  if (has(/\binput\(/)) t.add("input");
  for (let i = 0; i < lines.length; i++) {
    const def = lines[i].match(new RegExp(`^(\\s*)def\\s+(${IDENT})\\s*\\(`));
    if (!def) continue;
    t.add("functions");
    const own = def[1].length;
    const calls = new RegExp(`\\b${def[2]}\\s*\\(`);
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() && indentOf(lines[j]) <= own) break;
      if (calls.test(lines[j])) {
        t.add("recursion");
        break;
      }
    }
  }
  return t;
}

/** Applies one option of a repair question to the source. */
export function applyRepair(source: string, edit: RepairEdit, option: string): string {
  const text = option.replace(/^`|`$/g, "");
  const lines = source.split("\n");
  const at = edit.line - 1;
  const own = indentOf(lines[at] ?? "");
  const pad = (n: number) => " ".repeat(n);
  if (edit.mode === "replace") {
    lines[at] = pad(own) + text;
    return lines.join("\n");
  }
  if (edit.mode === "replace-raw") {
    lines[at] = option.replace(/^`|`$/g, "");
    return lines.join("\n");
  }
  let end = at;
  let bodyIndent = own + 4;
  for (let n = at + 1; n < lines.length; n++) {
    if (!lines[n].trim()) continue;
    if (indentOf(lines[n]) <= own) break;
    if (end === at) bodyIndent = indentOf(lines[n]);
    end = n;
  }
  lines.splice(edit.mode === "insert-start" ? at + 1 : end + 1, 0, pad(bodyIndent) + text);
  return lines.join("\n");
}
