import { testTargets } from './javasource.ts';
import type { JavaMethod, TestTarget } from './javasource.ts';
import { isHarnessFile, splitStatements } from './tests.ts';
import type { BatchResult } from './tests.ts';
import type { Check, SourceFile } from './types';

/**
 * Generates method-call tests by trying sample arguments on the student's methods: static methods directly,
 * instance methods on an object TraceLab can construct, and void methods by what they print. The results describe
 * what the code does now, which may be wrong, so the IDE always asks the student to confirm each expected value.
 * The AI assistant can suggest the rest (see aiTestMessages): its expected values say what the code should do, and
 * TraceLab runs every suggestion to show where the code disagrees.
 */
export type GeneratedCase = { id: number; target: string; className: string; method: string; call: string; expression: string; printed?: boolean };
export type SkippedMethod = { className: string; method: string; reason: string };
export type TestPlan = { cases: GeneratedCase[]; skipped: SkippedMethod[] };
export type CaseResult = BatchResult;

const INTS = ['0', '1', '2', '5', '-3'];
const SAMPLES: Record<string, string[]> = {
  int: INTS, long: INTS, short: INTS.map(v => `(short) ${v}`), byte: INTS.map(v => `(byte) ${v}`),
  Integer: INTS, Long: INTS.map(v => `${v}L`), Short: INTS.map(v => `(short) ${v}`),
  double: ['0.0', '2.5', '-1.5', '10.0'], float: ['0.0f', '2.5f', '-1.5f', '10.0f'], Double: ['0.0', '2.5', '-1.5', '10.0'], Float: ['0.0f', '2.5f', '-1.5f'],
  boolean: ['true', 'false'], Boolean: ['true', 'false'],
  char: ["'a'", "'b'", "'l'", "' '"], Character: ["'a'", "'b'", "'l'", "' '"],
  String: ['""', '"a"', '"racecar"', '"Hello, World"'],
  'int[]': ['new int[]{}', 'new int[]{7}', 'new int[]{3, 1, 2}', 'new int[]{-2, 5, 5, 0}'],
  'long[]': ['new long[]{}', 'new long[]{7}', 'new long[]{3, 1, 2}'],
  'double[]': ['new double[]{}', 'new double[]{1.5}', 'new double[]{2.0, -1.0, 3.5}'],
  'char[]': ['new char[]{}', "new char[]{'a'}", "new char[]{'c', 'a', 'b'}"],
  'boolean[]': ['new boolean[]{}', 'new boolean[]{true}', 'new boolean[]{true, false, true}'],
  'String[]': ['new String[]{}', 'new String[]{"a"}', 'new String[]{"pear", "apple", "fig"}'],
  'int[][]': ['new int[][]{}', 'new int[][]{{5}}', 'new int[][]{{1, 2}, {3, 4}}'],
  'List<Integer>': ['new java.util.ArrayList<>()', 'new java.util.ArrayList<>(java.util.List.of(7))', 'new java.util.ArrayList<>(java.util.List.of(3, 1, 2))'],
  'List<String>': ['new java.util.ArrayList<>()', 'new java.util.ArrayList<>(java.util.List.of("a"))', 'new java.util.ArrayList<>(java.util.List.of("pear", "apple", "fig"))'],
  'List<Double>': ['new java.util.ArrayList<>()', 'new java.util.ArrayList<>(java.util.List.of(1.5))', 'new java.util.ArrayList<>(java.util.List.of(2.0, -1.0, 3.5))'],
};
const normalizeType = (type: string) => type.replace(/\bjava\.(?:lang|util)\./g, '').replace(/\s+/g, '').replace(/^ArrayList</, 'List<').replace(/,/g, ', ');
/** Sample arguments for a parameter type, or null when the type isn't supported. */
export function samplesFor(type: string): string[] | null { return SAMPLES[normalizeType(type)] ?? null; }

const MAX_CASES = 40;
const MAX_PER_METHOD = 5;

/** An object to call instance methods on: `new Counter()`, `new Book("racecar", 2)`, or null when TraceLab can't build one. */
export function receiverFor(target: TestTarget): string | null {
  if (target.kind !== 'class' && target.kind !== 'record') return null;
  if (target.isAbstract) return null;
  const build = (params: { type: string }[]) => {
    const samples = params.map(p => samplesFor(p.type));
    return samples.every(Boolean) ? `new ${target.name}(${samples.map(s => s![2 % s!.length]).join(', ')})` : null;
  };
  if (target.kind === 'record') return build(target.components ?? []);
  const open = target.constructors.filter(c => !c.isPrivate);
  if (!target.constructors.length || open.some(c => !c.params.length)) return `new ${target.name}()`;
  for (const c of open) { const made = build(c.params); if (made) return made; }
  return null;
}

/**
 * Sample calls for one method. Parameters of the same type are offset so they differ (add(0, 1), add(1, 2), …);
 * parameters of different types move together, which pairs an array with values it contains (find({3, 1, 2}, 2)).
 */
export function sampleCalls(method: JavaMethod): string[] {
  const lists = (method.params ?? []).map(p => samplesFor(p.type)!);
  if (!lists.length) return [`${method.name}()`];
  const seen = new Map<string, number>();
  const offsets = (method.params ?? []).map(p => { const key = normalizeType(p.type); const n = seen.get(key) ?? 0; seen.set(key, n + 1); return n; });
  const count = Math.min(lists.length > 1 ? MAX_PER_METHOD - 1 : MAX_PER_METHOD, Math.max(...lists.map(l => l.length)));
  const calls = new Set<string>();
  for (let k = 0; k < count; k++) calls.add(`${method.name}(${lists.map((l, i) => l[(k + offsets[i]) % l.length]).join(', ')})`);
  return [...calls];
}

/**
 * Which methods can get generated tests, the calls to try, and why the others were skipped. Calls are spread
 * across methods, so a project with many methods gets a few calls for each rather than many for the first ones.
 */
export function planTests(files: SourceFile[]): TestPlan {
  const skipped: SkippedMethod[] = [];
  const eligible: { target: TestTarget; method: JavaMethod; receiver: string | null; printed: boolean }[] = [];
  for (const target of testTargets(files.filter(f => !isHarnessFile(f.name)))) {
    const receiver = receiverFor(target);
    for (const method of target.methods) {
      if (method.name === 'main') continue;
      const skip = (reason: string) => skipped.push({ className: target.name, method: method.name, reason });
      if (method.isPrivate) { skip('private, so other classes can’t call it'); continue; }
      if (!method.isStatic && !receiver) { skip(`instance method, and TraceLab can’t build a ${target.name} on its own: ${target.kind === 'class' && !target.isAbstract ? 'its constructors need arguments it has no samples for' : `it is ${target.isAbstract ? 'abstract' : `${target.kind === 'interface' ? 'an' : 'a'} ${target.kind}`}`}`); continue; }
      const unsupported = (method.params ?? []).find(p => !samplesFor(p.type));
      if (unsupported) { skip(`parameter type ${unsupported.type} isn’t supported yet`); continue; }
      eligible.push({ target, method, receiver: method.isStatic ? null : receiver, printed: !method.returnType || method.returnType === 'void' });
    }
  }
  const perMethod = Math.max(2, Math.min(MAX_PER_METHOD, Math.floor(MAX_CASES / Math.max(1, eligible.length))));
  const cases: GeneratedCase[] = [];
  for (const { target, method, receiver, printed } of eligible) {
    for (const sample of sampleCalls(method).slice(0, perMethod)) {
      if (cases.length >= MAX_CASES) break;
      // Void methods are checked by what they print: a call ending in ; compares the printed text.
      const call = `${receiver ? `${receiver}.` : ''}${sample}${printed ? ';' : ''}`;
      cases.push({ id: cases.length, target: target.qualified, className: target.name, method: method.name, call, expression: receiver ? call : `${target.name}.${call}`, printed });
    }
  }
  return { cases, skipped };
}

// ---------- AI-suggested tests ----------

export type AiTest =
  | { kind: 'call'; target: string; call: string; expected: string; why: string }
  | { kind: 'output'; name: string; stdin: string; expected: string; why: string };

const AI_SOURCE_BUDGET = 10000;

/**
 * The request for AI-suggested tests. The model is asked for what each method *should* do; TraceLab then runs
 * every suggestion, so a disagreement with the code is shown, never silently trusted.
 */
export function aiTestMessages(files: SourceFile[], existing: Check[], plan: TestPlan, options: { hasMain: boolean; mainClass: string }): { role: 'system' | 'user'; content: string }[] {
  let budget = AI_SOURCE_BUDGET;
  const source = files.filter(f => !isHarnessFile(f.name)).map(f => {
    const text = f.content.length > budget ? `${f.content.slice(0, Math.max(0, budget))}\n// … (truncated)` : f.content;
    budget -= text.length;
    return `### ${f.name}\n\`\`\`java\n${text}\n\`\`\``;
  }).join('\n\n');
  const covered = [...new Set(plan.cases.map(c => `${c.className}.${c.method}`))];
  return [{ role: 'system', content: `You write tests for a student's Java 21 program in TraceLab. Reply with one JSON object and nothing else (no Markdown fences): {"tests": [ ... ]}.
Each test is one of:
- {"kind": "call", "target": "<class, with package if any>", "call": "<one line of Java>", "expected": "<value>", "why": "<a few words>"}
- {"kind": "output", "name": "<short name>", "stdin": "<input text>", "expected": "<the complete output>", "why": "<a few words>"}
"call" runs in the target class's package. It is either an expression whose value is checked (sum(new int[]{1, 2}), new Counter().getCount()), or statements separated by semicolons that end with an expression whose value is checked (Counter c = new Counter(); c.increment(); c.getCount()), or statements that end with a semicolon, in which case what they print is checked, without the final line break (Shapes.square(2);). Qualify static calls with the class name. No blocks, loops or lambdas.
Write "expected" exactly as TraceLab shows values: numbers as Java prints them (2.0 for a double), Strings in double quotes with \\n for line breaks, chars in single quotes, arrays and lists as [1, 2, 3], maps as {a=1, b=2}, true/false, null, or throws ExceptionName.
"expected" must be what the code SHOULD do, judging by names, comments, the task the program seems to solve, and Java's rules. Do not just predict what the code does now: if a method looks buggy, write the correct expectation. Skip a method if you can't tell what it should do.
Cover every non-private method and constructor that matters, including instance methods (through an object), void methods (through the state they change or what they print), and edge cases: empty, zero, negative, one element, boundaries, invalid input that should throw.${options.hasMain ? ` The program's main is in ${options.mainClass}: add output tests with inputs if it reads standard input, or one output test otherwise.` : ''}
At most 16 tests. Don't repeat existing tests.` },
  { role: 'user', content: `${source}\n\nExisting tests:\n${existing.length ? existing.map(c => `- ${c.kind === 'call' ? `${c.target}: ${c.call}` : `output with input ${JSON.stringify(c.stdin)}`} → ${c.expectedOutput.slice(0, 80)}`).join('\n') : '(none)'}\n\nTraceLab already tries sample arguments on: ${covered.length ? covered.join(', ') : '(nothing)'}. Focus on what those samples miss.` }];
}

/**
 * The objects inside a reply's `tests` array that parse on their own, for replies that are cut off or have one
 * broken entry. Scans brackets outside strings.
 */
function salvageTests(text: string): unknown[] {
  const from = text.search(/"tests"\s*:\s*\[/);
  const open = from < 0 ? text.indexOf('[') : text.indexOf('[', from);
  if (open < 0) return [];
  const items: unknown[] = [];
  let depth = 0, start = -1, quoted = false;
  for (let k = open + 1; k < text.length; k++) {
    const c = text[k];
    if (quoted) { if (c === '\\') k++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') { if (depth++ === 0) start = k; }
    else if (c === '}' && depth > 0 && --depth === 0) { try { items.push(JSON.parse(text.slice(start, k + 1))); } catch { /* A broken entry is skipped. */ } }
    else if (c === ']' && depth === 0) break;
  }
  return items;
}

/** The model's reply as tests that can run here, or why it couldn't be read. Unknown classes and malformed tests are dropped. */
export function parseAiTests(text: string, files: SourceFile[]): { tests: AiTest[]; dropped: number } | string {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0) return 'The reply wasn’t a JSON object.';
  let value: { tests?: unknown } = {};
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { value = { tests: salvageTests(text) }; }
  if (!Array.isArray(value.tests) || !value.tests.length) return 'The reply had no readable list of tests.';
  const targets = testTargets(files.filter(f => !isHarnessFile(f.name)));
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : null;
  const tests: AiTest[] = [];
  let dropped = 0;
  for (const raw of value.tests.slice(0, 24) as Record<string, unknown>[]) {
    const why = (str(raw?.why, 200) ?? '').trim();
    if (raw?.kind === 'call') {
      const target = targets.find(t => t.qualified === raw.target) ?? targets.find(t => t.name === raw.target);
      const call = str(raw.call, 500)?.trim();
      const expected = str(raw.expected, 2000)?.trim();
      if (!target || !call || /[\r\n]/.test(call) || expected === undefined || expected === null || !expected || splitStatements(call).slice(0, -1).some(s => !s)) { dropped++; continue; }
      tests.push({ kind: 'call', target: target.qualified, call, expected, why });
    } else if (raw?.kind === 'output') {
      const stdin = str(raw.stdin ?? '', 16384), expected = str(raw.expected, 32768), name = (str(raw.name, 120) ?? '').trim() || 'Program output';
      if (stdin === null || expected === null) { dropped++; continue; }
      tests.push({ kind: 'output', name, stdin, expected: expected.replace(/\r\n/g, '\n'), why });
    } else dropped++;
  }
  return { tests, dropped };
}

export const packageOf = (target: string) => target.includes('.') ? target.slice(0, target.lastIndexOf('.')) : '';

/** The method test a confirmed case becomes. */
export function caseToCheck(c: GeneratedCase, expected: string): Check {
  return { name: c.call.length <= 120 ? c.call : `${c.call.slice(0, 117)}…`, kind: 'call', target: c.target, call: c.call, stdin: '', expectedOutput: expected.trim(), origin: 'generated' };
}
