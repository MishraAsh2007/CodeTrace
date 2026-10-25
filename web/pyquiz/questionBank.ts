// questionBank.ts: Kiro's built-in quiz. Answers instantly, offline, with no AI call.
//
// planQuiz() scans the WHOLE trace (every step the visualizer can show) and the source code, runs
// every rule, and ranks what it finds:
//   bug        the error / endless run this program actually hit            (rules/bugs.ts)
//   pitfall    Python gotchas the trace proves happened (shared defaults,  (rules/python.ts)
//              functions returning None)
//   algorithm  DFS/BFS, stacks/queues/heaps, sorting, binary search,       (rules/dsa.ts)
//              memoization, dict counting
//   efficiency Big-O, from how many times lines actually ran               (rules/efficiency.ts, dsa.ts)
//   basics     slicing, / vs //, aliasing                                  (rules/python.ts, predict.ts)
//   predict    "what happens next?" for pointers, branches, returns, loops (rules/predict.ts)
//
// The AI tutor is only needed when no rule produces anything, i.e. nothing in the bank relates to the code.

import type { RunResult } from "./types.ts";
import { liveFrames } from "./model.ts";
import { CONCEPT_TOPICS, TOPIC_LABELS, applyRepair, detectTopics, frameName, type Ctx, type Group, type Question, type Topic } from "./core.ts";
import { errorQuestions, ignoredReturnQuestions, loopQuestions, recursionQuestions, syntaxQuestions } from "./rules/bugs.ts";
import { binarySearchQuestions, countingQuestions, graphQuestions, popQuestions, repeatedWorkQuestions, sortingQuestions } from "./rules/dsa.ts";
import { efficiencyQuestions } from "./rules/efficiency.ts";
import { aliasQuestion, branchPredict, loopCountPredict, pointerPredict, recursionDepthPredict, returnPredict, statePredict } from "./rules/predict.ts";
import { divisionQuestions, mutableDefaultQuestions, returnsNoneQuestions, sliceQuestions } from "./rules/python.ts";

export { applyRepair, detectTopics, TOPIC_LABELS } from "./core.ts";
export type { Question, QuestionKind, RepairEdit, Topic } from "./core.ts";

export interface QuizPlan {
  questions: Question[];
  /** One or two sentences about what the scan found, shown before the first question. */
  summary: string;
  /** True only when nothing in the bank fits this program. */
  needsAi: boolean;
  topics: Topic[];
}

const MAX_QUESTIONS = 8;
const PER_GROUP: Record<Group, number> = { bug: 4, pitfall: 2, algorithm: 4, efficiency: 2, basics: 2, predict: 3 };

function collect(ctx: Ctx): Question[] {
  const safe = (name: string, f: () => (Question | null)[] | Question | null): Question[] => {
    try {
      const r = f();
      return (Array.isArray(r) ? r : [r]).filter((q): q is Question => !!q);
    } catch (err) {
      console.warn(`questionBank rule "${name}" failed`, err); // one odd trace shouldn't break the quiz
      return [];
    }
  };
  return [
    ...safe("errors", () => errorQuestions(ctx)),
    ...safe("ignored-return", () => ignoredReturnQuestions(ctx)),
    ...safe("endless-loop", () => loopQuestions(ctx)),
    ...safe("endless-recursion", () => recursionQuestions(ctx)),
    ...safe("mutable-default", () => mutableDefaultQuestions(ctx)),
    ...safe("returns-none", () => returnsNoneQuestions(ctx)),
    ...safe("graphs", () => graphQuestions(ctx)),
    ...safe("pop", () => popQuestions(ctx)),
    ...safe("sorting", () => sortingQuestions(ctx)),
    ...safe("binary-search", () => binarySearchQuestions(ctx)),
    ...safe("repeated-work", () => repeatedWorkQuestions(ctx)),
    ...safe("counting", () => countingQuestions(ctx)),
    ...safe("efficiency", () => efficiencyQuestions(ctx)),
    ...safe("division", () => divisionQuestions(ctx)),
    ...safe("slicing", () => sliceQuestions(ctx)),
    ...safe("alias", () => aliasQuestion(ctx)),
    ...safe("pointer", () => pointerPredict(ctx)),
    ...safe("branch", () => branchPredict(ctx)),
    ...safe("recursion-depth", () => recursionDepthPredict(ctx)),
    ...safe("return", () => returnPredict(ctx)),
    ...safe("loop-count", () => loopCountPredict(ctx)),
    ...safe("state", () => statePredict(ctx)),
  ];
}

function rank(ctx: Ctx, all: Question[]): Question[] {
  const seen = new Set<string>();
  const unique = all.filter((q) => !seen.has(q.id) && seen.add(q.id));
  const onTopic = (q: Question) => (CONCEPT_TOPICS[q.concept] ?? []).some((t) => ctx.topics.has(t));
  const scored = unique
    .map((q, order) => ({ q, order, score: q.score + (onTopic(q) ? 12 : 0) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const picked: Question[] = [];
  const perGroup = new Map<Group, number>();
  const perConcept = new Map<string, number>();
  // Bug questions keep their natural order (explain, then repair) and always come first.
  for (const q of unique.filter((x) => x.group === "bug")) {
    picked.push(q);
    perGroup.set("bug", (perGroup.get("bug") ?? 0) + 1);
    perConcept.set(q.concept, (perConcept.get(q.concept) ?? 0) + 1);
  }
  for (const { q } of scored) {
    if (q.group === "bug" || picked.length >= MAX_QUESTIONS) continue;
    if ((perGroup.get(q.group) ?? 0) >= PER_GROUP[q.group] || (perConcept.get(q.concept) ?? 0) >= 2) continue;
    picked.push(q);
    perGroup.set(q.group, (perGroup.get(q.group) ?? 0) + 1);
    perConcept.set(q.concept, (perConcept.get(q.concept) ?? 0) + 1);
  }
  return picked.slice(0, MAX_QUESTIONS).map((q) => {
    const topic = (CONCEPT_TOPICS[q.concept] ?? []).find((t) => ctx.topics.has(t));
    return topic && q.topicLabel === "Quick check" ? { ...q, topicLabel: TOPIC_LABELS[topic] } : q;
  });
}

/** What the scan saw, in plain words: what the program does and how it ended. */
function summarize(ctx: Ctx, questions: Question[]): string {
  const { result, trace } = ctx;
  if (!trace.length) {
    return result.status === "error" ? `Your program didn't start: line ${result.error_line} has a syntax problem.` : "";
  }
  // Calls per user function, and the deepest recursion.
  const calls = new Map<string, number>();
  let deepest = { name: "", depth: 0 };
  for (const s of trace) {
    if (s.event === "call") calls.set(frameName(s), (calls.get(frameName(s)) ?? 0) + 1);
    const counts = new Map<string, number>();
    for (const f of liveFrames(s)) counts.set(f.func_name, (counts.get(f.func_name) ?? 0) + 1);
    for (const [n, d] of counts) if (d > deepest.depth) deepest = { name: n, depth: d };
  }
  const concepts = new Set(questions.map((q) => q.concept));
  const what: string[] = [];
  if (concepts.has("graph-order") || concepts.has("graph-kind")) what.push("a graph traversal");
  if (concepts.has("sort-pass") || concepts.has("sort-comparisons")) what.push("a sort");
  if (concepts.has("binary-search")) what.push("a binary search");
  if (ctx.topics.has("linked-list")) what.push("a linked list");
  if (ctx.topics.has("tree")) what.push("a tree");
  if (concepts.has("stack-queue")) what.push("a stack or queue");
  if (concepts.has("dict-counting")) what.push("counting with a dict");
  const fnText = [...calls.entries()]
    .filter(([n]) => !n.startsWith("__")) // constructors like __init__ aren't interesting here
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([n, c]) => `\`${n}\` ran ${c} time${c === 1 ? "" : "s"}${deepest.name === n && deepest.depth >= 3 ? ` (up to ${deepest.depth} deep)` : ""}`)
    .join(", ");
  const ending =
    result.status === "ok"
      ? "and it finished"
      : result.status === "error"
        ? `and it stopped with \`${(result.message ?? "").split(":")[0]}\` on line ${result.error_line}`
        : result.status === "step_limit"
          ? "and it hit the step limit"
          : result.status === "timeout"
            ? "and it timed out"
            : "";
  const about = what.length ? ` It works with ${what.slice(0, 2).join(" and ")}.` : "";
  return `I went through all ${trace.length} steps of your program${fnText ? `: ${fnText}` : ""}, ${ending}.${about}`;
}

/** Scans the run and the code, and picks the built-in questions that fit. */
export function planQuiz(result: RunResult | null, source: string): QuizPlan {
  const topics = detectTopics(source);
  const empty: QuizPlan = { questions: [], summary: "", needsAi: true, topics: [...topics] };
  if (!result) return empty;
  const ctx: Ctx = { result, trace: result.trace, lines: source.split(/\r?\n/), topics };
  const questions = result.trace.length ? rank(ctx, collect(ctx)) : syntaxQuestions(ctx);
  return { questions, summary: summarize(ctx, questions), needsAi: questions.length === 0, topics: [...topics] };
}

/** Back-compat helper: just the questions. */
export function questionsFor(result: RunResult | null, source: string): Question[] {
  return planQuiz(result, source).questions;
}

// ---------------------------------------------------------------------------
// Suggested fix for a failed run
// ---------------------------------------------------------------------------

export interface CodeDiff {
  /** 1-based line numbers the fix changes (for the editor + the diff view). */
  lines: number[];
  before: string[];
  after: string[];
  /** The whole program with the fix applied, ready to drop into the editor. */
  patched: string;
}

export interface FixSuggestion {
  /** The exception type/message or syntax error, as the user saw it. */
  error: string;
  /** 1-based line the error points at, if known. */
  errorLine: number | null;
  /** Plain-language reason, reused from the question bank's explanation. */
  reason: string;
  /** A concrete code change, when the bank has a grounded repair for this bug. */
  diff: CodeDiff | null;
}

const strip = (s: string) => s.replace(/`([^`]+)`/g, "$1").trim();

/** Turns a repair question (whose correct option is the fix) into a before/after diff. */
function diffFromRepair(source: string, q: Question): CodeDiff | null {
  if (q.kind !== "repair" || !q.edit) return null;
  const option = q.options[q.correct];
  let patched: string;
  try {
    patched = applyRepair(source, q.edit, option);
  } catch {
    return null;
  }
  if (patched === source) return null;
  const a = source.split("\n");
  const b = patched.split("\n");
  // Report the contiguous span that actually changed, 1-based.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length - 1;
  let hiB = b.length - 1;
  while (hiA >= lo && hiB >= lo && a[hiA] === b[hiB]) {
    hiA--;
    hiB--;
  }
  const lines = Array.from({ length: hiA - lo + 1 }, (_, k) => lo + k + 1);
  return {
    lines: lines.length ? lines : [lo + 1],
    before: a.slice(lo, hiA + 1),
    after: b.slice(lo, hiB + 1),
    patched,
  };
}

/**
 * When a run ends in an error, look at what the program was trying to do and suggest a fix.
 *
 * It reuses the question bank, which already reads the real trace and code to diagnose the bug, then
 * takes the repair's correct option (grounded in the user's own code) as the suggested change. For
 * errors the bank can't repair automatically, it still returns the error and a plain-language reason
 * so the UI can offer "Ask AI" instead.
 */
export function suggestFix(result: RunResult | null, source: string): FixSuggestion | null {
  if (!result || result.status !== "error") return null;
  const error = (result.message ?? "Error").replace(/ \(<string>, line \d+\)$/, "");
  const questions = result.trace.length ? planQuiz(result, source).questions : syntaxQuestions({ result, trace: result.trace, lines: source.split(/\r?\n/), topics: detectTopics(source) });

  const bugs = questions.filter((q) => q.group === "bug");
  const repair = bugs.find((q) => q.kind === "repair" && q.edit);
  const explainer = bugs.find((q) => q.kind === "explain");
  const diff = repair ? diffFromRepair(source, repair) : null;
  // Prefer the "explain" question's reason: it's a full sentence about the error. A repair's
  // explanation is written to follow its quiz prompt, so it can read like a fragment on its own.
  const reason = strip(explainer?.explanation ?? repair?.explanation ?? "");

  return { error, errorLine: result.error_line, reason, diff };
}
