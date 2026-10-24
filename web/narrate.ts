import { exceptionMessage } from './learning.ts';
import type { Frame, HeapObject, Run, TraceEvent, TraceValue } from './types';

export type StoryItem = { kind: 'start' | 'call' | 'return' | 'change' | 'new' | 'output' | 'exception' | 'end' | 'same'; text: string };

const BOXED = /^java\.lang\.(Integer|Long|Short|Byte|Double|Float|Boolean|Character)$/;

/** "demo.Main.factorial" → "Main.factorial"; constructors read as "new Box". */
export function displayMethod(method: string): string {
  const parts = method.split('.');
  if (parts.at(-1) === '<init>') return `new ${parts.at(-2)}`;
  return parts.slice(-2).join('.');
}
export function simpleType(type: string): string { return type.replace(/(?:[\w$]+\.)+/g, '').replace(/\$/g, '.'); }
export function boxedValue(object?: HeapObject): string | undefined {
  return object?.kind === 'object' && BOXED.test(object.type) ? object.fields?.[0]?.value.value : undefined;
}
/** Immutable values that read better inline than as separate heap cards. */
export function isInlineValue(object?: HeapObject): boolean {
  return !!object && ((object.kind === 'string' && object.type === 'java.lang.String') || boxedValue(object) !== undefined);
}
export function heapIndex(state?: TraceEvent): Map<string, HeapObject> { return new Map((state?.heap ?? []).map(o => [o.id, o])); }

function clip(text: string, limit = 60): string { return text.length > limit ? `${text.slice(0, limit)}…` : text; }

export function describeValue(value: TraceValue | undefined, heap: Map<string, HeapObject>): string {
  if (!value) return '?';
  if (value.kind !== 'reference') return value.value ?? 'null';
  const object = heap.get(value.ref!);
  if (object?.kind === 'string' && object.type === 'java.lang.String') return JSON.stringify(clip(object.text ?? ''));
  const boxed = boxedValue(object);
  if (boxed !== undefined) return boxed;
  const type = simpleType(value.type ?? object?.type ?? 'Object');
  return object?.length !== undefined && object.kind === 'array' ? `${type.replace(/\[\]$/, `[${object.length}]`)} @${value.ref}` : `${type} @${value.ref}`;
}

const same = (a?: TraceValue, b?: TraceValue) => JSON.stringify(a) === JSON.stringify(b);

function callText(frame: Frame, heap: Map<string, HeapObject>): string {
  const args = frame.locals.filter(v => v.argument).map(v => `${v.name} = ${describeValue(v.value, heap)}`);
  return `${displayMethod(frame.method)}(${args.join(', ')})`;
}

/** Name for an object, preferring a variable in the newest frame that refers to it. */
function label(object: HeapObject, state: TraceEvent): string {
  for (const frame of state.frames ?? []) {
    const variable = frame.locals.find(v => v.value.ref === object.id && v.name !== 'this');
    if (variable) return variable.name;
  }
  return `@${object.id}`;
}

function heapChanges(before: HeapObject, after: HeapObject, state: TraceEvent, oldHeap: Map<string, HeapObject>, heap: Map<string, HeapObject>): StoryItem[] {
  const name = label(after, state);
  const items: StoryItem[] = [];
  if (after.kind === 'string' && before.text !== after.text) items.push({ kind: 'change', text: `${name}: ${JSON.stringify(clip(before.text ?? ''))} → ${JSON.stringify(clip(after.text ?? ''))}` });
  if (after.elements) {
    if (after.kind !== 'array' && before.length !== after.length) items.push({ kind: 'change', text: `${name} size: ${before.length ?? 0} → ${after.length ?? 0}` });
    after.elements.forEach((value, i) => {
      const old = before.elements?.[i];
      if (!old) { if (after.kind === 'array') return; items.push({ kind: 'new', text: `${name}[${i}] = ${describeValue(value, heap)}` }); }
      else if (!same(old, value) && describeValue(old, oldHeap) !== describeValue(value, heap)) items.push({ kind: 'change', text: `${name}[${i}]: ${describeValue(old, oldHeap)} → ${describeValue(value, heap)}` });
    });
  }
  if (after.fields) for (const field of after.fields) {
    const old = before.fields?.find(f => f.name === field.name);
    if (old && !same(old.value, field.value)) items.push({ kind: 'change', text: `${name}.${field.name.split('.').at(-1)}: ${describeValue(old.value, oldHeap)} → ${describeValue(field.value, heap)}` });
  }
  if (after.entries) {
    const oldEntries = new Map((before.entries ?? []).map(e => [describeValue(e.key, oldHeap), describeValue(e.value, oldHeap)]));
    for (const entry of after.entries) {
      const key = describeValue(entry.key, heap), value = describeValue(entry.value, heap);
      if (!oldEntries.has(key)) items.push({ kind: 'new', text: `${name}: put ${key} → ${value}` });
      else if (oldEntries.get(key) !== value) items.push({ kind: 'change', text: `${name}[${key}]: ${oldEntries.get(key)} → ${value}` });
      oldEntries.delete(key);
    }
    if (!before.truncated && !after.truncated) for (const key of oldEntries.keys()) items.push({ kind: 'change', text: `${name}: removed ${key}` });
  }
  return items;
}

/**
 * Names a returned call with the arguments its frame showed at its last recorded stop, e.g. "Main.factorial(n = 1)".
 * Falls back to the bare method name if that activation was never captured (for example, past the frame budget).
 */
export function returnedCall(states: TraceEvent[], index: number, frameId: string | null, method: string, heap?: Map<string, HeapObject>): string {
  if (frameId) for (let i = index - 1; i >= 0; i--) {
    const frame = states[i].frames?.find(f => f.id === frameId);
    if (frame) return callText(frame, heap ?? heapIndex(states[i]));
  }
  return displayMethod(method);
}

/** Narrates differences between the previous recorded source stop and this one. */
export function describeStep(run: Run, states: TraceEvent[], index: number): StoryItem[] {
  const current = states[index];
  if (!current) return [];
  let previous: TraceEvent | undefined;
  for (let i = index - 1; i >= 0; i--) if (states[i].frames) { previous = states[i]; break; }
  const items: StoryItem[] = [];
  const printed = run.events.filter(e => e.kind === 'output' && e.sequence > (index > 0 ? states[index - 1].sequence : -1) && e.sequence <= current.sequence);
  const outputItems = (['stdout', 'stderr'] as const).flatMap(stream => {
    const text = printed.filter(e => e.stream === stream).map(e => e.text ?? '').join('').replace(/\r\n/g, '\n');
    return text ? [{ kind: 'output' as const, text: `${stream === 'stdout' ? 'Output received' : 'stderr received'}: ${JSON.stringify(clip(text, 80))}` }] : [];
  });
  if (current.kind === 'terminated') return [{ kind: 'end', text: current.message ?? 'The run ended.' }, ...outputItems];
  const heap = heapIndex(current), oldHeap = heapIndex(previous);
  if (current.exception) {
    const { type, caught } = current.exception;
    const message = exceptionMessage(run, current);
    items.push({ kind: 'exception', text: `${caught ? 'Threw (a handler will catch it)' : 'Threw'} ${simpleType(type)}${message ? `: ${clip(message, 120)}` : ''}` });
  }
  if (!previous) items.push({ kind: 'start', text: `Execution starts in ${displayMethod(current.frames?.at(-1)?.method ?? 'main')}.` });
  const returns = current.returns ?? [];
  for (const r of returns) {
    const call = returnedCall(states, index, r.frameId, r.method, oldHeap);
    items.push({ kind: 'return', text: r.void ? `${call} finished.` : `${call} returned ${describeValue(r.value, heap)}.` });
  }
  const before = previous?.frames ?? [], after = current.frames ?? [];
  const afterIds = new Set(after.map(f => f.id)), beforeIds = new Set(before.map(f => f.id));
  for (const frame of before) {
    if (afterIds.has(frame.id) || returns.some(r => r.frameId === frame.id)) continue;
    items.push({ kind: 'return', text: frame.method.endsWith('.<init>') ? `${displayMethod(frame.method)}(…) finished constructing.` : `${displayMethod(frame.method)} left the stack.` });
  }
  if (previous) for (const frame of [...after].reverse()) if (!beforeIds.has(frame.id)) items.push({ kind: 'call', text: `Called ${callText(frame, heap)}.` });
  for (const frame of after) {
    const old = before.find(f => f.id === frame.id);
    if (!old) continue;
    const where = frame === after[0] ? '' : ` (in ${displayMethod(frame.method)})`;
    for (const variable of frame.locals) {
      const prior = old.locals.find(v => v.name === variable.name);
      if (!prior) items.push({ kind: 'new', text: `${variable.name} = ${describeValue(variable.value, heap)}${where}` });
      else if (!same(prior.value, variable.value)) items.push({ kind: 'change', text: `${variable.name}: ${describeValue(prior.value, oldHeap)} → ${describeValue(variable.value, heap)}${where}` });
    }
  }
  for (const field of current.statics ?? []) {
    const prior = previous?.statics?.find(s => s.name === field.name);
    if (prior && !same(prior.value, field.value)) items.push({ kind: 'change', text: `${simpleType(field.name)}: ${describeValue(prior.value, oldHeap)} → ${describeValue(field.value, heap)}` });
  }
  if (previous) for (const object of current.heap ?? []) {
    const old = oldHeap.get(object.id);
    if (old) items.push(...heapChanges(old, object, current, oldHeap, heap));
    else if (!isInlineValue(object) && object.kind !== 'opaque') items.push({ kind: 'new', text: `Created ${describeValue({ kind: 'reference', ref: object.id, type: object.type }, heap)}` });
  }
  items.push(...outputItems);
  if (!items.length) items.push({ kind: 'same', text: 'No recorded value changed since the previous stop.' });
  return items;
}

const topId = (state?: TraceEvent) => state?.frames?.[0]?.id;

/** Next stop in the current frame or a caller, skipping callee stops. Exceptions always stop. */
export function stepOver(states: TraceEvent[], index: number): number {
  const top = topId(states[index]);
  if (!top) return Math.min(index + 1, states.length - 1);
  for (let j = index + 1; j < states.length; j++) {
    const frames = states[j].frames;
    if (!frames || frames[0]?.id === top || !frames.some(f => f.id === top) || states[j].exception) return j;
  }
  return states.length - 1;
}

/** First stop after the current frame has returned. */
export function stepOut(states: TraceEvent[], index: number): number {
  const top = topId(states[index]);
  if (!top) return Math.min(index + 1, states.length - 1);
  for (let j = index + 1; j < states.length; j++) {
    const frames = states[j].frames;
    if (!frames || !frames.some(f => f.id === top) || (states[j].exception && !states[j].exception!.caught)) return j;
  }
  return states.length - 1;
}

/** Previous stop in the current frame or a caller. */
export function stepBackOver(states: TraceEvent[], index: number): number {
  const top = topId(states[index]);
  for (let j = index - 1; j >= 0; j--) {
    const frames = states[j].frames;
    if (!top || (frames && (frames[0]?.id === top || !frames.some(f => f.id === top)))) return j;
  }
  return 0;
}
