// Pure helpers over pg_logger's encoding: labels, layout, and the "where am I" spotlight.
import type { Encoded, HeapObject, StackFrame, TraceStep } from "./types.ts";

export const MAX_OBJECTS = 160;
export const MAX_SEQ_ITEMS = 30;

const INLINE_KINDS = new Set(["FUNCTION", "CLASS", "module"]);

export const isRef = (v: unknown): v is ["REF", number | string] => Array.isArray(v) && v[0] === "REF";

export function heapObj(heap: Record<string, HeapObject>, ref: ["REF", number | string]): HeapObject | undefined {
  return heap[String(ref[1])];
}

/** Functions, classes and modules render inline as text instead of as heap cards. */
export function isInline(obj: HeapObject | undefined): boolean {
  return !obj || INLINE_KINDS.has(obj[0]);
}

export const isInstance = (obj: HeapObject) => obj[0] === "INSTANCE" || obj[0] === "INSTANCE_PPRINT";

export function objLabel(obj: HeapObject | undefined): string {
  if (!obj) return "object";
  switch (obj[0]) {
    case "INSTANCE":
    case "INSTANCE_PPRINT":
      return String(obj[1]);
    case "LIST":
      return "list";
    case "TUPLE":
      return "tuple";
    case "SET":
      return "set";
    case "DICT":
      return "dict";
    default:
      return String(obj[0]).toLowerCase();
  }
}

export type Attr = [string, Encoded];

export function instanceAttrs(obj: HeapObject): Attr[] {
  return (obj[0] === "INSTANCE" ? obj.slice(2) : obj.slice(3)) as Attr[];
}

/** Data fields (val, key, ...) first, pointer fields (next, left, right) last. */
export function orderAttrs(attrs: Attr[]): Attr[] {
  const isLink = ([, v]: Attr) => v === null || isRef(v);
  return [...attrs.filter((a) => !isLink(a)), ...attrs.filter(isLink)];
}

export function childRefs(obj: HeapObject): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (isRef(v)) out.push(String(v[1]));
  };
  switch (obj[0]) {
    case "INSTANCE":
    case "INSTANCE_PPRINT":
      for (const [, v] of orderAttrs(instanceAttrs(obj))) add(v);
      break;
    case "LIST":
    case "TUPLE":
    case "SET":
      obj.slice(1, MAX_SEQ_ITEMS + 1).forEach(add);
      break;
    case "DICT":
      for (const pair of obj.slice(1, MAX_SEQ_ITEMS + 1) as [Encoded, Encoded][]) {
        add(pair[0]);
        add(pair[1]);
      }
      break;
  }
  return out;
}

function pyStr(s: string): string {
  const body = s.length > 40 ? s.slice(0, 37) + "…" : s;
  return "'" + body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
}

export function primitiveText(v: Encoded): string {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v) && v[0] === "SPECIAL_FLOAT") return String(v[1]);
  return String(v);
}

export { pyStr };

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- frames ----------

export interface FrameView {
  key: string;
  title: string;
  names: string[];
  values: Record<string, Encoded>;
  prev: Record<string, Encoded> | null;
  isCurrent: boolean;
}

export function liveFrames(step: TraceStep): StackFrame[] {
  return (step.stack_to_render || []).filter((f) => !f.is_zombie);
}

export function buildFrames(step: TraceStep, prevStep: TraceStep | null): FrameView[] {
  const stack = liveFrames(step);
  const prevStack = prevStep ? prevStep.stack_to_render || [] : [];
  const frames: FrameView[] = [
    {
      key: "global",
      title: "Global frame",
      names: step.ordered_globals || [],
      values: step.globals || {},
      prev: prevStep ? prevStep.globals || {} : null,
      isCurrent: !stack.some((f) => f.is_highlighted),
    },
  ];
  for (const f of stack) {
    const before = prevStack.find((p) => p.frame_id === f.frame_id);
    frames.push({
      key: String(f.frame_id),
      title: `${f.func_name}()`,
      names: f.ordered_varnames || [],
      values: f.encoded_locals || {},
      prev: before ? before.encoded_locals || {} : null,
      isCurrent: !!f.is_highlighted,
    });
  }
  return frames;
}

// ---------- heap layout ----------

/**
 * Depth-first placement from the variables: a child goes one column right, on its
 * parent's row if free. Linked lists become one row; trees fan out sideways.
 */
export function layoutHeap(frames: FrameView[], heap: Record<string, HeapObject>): Map<string, { col: number; row: number }> {
  const pos = new Map<string, { col: number; row: number }>();
  const nextFree: number[] = [];
  const place = (id: string, col: number, minRow: number) => {
    if (pos.has(id) || pos.size >= MAX_OBJECTS) return;
    const obj = heap[id];
    if (isInline(obj)) return;
    const row = Math.max(nextFree[col] || 0, minRow);
    pos.set(id, { col, row });
    nextFree[col] = row + 1;
    for (const child of childRefs(obj)) place(child, col + 1, row);
  };
  for (const frame of frames) {
    for (const n of frame.names) {
      const v = frame.values[n];
      if (isRef(v)) place(String(v[1]), 0, 0);
    }
  }
  return pos;
}

// ---------- spotlight ("you are here") ----------

export interface SpotPointer {
  name: string;
  isNone?: boolean;
  id?: string;
  label?: string;
  preview?: string;
  nullAttrs: string[];
}

export interface Spotlight {
  frameName: string;
  pointers: SpotPointer[];
}

/** The variables in the current frame and what they point at. */
export function computeSpotlight(step: TraceStep): Spotlight {
  const heap = step.heap || {};
  const current = liveFrames(step).find((f) => f.is_highlighted);
  const names = current ? current.ordered_varnames || [] : step.ordered_globals || [];
  const values = current ? current.encoded_locals || {} : step.globals || {};

  const pointers: SpotPointer[] = [];
  for (const name of names) {
    if (!(name in values) || name === "__return__") continue;
    const v = values[name];
    if (v === null) {
      pointers.push({ name, isNone: true, nullAttrs: [] });
      continue;
    }
    if (!isRef(v)) continue;
    const obj = heapObj(heap, v);
    if (!obj || isInline(obj)) continue;
    const id = String(v[1]);
    const entry: SpotPointer = { name, id, label: `${objLabel(obj)} #${id}`, preview: "", nullAttrs: [] };
    if (isInstance(obj)) {
      const attrs = orderAttrs(instanceAttrs(obj));
      entry.preview = attrs
        .filter(([, val]) => !isRef(val) && val !== null)
        .slice(0, 2)
        .map(([k, val]) => `${k}=${primitiveText(val)}`)
        .join(", ");
      entry.nullAttrs = attrs.filter(([, val]) => val === null).map(([k]) => k);
    } else {
      entry.preview = `${obj.length - 1} item${obj.length === 2 ? "" : "s"}`;
    }
    pointers.push(entry);
  }
  return { frameName: current ? `${current.func_name}()` : "global scope", pointers };
}

export interface PointerFact {
  mentioned: boolean;
  alert: boolean;
  /** plain text, used for the inline hint in the editor */
  text: string;
  /** structured parts for the "You are here" card: code spans and plain text */
  parts: { code?: string; text?: string; dim?: string }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Facts about pointers, ranked: None pointers the current line reads through come first. */
export function pointerFacts(lineText: string, spot: Spotlight): PointerFact[] {
  const facts: PointerFact[] = [];
  const mentions = (expr: string) => new RegExp(`(^|[^\\w.])${expr}\\b`).test(lineText);
  const derefs = (expr: string) => new RegExp(`(^|[^\\w.])${expr}\\s*[.\\[]`).test(lineText);
  const readsThrough = { text: ", and this line reads through it" };

  for (const p of spot.pointers) {
    const name = escapeRe(p.name);
    if (p.isNone) {
      const alert = derefs(name);
      facts.push({
        mentioned: mentions(name),
        alert,
        text: `${p.name} is None`,
        parts: [{ code: p.name }, { text: " is " }, { code: "None" }, ...(alert ? [readsThrough] : [])],
      });
      continue;
    }
    facts.push({
      mentioned: mentions(name),
      alert: false,
      text: `${p.name} → ${p.label}${p.preview ? ` (${p.preview})` : ""}`,
      parts: [{ code: p.name }, { text: ` → ${p.label}` }, ...(p.preview ? [{ dim: ` (${p.preview})` }] : [])],
    });
    for (const attr of p.nullAttrs) {
      const path = `${name}\\.${escapeRe(attr)}`;
      const alert = derefs(path);
      facts.push({
        mentioned: mentions(path),
        alert,
        text: `${p.name}.${attr} is None`,
        parts: [{ code: `${p.name}.${attr}` }, { text: " is " }, { code: "None" }, ...(alert ? [readsThrough] : [])],
      });
    }
  }
  facts.sort((a, b) => Number(b.alert) - Number(a.alert) || Number(b.mentioned) - Number(a.mentioned));
  return facts;
}
