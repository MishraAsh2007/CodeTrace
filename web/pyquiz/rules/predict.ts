// predict.ts: "what happens next?" questions grounded in recorded values.

import type { Encoded, TraceStep } from "../types.ts";
import { isInstance, isRef, liveFrames, primitiveText, same } from "../model.ts";
import {
  CHAIN,
  IDENT,
  NUMBER,
  PY_WORDS,
  asNumber,
  blockEnd,
  choices,
  code,
  currentFrame,
  defLine,
  describe,
  enclosingLoop,
  evalChain,
  frameId,
  frameName,
  indentOf,
  lookup,
  make,
  nextCodeLine,
  operand,
  pyText,
  textAt,
  type Ctx,
  type Question,
} from "../core.ts";

/** `current = current.next`: where does the pointer go? Prefers the step where it becomes None. */
export function pointerPredict(ctx: Ctx): Question | null {
  const assign = new RegExp(`^(${IDENT})\\s*=\\s*(${CHAIN})$`);
  type Pick = { i: number; target: string; rhs: string; before: Encoded | undefined; after: Encoded };
  let pick: Pick | null = null;
  const score = (p: Pick) => (p.rhs.includes(".") ? 2 : 0) + (p.after === null ? 1 : 0);
  for (let i = 0; i < ctx.trace.length - 1; i++) {
    const a = ctx.trace[i];
    const b = ctx.trace[i + 1];
    if (a.event !== "step_line" || frameId(a) !== frameId(b)) continue;
    const m = textAt(ctx, a.line).match(assign);
    if (!m || m[1] === m[2] || PY_WORDS.has(m[2])) continue;
    const after = lookup(b, m[1]);
    // Only object pointers (nodes); list/dict assignments have their own questions.
    if (after === undefined || !(after === null || (isRef(after) && isInstance(b.heap?.[String(after[1])] ?? ["x"])))) continue;
    const expected = evalChain(a, m[2]);
    if (expected === undefined || !same(expected, after)) continue;
    const cand: Pick = { i, target: m[1], rhs: m[2], before: lookup(a, m[1]), after };
    if (!pick || score(cand) > score(pick)) pick = cand;
    if (score(pick) === 3) break;
  }
  if (!pick) return null;
  const { i, target, rhs, before, after } = pick;
  const a = ctx.trace[i];
  const parts = rhs.split(".");
  const base = parts[0];
  const parent = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  const correct = describe(a, after);
  const opts = choices(
    correct,
    before !== undefined ? describe(a, before) : undefined,
    parent ? describe(a, evalChain(a, parent)) : undefined,
    after === null ? undefined : "None",
    "An AttributeError is raised",
  );
  if (!opts) return null;
  const text = textAt(ctx, a.line);
  return make(
    {
      id: `pointer-${i}`,
      kind: "predict",
      group: "predict",
      score: 55,
      concept: "pointers",
      title: "Predict the pointer",
      context: `Paused before line ${a.line}: ${code(text)}.` + (parent ? ` ${code(parent)} is ${describe(a, evalChain(a, parent))}.` : ""),
      prompt: `What will ${code(target)} refer to after this line runs?`,
      explanation: parent
        ? `${code(rhs)} reads the ${code(parts[parts.length - 1])} field of ${describe(a, evalChain(a, parent))}, which is ${correct}. Assignment copies that reference into ${code(target)}${after === null ? ", so the next loop check sees None" : ""}.`
        : `Assignment copies the reference in ${code(rhs)} into ${code(target)}: both now point to ${correct}.`,
      hints: parent
        ? [`Find ${code(base)} in the diagram and follow its ${code(parts[parts.length - 1])} arrow.`, "Assignment copies a reference; it doesn't copy the node."]
        : ["Assignment copies a reference; it doesn't copy the object."],
      step: i,
      focusLine: a.line,
    },
    opts,
    0,
  );
}

/** `if val < root.val:` with recorded values: which line runs next? (In a BST: left or right?) */
export function branchPredict(ctx: Ctx): Question | null {
  const re = new RegExp(`^(?:if|elif|while)\\s+(${CHAIN}(?:\\[${IDENT}\\])?|${NUMBER})\\s*(<=|<|>=|>|==|!=)\\s*(${CHAIN}(?:\\[${IDENT}\\])?|${NUMBER}):$`);
  type Cand = { i: number; line: number; left: string; op: string; right: string; l: number; r: number; truth: boolean };
  const value = (step: TraceStep, expr: string) => {
    const idx = expr.match(new RegExp(`^(${IDENT})\\[(${IDENT})\\]$`));
    if (!idx) return operand(step, expr);
    const list = lookup(step, idx[1]);
    const k = asNumber(lookup(step, idx[2]));
    const obj = isRef(list) ? step.heap?.[String(list[1])] : undefined;
    if (!obj || obj[0] !== "LIST" || k === undefined) return undefined;
    const v = obj[k + 1];
    return typeof v === "number" ? v : undefined;
  };
  const cands: Cand[] = [];
  for (let i = 0; i < ctx.trace.length - 1; i++) {
    const a = ctx.trace[i];
    const b = ctx.trace[i + 1];
    if (a.event !== "step_line" || b.event !== "step_line" || frameId(a) !== frameId(b)) continue;
    const text = textAt(ctx, a.line);
    if (text.startsWith("while")) continue; // while loops are covered by loop-count questions
    const m = text.match(re);
    if (!m) continue;
    const l = value(a, m[1]);
    const r = value(a, m[3]);
    if (l === undefined || r === undefined) continue;
    const op = m[2];
    const truth = op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : op === ">=" ? l >= r : op === "==" ? l === r : l !== r;
    const ranBody = b.line > a.line && b.line <= blockEnd(ctx, a.line);
    if (truth !== ranBody) continue;
    cands.push({ i, line: a.line, left: m[1], op, right: m[3], l, r, truth });
  }
  if (!cands.length) return null;
  const c = cands[Math.floor(cands.length / 2)];
  const end = blockEnd(ctx, c.line);
  const header = indentOf(ctx.lines[c.line - 1]);
  const bodyLine = nextCodeLine(ctx, c.line);
  const afterLine = nextCodeLine(ctx, end);
  const afterRaw = afterLine ? ctx.lines[afterLine - 1] : "";
  const hasElse = !!afterLine && indentOf(afterRaw) === header && /^(else|elif)\b/.test(afterRaw.trim());
  const otherLine = hasElse && /^else\s*:/.test(afterRaw.trim()) ? nextCodeLine(ctx, afterLine) : afterLine;
  if (!bodyLine || !otherLine) return null;
  const body = ctx.lines.slice(c.line, end).join("\n");
  const tree = ctx.topics.has("tree") && /\.(left|right)\b/.test(body);
  const side = /\.left\b/.test(body) ? (c.truth ? "left" : "right") : c.truth ? "right" : "left";
  const cmp = `${c.l} ${c.op} ${c.r}`;
  const named = [c.left, c.right].filter((x) => !new RegExp(`^${NUMBER}$`).test(x));
  const values = named.map((x) => `${code(x)} is ${x === c.left ? c.l : c.r}`).join(" and ");
  const show = (n: number) => `line ${n}: ${code(textAt(ctx, n))}`;
  return make(
    {
      id: `branch-${c.i}`,
      kind: "predict",
      group: "predict",
      score: tree ? 60 : 45,
      concept: "branching",
      title: tree ? "Which way does it go?" : "Predict the branch",
      context: `Paused before line ${c.line}: ${code(textAt(ctx, c.line))}.${values ? ` ${values}.` : ""}`,
      prompt: "Which line runs next?",
      explanation:
        `${cmp} is ${c.truth ? "True" : "False"}, so Python ${c.truth ? "runs the indented block under the if" : hasElse ? "skips the if-block and runs the else-block" : "skips the if-block"}.` +
        (tree ? ` In a binary search tree, that sends the value into the ${side} subtree.` : ""),
      hints: ["Plug the recorded values into the condition.", tree ? "Smaller values go one way, larger ones the other." : "Exactly one branch of an if/else runs."],
      step: c.i,
      focusLine: c.line,
    },
    [`The if-branch, ${show(bodyLine)}`, `${hasElse ? "The else-branch" : "The code after the if"}, ${show(otherLine)}`, "Both, one after the other"],
    c.truth ? 0 : 1,
  );
}

/** What does `f(3)` return? Picks the middle of a recursive chain. */
export function returnPredict(ctx: Ctx): Question | null {
  type Call = { callStep: number; value: Encoded; args: Encoded[] };
  const byFunc = new Map<string, Call[]>();
  ctx.trace.forEach((s) => {
    if (s.event !== "return") return;
    const f = currentFrame(s);
    if (!f) return;
    const value = f.encoded_locals?.__return__;
    if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string") return;
    const callStep = ctx.trace.findIndex((t) => t.event === "call" && currentFrame(t)?.frame_id === f.frame_id);
    if (callStep < 0) return;
    const cf = currentFrame(ctx.trace[callStep])!;
    const args = (cf.ordered_varnames ?? []).filter((n) => n in cf.encoded_locals).map((n) => cf.encoded_locals[n]);
    if (!args.length || args.some((v) => isRef(v) || Array.isArray(v))) return;
    byFunc.set(f.func_name, [...(byFunc.get(f.func_name) ?? []), { callStep, value, args }]);
  });
  const [name, calls] = [...byFunc.entries()].sort((x, y) => y[1].length - x[1].length)[0] ?? [];
  if (!name || !calls) return null;
  const idx = Math.floor(calls.length / 2);
  const pick = calls[idx];
  const deeper = calls[idx - 1];
  const callText = `${name}(${pick.args.map(primitiveText).join(", ")})`;
  const value = primitiveText(pick.value);
  const num = asNumber(pick.value);
  const opts = choices(
    value,
    deeper ? primitiveText(deeper.value) : undefined,
    num !== undefined ? String(num + 1) : undefined,
    num !== undefined ? String(num - 1) : undefined,
    typeof pick.value === "boolean" ? (pick.value ? "False" : "True") : undefined,
    typeof pick.value === "boolean" ? "None" : undefined,
    ...pick.args.map(primitiveText),
  );
  if (!opts) return null;
  const recursive = calls.length >= 3;
  return make(
    {
      id: `return-${pick.callStep}`,
      kind: "predict",
      group: "predict",
      score: recursive ? 55 : 45,
      concept: recursive ? "recursion" : "return-values",
      title: "Predict a return value",
      context: `${code(callText)} is one of ${calls.length} call${calls.length === 1 ? "" : "s"} to ${code(name)} in this run.` + (recursive ? " Each call has its own frame with its own arguments." : ""),
      prompt: `What does ${code(callText)} return?`,
      explanation: `In this run, ${code(callText)} returned ${value}` + (deeper ? ` after the deeper call returned ${primitiveText(deeper.value)}.` : ".") + " Step forward from here to watch the frames return in reverse order.",
      hints: recursive ? ["Work outward from the base case.", "What does the deeper call return first, and what does this call do with it?"] : ["Read the function body with these argument values."],
      step: pick.callStep,
      focusLine: defLine(ctx, name) || undefined,
    },
    opts,
    0,
  );
}

/** How many frames of a recursive function are on the stack at once, at the deepest point? */
export function recursionDepthPredict(ctx: Ctx): Question | null {
  if (ctx.result.status === "step_limit") return null;
  let best = { name: "", depth: 0, step: -1 };
  ctx.trace.forEach((s, i) => {
    const counts = new Map<string, number>();
    for (const f of liveFrames(s)) counts.set(f.func_name, (counts.get(f.func_name) ?? 0) + 1);
    for (const [name, n] of counts) if (n > best.depth) best = { name, depth: n, step: i };
  });
  if (best.depth < 3) return null;
  const first = ctx.trace.findIndex((s) => liveFrames(s).some((f) => f.func_name === best.name));
  const opts = choices(String(best.depth), String(best.depth - 1), String(best.depth + 1));
  if (!opts || first < 0) return null;
  return make(
    {
      id: "recursion-depth",
      kind: "predict",
      group: "predict",
      score: 55,
      concept: "recursion-depth",
      title: "How deep does it go?",
      context: `${code(best.name)} calls itself. Every call that has started but not returned keeps its own frame on the call stack.`,
      prompt: `At the deepest point of this run, how many ${code(best.name)} frames are on the stack at once?`,
      explanation: `The trace peaks at ${best.depth} ${code(best.name)} frames (step ${best.step + 1}): one per active call, from the first call down to the deepest one. Step there and count the frame cards to check.`,
      hints: ["Each call stays on the stack until it returns.", "Which call is the first one that doesn't recurse?"],
      step: first,
      focusLine: defLine(ctx, best.name) || undefined,
    },
    opts,
    0,
  );
}

/** How many times does a (non-nested) loop body run? */
export function loopCountPredict(ctx: Ctx): Question | null {
  if (ctx.result.status !== "ok") return null;
  for (let L = 1; L <= ctx.lines.length; L++) {
    const raw = textAt(ctx, L);
    if (!/^(for|while)\b.*:$/.test(raw) || enclosingLoop(ctx, L)) continue;
    const own = indentOf(ctx.lines[L - 1]);
    const bodyLine = nextCodeLine(ctx, L);
    if (!bodyLine || indentOf(ctx.lines[bodyLine - 1]) <= own) continue;
    const firstHit = ctx.trace.findIndex((s) => s.event === "step_line" && s.line === L);
    if (firstHit < 0) continue;
    const fid = frameId(ctx.trace[firstHit]);
    // One pass = the header runs, then the first body line runs. (Counting body-line hits alone
    // over-counts when the body starts with an inner loop, whose header re-runs every inner pass.)
    let count = 0;
    for (let i = 1; i < ctx.trace.length; i++) {
      const s = ctx.trace[i];
      const prev = ctx.trace[i - 1];
      if (s.event === "step_line" && s.line === bodyLine && frameId(s) === fid && prev.line === L && frameId(prev) === fid) count++;
    }
    if (count < 2 || count > 30) continue;
    const fn = frameName(ctx.trace[firstHit]);
    const opts = choices(String(count), String(count + 1), String(count - 1));
    if (!opts) continue;
    return make(
      {
        id: `loop-count-${L}`,
        kind: "predict",
        group: "predict",
        score: 50,
        concept: "loop-count",
        title: "Count the iterations",
        context: `Line ${L} reads ${code(raw)}.${fn !== "<module>" ? ` This is the first time ${code(`${fn}()`)} runs.` : ""}`,
        prompt: `How many times will the loop body (starting at line ${bodyLine}) run?`,
        explanation: `The trace shows line ${bodyLine} running ${count} times before the loop ended: one pass per value of the loop variable, or per time the condition was True.`,
        hints: ["List the values the loop variable takes, one per pass.", "Does the range include its end value? Does a slice like [1:] skip anything?"],
        step: firstHit,
        focusLine: L,
      },
      opts,
      0,
    );
  }
  return null;
}

/** Two names, one list/dict/object: a change through one name shows up through the other. */
export function aliasQuestion(ctx: Ctx): Question | null {
  // Strongest version: a mutation through one name, then predict what the other name shows.
  const mutate = new RegExp(`^(${IDENT})(?:\\.(append|extend|insert|pop|remove|clear|sort|reverse)\\(.*\\)|\\[.+\\]\\s*=.+|\\.${IDENT}\\s*=.+)$`);
  for (let i = 0; i < ctx.trace.length - 1; i++) {
    const a = ctx.trace[i];
    if (a.event !== "step_line") continue;
    const m = textAt(ctx, a.line).match(mutate);
    if (!m) continue;
    const writer = m[1];
    const ref = lookup(a, writer);
    if (!isRef(ref)) continue;
    const f = currentFrame(a);
    const scope: Record<string, Encoded> = { ...(a.globals ?? {}), ...(f?.encoded_locals ?? {}) };
    const reader = Object.keys(scope).find((n) => n !== writer && !n.startsWith("__") && isRef(scope[n]) && same(scope[n], ref));
    if (!reader) continue;
    const j = i + 1 < ctx.trace.length ? i + 1 : -1;
    if (j < 0) continue;
    const before = pyText(a, ref);
    const after = pyText(ctx.trace[j], ref);
    if (before === after || after.length > 60) continue;
    const opts = choices(after, before, "An error: the two names now point to different objects");
    if (!opts) continue;
    return make(
      {
        id: `alias-${i}`,
        kind: "predict",
        group: "basics",
        score: 70,
        concept: "aliasing",
        title: "Two names, one object",
        context: `Paused before line ${a.line}: ${code(textAt(ctx, a.line))}. ${code(writer)} and ${code(reader)} point to the same object, which is ${code(before)}.`,
        prompt: `After this line runs, what will ${code(reader)} show?`,
        explanation: `There is only one object, with two names pointing at it. Changing it through ${code(writer)} changes what ${code(reader)} sees: ${code(after)}. To get an independent copy, use ${code(`${writer}.copy()`)} or ${code(`list(${writer})`)}.`,
        hints: ["Count the cards the two arrows point to.", "Does assignment copy the list, or the reference to it?"],
        step: i,
        focusLine: a.line,
      },
      opts,
      0,
    );
  }
  // Fallback: two names pointing at the same object.
  for (let i = 0; i < ctx.trace.length; i++) {
    const step = ctx.trace[i];
    if (step.event !== "step_line") continue;
    const f = currentFrame(step);
    const names = f ? f.ordered_varnames ?? [] : step.ordered_globals ?? [];
    const values = f ? f.encoded_locals ?? {} : step.globals ?? {};
    const seen = new Map<string, string>();
    for (const n of names) {
      const v = values[n];
      if (!isRef(v) || n.startsWith("__")) continue;
      const obj = step.heap?.[String(v[1])];
      if (!obj || !(isInstance(obj) || obj[0] === "LIST" || obj[0] === "DICT")) continue;
      const other = seen.get(String(v[1]));
      if (other) {
        return make(
          {
            id: "alias",
            kind: "explain",
            group: "predict",
            score: 45,
            concept: "aliasing",
            title: "Follow the arrows",
            context: `At step ${i + 1}, follow the arrows from ${code(other)} and ${code(n)} in the diagram.`,
            prompt: `How many objects do ${code(other)} and ${code(n)} refer to?`,
            explanation: `Both arrows end at the same card: ${describe(step, v)}. Assigning one name to another copies the reference, not the object, so a change made through ${code(n)} is visible through ${code(other)}.`,
            hints: ["Count the cards the two arrows point to."],
            step: i,
            focusLine: step.line,
          },
          ["One shared object", "Two separate copies", "None yet; objects are created when first used"],
          0,
        );
      }
      seen.set(String(v[1]), n);
    }
  }
  return null;
}

/** An int local about to change on an assignment line. */
export function statePredict(ctx: Ctx): Question | null {
  for (let i = 0; i < ctx.trace.length - 1; i++) {
    const a = ctx.trace[i];
    const b = ctx.trace[i + 1];
    if (a.event !== "step_line" || b.event !== "step_line" || frameId(a) !== frameId(b)) continue;
    const text = textAt(ctx, a.line);
    const m = text.match(new RegExp(`^(${IDENT})\\s*([-+*/%]?=)\\s*(.+)$`));
    if (!m || m[2] === "==") continue;
    const before = asNumber(lookup(a, m[1]));
    const after = asNumber(lookup(b, m[1]));
    if (before === undefined || after === undefined || before === after || !Number.isInteger(after)) continue;
    const opts = choices(String(after), String(before), String(after + 1), String(after - 1));
    if (!opts) continue;
    return make(
      {
        id: `state-${i}`,
        kind: "predict",
        group: "predict",
        score: 35,
        concept: "state-change",
        title: "Predict the next value",
        context: `Paused before line ${a.line}: ${code(text)}. ${code(m[1])} is ${before}.`,
        prompt: `What will ${code(m[1])} be after this line runs?`,
        explanation: `Evaluating the right-hand side with the values in the current frame gives ${after}, which is stored in ${code(m[1])}. Step forward to check.`,
        hints: ["Read the values the line uses from the current frame."],
        step: i,
        focusLine: a.line,
      },
      opts,
      0,
    );
  }
  return null;
}
