import { cursorsFor } from './cursors.ts';
import { exceptionGuide } from './exceptions.ts';
import { maskJava } from './javasource.ts';
import { exceptionMessage, failingCheck, normalizeOutput, output, snapshots } from './learning.ts';
import { describeValue, displayMethod, heapIndex, simpleType } from './narrate.ts';
import type { Check, HeapObject, Question, Run, TraceEvent, TraceValue } from './types';

/**
 * "Need help" for a run: a step-by-step account built only from the recording, plus visualizations
 * (how variables changed, loop iterations, the calls made, which cells were read, and output differences).
 */
export type HelpRow = { cells: string[]; changed: boolean[]; step: number; mark?: 'error' | 'focus' };
export type HelpVisual =
  | { kind: 'table'; title: string; caption: string; columns: string[]; rows: HelpRow[]; hidden: number }
  | { kind: 'calls'; title: string; caption: string; calls: { depth: number; label: string; result: string; step: number; failed: boolean }[]; hidden: number }
  | { kind: 'cells'; title: string; caption: string; name: string; cells: { index: number; value: string; reads: number; outside: boolean }[] }
  | { kind: 'diff'; title: string; caption: string; lines: { expected: string | null; actual: string | null; same: boolean }[] };
export type HelpView = { title: string; story: string[]; visuals: HelpVisual[]; tips: string[] };

const MAX_ROWS = 30;

/** A compact value: arrays and lists show their elements, Strings their text. */
export function shortValue(value: TraceValue | undefined, heap: Map<string, HeapObject>): string {
  if (value?.kind === 'reference') {
    const object = heap.get(value.ref!);
    if (object && (object.kind === 'array' || object.kind === 'list') && object.elements) {
      const items = object.elements.slice(0, 8).map(e => describeValue(e, heap));
      return `[${items.join(', ')}${(object.length ?? object.elements.length) > 8 ? ', …' : ''}]`;
    }
    if (object?.kind === 'map' && object.entries) return `{${object.entries.slice(0, 4).map(e => `${describeValue(e.key, heap)}=${describeValue(e.value, heap)}`).join(', ')}${object.entries.length > 4 ? ', …' : ''}}`;
  }
  return describeValue(value, heap);
}

/** The loop (for/while/do) whose body contains a line: its header line and last line, or null. */
export function enclosingLoop(src: string, line: number): { header: number; end: number } | null {
  const masked = maskJava(src);
  const lineStart: number[] = [0];
  for (let i = 0; i < masked.length; i++) if (masked[i] === '\n') lineStart.push(i + 1);
  const lineAt = (offset: number) => { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };
  let best: { header: number; end: number } | null = null;
  for (const m of masked.matchAll(/\b(for|while)\s*\(/g)) {
    // Skip the while of a do-while; its body is the do block.
    let depth = 0, k = m.index! + m[0].length - 1;
    for (; k < masked.length; k++) { if (masked[k] === '(') depth++; else if (masked[k] === ')' && --depth === 0) break; }
    let j = k + 1; while (/\s/.test(masked[j] ?? '')) j++;
    if (masked[j] === ';') continue;
    let end: number;
    if (masked[j] === '{') { depth = 0; for (end = j; end < masked.length; end++) { if (masked[end] === '{') depth++; else if (masked[end] === '}' && --depth === 0) break; } }
    else { end = masked.indexOf(';', j); if (end < 0) end = masked.length; }
    const header = lineAt(m.index!), last = lineAt(end);
    if (header <= line && line <= last && (!best || header > best.header)) best = { header, end: last };
  }
  return best;
}

function sourceLine(run: Run, file: string, line: number): string { return run.request.files.find(f => f.name === file)?.content.split(/\r?\n/)[line - 1] ?? ''; }

/** Builds the help view for the moment a question (or the current step) is about. */
export function buildHelp(run: Run, options: { question?: Question; step: number; checks?: Check[] }): HelpView {
  const states = snapshots(run);
  const end = run.events.at(-1);
  const failure = states.findIndex(e => e.exception && !e.exception.caught);
  let at = options.question && options.question.step >= 0 ? options.question.step : failure >= 0 ? failure : Math.min(options.step, states.length - 1);
  while (at > 0 && !states[at]?.frames) at--;
  const state = states[at];
  const story: string[] = [];
  const tips: string[] = [...(options.question?.hints ?? [])];
  const visuals: HelpVisual[] = [];
  let title = 'What the recording shows';

  // 1. What happened, from the end of the run.
  const mismatch = failingCheck(run, options.checks ?? []);
  if (failure >= 0) {
    const event = states[failure];
    const message = exceptionMessage(run, event);
    const guide = exceptionGuide(event.exception!.type, message);
    title = `Why ${simpleType(event.exception!.type)} happened`;
    story.push(`The program stopped at ${event.location!.file} line ${event.location!.line} with ${simpleType(event.exception!.type)}${message ? `: ${message}` : ''}.`);
    // A question's own explanation is more specific; use the general meaning only without one.
    if (!options.question) story.push(guide.meaning);
    tips.push(...guide.causes);
  } else if (end?.stopReason === 'step-limit' || end?.stopReason === 'timeout') {
    title = 'Why the program didn\u2019t finish';
    const counts = new Map<string, number>();
    for (const s of states) if (s.location) counts.set(`${s.location.file}:${s.location.line}`, (counts.get(`${s.location.file}:${s.location.line}`) ?? 0) + 1);
    const [hot, times] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    story.push(`The recording stopped after ${states.length} steps without the program finishing.${hot ? ` Line ${hot.split(':')[1]} of ${hot.split(':')[0]} ran ${times} times.` : ''}`);
    story.push('A loop that never ends usually has a condition that never becomes false: check that something inside the loop moves its variable toward the end. Endless recursion needs a base case that is reached.');
  } else if (mismatch) {
    title = 'Why the output doesn\u2019t match';
    const expected = normalizeOutput(mismatch.check.expectedOutput).split('\n'), actual = mismatch.actual.split('\n');
    const first = expected.findIndex((l, i) => l !== actual[i]);
    const line = first < 0 ? Math.min(expected.length, actual.length) : first;
    story.push(`The program finished, but its output differs from the test “${mismatch.check.name}” at output line ${line + 1}: expected ${JSON.stringify(expected[line] ?? '(nothing)')}, printed ${JSON.stringify(actual[line] ?? '(nothing)')}.`);
    story.push('Find the statement that printed that line, then step back from it to see where the value first differed from what you expected.');
    const lines = Array.from({ length: Math.max(expected.length, actual.length) }, (_, i) => ({ expected: expected[i] ?? null, actual: actual[i] ?? null, same: expected[i] === actual[i] }));
    visuals.push({ kind: 'diff', title: 'Expected and actual output', caption: `First difference on line ${line + 1}.`, lines: lines.slice(0, 40) });
  } else if (end?.stopReason === 'completed') {
    const printed = normalizeOutput(output(run, 'stdout'));
    story.push(`The program finished normally after ${states.length} steps${printed ? ` and printed ${printed.split('\n').length} line${printed.split('\n').length === 1 ? '' : 's'}` : ' without printing anything'}.`);
  }
  if (options.question) story.push(options.question.explanation.replace(/`/g, ''));
  if (!state?.frames?.length) return { title, story, visuals, tips };

  // 2. The variables on the focus line, step by step, in that method call.
  const top = state.frames[0];
  const focusLine = options.question?.focus && options.question.focus.file === top.file ? options.question.focus.line : state.location?.line ?? top.line;
  const text = maskJava(sourceLine(run, top.file, focusLine));
  const named = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
  let vars = top.locals.filter(v => named.has(v.name) && v.name !== 'this').map(v => v.name);
  if (!vars.length) vars = top.locals.filter(v => v.name !== 'this' && v.name !== 'args').slice(0, 4).map(v => v.name);
  vars = vars.slice(0, 5);
  const loop = enclosingLoop(run.request.files.find(f => f.name === top.file)?.content ?? '', focusLine);
  const steps = states.map((s, i) => ({ s, i })).filter(({ s }) => s.frames?.[0]?.id === top.id);
  if (vars.length && steps.length > 1) {
    let iteration = 0, previous: string[] = [];
    const rows: HelpRow[] = [];
    for (const { s, i } of steps) {
      const heap = heapIndex(s);
      if (loop && s.location?.line === loop.header) iteration++;
      const values = vars.map(name => { const v = s.frames![0].locals.find(l => l.name === name); return v ? shortValue(v.value, heap) : '—'; });
      const changed = values.map((v, k) => previous.length > 0 && v !== previous[k]);
      const isFocus = i === at;
      if (!isFocus && rows.length && changed.every(c => !c) && s.location?.line !== loop?.header && s.location?.line !== focusLine) continue;
      rows.push({ cells: [String(i + 1), String(s.location?.line ?? ''), ...(loop ? [iteration ? String(iteration) : '—'] : []), ...values], changed: [false, false, ...(loop ? [false] : []), ...changed], step: i, mark: isFocus ? (s.exception && !s.exception.caught ? 'error' : 'focus') : undefined });
      previous = values;
    }
    const focusRow = Math.max(0, rows.findIndex(r => r.step === at));
    const from = Math.max(0, Math.min(focusRow - MAX_ROWS + 5, rows.length - MAX_ROWS));
    visuals.push({ kind: 'table', title: loop ? `Each pass through the loop on line ${loop.header}` : `How the values changed in ${displayMethod(top.method)}`,
      caption: `Values at each step of this call to ${displayMethod(top.method)}, before the line runs.${loop ? ' Pass counts the times the loop header has run.' : ''} Changed values are highlighted; click a row to jump there.`,
      columns: ['Step', 'Line', ...(loop ? ['Pass'] : []), ...vars], rows: rows.slice(from, from + MAX_ROWS), hidden: rows.length - Math.min(rows.length, MAX_ROWS) });
    if (loop) {
      const passes = rows.length ? Math.max(...rows.map(r => Number(r.cells[2]) || 0)) : 0;
      story.push(`The loop’s header on line ${loop.header} ran ${passes} time${passes === 1 ? '' : 's'} in this call${failure === at ? ' before the failure' : ''}. It runs once before each pass through the body, and once more when the condition finally turns false.`);
    }
  }

  // 3. Which array/list/String cells this call read, from the index markers at each step.
  const reads = new Map<string, Map<number, number>>();
  const names = new Map<string, string>();
  for (const { i } of steps) for (const c of cursorsFor(run, states, i)) {
    if (c.kind !== 'index') continue;
    const map = reads.get(c.objectId) ?? new Map<number, number>();
    if (!reads.has(c.objectId)) { reads.set(c.objectId, map); names.set(c.objectId, c.name); }
    if (states[i].location?.line === focusLine || c.inRange === false) map.set(c.index, (map.get(c.index) ?? 0) + 1);
  }
  const heap = heapIndex(state);
  for (const [id, map] of [...reads].filter(([, m]) => m.size).slice(0, 2)) {
    const object = heap.get(id);
    const length = object?.kind === 'string' ? (object.text ?? '').length : object?.length ?? object?.elements?.length ?? 0;
    const values = object?.kind === 'string' ? [...(object.text ?? '')].map(ch => `'${ch}'`) : (object?.elements ?? []).map(e => describeValue(e, heap));
    const indexes = [...new Set([...Array.from({ length: Math.min(length, 16) }, (_, k) => k), ...map.keys()])].sort((a, b) => a - b);
    const outside = [...map.keys()].filter(k => k < 0 || k >= length);
    visuals.push({ kind: 'cells', title: `Cells of ${names.get(id)} read on line ${focusLine}`, caption: outside.length ? `Index ${outside.join(', ')} is outside 0–${length - 1}.` : `Every read was inside 0–${length - 1}.`, name: names.get(id)!,
      cells: indexes.map(k => ({ index: k, value: values[k] ?? '', reads: map.get(k) ?? 0, outside: k < 0 || k >= length })) });
  }

  // 4. Calls and returns, when methods were called (most useful for recursion).
  const activations = new Map<string, { depth: number; label: string; result: string; step: number; failed: boolean }>();
  for (const [i, s] of states.entries()) {
    const heapAt = heapIndex(s);
    s.frames?.forEach((f, depthFromTop) => {
      // main and static initializers are where calls start, not calls to show.
      if (activations.has(f.id) || f.method.endsWith('.main') || f.method.endsWith('.<clinit>')) return;
      const args = f.locals.filter(v => v.argument).map(v => shortValue(v.value, heapAt)).join(', ');
      activations.set(f.id, { depth: Math.max(0, (s.frames!.length - 1 - depthFromTop) - 1), label: `${displayMethod(f.method)}(${args})`, result: '…', step: i, failed: false });
    });
    for (const r of s.returns ?? []) { const a = r.frameId ? activations.get(r.frameId) : undefined; if (a) a.result = r.void ? 'returned' : `returned ${shortValue(r.value, heapAt)}`; }
  }
  if (failure >= 0) for (const f of states[failure].frames ?? []) { const a = activations.get(f.id); if (a) { a.failed = true; a.result = 'threw'; } }
  const calls = [...activations.values()];
  if (calls.length > 1) {
    const recursive = calls.some((c, k) => calls.slice(k + 1).some(d => d.label.split('(')[0] === c.label.split('(')[0] && d.depth > c.depth));
    visuals.push({ kind: 'calls', title: recursive ? 'The recursive calls' : 'Method calls', caption: recursive ? 'Each call waits for the one below it. Results come back from the deepest call first.' : 'Calls in the order they started, with what each returned.', calls: calls.slice(0, 40), hidden: Math.max(0, calls.length - 40) });
  }
  return { title, story, visuals, tips: [...new Set(tips.map(t => t.replace(/`/g, '')))] };
}

export { exceptionGuide };
