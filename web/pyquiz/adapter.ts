/**
 * Connects the python branch's question bank (this folder) to TraceLab. The runner sends a Python run's raw
 * pg_logger result in a `native` event; the bank reads that, and its questions become TraceLab questions.
 * Raw step `i` is TraceLab snapshot `i`: the runner turns each pg_logger step into one line or exception
 * event, in order.
 */
import type { Question, Run } from '../types';
import { CONCEPT_LABELS } from './core.ts';
import { applyRepair, planQuiz, suggestFix } from './questionBank.ts';
import type { FixSuggestion, QuizPlan } from './questionBank.ts';
import type { HeapObject, RunResult, StackFrame, TraceStep } from './types.ts';

/** The runner's compact trace (worker/python/tracer.py `compact`): frames and heap entries stored once. */
type Compact = Omit<RunResult, 'trace' | 'duration_ms'> & {
  format: 'compact-1'; frames: StackFrame[]; heap: [string, HeapObject][]; output: string;
  trace: (Omit<TraceStep, 'stack_to_render' | 'heap' | 'stdout'> & { stack_to_render?: number[]; heap?: number[]; stdout?: number | string })[];
};

const expanded = new WeakMap<object, RunResult>();

/** The raw result of a recorded Python run, or null for other runs. Expanded once per run. */
export function pythonResult(run: Run | null): RunResult | null {
  const native = run?.request.language === 'python' ? run.events.find(e => e.kind === 'native' && e.language === 'python') : undefined;
  if (!native?.result) return null;
  const cached = expanded.get(native.result as object);
  if (cached) return cached;
  const raw = native.result as Compact | Omit<RunResult, 'duration_ms'>;
  let result: RunResult;
  if ('format' in raw && raw.format === 'compact-1') {
    // Output lengths count characters (code points), as Python does.
    const chars = [...raw.output];
    const prefix = new Map<number, string>();
    const outputAt = (n: number) => { if (!prefix.has(n)) prefix.set(n, chars.slice(0, n).join('')); return prefix.get(n)!; };
    const trace = raw.trace.map(step => ({
      ...step,
      stack_to_render: (step.stack_to_render ?? []).map(i => raw.frames[i]),
      heap: Object.fromEntries((step.heap ?? []).map(i => raw.heap[i])),
      stdout: typeof step.stdout === 'number' ? outputAt(step.stdout) : step.stdout ?? '',
    })) as TraceStep[];
    const { format: _format, frames: _frames, heap: _heap, output: _output, ...rest } = raw;
    result = { duration_ms: 0, ...rest, trace };
  } else result = { duration_ms: 0, ...(raw as Omit<RunResult, 'duration_ms'>) };
  expanded.set(native.result as object, result);
  return result;
}

const sourceOf = (run: Run) => run.request.files[0]?.content ?? '';

export function pythonPlan(run: Run): QuizPlan | null {
  const result = pythonResult(run);
  return result ? planQuiz(result, sourceOf(run)) : null;
}

/** Progress is kept per concept; Python concepts are prefixed so they don't count toward Java ones. */
export const conceptKey = (concept: string) => `python:${concept}`;
export const PYTHON_CONCEPTS: Record<string, string> = Object.fromEntries(Object.entries(CONCEPT_LABELS).map(([k, v]) => [conceptKey(k), `Python: ${v}`]));

export function pythonQuestions(run: Run): Question[] {
  const plan = pythonPlan(run);
  if (!plan) return [];
  const source = sourceOf(run);
  const file = run.request.files[0].name;
  const lines = source.split(/\r?\n/);
  return plan.questions.map(q => {
    let patched: string | undefined;
    if (q.kind === 'repair' && q.edit) { try { patched = applyRepair(source, q.edit, q.options[q.correct]); } catch { patched = undefined; } }
    return {
      id: `py:${q.id}`, kind: q.kind, concept: conceptKey(q.concept), title: q.title, context: q.context, prompt: q.prompt,
      options: q.options, correct: q.correct, explanation: q.explanation, hints: q.hints, step: q.step,
      ...(q.focusLine ? { focus: { file, line: q.focusLine }, code: lines[q.focusLine - 1]?.trim() } : {}),
      topic: q.topicLabel, ...(patched && patched !== source ? { patched } : {}),
    };
  });
}

/** The bank's suggested fix for a Python run that ended in an error (their Fix panel). */
export function pythonFix(run: Run | null): FixSuggestion | null {
  const result = pythonResult(run);
  return result && run ? suggestFix(result, sourceOf(run)) : null;
}
