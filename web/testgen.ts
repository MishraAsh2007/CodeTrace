import { testTargets } from './javasource.ts';
import type { JavaMethod } from './javasource.ts';
import { isHarnessFile } from './tests.ts';
import type { BatchResult } from './tests.ts';
import type { Check, SourceFile } from './types';

/**
 * Generates method-call tests by trying sample arguments on the student's static methods. The results describe
 * what the code does now, which may be wrong, so the IDE always asks the student to confirm each expected value.
 */
export type GeneratedCase = { id: number; target: string; className: string; method: string; call: string; expression: string };
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

const MAX_CASES = 30;
const MAX_PER_METHOD = 5;

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

/** Which methods can get generated tests, the calls to try, and why the others were skipped. */
export function planTests(files: SourceFile[]): TestPlan {
  const cases: GeneratedCase[] = [];
  const skipped: SkippedMethod[] = [];
  for (const target of testTargets(files.filter(f => !isHarnessFile(f.name)))) {
    for (const method of target.methods) {
      if (method.name === 'main') continue;
      const skip = (reason: string) => skipped.push({ className: target.name, method: method.name, reason });
      if (method.isPrivate) { skip('private, so other classes can’t call it'); continue; }
      if (!method.isStatic) { skip(`instance method: add a test by hand with an object, such as new ${target.name}().${method.name}(…)`); continue; }
      if (!method.returnType || method.returnType === 'void') { skip('returns nothing; test what it prints with an output test'); continue; }
      const unsupported = (method.params ?? []).find(p => !samplesFor(p.type));
      if (unsupported) { skip(`parameter type ${unsupported.type} isn’t supported yet`); continue; }
      for (const call of sampleCalls(method)) {
        if (cases.length >= MAX_CASES) break;
        cases.push({ id: cases.length, target: target.qualified, className: target.name, method: method.name, call, expression: `${target.name}.${call}` });
      }
    }
  }
  return { cases, skipped };
}

export const packageOf = (target: string) => target.includes('.') ? target.slice(0, target.lastIndexOf('.')) : '';

/** The method test a confirmed case becomes. */
export function caseToCheck(c: GeneratedCase, expected: string): Check {
  return { name: c.call.length <= 120 ? c.call : `${c.call.slice(0, 117)}…`, kind: 'call', target: c.target, call: c.call, stdin: '', expectedOutput: expected.trim() };
}
