// dsa.ts: data structures & algorithms questions, grounded in the whole trace.
// Graph traversal (DFS/BFS), stacks/queues/heaps, sorting, binary search, repeated work and
// memoization, and dictionary counting.

import type { Encoded } from "../types.ts";
import { isRef, primitiveText, same } from "../model.ts";
import {
  IDENT,
  allVars,
  asNumber,
  choices,
  code,
  currentFrame,
  defLine,
  enclosingHeaders,
  frameId,
  heapOf,
  hitsOf,
  isLoopHeader,
  isPrimitive,
  itemsOf,
  lengthOf,
  lookup,
  make,
  nextInFrame,
  pyText,
  textAt,
  type Ctx,
  type Question,
} from "../core.ts";

const key = (v: Encoded) => primitiveText(v);
const list = (xs: string[]) => xs.join(", ");

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

interface Graph {
  name: string;
  adj: Map<string, string[]>;
}

/** A dict whose values are lists of node names: an adjacency list. */
function findGraph(ctx: Ctx): Graph | null {
  for (let i = ctx.trace.length - 1; i >= 0; i--) {
    const step = ctx.trace[i];
    for (const [name, v] of allVars(step)) {
      const obj = heapOf(step, v);
      if (obj?.[0] !== "DICT" || obj.length < 3) continue;
      const adj = new Map<string, string[]>();
      let ok = true;
      for (const [k, val] of obj.slice(1) as [Encoded, Encoded][]) {
        const items = itemsOf(step, val);
        if (!isPrimitive(k) || !items || !items.every(isPrimitive)) {
          ok = false;
          break;
        }
        adj.set(key(k), items.map(key));
      }
      if (!ok) continue;
      const nodes = new Set(adj.keys());
      const neighbors = [...adj.values()].flat();
      // Most neighbor names should themselves be keys, otherwise it's just a dict of lists.
      if (neighbors.length && neighbors.filter((n) => nodes.has(n)).length * 2 >= neighbors.length) return { name, adj };
    }
  }
  return null;
}

interface Visits {
  name: string;
  order: string[];
  /** Trace index where each node first appeared. */
  addedAt: number[];
}

/** The container that collects visited nodes, and the order nodes were added (from step-to-step diffs). */
function findVisits(ctx: Ctx, g: Graph): Visits | null {
  const nodes = new Set(g.adj.keys());
  const tracks = new Map<string, Visits & { seen: Set<string> }>();
  for (let i = 0; i < ctx.trace.length; i++) {
    const step = ctx.trace[i];
    for (const [name, v] of allVars(step)) {
      if (!isRef(v)) continue;
      const obj = heapOf(step, v);
      if (!obj || (obj[0] !== "SET" && obj[0] !== "LIST")) continue;
      if (/^(stack|queue|q|frontier|todo|neighbors?|path)$/i.test(name)) continue;
      const items = (obj.slice(1) as Encoded[]).map(key);
      if (!items.every((x) => nodes.has(x))) continue;
      const id = String(v[1]);
      const t = tracks.get(id) ?? { name, order: [], addedAt: [], seen: new Set<string>() };
      for (const x of items) {
        if (!t.seen.has(x)) {
          t.seen.add(x);
          t.order.push(x);
          t.addedAt.push(i);
        }
      }
      tracks.set(id, t);
    }
  }
  // Prefer the container the code checks membership in (`if n not in visited`), then the longest.
  const source = ctx.lines.join("\n");
  const checked = (n: string) => new RegExp(`\\bin\\s+${n}\\b`).test(source);
  const best = [...tracks.values()].sort((a, b) => Number(checked(b.name)) - Number(checked(a.name)) || b.order.length - a.order.length)[0];
  return best && best.order.length >= 3 ? best : null;
}

function simulate(g: Graph, start: string, kind: "dfs" | "bfs"): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  if (kind === "dfs") {
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      order.push(n);
      for (const m of g.adj.get(n) ?? []) visit(m);
    };
    visit(start);
  } else {
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const n = queue.shift()!;
      order.push(n);
      for (const m of g.adj.get(n) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
  }
  return order;
}

function hasCycle(g: Graph): string[] | null {
  const state = new Map<string, number>();
  const stack: string[] = [];
  let found: string[] | null = null;
  const visit = (n: string) => {
    if (found) return;
    state.set(n, 1);
    stack.push(n);
    for (const m of g.adj.get(n) ?? []) {
      if (state.get(m) === 1) {
        found = [...stack.slice(stack.indexOf(m)), m];
        return;
      }
      if (!state.has(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of g.adj.keys()) if (!state.has(n)) visit(n);
  return found;
}

export function graphQuestions(ctx: Ctx): Question[] {
  const g = findGraph(ctx);
  if (!g) return [];
  const visits = findVisits(ctx, g);
  if (!visits) return [];
  const out: Question[] = [];
  const { order, addedAt, name: vname } = visits;
  const source = ctx.lines.join("\n");
  const queueStyle = /\.popleft\(\)|\.pop\(0\)/.test(source);
  const recursive = ctx.topics.has("recursion");
  const stackStyle = !queueStyle && (recursive || /\.pop\(\)/.test(source));
  const dfs = simulate(g, order[0], "dfs");
  const bfs = simulate(g, order[0], "bfs");
  const isPrefix = (sim: string[]) => order.every((x, i) => sim[i] === x);
  const kind = queueStyle && isPrefix(bfs) ? "bfs" : stackStyle && isPrefix(dfs) ? "dfs" : null;
  const visitLine = ctx.trace[addedAt[1]]?.line;

  // 1. Predict the next node visited.
  const k = Math.min(2, order.length - 1);
  const sofar = order.slice(0, k);
  const lastNode = sofar[sofar.length - 1];
  const other = kind === "dfs" ? bfs : dfs;
  const alt = other.find((x, i) => i >= k && !sofar.includes(x) && x !== order[k]) ?? [...g.adj.keys()].find((x) => !sofar.includes(x) && x !== order[k]);
  const opts = choices(code(order[k]), alt && code(alt), code(sofar[0]) + " again", code(lastNode) + " again");
  if (opts) {
    out.push(
      make(
        {
          id: "graph-order",
          kind: "predict",
          group: "algorithm",
          score: 82,
          concept: "graph-order",
          title: "Which node is next?",
          context: `So far ${code(vname)} holds ${list(sofar.map(code))}, in that order. ${code(`${g.name}[${lastNode}]`)} is ${code(`[${(g.adj.get(lastNode) ?? []).join(", ")}]`)}.`,
          prompt: `Which node gets added to ${code(vname)} next?`,
          explanation: `The trace adds ${code(order[k])} next. ${kind === "dfs" ? `Depth-first search goes to the first unvisited neighbor of the newest node and keeps going deeper before backing up.` : kind === "bfs" ? `Breadth-first search finishes the nodes already waiting in the queue (oldest first) before moving further out.` : `Follow the code from the last node added.`} Already-visited nodes are skipped.`,
          hints: [`Look at ${code(lastNode)}'s neighbors in ${code(g.name)}.`, `Which of them are already in ${code(vname)}?`],
          step: addedAt[k - 1],
          focusLine: visitLine,
        },
        opts,
        0,
      ),
    );
  }

  // 2. Depth-first or breadth-first?
  if (kind) {
    out.push(
      make(
        {
          id: "graph-kind",
          kind: "explain",
          group: "algorithm",
          score: 78,
          concept: "graph-kind",
          title: "What kind of traversal is this?",
          context: `The run visited ${list(order.map(code))}, in that order${queueStyle ? `, taking nodes off the front of a queue` : recursive ? `, using recursion` : `, popping nodes off the end of a list`}.`,
          prompt: "Is this a depth-first or a breadth-first traversal?",
          explanation:
            kind === "dfs"
              ? `Depth-first: it follows one path as far as it can, then backs up. ${recursive ? "Recursion" : "Popping from the end of a list"} gives last-in, first-out order, which is what makes it go deep first.`
              : `Breadth-first: it visits every neighbor of a node before going one level further. Taking from the front of a queue gives first-in, first-out order.`,
          hints: ["Does it finish all of the first node's neighbors before going deeper?", queueStyle ? "Which end of the queue does it take from?" : "What order do recursive calls finish in?"],
          step: addedAt[addedAt.length - 1],
        },
        [
          "Depth-first: it follows one path as deep as it can before backing up",
          "Breadth-first: it visits all of a node's neighbors before going deeper",
          "Neither: it visits the nodes in alphabetical order",
        ],
        kind === "dfs" ? 0 : 1,
      ),
    );
  }

  // 3. Why the visited check matters.
  if (new RegExp(`\\bnot\\s+in\\s+${vname}\\b|\\bin\\s+${vname}\\s*:`).test(source)) {
    const cycle = hasCycle(g);
    const indegree = new Map<string, number>();
    for (const ns of g.adj.values()) for (const n of ns) indegree.set(n, (indegree.get(n) ?? 0) + 1);
    const shared = [...indegree.entries()].find(([, d]) => d >= 2)?.[0];
    const correct = cycle
      ? `It would go around the cycle ${cycle.map(code).join(" → ")} forever (until Python gives up)`
      : shared
        ? `${code(shared)} would be visited more than once, since more than one node links to it`
        : null;
    if (correct) {
      const checkLine = ctx.lines.findIndex((l) => new RegExp(`\\bnot\\s+in\\s+${vname}\\b|\\bin\\s+${vname}\\s*:`).test(l)) + 1;
      out.push(
        make(
          {
            id: "graph-visited",
            kind: "explain",
            group: "algorithm",
            score: 74,
            concept: "graph-visited",
            title: `Why keep ${vname}?`,
            context: `Line ${checkLine} checks ${code(vname)} before visiting a node. ${cycle ? `${code(g.name)} has a cycle: ${cycle.map(code).join(" → ")}.` : `${code(shared!)} can be reached from more than one node.`}`,
            prompt: `What would happen if the ${code(vname)} check on line ${checkLine} were removed?`,
            explanation: `Without the check, nothing remembers which nodes are done. ${cycle ? "Following edges around a cycle never runs out of nodes, so the traversal never ends." : `Every path into ${code(shared!)} would visit it again, repeating its work.`} Checking ${code(vname)} makes each node count once.`,
            hints: [cycle ? "Follow the edges starting from the first node. Do you ever come back?" : `How many arrows point into ${code(shared!)}?`],
            step: addedAt[addedAt.length - 1],
            focusLine: checkLine,
          },
          [correct, "Nothing: the order would be exactly the same", "Python would raise a KeyError"],
          0,
        ),
      );
    }
  }

  // 4. Cost.
  const V = g.adj.size;
  const E = [...g.adj.values()].reduce((s, ns) => s + ns.length, 0);
  out.push(
    make(
      {
        id: "graph-cost",
        kind: "explain",
        group: "efficiency",
        score: 64,
        concept: "graph-cost",
        title: "How much work is a traversal?",
        context: `${code(g.name)} has ${V} nodes and ${E} edges. Each node is added to ${code(vname)} once, and each node's neighbor list is read when it's visited.`,
        prompt: "How does the running time grow with the number of nodes V and edges E?",
        explanation: `Each node is visited once (V) and each edge is looked at once from its starting node (E), so the work is O(V + E). The ${code(vname)} check, a set lookup, is constant time on average.`,
        hints: ["How many times is each node visited?", "How many times is each edge looked at?"],
        step: addedAt[addedAt.length - 1],
      },
      ["O(V + E): proportional to the nodes plus the edges", "O(V × E): every node checks every edge", "O(V²) no matter how many edges there are"],
      0,
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Stacks, queues, heaps: what does pop give back?
// ---------------------------------------------------------------------------

export function popQuestions(ctx: Ctx): Question[] {
  const re = new RegExp(`^(${IDENT})\\s*=\\s*(?:(${IDENT})\\.(pop|popleft)\\((0)?\\)|heapq\\.heappop\\((${IDENT})\\))$`);
  for (let i = 0; i < ctx.trace.length; i++) {
    const a = ctx.trace[i];
    if (a.event !== "step_line") continue;
    const m = textAt(ctx, a.line).match(re);
    if (!m) continue;
    const [, target, owner, method, zero, heapName] = m;
    const container = owner ?? heapName;
    const items = itemsOf(a, lookup(a, container));
    if (!items || items.length < 2 || !items.every(isPrimitive)) continue;
    const j = nextInFrame(ctx, i);
    if (j < 0) continue;
    const got = lookup(ctx.trace[j], target);
    if (got === undefined || !isPrimitive(got)) continue;
    const kind = heapName ? "heap" : method === "popleft" || zero ? "queue" : "stack";
    if (kind === "heap" && !items.every((x) => typeof x === "number")) continue;
    const first = items[0];
    const last = items[items.length - 1];
    const expected = kind === "heap" ? [...items].sort((x, y) => Number(x) - Number(y))[0] : kind === "queue" ? first : last;
    if (!same(expected, got) || same(first, last)) continue;
    const opts = choices(
      key(got),
      kind === "stack" ? key(first) : key(last),
      kind === "heap" ? key(first) : key(items[Math.floor(items.length / 2)]),
      key(items[1]),
      "Nothing: it raises an IndexError",
    );
    if (!opts) continue;
    return [
      make(
        {
          id: `pop-${kind}`,
          kind: "predict",
          group: "algorithm",
          score: 72,
          concept: "stack-queue",
          title: kind === "heap" ? "What comes out of the heap?" : kind === "queue" ? "First in, first out?" : "Last in, first out?",
          context: `Paused before line ${a.line}: ${code(textAt(ctx, a.line))}. ${code(container)} is ${code(pyText(a, lookup(a, container)))}.`,
          prompt: `What will ${code(target)} be after this line runs?`,
          explanation:
            kind === "heap"
              ? `${code("heapq.heappop")} always removes the smallest item of a min-heap, ${key(got)}, wherever it was added. That's what makes heaps useful as priority queues.`
              : kind === "queue"
                ? `Taking from the front makes ${code(container)} a queue: first in, first out. The oldest item, ${key(got)}, comes out.`
                : `${code(".pop()")} with no index removes the last item, so ${code(container)} acts as a stack: last in, first out. ${key(got)} was added most recently.`,
          hints: [kind === "heap" ? "Does a heap care about insertion order?" : kind === "queue" ? "Which end does this take from?" : "Which end does .pop() take from?"],
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

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export function sortingQuestions(ctx: Ctx): Question[] {
  // A list mutated by index assignment inside nested loops that ends up sorted.
  const mutate = new RegExp(`^(${IDENT})\\[[^\\]]+\\](?:\\s*,\\s*\\1\\[[^\\]]+\\])?\\s*=`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const m = textAt(ctx, L).match(mutate);
    if (!m) continue;
    const name = m[1];
    const loops = enclosingHeaders(ctx, L).filter((h) => isLoopHeader(ctx, h));
    if (loops.length < 2) continue;
    const outer = loops[loops.length - 1];
    const firstOuter = ctx.trace.findIndex((s) => s.event === "step_line" && s.line === outer);
    if (firstOuter < 0) continue;
    const fid = frameId(ctx.trace[firstOuter]);
    const outerHits = hitsOf(ctx, outer, fid);
    const start = itemsOf(ctx.trace[firstOuter], lookup(ctx.trace[firstOuter], name));
    if (!start || start.length < 3 || !start.every((x) => typeof x === "number" || typeof x === "string")) continue;
    // Final state: last step where the list is visible in this frame.
    let finalItems: Encoded[] | null = null;
    for (let i = ctx.trace.length - 1; i >= firstOuter; i--) {
      if (frameId(ctx.trace[i]) !== fid) continue;
      finalItems = itemsOf(ctx.trace[i], lookup(ctx.trace[i], name));
      if (finalItems) break;
    }
    if (!finalItems) continue;
    const sortedStart = [...start].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const ascending = same(finalItems, sortedStart);
    if (!ascending && !same(finalItems, [...sortedStart].reverse())) continue;
    const show = (xs: Encoded[]) => `[${xs.map(key).join(", ")}]`;
    const out: Question[] = [];

    // 1. The list after the first pass.
    if (outerHits.length >= 3) {
      const afterPass = itemsOf(ctx.trace[outerHits[1]], lookup(ctx.trace[outerHits[1]], name));
      if (afterPass && !same(afterPass, start)) {
        const wrongPass = [...start];
        const opts = choices(code(show(afterPass)), code(show(start)), !same(afterPass, finalItems) && code(show(finalItems)), code(show([...afterPass].reverse())), code(show(wrongPass.slice(1).concat(wrongPass[0]))));
        if (opts) {
          out.push(
            make(
              {
                id: "sort-pass",
                kind: "predict",
                group: "algorithm",
                score: 80,
                concept: "sort-pass",
                title: "After one pass",
                context: `${code(name)} starts as ${code(show(start))}. The loop on line ${outer} (${code(textAt(ctx, outer))}) makes one pass per iteration.`,
                prompt: `What does ${code(name)} look like after the first pass of the loop on line ${outer}?`,
                explanation: `The trace shows ${code(show(afterPass))} after one pass. Each pass moves items closer to their final places (in bubble sort, the ${ascending ? "largest" : "smallest"} item bubbles to the end), but one pass usually isn't enough to sort everything.`,
                hints: [`Step through the first pass and watch the ${code(name)} card change.`, `Which item ends up at the ${ascending ? "end" : "front"} after one pass?`],
                step: outerHits[1],
                focusLine: outer,
              },
              opts,
              0,
            ),
          );
        }
      }
    }

    // 2. How many comparisons (and how that grows).
    const compLine = ctx.lines.findIndex((l, n) => n + 1 > outer && n + 1 <= L && new RegExp(`^\\s*(if|while)\\b.*${name}\\[`).test(l)) + 1;
    if (compLine) {
      const count = hitsOf(ctx, compLine, fid).length;
      const n = start.length;
      if (count >= n) {
        const opts = choices(String(count), String(n - 1), String(n * n), String(2 * n));
        if (opts) {
          out.push(
            make(
              {
                id: "sort-comparisons",
                kind: "predict",
                group: "efficiency",
                score: 70,
                concept: "sort-comparisons",
                title: "Count the comparisons",
                context: `${code(name)} has ${n} items. Line ${compLine} (${code(textAt(ctx, compLine))}) compares two of them.`,
                prompt: `How many times did line ${compLine} run while sorting these ${n} items?`,
                explanation: `The trace shows ${count} comparisons for ${n} items. Nested loops like this compare roughly n²/2 pairs (${n} × ${n - 1} / 2 = ${(n * (n - 1)) / 2}), so the work grows like O(n²): twice as many items means about four times the comparisons.`,
                hints: ["How many times does the inner loop run on each pass?", "Add those up over all the passes."],
                step: firstOuter,
                focusLine: compLine,
              },
              opts,
              0,
            ),
          );
        }
      }
    }
    if (out.length) return out;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Binary search
// ---------------------------------------------------------------------------

export function binarySearchQuestions(ctx: Ctx): Question[] {
  const midRe = new RegExp(`^(${IDENT})\\s*=\\s*(?:\\(\\s*(${IDENT})\\s*\\+\\s*(${IDENT})\\s*\\)\\s*//\\s*2|(${IDENT})\\s*\\+\\s*\\(\\s*(${IDENT})\\s*-\\s*\\4\\s*\\)\\s*//\\s*2)$`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const m = textAt(ctx, L).match(midRe);
    if (!m) continue;
    const mid = m[1];
    const lo = m[2] ?? m[4];
    const hi = m[3] ?? m[5];
    const hits = hitsOf(ctx, L);
    if (!hits.length) continue;
    // The second guess is more interesting than the first (one bound has already moved).
    const first = hits.length > 1 ? hits[1] : hits[0];
    const a = ctx.trace[first];
    const loV = asNumber(lookup(a, lo));
    const hiV = asNumber(lookup(a, hi));
    const j = nextInFrame(ctx, first);
    const midV = j >= 0 ? asNumber(lookup(ctx.trace[j], mid)) : undefined;
    if (loV === undefined || hiV === undefined || midV === undefined) continue;
    const out: Question[] = [];
    const pyFloat = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));
    const opts = choices(String(midV), pyFloat((loV + hiV) / 2), String(midV + 1), String(Math.floor(hiV / 2)), String(hiV), String(midV - 1));
    if (opts) {
      out.push(
        make(
          {
            id: "binary-search-mid",
            kind: "predict",
            group: "algorithm",
            score: 78,
            concept: "binary-search",
            title: "Find the middle",
            context: `Paused before line ${L}: ${code(textAt(ctx, L))}. ${code(lo)} is ${loV} and ${code(hi)} is ${hiV}.`,
            prompt: `What will ${code(mid)} be after this line runs?`,
            explanation: `${code("//")} is floor division, so ${code(`(${loV} + ${hiV}) // 2`)} is ${midV}, a whole number that can be used as an index. Plain ${code("/")} would give ${pyFloat((loV + hiV) / 2)}, a float, which can't be used as a list index.`,
            hints: ["Add the two bounds, then divide by 2 and round down."],
            step: first,
            focusLine: L,
          },
          opts,
          0,
        ),
      );
    }
    // How many halvings, and why that's fast.
    const fid = frameId(a);
    const count = hitsOf(ctx, L, fid).length;
    const arrName = ctx.lines.join("\n").match(new RegExp(`(${IDENT})\\[${mid}\\]`))?.[1];
    const n = arrName ? lengthOf(a, lookup(a, arrName)) : undefined;
    if (n && n >= 4 && count >= 1 && count < n) {
      const opts2 = choices(String(count), String(n), String(Math.ceil(n / 2)), String(count + 2));
      if (opts2) {
        out.push(
          make(
            {
              id: "binary-search-steps",
              kind: "predict",
              group: "efficiency",
              score: 70,
              concept: "binary-search-steps",
              title: "How many guesses?",
              context: `${code(arrName!)} has ${n} items. Each pass of the loop computes a new ${code(mid)} on line ${L}.`,
              prompt: `How many times did line ${L} run during this search?`,
              explanation: `The trace shows ${count}. Each guess throws away half of what's left, so even ${n * 1000} items would take only about ${Math.ceil(Math.log2(n * 1000))} guesses: binary search is O(log n). A linear scan could need all ${n}.`,
              hints: ["How much of the list is left after each guess?"],
              step: first,
              focusLine: L,
            },
            opts2,
            0,
          ),
        );
      }
    }
    if (out.length) return out;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Repeated work in recursion, and memoization
// ---------------------------------------------------------------------------

export function repeatedWorkQuestions(ctx: Ctx): Question[] {
  type CallInfo = { step: number; args: string };
  const calls = new Map<string, CallInfo[]>();
  ctx.trace.forEach((s, i) => {
    if (s.event !== "call") return;
    const f = currentFrame(s);
    if (!f) return;
    const args = (f.ordered_varnames ?? []).filter((n) => n in f.encoded_locals).map((n) => f.encoded_locals[n]);
    // Only calls made entirely of plain values can be "the same call again" (insert(node, 5) with
    // different nodes is different work, even though 5 repeats).
    if (!args.length || !args.every((v) => isPrimitive(v))) return;
    calls.set(f.func_name, [...(calls.get(f.func_name) ?? []), { step: i, args: args.map(key).join(", ") }]);
  });
  const out: Question[] = [];
  for (const [fn, fnCalls] of calls) {
    if (fnCalls.length < 5 || !ctx.topics.has("recursion")) continue;
    const counts = new Map<string, number>();
    for (const c of fnCalls) counts.set(c.args, (counts.get(c.args) ?? 0) + 1);
    const [args, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const distinct = counts.size;
    const memo = /\b(memo|cache|dp|lru_cache)\b/i.test(ctx.lines.join("\n"));
    const top = fnCalls[0].args;
    const total = fnCalls.length;
    if (count >= 2 && !memo) {
      out.push(
        make(
          {
            id: "repeated-work",
            kind: "predict",
            group: "efficiency",
            score: 80,
            concept: "repeated-work",
            title: "Same question, asked again",
            context: `The program calls ${code(`${fn}(${top})`)} once. ${code(fn)} then calls itself to solve smaller cases.`,
            prompt: `How many times is ${code(`${fn}(${args})`)} called in this run?`,
            explanation: `The trace shows ${code(`${fn}(${args})`)} called ${count} times, each time redoing the same work. In total there were ${total} calls but only ${distinct} different arguments. That repetition makes the running time grow exponentially.`,
            hints: [`Draw the call tree for ${code(`${fn}(${top})`)}. Where does ${code(`${fn}(${args})`)} appear?`],
            step: fnCalls[0].step,
            focusLine: defLine(ctx, fn) || undefined,
          },
          choices(String(count), "1", String(count + 1), String(count - 1))!,
          0,
        ),
      );
      out.push(
        make(
          {
            id: "memoization",
            kind: "explain",
            group: "efficiency",
            score: 76,
            concept: "memoization",
            title: "What would a cache change?",
            context: `${code(fn)} made ${total} calls for only ${distinct} different arguments.`,
            prompt: `If ${code(fn)} saved each result in a dict (memoization) and reused it, what would change?`,
            explanation: `With a memo dict, each of the ${distinct} different arguments is computed once and later calls return the saved answer. The total work drops from ${total} full calls to about ${distinct} computations, which turns exponential growth into linear.`,
            hints: ["How many of those calls were asking a question already answered?"],
            step: fnCalls[fnCalls.length - 1].step,
            focusLine: defLine(ctx, fn) || undefined,
          },
          [
            `Each of the ${distinct} different arguments would be computed once, instead of ${total} calls`,
            "Nothing: every call already runs only once",
            "The recursion would never reach its base case",
          ],
          0,
        ),
      );
      return out;
    }
    // Memo already present: a repeated call answered straight from the cache.
    if (memo && count >= 2) {
      // A repeated call whose frame returns without making any further calls: a cache hit.
      const repeat = fnCalls.find((c, idx) => {
        if (fnCalls.findIndex((d) => d.args === c.args) >= idx) return false;
        const fid = frameId(ctx.trace[c.step]);
        const ret = ctx.trace.findIndex((s, k) => k > c.step && s.event === "return" && frameId(s) === fid);
        return ret > 0 && !ctx.trace.slice(c.step + 1, ret).some((s) => s.event === "call");
      });
      if (!repeat) continue;
      out.push(
        make(
          {
            id: "memo-hit",
            kind: "explain",
            group: "algorithm",
            score: 74,
            concept: "memoization",
            title: "A cache hit",
            context: `${code(`${fn}(${repeat.args})`)} is called again here, after it was already computed once.`,
            prompt: "What happens on this second call?",
            explanation: `The saved answer is found in the cache, so ${code(fn)} returns right away without recursing again. That's why the run has only ${total} calls for ${distinct} different arguments.`,
            hints: ["Step forward: does this call make any recursive calls?"],
            step: repeat.step,
            focusLine: defLine(ctx, fn) || undefined,
          },
          ["It returns the saved result right away, without recursing", "It recomputes the answer from scratch", "It raises a KeyError because the key already exists"],
          0,
        ),
      );
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Counting with a dict
// ---------------------------------------------------------------------------

export function countingQuestions(ctx: Ctx): Question[] {
  const re = new RegExp(`^(${IDENT})\\[(${IDENT})\\]\\s*(?:\\+=\\s*1|=\\s*\\1\\.get\\(\\2,\\s*0\\)\\s*\\+\\s*1)$`);
  for (let L = 1; L <= ctx.lines.length; L++) {
    const m = textAt(ctx, L).match(re);
    if (!m) continue;
    const d = m[1];
    const hits = hitsOf(ctx, L);
    if (hits.length < 3) continue;
    const fid = frameId(ctx.trace[hits[0]]);
    // State right after the last update.
    const j = nextInFrame(ctx, hits[hits.length - 1]);
    if (j < 0) continue;
    const obj = heapOf(ctx.trace[j], lookup(ctx.trace[j], d));
    if (obj?.[0] !== "DICT" || frameId(ctx.trace[j]) !== fid) continue;
    const pairs = obj.slice(1) as [Encoded, Encoded][];
    if (pairs.length < 2 || pairs.length > 8 || !pairs.every(([k, v]) => isPrimitive(k) && typeof v === "number")) continue;
    const show = (ps: [Encoded, Encoded][]) => `{${ps.map(([k, v]) => `${primitiveText(k)}: ${primitiveText(v)}`).join(", ")}}`;
    const ones = pairs.map(([k]) => [k, 1] as [Encoded, Encoded]);
    const bumped = pairs.map(([k, v], i) => [k, i === 0 ? (v as number) + 1 : v] as [Encoded, Encoded]);
    const dropped = pairs.slice(0, -1);
    const opts = choices(code(show(pairs)), code(show(ones)), code(show(bumped)), code(show(dropped)));
    if (!opts) continue;
    return [
      make(
        {
          id: "dict-counting",
          kind: "predict",
          group: "algorithm",
          score: 68,
          concept: "dict-counting",
          title: "Count with a dictionary",
          context: `Line ${L} (${code(textAt(ctx, L))}) runs once per item, ${hits.length} times in all.`,
          prompt: `What does ${code(d)} hold after the last update?`,
          explanation: `Each key maps to how many times it was seen: ${code(show(pairs))}. Dictionary lookups and updates take constant time on average, so counting n items is O(n).`,
          hints: [`Go through the items one at a time and keep a tally.`],
          step: hits[0],
          focusLine: L,
        },
        opts,
        0,
      ),
    ];
  }
  return [];
}


