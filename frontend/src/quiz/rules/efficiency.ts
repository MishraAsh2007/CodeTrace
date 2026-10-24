// efficiency.ts: Big-O questions, backed by how many times lines actually ran in this trace.

import {
  IDENT,
  choices,
  code,
  enclosingHeaders,
  enclosingLoop,
  frameId,
  heapOf,
  hitsOf,
  isLoopHeader,
  lengthOf,
  lookup,
  make,
  nextCodeLine,
  textAt,
  type Ctx,
  type Question,
} from "../core";

/** Inner-loop body runs ~n²/2 times or more for n outer iterations: quadratic growth. */
function nestedLoopQuestion(ctx: Ctx): Question | null {
  for (let L = 1; L <= ctx.lines.length; L++) {
    if (!isLoopHeader(ctx, L)) continue;
    const outer = enclosingHeaders(ctx, L).find((h) => isLoopHeader(ctx, h));
    if (!outer || enclosingLoop(ctx, outer)) continue;
    const inner = nextCodeLine(ctx, L);
    const first = ctx.trace.findIndex((s) => s.event === "step_line" && s.line === outer);
    if (!inner || first < 0) continue;
    const fid = frameId(ctx.trace[first]);
    // A for-header is re-checked once per pass plus once at the end, so passes = hits - 1.
    const n = Math.max(1, hitsOf(ctx, outer, fid).length - 1);
    const total = hitsOf(ctx, inner, fid).length;
    if (n < 3 || total < (n * (n - 1)) / 2) continue;
    return make(
      {
        id: "nested-loops",
        kind: "explain",
        group: "efficiency",
        score: 68,
        concept: "nested-loops",
        title: "Loops inside loops",
        context: `The loop on line ${outer} ran ${n} times, and for each of those the loop on line ${L} ran again: line ${inner} ran ${total} times in all.`,
        prompt: `If the input were twice as big (${2 * n} items), about how many times would line ${inner} run?`,
        explanation: `Each extra item adds a whole pass of the inner loop, so the work grows with n × n. That's O(n²): doubling the input roughly quadruples the work (here about ${total * 4} instead of ${total}).`,
        hints: ["How many inner passes happen for each outer pass?", "What happens to n × n when n doubles?"],
        step: first,
        focusLine: L,
      },
      [`About ${total * 4} (4×): nested loops grow like n²`, `About ${total * 2} (2×): the work grows like n`, `About ${total}: the inner loop doesn't depend on n`],
      0,
    );
  }
  return null;
}

/** `x in some_list` inside a loop: a linear scan each time. */
function membershipQuestion(ctx: Ctx): Question | null {
  const re = new RegExp(`\\b(?:not\\s+)?in\\s+(${IDENT})\\b(?!\\s*\\()`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const text = textAt(ctx, L);
    if (/^for\b/.test(text)) continue;
    const m = text.match(re);
    if (!m || !enclosingLoop(ctx, L)) continue;
    const hits = hitsOf(ctx, L);
    if (hits.length < 3) continue;
    const last = ctx.trace[hits[hits.length - 1]];
    const obj = heapOf(last, lookup(last, m[1]));
    if (obj?.[0] !== "LIST") continue;
    const n = lengthOf(last, lookup(last, m[1])) ?? 0;
    if (n < 2) continue;
    return make(
      {
        id: "list-membership",
        kind: "explain",
        group: "efficiency",
        score: 72,
        concept: "list-membership",
        title: "Searching a list, over and over",
        context: `Line ${L} (${code(text)}) runs ${hits.length} times, and each time it checks whether a value is in the list ${code(m[1])} (${n} items by the end).`,
        prompt: `How long does one ${code(`in ${m[1]}`)} check take when ${code(m[1])} is a list of n items?`,
        explanation: `A list has to be checked item by item, so ${code("in")} is O(n), and doing it inside a loop makes the whole thing O(n²). A ${code("set")} finds items by hashing, so ${code(`x in some_set`)} is O(1) on average. Keep a set alongside the list (or instead of it) for membership checks.`,
        hints: ["Does Python know where an item is in a list without looking?", "Which built-in type is made for fast membership tests?"],
        step: hits[0],
        focusLine: L,
      },
      ["O(n): it may compare against every item; a set makes it O(1)", "O(1): Python jumps straight to the item", "O(log n): lists are kept sorted"],
      0,
    );
  }
  return null;
}

/** `lst.pop(0)` in a loop: every pop shifts the rest of the list. */
function popFrontQuestion(ctx: Ctx): Question | null {
  const re = new RegExp(`\\b(${IDENT})\\.pop\\(0\\)`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const m = textAt(ctx, L).match(re);
    if (!m) continue;
    const hits = hitsOf(ctx, L);
    if (hits.length < 3) continue;
    return make(
      {
        id: "list-pop-front",
        kind: "explain",
        group: "efficiency",
        score: 66,
        concept: "list-pop-front",
        title: "Taking from the front",
        context: `Line ${L} (${code(textAt(ctx, L))}) ran ${hits.length} times.`,
        prompt: `Why can ${code(`${m[1]}.pop(0)`)} get slow when ${code(m[1])} is long?`,
        explanation: `Lists store items side by side, so removing the first one shifts every other item left: O(n) per pop. ${code("collections.deque")} is built for this: ${code(".popleft()")} is O(1).`,
        hints: ["What happens to the other items when the first one is removed?"],
        step: hits[0],
        focusLine: L,
      },
      [
        `Every remaining item shifts one place left, so each pop is O(n); ${code("deque.popleft()")} is O(1)`,
        "It isn't slow: pop(0) and pop() take the same time",
        "pop(0) copies the whole list into a new one but leaves the original unchanged",
      ],
      0,
    );
  }
  return null;
}

/** `s += piece` on a string inside a loop. */
function stringBuildingQuestion(ctx: Ctx): Question | null {
  const re = new RegExp(`^(${IDENT})\\s*\\+=\\s*.+$`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const m = textAt(ctx, L).match(re);
    if (!m || !enclosingLoop(ctx, L)) continue;
    const hits = hitsOf(ctx, L);
    if (hits.length < 4 || typeof lookup(ctx.trace[hits[0]], m[1]) !== "string") continue;
    return make(
      {
        id: "string-building",
        kind: "explain",
        group: "efficiency",
        score: 56,
        concept: "string-building",
        title: "Building a string",
        context: `Line ${L} (${code(textAt(ctx, L))}) adds to the string ${code(m[1])} ${hits.length} times.`,
        prompt: "Which approach avoids re-copying the growing string on every pass?",
        explanation: `Strings are immutable, so ${code(`${m[1]} += ...`)} creates a new string each time, which can mean copying everything built so far. Appending pieces to a list and calling ${code("''.join(pieces)")} once at the end copies each character only once.`,
        hints: ["Can a string be changed in place?"],
        step: hits[0],
        focusLine: L,
      },
      [`Collect the pieces in a list and call ${code("''.join(pieces)")} once at the end`, `Write ${code(`${m[1]} = ${m[1]} + ...`)} instead of ${code("+=")}`, "Convert the string to a list of numbers first"],
      0,
    );
  }
  return null;
}

/** Sorting inside a loop: n log n work on every pass. */
function sortInLoopQuestion(ctx: Ctx): Question | null {
  for (let L = 1; L <= ctx.lines.length; L++) {
    const text = textAt(ctx, L);
    if (!/\bsorted\(|\.sort\(\)/.test(text) || !enclosingLoop(ctx, L)) continue;
    const hits = hitsOf(ctx, L);
    if (hits.length < 2) continue;
    return make(
      {
        id: "sort-in-loop",
        kind: "explain",
        group: "efficiency",
        score: 60,
        concept: "sort-in-loop",
        title: "Sorting again and again",
        context: `Line ${L} (${code(text)}) sorts inside a loop: it ran ${hits.length} times.`,
        prompt: "What's the cost of sorting on every pass of a loop that runs n times?",
        explanation: "One sort of n items is O(n log n). Doing it on each of n passes costs O(n² log n). If the data doesn't change between passes, sort once before the loop; if you only need the smallest item each time, a heap (`heapq`) is cheaper.",
        hints: ["Does the list change between passes?"],
        step: hits[0],
        focusLine: L,
      },
      choices("About n × (n log n): sort once before the loop if you can", "The same as sorting once: Python remembers the sorted order", "O(n): sorting an already-sorted list is free")!,
      0,
    );
  }
  return null;
}

export function efficiencyQuestions(ctx: Ctx): Question[] {
  return [nestedLoopQuestion(ctx), membershipQuestion(ctx), popFrontQuestion(ctx), stringBuildingQuestion(ctx), sortInLoopQuestion(ctx)].filter((q): q is Question => !!q);
}
