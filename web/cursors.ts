import { enclosingMethod, forEachLoops, maskJava } from './javasource.ts';
import type { Frame, HeapObject, Run, TraceEvent } from './types';

/**
 * "Where are we in the array?" markers. For the current step, finds index expressions in the running method,
 * such as `values[i]`, `list.get(i - 1)` or `word.charAt(word.length() - 1 - i)`, and evaluates them with the
 * recorded values. Enhanced for loops get the current iteration's position, checked against the recorded element.
 */
export type Cursor = {
  /** Heap object the index points into. */
  objectId: string;
  /** Variable name used for the collection in the source. */
  name: string;
  /** Index expression as written, e.g. `i` or `values.length - 1 - i`. */
  label: string;
  index: number;
  inRange: boolean;
  kind: 'index' | 'for-each';
};

const INTEGRAL = new Set(['int', 'long', 'short', 'byte', 'char']);
const shortField = (name: string) => name.split('.').at(-1)!;

/** Evaluates + - * / % and parentheses over integers, `x`, `x.length`, `x.length()` and `x.size()`. Undefined if anything is unknown. */
export function evaluateIndex(expr: string, number: (name: string) => number | undefined, size: (name: string) => number | undefined): number | undefined {
  const tokens: string[] = [];
  const re = /\s*(\d+|[A-Za-z_$][\w$]*(?:\s*\.\s*(?:length\s*\(\s*\)|length|size\s*\(\s*\)))?|[-+*/%()])/y;
  let at = 0;
  while (at < expr.length) {
    re.lastIndex = at;
    const m = re.exec(expr);
    if (!m) { if (/^\s*$/.test(expr.slice(at))) break; return undefined; }
    tokens.push(m[1]); at = re.lastIndex;
  }
  let p = 0;
  const atom = (): number | undefined => {
    const t = tokens[p++];
    if (t === undefined) return undefined;
    if (t === '(') { const v = sum(); return tokens[p++] === ')' ? v : undefined; }
    if (t === '-') { const v = atom(); return v === undefined ? undefined : -v; }
    if (/^\d+$/.test(t)) return Number(t);
    const member = t.match(/^([A-Za-z_$][\w$]*)\s*\.\s*(length|size)/);
    return member ? size(member[1]) : number(t);
  };
  const product = (): number | undefined => {
    let v = atom();
    while (v !== undefined && (tokens[p] === '*' || tokens[p] === '/' || tokens[p] === '%')) {
      const op = tokens[p++], r = atom();
      if (r === undefined || (op !== '*' && r === 0)) return undefined;
      v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  const sum = (): number | undefined => {
    let v = product();
    while (v !== undefined && (tokens[p] === '+' || tokens[p] === '-')) {
      const op = tokens[p++], r = product();
      if (r === undefined) return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const value = sum();
  return p === tokens.length && value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

/** Text inside balanced brackets starting just after `open`, or null. */
function balanced(text: string, from: number, open: string, close: string): { inner: string; end: number } | null {
  let depth = 1;
  for (let k = from; k < text.length; k++) {
    if (text[k] === open) depth++;
    else if (text[k] === close && --depth === 0) return { inner: text.slice(from, k), end: k + 1 };
  }
  return null;
}

export function cursorsFor(run: Run, states: TraceEvent[], step: number): Cursor[] {
  let at = Math.min(step, states.length - 1);
  while (at >= 0 && !states[at].frames) at--;
  const state = states[at];
  const frame = state?.frames?.[0];
  if (!state || !frame) return [];
  const src = run.request.files.find(f => f.name === frame.file)?.content;
  if (!src) return [];
  const range = enclosingMethod(src, frame.line);
  if (!range) return [];
  const heap = new Map((state.heap ?? []).map(o => [o.id, o]));
  const self = frame.locals.find(v => v.name === 'this')?.value.ref;
  const selfFields = self ? heap.get(self)?.fields ?? [] : [];
  const locals = new Map(frame.locals.map(v => [v.name, v]));
  const ref = (name: string) => locals.get(name)?.value.ref ?? (locals.has(name) ? undefined : selfFields.find(f => shortField(f.name) === name)?.value.ref);
  const number = (name: string) => {
    const v = locals.get(name);
    if (!v || v.value.kind !== 'primitive' || !INTEGRAL.has(v.type)) return undefined;
    return v.type === 'char' ? v.value.value!.codePointAt(0) : Number(v.value.value);
  };
  const size = (name: string) => { const id = ref(name); const o = id ? heap.get(id) : undefined; return o?.kind === 'string' ? o.text?.length : o?.length; };
  const cursors: Cursor[] = [];
  const seen = new Set<string>();
  const add = (cursor: Cursor) => {
    const key = `${cursor.objectId}|${cursor.label.replace(/\s+/g, '')}`;
    if (seen.has(key)) return;
    seen.add(key); cursors.push(cursor);
  };
  const lengthOf = (o: HeapObject) => o.kind === 'string' ? (o.text?.length ?? 0) : (o.length ?? 0);
  const indexCursor = (objectId: string | undefined, name: string, expr: string) => {
    const object = objectId ? heap.get(objectId) : undefined;
    if (!object || !/[A-Za-z_$]/.test(expr.replace(/\b(?:length|size)\b/g, ''))) return;
    if (!['array', 'list', 'string'].includes(object.kind)) return;
    const index = evaluateIndex(expr, number, size);
    if (index === undefined) return;
    add({ objectId: object.id, name, label: expr.trim().replace(/\s+/g, ' '), index, inRange: index >= 0 && index < lengthOf(object), kind: 'index' });
    return object;
  };
  // Index expressions anywhere in the method body, evaluated with the values at this step.
  const masked = maskJava(src).slice(range.start, range.end);
  const access = /(?:\bthis\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*(\[|\.\s*(?:get|charAt|set)\s*\()/g;
  for (let m; (m = access.exec(masked));) {
    const name = m[1];
    const bracket = m[2] === '[';
    const first = balanced(masked, m.index + m[0].length, bracket ? '[' : '(', bracket ? ']' : ')');
    if (!first) continue;
    const expr = bracket || !m[2].includes('set') ? first.inner : first.inner.split(',')[0];
    const outer = indexCursor(ref(name), name, expr);
    // A second index, as in grid[r][c], points into the row array.
    const second = bracket && outer?.kind === 'array' ? masked.slice(first.end).match(/^\s*\[/) : null;
    if (second && outer) {
      const inner = balanced(masked, first.end + second[0].length, '[', ']');
      const row = evaluateIndex(expr, number, size);
      const rowRef = row !== undefined ? outer.elements?.[row]?.ref : undefined;
      if (inner && rowRef) indexCursor(rowRef, `${name}[${expr.trim()}]`, inner.inner);
    }
  }
  // Enhanced for loops: count iterations of this activation, then confirm against the recorded element.
  for (const loop of forEachLoops(src, range)) {
    if (frame.line < loop.firstLine || frame.line > loop.lastLine || !locals.has(loop.variable)) continue;
    const objectId = ref(loop.iterable);
    const object = objectId ? heap.get(objectId) : undefined;
    if (!object || !(object.kind === 'array' || object.kind === 'list')) continue;
    let headers = 0;
    for (let i = at; i >= 0; i--) {
      const top = states[i].frames?.[0];
      if (!top || top.id !== frame.id) { if (states[i].frames?.some(f => f.id === frame.id)) continue; break; }
      if (top.line === loop.headerLine) headers++;
      else if (top.line < loop.headerLine || top.line > loop.lastLine) break;
    }
    const index = headers - 1;
    const element = object.elements?.[index];
    const current = locals.get(loop.variable)!.value;
    const matches = element && (element.kind === 'reference' ? element.ref === current.ref : element.value === current.value);
    if (index >= 0 && matches) add({ objectId: object.id, name: loop.iterable, label: loop.variable, index, inRange: true, kind: 'for-each' });
  }
  return cursors;
}

/** Cursors grouped by heap object. */
export function cursorsByObject(cursors: Cursor[]): Map<string, Cursor[]> {
  const map = new Map<string, Cursor[]>();
  for (const c of cursors) map.set(c.objectId, [...(map.get(c.objectId) ?? []), c]);
  return map;
}

/** For a simple index variable such as `i`, the cell it points to, e.g. `values[2]`. */
export function variableTargets(cursors: Cursor[], frame?: Frame): Map<string, Cursor> {
  const out = new Map<string, Cursor>();
  for (const c of cursors) if (/^[A-Za-z_$][\w$]*$/.test(c.label) && frame?.locals.some(v => v.name === c.label) && !out.has(c.label)) out.set(c.label, c);
  return out;
}
