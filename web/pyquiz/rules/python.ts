// python.ts: basic-Python questions, only when the trace shows the behavior actually happening.
// Mutable default arguments, functions that return None, / vs //, slicing.

import type { Encoded } from "../types.ts";
import { isRef, primitiveText, same } from "../model.ts";
import {
  IDENT,
  asNumber,
  choices,
  code,
  currentFrame,
  defLine,
  frameName,
  heapOf,
  isPrimitive,
  itemsOf,
  lookup,
  make,
  nextInFrame,
  pyText,
  returnsValue,
  textAt,
  type Ctx,
  type Question,
} from "../core.ts";

/** `def f(x, acc=[])` called twice: the second call starts with the first call's list. */
export function mutableDefaultQuestions(ctx: Ctx): Question[] {
  for (let i = 0; i < ctx.trace.length; i++) {
    const step = ctx.trace[i];
    for (const [id, obj] of Object.entries(step.heap ?? {})) {
      if (obj[0] !== "FUNCTION" || !Array.isArray(obj[3])) continue;
      const fn = String(obj[1]).replace(/\(.*$/, "");
      for (const [param, dv] of obj[3] as [string, Encoded][]) {
        const kind = heapOf(step, dv)?.[0];
        if (!isRef(dv) || !(kind === "LIST" || kind === "DICT" || kind === "SET")) continue;
        // Calls where the parameter IS the shared default object.
        const callsUsingDefault = ctx.trace
          .map((s, k) => ({ s, k }))
          .filter(({ s }) => s.event === "call" && frameName(s) === fn && same(currentFrame(s)?.encoded_locals?.[param], dv));
        if (callsUsingDefault.length < 2) continue;
        const second = callsUsingDefault[1];
        const startsWith = pyText(second.s, dv);
        const empty = kind === "LIST" ? "[]" : kind === "DICT" ? "{}" : "set()";
        if (startsWith === empty) continue;
        const def = defLine(ctx, fn);
        const args = (currentFrame(second.s)?.ordered_varnames ?? [])
          .filter((n) => n !== param)
          .map((n) => primitiveText(currentFrame(second.s)!.encoded_locals[n]))
          .join(", ");
        void id;
        return [
          make(
            {
              id: "mutable-default",
              kind: "predict",
              group: "pitfall",
              score: 88,
              concept: "mutable-default",
              title: "A default that remembers",
              context: `Line ${def} reads ${code(textAt(ctx, def))}. The program calls ${code(fn)} more than once without passing ${code(param)}.`,
              prompt: `When the second call ${code(`${fn}(${args})`)} starts, what is ${code(param)}?`,
              explanation: `${code(`${param}=${empty}`)} is evaluated once, when ${code("def")} runs, so every call that doesn't pass ${code(param)} shares that same object. The second call starts with ${code(startsWith)}, left over from the first call. The usual fix: ${code(`${param}=None`)}, then ${code(`if ${param} is None: ${param} = ${empty}`)} inside the function.`,
              hints: [`Look at the ${code(fn)} function card: its default is an object in the diagram.`, "When is a default value created: at each call, or once?"],
              step: second.k,
              focusLine: def,
            },
            [code(startsWith), `${code(empty)}, a fresh empty one`, code("None")],
            0,
          ),
        ];
      }
    }
  }
  return [];
}

/** `x = f(...)` where `f` has no `return`, so `x` is None (even if nothing crashed). */
export function returnsNoneQuestions(ctx: Ctx): Question[] {
  for (let i = 0; i < ctx.trace.length; i++) {
    const a = ctx.trace[i];
    if (a.event !== "step_line") continue;
    const m = textAt(ctx, a.line).match(new RegExp(`^(${IDENT})\\s*=\\s*(${IDENT})\\((.*)\\)$`));
    if (!m) continue;
    const [, target, fn] = m;
    if (!defLine(ctx, fn) || returnsValue(ctx, fn)) continue;
    const j = nextInFrame(ctx, i);
    if (j < 0 || lookup(ctx.trace[j], target) !== null) continue;
    // What the function printed or built (the value they probably meant to return).
    const ret = ctx.trace.findIndex((s, k) => k > i && s.event === "return" && frameName(s) === fn);
    const f = ret >= 0 ? currentFrame(ctx.trace[ret]) : undefined;
    const names = (f?.ordered_varnames ?? []).filter((n) => n !== "__return__");
    const built = names.length ? f!.encoded_locals[names[names.length - 1]] : undefined;
    const meant = built !== undefined ? pyText(ctx.trace[ret], built) : null;
    const printedNone = /(^|\n)None(\n|$)/.test(ctx.result.stdout) || /\bNone\b/.test(ctx.result.stdout);
    const def = defLine(ctx, fn);
    return [
      make(
        {
          id: "returns-none-latent",
          kind: "predict",
          group: "pitfall",
          score: printedNone ? 87 : 72,
          concept: "returns-none",
          title: "What comes back?",
          context: `Line ${a.line} reads ${code(textAt(ctx, a.line))}. ${code(`def ${fn}`)} (line ${def}) has no ${code("return")} statement.`,
          prompt: `What will ${code(target)} hold after line ${a.line} runs?`,
          explanation: `A function without ${code("return")} gives back None, no matter what it computed or printed inside. ${meant ? `${code(fn)} built ${code(meant)}, but never returned it. ` : ""}Add ${code("return <value>")} at the end of ${code(fn)}.`,
          hints: [`Read ${code(`def ${fn}`)}. Which line hands a value back?`, "Printing a value isn't the same as returning it."],
          step: i,
          focusLine: def,
        },
        choices(code("None"), meant && code(meant), "An error, because the function has no return", code("0"))!,
        0,
      ),
    ];
  }
  return [];
}

/** `x = a / b` with ints: the result is a float (and `//` would round down). */
export function divisionQuestions(ctx: Ctx): Question[] {
  const re = new RegExp(`^(${IDENT})\\s*=\\s*(${IDENT}|\\d+)\\s*(/|//)\\s*(${IDENT}|\\d+)$`);
  for (let i = 0; i < ctx.trace.length; i++) {
    const a = ctx.trace[i];
    if (a.event !== "step_line") continue;
    const m = textAt(ctx, a.line).match(re);
    if (!m) continue;
    const [, target, l, op, r] = m;
    const lv = /^\d+$/.test(l) ? Number(l) : asNumber(lookup(a, l));
    const rv = /^\d+$/.test(r) ? Number(r) : asNumber(lookup(a, r));
    if (lv === undefined || rv === undefined || !Number.isInteger(lv) || !Number.isInteger(rv) || rv === 0) continue;
    const j = nextInFrame(ctx, i);
    if (j < 0) continue;
    const got = lookup(ctx.trace[j], target);
    if (got === undefined || !isPrimitive(got)) continue;
    const shown = primitiveText(got);
    const exact = lv / rv;
    const floor = Math.floor(exact);
    if (op === "/" && Number.isInteger(exact) && shown !== `${exact}.0`) continue;
    if (op === "//" && shown !== String(floor)) continue;
    if (op === "//" && Number.isInteger(exact)) continue; // nothing to learn when it divides evenly
    const correct = shown;
    const opts =
      op === "/"
        ? choices(correct, String(floor), Number.isInteger(exact) ? String(exact) : String(Math.round(exact)), String(floor + 1))
        : choices(correct, String(exact), String(floor + 1), `${floor}.0`);
    if (!opts) continue;
    return [
      make(
        {
          id: `division-${op === "/" ? "true" : "floor"}`,
          kind: "predict",
          group: "basics",
          score: 55,
          concept: "division",
          title: op === "/" ? "/ always gives a float" : "// rounds down",
          context: `Paused before line ${a.line}: ${code(textAt(ctx, a.line))}. ${code(`${l} ${op} ${r}`)} is ${code(`${lv} ${op} ${rv}`)}.`,
          prompt: `What will ${code(target)} be after this line runs?`,
          explanation:
            op === "/"
              ? `In Python 3, ${code("/")} always gives a float: ${code(`${lv} / ${rv}`)} is ${correct}${Number.isInteger(exact) ? ", not " + exact : ""}. Use ${code("//")} when you want a whole number (rounded down).`
              : `${code("//")} is floor division: it rounds down to a whole number, so ${code(`${lv} // ${rv}`)} is ${correct}. ${code("/")} would give ${exact}.`,
          hints: [op === "/" ? "Does / ever give a whole-number int in Python 3?" : "Does // keep the fractional part?"],
          step: i,
          focusLine: a.line,
        },
        opts,
        0,
      ),
    ];
  }
  return [];
}

function pySlice<T>(xs: T[], start: number | undefined, stop: number | undefined, stepV: number): T[] {
  const n = xs.length;
  const norm = (v: number | undefined, def: number) => (v === undefined ? def : v < 0 ? Math.max(n + v, stepV < 0 ? -1 : 0) : Math.min(v, stepV < 0 ? n - 1 : n));
  const out: T[] = [];
  if (stepV > 0) {
    for (let i = norm(start, 0); i < norm(stop, n); i += stepV) out.push(xs[i]);
  } else {
    for (let i = norm(start, n - 1); i > norm(stop, -1); i += stepV) out.push(xs[i]);
  }
  return out;
}

/** `x = y[a:b]`: predict the slice (off-by-one practice). */
export function sliceQuestions(ctx: Ctx): Question[] {
  const re = new RegExp(`^(${IDENT})\\s*=\\s*(${IDENT})\\[\\s*(-?\\w*)\\s*:\\s*(-?\\w*)\\s*(?::\\s*(-?\\d+)\\s*)?\\]$`);
  for (let i = 0; i < ctx.trace.length; i++) {
    const a = ctx.trace[i];
    if (a.event !== "step_line") continue;
    const m = textAt(ctx, a.line).match(re);
    if (!m) continue;
    const [, target, src, sA, sB, sStep] = m;
    const v = lookup(a, src);
    const isStr = typeof v === "string";
    const items: Encoded[] | null = isStr ? [...(v as string)] : itemsOf(a, v);
    if (!items || items.length < 3 || !items.every(isPrimitive)) continue;
    const num = (s: string) => (s === "" ? undefined : /^-?\d+$/.test(s) ? Number(s) : asNumber(lookup(a, s)));
    const start = num(sA);
    const stop = num(sB);
    const stepV = sStep ? Number(sStep) : 1;
    if ((sA && start === undefined) || (sB && stop === undefined) || stepV === 0) continue;
    const show = (xs: Encoded[]) => (isStr ? `'${xs.join("")}'` : `[${xs.map((x) => primitiveText(x)).join(", ")}]`);
    const expected = pySlice(items, start, stop, stepV);
    const j = nextInFrame(ctx, i);
    if (j < 0) continue;
    const got = lookup(ctx.trace[j], target);
    const gotText = typeof got === "string" ? `'${got}'` : pyText(ctx.trace[j], got);
    if (gotText !== show(expected)) continue;
    const plusOne = pySlice(items, start, stop === undefined ? undefined : stop + 1, stepV);
    const fromNext = pySlice(items, start === undefined ? 1 : start + 1, stop, stepV);
    const full = pySlice(items, undefined, undefined, stepV);
    const opts = choices(code(show(expected)), code(show(plusOne)), code(show(fromNext)), code(show(full)));
    if (!opts) continue;
    const sliceText = `${src}[${sA}:${sB}${sStep ? `:${sStep}` : ""}]`;
    return [
      make(
        {
          id: `slice-${i}`,
          kind: "predict",
          group: "basics",
          score: 58,
          concept: "slicing",
          title: "Read the slice",
          context: `Paused before line ${a.line}: ${code(textAt(ctx, a.line))}. ${code(src)} is ${code(show(items))}.`,
          prompt: `What will ${code(target)} be after this line runs?`,
          explanation: `${code(sliceText)} starts at index ${start ?? (stepV > 0 ? 0 : "the end")} and stops before ${stop === undefined ? "the end" : `index ${stop}`}${stepV !== 1 ? `, stepping by ${stepV}` : ""}: the stop index itself is never included. That gives ${code(show(expected))}.`,
          hints: ["Number the items from 0.", "Is the stop index included?"],
          step: i,
          focusLine: a.line,
        },
        opts,
        0,
      ),
    ];
  }
  return [];
}
