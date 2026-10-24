// Self-check for the built-in question bank (src/quiz).
//
//   1. Traces each test program with the running server and plans a quiz for it.
//   2. Checks retrieval: built-in vs. the AI tutor, and that the expected concepts were picked for that code.
//   3. Checks every question's shape (3 distinct options, valid answer index, valid step/line, no unfilled text).
//   4. For repair questions, applies EVERY option to the code and re-runs it: the correct option must make
//      the program finish, and each wrong option must still fail or print something different.
//
// Usage (with the server running):  npm run check:questions        [KIRO_URL=http://127.0.0.1:8000]

import { applyRepair, planQuiz, type Question } from "../src/quiz/questionBank.ts";
import { SAMPLES } from "../src/samples.ts";
import type { RunResult } from "../src/types.ts";

const BASE = process.env.KIRO_URL ?? "http://127.0.0.1:8000";

interface Case {
  name: string;
  code: string;
  stdin?: string[];
  expect: "local" | "ai";
  /** Concepts that must appear in the plan. */
  concepts?: string[];
}

const BST_OK =
  "class Node:\n    def __init__(self, val):\n        self.val = val\n        self.left = None\n        self.right = None\n\n" +
  "def insert(root, val):\n    if root is None:\n        return Node(val)\n    if val < root.val:\n        root.left = insert(root.left, val)\n" +
  "    else:\n        root.right = insert(root.right, val)\n    return root\n\nroot = None\nfor v in [5, 2, 8, 1]:\n    root = insert(root, v)\nprint(root.left.left.val)\n";

const CASES: Case[] = [
  // Samples
  { name: "sample: linked list (bug)", code: SAMPLES.linked_list.code, expect: "local", concepts: ["none-pointer", "pointers"] },
  { name: "sample: BST insert (bug)", code: SAMPLES.bst.code, expect: "local", concepts: ["none-pointer", "recursion-return"] },
  { name: "sample: reverse list", code: SAMPLES.reverse.code, expect: "local", concepts: ["pointers"] },
  { name: "sample: factorial", code: SAMPLES.recursion.code, expect: "local", concepts: ["recursion-depth"] },
  { name: "working BST", code: BST_OK, expect: "local", concepts: ["branching"] },

  // Data structures & algorithms
  {
    name: "DFS (recursive)",
    code:
      "graph = {'a': ['b', 'c'], 'b': ['d'], 'c': ['d'], 'd': []}\n\ndef dfs(node, visited):\n    visited.add(node)\n" +
      "    for n in graph[node]:\n        if n not in visited:\n            dfs(n, visited)\n    return visited\n\nprint(sorted(dfs('a', set())))\n",
    expect: "local",
    concepts: ["graph-order", "graph-kind", "graph-visited", "graph-cost"],
  },
  {
    name: "BFS (deque)",
    code:
      "from collections import deque\n\ngraph = {'a': ['b', 'c'], 'b': ['d'], 'c': ['e'], 'd': [], 'e': ['a']}\n\ndef bfs(start):\n" +
      "    seen = {start}\n    order = []\n    q = deque([start])\n    while q:\n        node = q.popleft()\n        order.append(node)\n" +
      "        for n in graph[node]:\n            if n not in seen:\n                seen.add(n)\n                q.append(n)\n    return order\n\nprint(bfs('a'))\n",
    expect: "local",
    concepts: ["graph-kind", "graph-visited", "stack-queue"],
  },
  {
    name: "bubble sort",
    code:
      "def bubble(a):\n    n = len(a)\n    for i in range(n):\n        for j in range(n - 1 - i):\n            if a[j] > a[j + 1]:\n" +
      "                a[j], a[j + 1] = a[j + 1], a[j]\n    return a\n\nprint(bubble([5, 1, 4, 2, 8]))\n",
    expect: "local",
    concepts: ["sort-pass", "sort-comparisons"],
  },
  {
    name: "binary search",
    code:
      "def search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n" +
      "            return mid\n        if arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n\n" +
      "print(search([1, 3, 5, 7, 9, 11, 13], 11))\n",
    expect: "local",
    concepts: ["binary-search", "binary-search-steps"],
  },
  { name: "naive fibonacci", code: "def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(fib(5))\n", expect: "local", concepts: ["repeated-work", "memoization"] },
  {
    name: "memoized fibonacci",
    code: "memo = {}\n\ndef fib(n):\n    if n in memo:\n        return memo[n]\n    if n < 2:\n        return n\n    memo[n] = fib(n - 1) + fib(n - 2)\n    return memo[n]\n\nprint(fib(6))\n",
    expect: "local",
    concepts: ["memoization"],
  },
  { name: "stack", code: "stack = []\nfor x in [1, 2, 3]:\n    stack.append(x)\ntop = stack.pop()\nprint(top, stack)\n", expect: "local", concepts: ["stack-queue"] },
  { name: "heap", code: "import heapq\nh = []\nfor x in [7, 2, 9, 4]:\n    heapq.heappush(h, x)\nlow = heapq.heappop(h)\nprint(low)\n", expect: "local", concepts: ["stack-queue"] },
  { name: "word count", code: "words = 'the cat and the hat and the bat'.split()\ncounts = {}\nfor w in words:\n    counts[w] = counts.get(w, 0) + 1\nprint(counts)\n", expect: "local", concepts: ["dict-counting"] },

  // Efficiency
  {
    name: "dedupe with list (O(n^2))",
    code: "nums = [3, 1, 3, 2, 1, 4, 2]\nresult = []\nfor x in nums:\n    if x not in result:\n        result.append(x)\nprint(result)\n",
    expect: "local",
    concepts: ["list-membership"],
  },
  {
    name: "two-sum nested loops",
    code: "nums = [2, 7, 11, 15, 1]\nfound = None\nfor i in range(len(nums)):\n    for j in range(i + 1, len(nums)):\n        if nums[i] + nums[j] == 16:\n            found = (i, j)\nprint(found)\n",
    expect: "local",
    concepts: ["nested-loops"],
  },
  { name: "queue with pop(0)", code: "q = [1, 2, 3, 4]\ntotal = 0\nwhile q:\n    x = q.pop(0)\n    total += x\nprint(total)\n", expect: "local", concepts: ["list-pop-front", "stack-queue"] },
  { name: "string building", code: "s = ''\nfor ch in 'hello':\n    s += ch.upper()\nprint(s)\n", expect: "local", concepts: ["string-building"] },

  // Python basics
  { name: "mutable default", code: "def add(x, items=[]):\n    items.append(x)\n    return items\n\nprint(add(1))\nprint(add(2))\n", expect: "local", concepts: ["mutable-default"] },
  { name: "returns None (no crash)", code: "def double_all(xs):\n    out = [x * 2 for x in xs]\n    print(out)\n\nresult = double_all([1, 2])\nprint(result)\n", expect: "local", concepts: ["returns-none"] },
  { name: "true division", code: "total = 7\ncount = 2\navg = total / count\nprint(avg)\n", expect: "local", concepts: ["division"] },
  { name: "slicing", code: "letters = ['a', 'b', 'c', 'd', 'e']\npart = letters[1:3]\nprint(part)\n", expect: "local", concepts: ["slicing"] },
  { name: "aliasing", code: "a = [1, 2, 3]\nb = a\nb.append(4)\nprint(a)\n", expect: "local", concepts: ["aliasing"] },

  // Bugs
  { name: "index off by one", code: "nums = [3, 1, 4]\ntotal = 0\nfor i in range(len(nums) + 1):\n    total += nums[i]\nprint(total)\n", expect: "local", concepts: ["list-bounds"] },
  { name: "infinite while", code: "i = 0\nwhile i < 5:\n    print(i)\n", expect: "local", concepts: ["loop-termination"] },
  { name: "no base case", code: "def count(n):\n    return count(n - 1)\n\ncount(5)\n", expect: "local", concepts: ["recursion"] },
  { name: "zero division", code: "scores = []\ntotal = sum(scores)\ncount = len(scores)\navg = total / count\nprint(avg)\n", expect: "local", concepts: ["division-by-zero"] },
  { name: "dict counting bug", code: "words = ['a', 'b', 'a']\ncounts = {}\nfor w in words:\n    counts[w] += 1\nprint(counts)\n", expect: "local", concepts: ["dict-missing-key"] },
  { name: "name typo", code: "total = 5\nprint(totl)\n", expect: "local", concepts: ["names"] },
  { name: "int of decimal", code: "price = int('3.50')\nprint(price)\n", expect: "local", concepts: ["parsing-input"] },
  { name: "list.push", code: "class Stack:\n    def __init__(self):\n        self.items = []\n\ns = Stack()\ns.items.push(3)\nprint(s.items)\n", expect: "local", concepts: ["list-methods"] },
  { name: "unbound local", code: "count = 0\n\ndef inc():\n    count += 1\n\ninc()\nprint(count)\n", expect: "local", concepts: ["scope"] },
  { name: "str item assignment", code: "s = 'cat'\ns[0] = 'b'\nprint(s)\n", expect: "local", concepts: ["string-immutable"] },
  { name: "for over int", code: "n = 3\nfor i in n:\n    print(i)\n", expect: "local", concepts: ["loops"] },
  { name: "None subscript", code: "def first_two(xs):\n    part = xs[:2]\n\nr = first_two([5, 6, 7])\nprint(r[0])\n", expect: "local", concepts: ["returns-none"] },
  { name: "missing argument", code: "def add(a, b):\n    return a + b\n\nprint(add(1))\n", expect: "local", concepts: ["arguments"] },
  { name: "assert", code: "def area(w, h):\n    return w + h\n\nresult = area(2, 3)\nassert result == 6\n", expect: "local", concepts: ["assertions"] },
  { name: "ValueError (generic)", code: "x = [1, 2, 3]\nx.remove(9)\n", expect: "local", concepts: ["error-types"] },

  // Syntax errors (no trace)
  { name: "missing colon", code: "x = 3\nif x > 1\n    print(x)\n", expect: "local", concepts: ["syntax"] },
  { name: "= instead of ==", code: "x = 3\nif x = 3:\n    print(x)\n", expect: "local", concepts: ["syntax"] },
  { name: "unclosed paren", code: "print((1 + 2)\nx = 1\n", expect: "local", concepts: ["syntax"] },
  { name: "missing indent", code: "if True:\nprint(1)\n", expect: "local", concepts: ["indentation"] },

  // Nothing to quiz on
  { name: "hello world", code: "print('hello')\n", expect: "ai" },
];

async function trace(code: string, stdin: string[] = []): Promise<RunResult> {
  const res = await fetch(`${BASE}/api/run-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, stdin }),
  });
  if (!res.ok) throw new Error(`run-code ${res.status}: ${await res.text()}`);
  return (await res.json()) as RunResult;
}

const strip = (s: string) => s.replace(/`/g, "");
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`    ✗ ${msg}`);
};

async function checkRepair(c: Case, q: Question) {
  if (!q.edit) return fail(`${q.id}: repair question without edit info`);
  const fixed = await trace(applyRepair(c.code, q.edit, q.options[q.correct]), c.stdin);
  if (fixed.status !== "ok") return fail(`${q.id}: correct option ${strip(q.options[q.correct])} -> ${fixed.status} (${fixed.message})`);
  console.log(`    ✓ correct fixes it -> prints ${JSON.stringify(fixed.stdout.trim()).slice(0, 60)}`);
  for (let i = 0; i < q.options.length; i++) {
    if (i === q.correct) continue;
    const r = await trace(applyRepair(c.code, q.edit, q.options[i]), c.stdin);
    if (r.status === "ok" && r.stdout === fixed.stdout) fail(`${q.id}: wrong option ${strip(q.options[i])} ALSO fixes it`);
    else console.log(`    ✓ wrong stays wrong: ${strip(q.options[i]).slice(0, 50)} -> ${r.status === "ok" ? `prints ${JSON.stringify(r.stdout.trim()).slice(0, 30)}` : r.status}`);
  }
}

let local = 0;
for (const c of CASES) {
  const result = await trace(c.code, c.stdin);
  const t0 = performance.now();
  const plan = planQuiz(result, c.code);
  const ms = (performance.now() - t0).toFixed(1);
  const qs = plan.questions;
  const got = plan.needsAi ? "ai" : "local";
  if (got === "local") local++;
  console.log(`\n■ ${c.name}  [${result.status}; ${plan.topics.join(", ") || "no topics"}] -> ${got === "local" ? `${qs.length} built-in` : "AI tutor"} (${ms} ms)`);
  if (plan.summary) console.log(`  “${plan.summary}”`);
  if (got !== c.expect) fail(`expected ${c.expect}, got ${got}`);
  const concepts = new Set(qs.map((q) => q.concept));
  for (const want of c.concepts ?? []) if (!concepts.has(want)) fail(`expected a "${want}" question`);
  const lineCount = c.code.split("\n").length;
  for (const q of qs) {
    console.log(`  [${q.group}/${q.concept} · ${q.topicLabel}] ${strip(q.prompt)}`);
    q.options.forEach((o, i) => console.log(`      ${i === q.correct ? "●" : "○"} ${strip(o)}`));
    if (q.options.length !== 3) fail(`${q.id}: ${q.options.length} options`);
    if (new Set(q.options).size !== q.options.length) fail(`${q.id}: duplicate options`);
    if (q.correct < 0 || q.correct >= q.options.length) fail(`${q.id}: bad answer index`);
    if (q.step >= result.trace.length || (q.step < 0 && result.trace.length > 0)) fail(`${q.id}: step ${q.step} out of range`);
    if (q.focusLine !== undefined && (q.focusLine < 1 || q.focusLine > lineCount)) fail(`${q.id}: focus line ${q.focusLine} out of range`);
    if (/\$\{|undefined|NaN|\[object/.test(q.context + q.prompt + q.options.join("") + q.explanation)) fail(`${q.id}: unfilled text`);
    if (q.kind === "repair") await checkRepair(c, q);
  }
}

console.log(`\n${local}/${CASES.length} programs answered from the built-in bank.`);
console.log(failures ? `✗ ${failures} problem(s)` : "✓ all checks passed");
process.exit(failures ? 1 : 0);
