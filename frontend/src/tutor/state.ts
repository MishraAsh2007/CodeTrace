// state.ts: turns one pg_logger step into compact text for the AI tutor.
//
// Raw pg_logger JSON is full of ["REF", 5] pointers into a heap table, which models misread.
// This renders it as `head = Node#1(val=1, next=Node#2(val=2, next=None))`, so a `next`
// that is None is hard to miss. Each object is expanded once; later mentions print `->Node#2`.

import type { Encoded, HeapObject, TraceStep } from "../types";
import { instanceAttrs, isInstance, isRef, liveFrames } from "../viz/model";

const MAX_STATE_CHARS = 9000;
const MAX_ITEMS = 25;
const MAX_NESTING = 8;
const MAX_LISTING_LINES = 200;

function pyStr(s: string): string {
  const body = s.length > 80 ? s.slice(0, 77) + "..." : s;
  return "'" + body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
}

function label(obj: HeapObject): string {
  if (isInstance(obj)) return String(obj[1]);
  return ({ LIST: "list", TUPLE: "tuple", SET: "set", DICT: "dict" } as Record<string, string>)[obj[0]] ?? String(obj[0]).toLowerCase();
}

class Renderer {
  private expanded = new Set<string>();
  constructor(private heap: Record<string, HeapObject>) {}

  value(v: Encoded, depth = 0): string {
    if (v === null) return "None";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return pyStr(v);
    if (Array.isArray(v) && v.length) {
      if (v[0] === "REF") return this.ref(String(v[1]), depth);
      if (v[0] === "SPECIAL_FLOAT") return String(v[1]);
      if (v[0] === "IMPORTED_FAUX_PRIMITIVE") return `<${String(v[1])}>`;
    }
    return JSON.stringify(v).slice(0, 80);
  }

  private ref(id: string, depth: number): string {
    const obj = this.heap[id];
    if (!obj) return `<object #${id}>`;
    const kind = obj[0];
    if (kind === "FUNCTION") return `<function ${String(obj[1])}>`;
    if (kind === "CLASS") return `<class ${String(obj[1])}>`;
    if (kind === "module") return `<module ${String(obj[1])}>`;
    const tag = `${label(obj)}#${id}`;
    if (this.expanded.has(id)) return `->${tag}`;
    if (depth >= MAX_NESTING) return `->${tag}(...)`;
    this.expanded.add(id);
    const d = depth + 1;
    if (isInstance(obj)) {
      return `${tag}(${instanceAttrs(obj).map(([k, x]) => `${k}=${this.value(x, d)}`).join(", ")})`;
    }
    if (kind === "LIST" || kind === "TUPLE" || kind === "SET") {
      const items = obj.slice(1) as Encoded[];
      const shown = items.slice(0, MAX_ITEMS).map((x) => this.value(x, d));
      if (items.length > MAX_ITEMS) shown.push(`... +${items.length - MAX_ITEMS} more`);
      const [open, close] = kind === "LIST" ? ["[", "]"] : kind === "TUPLE" ? ["(", ")"] : ["{", "}"];
      return `${tag}${open}${shown.join(", ")}${close}`;
    }
    if (kind === "DICT") {
      const pairs = obj.slice(1) as [Encoded, Encoded][];
      const shown = pairs.slice(0, MAX_ITEMS).map(([k, x]) => `${this.value(k, d)}: ${this.value(x, d)}`);
      if (pairs.length > MAX_ITEMS) shown.push(`... +${pairs.length - MAX_ITEMS} more`);
      return `${tag}{${shown.join(", ")}}`;
    }
    return `<${kind} ${obj.slice(1).join(" ").slice(0, 60)}>`;
  }
}

function listing(code: string, current: number): string {
  const lines = code.split(/\r?\n/);
  let start = 1;
  let end = lines.length;
  if (lines.length > MAX_LISTING_LINES) {
    start = Math.max(1, current - MAX_LISTING_LINES / 2);
    end = Math.min(lines.length, start + MAX_LISTING_LINES - 1);
  }
  const out: string[] = [];
  if (start > 1) out.push("   ... (earlier lines omitted)");
  for (let n = start; n <= end; n++) out.push(`${n === current ? ">>" : "  "}${String(n).padStart(4)} | ${lines[n - 1]}`);
  if (end < lines.length) out.push("   ... (later lines omitted)");
  return out.join("\n");
}

/** Text the tutor sees for one step: program (optional), position, call stack with locals, output so far. */
export function describeState(code: string, step: TraceStep, index: number, count: number, includeCode = true): string {
  const r = new Renderer(step.heap ?? {});
  const line = step.line;
  const fn = step.func_name || "<module>";
  const event = step.event || "step_line";
  const src = code.split(/\r?\n/);
  const parts: string[] = [];
  if (includeCode) parts.push(`## Program (>> marks the current line)\n${listing(code, line)}`);

  const where =
    event === "call"
      ? `just entered ${fn}() at line ${line}`
      : event === "return"
        ? `is about to return from ${fn}() at line ${line}`
        : event === "exception"
          ? `just raised an exception at line ${line}`
          : `is about to run line ${line}`;
  const pos = [`## Position\nStep ${index + 1} of ${count}: execution ${where}.`];
  if (fn !== "<module>" && event === "step_line") pos.push(`Inside function ${fn}().`);
  if (src[line - 1] !== undefined) pos.push(`Current line ${line}: ${src[line - 1].trim()}`);
  if (step.exception_msg) pos.push(`Exception: ${step.exception_msg}`);
  parts.push(pos.join("\n"));

  const frames = liveFrames(step);
  const globalCurrent = !frames.some((f) => f.is_highlighted);
  const vars = (names: string[], values: Record<string, Encoded>) => {
    const rows = names.filter((n) => n in values).map((n) => `  ${n === "__return__" ? "return value" : n} = ${r.value(values[n])}`);
    return rows.length ? rows : ["  (no variables)"];
  };
  const mem = ["## Memory (call stack, outermost frame first)", `Global frame${globalCurrent ? " [current]" : ""}:`];
  mem.push(...vars(step.ordered_globals ?? [], step.globals ?? {}));
  for (const f of frames) {
    mem.push(`Frame ${f.func_name}()${f.is_highlighted ? " [current]" : ""}:`);
    mem.push(...vars(f.ordered_varnames ?? [], f.encoded_locals ?? {}));
  }
  parts.push(mem.join("\n"));

  const out = step.stdout ?? "";
  parts.push(`## Printed output so far\n${out ? out.slice(-600) : "(nothing yet)"}`);

  const text = parts.join("\n\n");
  return text.length > MAX_STATE_CHARS ? text.slice(0, MAX_STATE_CHARS) + "\n... (memory state truncated)" : text;
}

/** True if the value is a pointer to an object (used by the offline hint). */
export const pointsToObject = (v: Encoded | undefined) => isRef(v);
