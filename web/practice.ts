import type { TraceEvent } from './types';

/**
 * Practice problems for a concept: small programs with randomized values. The correct answer is never computed
 * here: the IDE runs each program on the JVM and the answer is what Java actually did. Generators only supply
 * the program, the question, and wrong answers that reflect common misconceptions.
 */
export type PracticeOutcome = { kind: 'output'; text: string } | { kind: 'exception'; type: string } | { kind: 'compile-error'; line: number; message: string } | { kind: 'other'; reason: string };
export type PracticeItem = { concept: string; title: string; code: string; prompt: string; mistakes: string[]; why: string; source?: 'ai' };

/** Small deterministic generator (mulberry32), so a seed always gives the same problem. */
export function random(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  return { next, int, pick };
}
type Rng = ReturnType<typeof random>;

const program = (body: string, extra = '') => `public class Main {\n${extra}    public static void main(String[] args) {\n${body.split('\n').map(l => `        ${l}`).join('\n')}\n    }\n}\n`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const THROWS = (type: string) => `It throws ${type}`;

type Generator = (r: Rng) => PracticeItem;
const generators: Record<string, Generator[]> = {
  'array-bounds': [
    r => {
      const values = Array.from({ length: r.int(3, 5) }, () => r.int(1, 9));
      const variant = r.pick(['<', '<', '<=', 'from1'] as const);
      const header = variant === 'from1' ? 'int i = 1; i < values.length; i++' : `int i = 0; i ${variant} values.length; i++`;
      return { concept: 'array-bounds', title: 'Sum an array', prompt: 'What does this program print?', why: 'An array of length n has indexes 0 to n − 1. Compare the loop’s first and last index with that range.',
        code: program(`int[] values = {${values.join(', ')}};\nint total = 0;\nfor (${header}) {\n    total += values[i];\n}\nSystem.out.println(total);`),
        mistakes: [String(sum(values)), String(sum(values.slice(1))), String(sum(values) - values.at(-1)!), THROWS('ArrayIndexOutOfBoundsException')] };
    },
    r => {
      const values = Array.from({ length: r.int(3, 6) }, () => r.int(1, 20));
      const k = r.pick([0, 1, 1, 2] as const);
      return { concept: 'array-bounds', title: 'The last element', prompt: 'What does this program print?', why: 'The last element is at index length − 1.',
        code: program(`int[] values = {${values.join(', ')}};\nSystem.out.println(values[values.length - ${k}]);`),
        mistakes: [String(values.at(-1)), String(values.at(-2)), String(values.at(-3)), String(values.length), THROWS('ArrayIndexOutOfBoundsException')] };
    },
  ],
  'string-bounds': [
    r => {
      const word = r.pick(['level', 'java', 'debug', 'array', 'stack', 'tutor']);
      const k = r.pick([0, 1, 2] as const);
      return { concept: 'string-bounds', title: 'Characters from the end', prompt: 'What does this program print?', why: 'charAt accepts 0 to length() − 1, so the last character is charAt(length() − 1).',
        code: program(`String word = "${word}";\nSystem.out.println(word.charAt(word.length() - ${k}));`),
        mistakes: [word.at(-1)!, word.at(-2)!, word[0], THROWS('StringIndexOutOfBoundsException')] };
    },
    r => {
      const word = r.pick(['program', 'variable', 'compiler', 'student']);
      const a = r.int(1, 3), b = r.int(a + 1, word.length);
      return { concept: 'string-bounds', title: 'substring', prompt: 'What does this program print?', why: 'substring(a, b) starts at index a and stops just before index b, so it has b − a characters.',
        code: program(`String word = "${word}";\nSystem.out.println(word.substring(${a}, ${b}));`),
        mistakes: [word.slice(a, b + 1), word.slice(a - 1, b), word.slice(a - 1, b - 1), word.slice(a)] };
    },
  ],
  'loop-termination': [
    r => {
      const start = r.int(0, 3), end = r.int(start + 4, start + 9), step = r.pick([1, 2, 3]);
      const op = r.pick(['<', '<=']);
      const naive = Math.floor((end - start) / step);
      return { concept: 'loop-termination', title: 'Count the passes', prompt: 'What does this program print?', why: 'Count the values the loop variable takes while the condition is still true, including the first one.',
        code: program(`int count = 0;\nfor (int i = ${start}; i ${op} ${end}; i += ${step}) {\n    count++;\n}\nSystem.out.println(count);`),
        mistakes: [String(naive), String(naive + 1), String(naive - 1), String(end - start)] };
    },
    r => {
      const n = r.int(2, 5);
      const update = r.pick(['n--;', 'n -= 2;', '']);
      return { concept: 'loop-termination', title: 'Does it stop?', prompt: 'What does this program print?', why: 'A while loop ends only when its condition becomes false, so something inside it must change the variables in the condition.',
        code: program(`int n = ${n};\nint steps = 0;\nwhile (n > 0 && steps < 100) {\n    steps++;\n    ${update || '// nothing changes n'}\n}\nSystem.out.println(steps);`),
        mistakes: [String(n), String(n + 1), String(Math.ceil(n / 2)), '100', 'It never finishes'] };
    },
  ],
  'integer-division': [
    r => {
      const b = r.pick([2, 3, 4]);
      let a = r.int(5, 19);
      if (a % b === 0) a++; // An exact division would make every answer the same.
      const variant = r.pick(['plain', 'cast', 'double-literal'] as const);
      const expr = variant === 'plain' ? 'total / count' : variant === 'cast' ? '(double) total / count' : 'total / (count * 1.0)';
      return { concept: 'integer-division', title: 'An average', prompt: 'What does this program print?', why: 'If both operands are int, / divides as integers and drops the fractional part, before the result is stored in a double.',
        code: program(`int total = ${a};\nint count = ${b};\ndouble average = ${expr};\nSystem.out.println(average);`),
        mistakes: [String(Math.trunc(a / b)), `${Math.trunc(a / b)}.0`, String(a / b), (a / b).toFixed(1)] };
    },
  ],
  'division-by-zero': [
    r => {
      const n = r.int(3, 9);
      const type = r.pick(['int', 'double']);
      return { concept: 'division-by-zero', title: 'Divide by zero', prompt: 'What happens when this program runs?', why: 'Integer division by zero throws ArithmeticException; floating-point division by zero gives Infinity (or NaN for 0.0 / 0.0).',
        code: program(`${type} items = ${type === 'int' ? n : `${n}.0`};\n${type} people = 0;\nSystem.out.println(items / people);`),
        mistakes: ['0', 'Infinity', 'NaN', THROWS('ArithmeticException')] };
    },
  ],
  'string-equality': [
    r => {
      const word = r.pick(['hello', 'java', 'cat']);
      const variant = r.pick(['new', 'literal', 'concat'] as const);
      const second = variant === 'new' ? `new String("${word}")` : variant === 'literal' ? `"${word}"` : `"${word.slice(0, 2)}" + suffix`;
      return { concept: 'string-equality', title: '== or equals', prompt: 'What does this program print?', why: '== compares references: whether both names refer to the same object. equals compares the text. Identical literals share one object; new String and run-time concatenation create new ones.',
        code: program(`String suffix = "${word.slice(2)}";\nString a = "${word}";\nString b = ${second};\nSystem.out.println(a == b);\nSystem.out.println(a.equals(b));`),
        mistakes: ['true\ntrue', 'false\ntrue', 'true\nfalse', 'false\nfalse'] };
    },
  ],
  'pass-by-value': [
    r => {
      const n = r.int(1, 9), m = r.int(10, 50);
      const variant = r.pick(['int', 'array'] as const);
      return variant === 'int'
        ? { concept: 'pass-by-value', title: 'Change a parameter', prompt: 'What does this program print?', why: 'Java passes a copy of each argument. Assigning to the parameter changes only the method’s copy.',
          code: program(`int x = ${n};\nchange(x);\nSystem.out.println(x);`, `    static void change(int x) {\n        x = ${m};\n    }\n\n`), mistakes: [String(n), String(m), '0'] }
        : { concept: 'pass-by-value', title: 'Change an array element', prompt: 'What does this program print?', why: 'The method gets a copy of the reference, which still points to the same array, so changing an element is visible to the caller.',
          code: program(`int[] values = {${n}, ${n + 1}};\nchange(values);\nSystem.out.println(values[0]);`, `    static void change(int[] values) {\n        values[0] = ${m};\n    }\n\n`), mistakes: [String(n), String(m), String(n + 1)] };
    },
  ],
  aliasing: [
    r => {
      const a = r.int(1, 9), b = r.int(10, 40);
      const variant = r.pick(['alias', 'clone'] as const);
      return { concept: 'aliasing', title: 'Two names, one array?', prompt: 'What does this program print?', why: 'Assigning an array variable copies the reference, not the array. clone() makes a separate array.',
        code: program(`int[] first = {${a}, ${a + 1}};\nint[] second = ${variant === 'alias' ? 'first' : 'first.clone()'};\nsecond[0] = ${b};\nSystem.out.println(first[0]);`),
        mistakes: [String(a), String(b), String(a + 1)] };
    },
  ],
  recursion: [
    r => {
      const n = r.int(3, 6), base = r.pick([0, 1]);
      const naive = Array.from({ length: n }, (_, i) => n - i).reduce((s, v) => s + v, 0);
      return { concept: 'recursion', title: 'Trace a recursive sum', prompt: 'What does this program print?', why: 'Each call waits for the smaller call to return, then adds its own n. The base case decides what the smallest call contributes.',
        code: program(`System.out.println(sum(${n}));`, `    static int sum(int n) {\n        if (n <= ${base}) {\n            return ${base};\n        }\n        return n + sum(n - 1);\n    }\n\n`),
        mistakes: [String(naive), String(naive - 1), String(naive + 1), String(n)] };
    },
  ],
  'null-reference': [
    r => {
      const name = r.pick(['title', 'label', 'name']);
      const variant = r.pick(['null', 'empty'] as const);
      return { concept: 'null-reference', title: 'null or empty?', prompt: 'What happens when this program runs?', why: 'An empty String "" is an object with length 0. null refers to no object, so calling a method on it throws NullPointerException.',
        code: program(`String ${name} = ${variant === 'null' ? 'null' : '""'};\nSystem.out.println(${name}.length());`), mistakes: ['0', 'null', THROWS('NullPointerException')] };
    },
  ],
  'parsing-input': [
    r => {
      const n = r.int(10, 99);
      const text = r.pick([`"${n}"`, `" ${n}"`, `"${n}.5"`, `"${n}".trim()`]);
      return { concept: 'parsing-input', title: 'Parse a number', prompt: 'What happens when this program runs?', why: 'Integer.parseInt accepts only an optional sign and digits: no spaces and no decimal point.',
        code: program(`int value = Integer.parseInt(${text});\nSystem.out.println(value + 1);`), mistakes: [String(n + 1), `${n}1`, THROWS('NumberFormatException')] };
    },
  ],
  'concurrent-modification': [
    r => {
      const items = r.pick([['a', 'b', 'c'], ['x', 'y', 'z', 'w'], ['red', 'green', 'blue']]);
      const victim = items[r.int(0, items.length - 2)];
      const variant = r.pick(['foreach', 'removeIf'] as const);
      const body = variant === 'foreach' ? `for (String item : items) {\n    if (item.equals("${victim}")) {\n        items.remove(item);\n    }\n}` : `items.removeIf(item -> item.equals("${victim}"));`;
      return { concept: 'concurrent-modification', title: 'Remove while looping', prompt: 'What happens when this program runs?', why: 'Removing from a list inside a for-each loop invalidates its iterator; the loop then throws ConcurrentModificationException on its next step. removeIf or an Iterator’s remove() are safe.',
        code: `import java.util.*;\n\n${program(`List<String> items = new ArrayList<>(List.of(${items.map(i => `"${i}"`).join(', ')}));\n${body}\nSystem.out.println(items);`)}`,
        mistakes: [`[${items.filter(i => i !== victim).join(', ')}]`, `[${items.join(', ')}]`, THROWS('ConcurrentModificationException')] };
    },
  ],
  types: [
    r => {
      const a = r.int(5, 15), b = r.pick([2, 4]);
      const variant = r.pick(['int', 'double', 'cast'] as const);
      const line = variant === 'int' ? `int result = ${a} / ${b}.0;` : variant === 'double' ? `double result = ${a} / ${b};` : `int result = (int) (${a} / ${b}.0);`;
      return { concept: 'types', title: 'Does it compile?', prompt: 'What happens with this program?', why: 'Storing a double in an int needs an explicit cast, because the fractional part would be lost. An int result stored in a double widens silently.',
        code: program(`${line}\nSystem.out.println(result);`), mistakes: ['It doesn’t compile', String(Math.trunc(a / b)), `${Math.trunc(a / b)}.0`, String(a / b)] };
    },
  ],
  'compile-errors': [
    r => {
      const name = r.pick(['total', 'count', 'score']);
      const typo = name.slice(0, -1);
      const variant = r.pick(['typo', 'scope', 'ok'] as const);
      const body = variant === 'typo' ? `int ${name} = 3;\nSystem.out.println(${typo});` : variant === 'scope' ? `for (int i = 0; i < 3; i++) {\n    int ${name} = i;\n}\nSystem.out.println(${name});` : `int ${name} = 3;\nfor (int i = 0; i < 3; i++) {\n    ${name} += i;\n}\nSystem.out.println(${name});`;
      return { concept: 'compile-errors', title: 'Will javac accept it?', prompt: 'What happens with this program?', why: 'A variable is visible from its declaration to the end of the block it is declared in, and names must match exactly.',
        code: program(body), mistakes: ['It doesn’t compile', '3', '6', '0'] };
    },
  ],
  'state-change': [
    r => {
      const start = r.int(1, 5), add = r.int(2, 6);
      return { concept: 'state-change', title: 'Two counters', prompt: 'What does this program print?', why: 'Each object has its own fields. Changing one object doesn’t change another of the same class.',
        code: program(`Counter a = new Counter(${start});\nCounter b = new Counter(${start});\na.add(${add});\nSystem.out.println(a.value + " " + b.value);`, `    static class Counter {\n        int value;\n        Counter(int value) { this.value = value; }\n        void add(int n) { value += n; }\n    }\n\n`),
        mistakes: [`${start + add} ${start}`, `${start + add} ${start + add}`, `${start} ${start}`] };
    },
  ],
  'return-values': [
    r => {
      const n = r.int(2, 9);
      return { concept: 'return-values', title: 'Using the result', prompt: 'What does this program print?', why: 'Calling a method that returns a value does nothing with that value unless you store or use it.',
        code: program(`int x = ${n};\ndoubled(x);\nSystem.out.println(x);\nx = doubled(x);\nSystem.out.println(x);`, `    static int doubled(int n) {\n        return n * 2;\n    }\n\n`),
        mistakes: [`${n}\n${n * 2}`, `${n * 2}\n${n * 4}`, `${n * 2}\n${n * 2}`] };
    },
  ],
};

// ---------- Algorithms: graphs, trees, binary search and sorting ----------

type Graph = number[][];
/** A connected undirected graph on 0..n-1: a random spanning tree plus a few extra edges, neighbors ascending. */
function randomGraph(r: Rng, n = r.int(5, 7)): Graph {
  const edges = new Set<string>();
  for (let i = 1; i < n; i++) edges.add(`${r.int(0, i - 1)}-${i}`);
  for (let k = r.int(1, 3); k > 0; k--) { const a = r.int(0, n - 1), b = r.int(0, n - 1); if (a !== b) edges.add(`${Math.min(a, b)}-${Math.max(a, b)}`); }
  const adj: Graph = Array.from({ length: n }, () => []);
  for (const e of edges) { const [a, b] = e.split('-').map(Number); adj[a].push(b); adj[b].push(a); }
  return adj.map(list => [...new Set(list)].sort((x, y) => x - y));
}
const graphLiteral = (g: Graph) => `int[][] graph = {\n${g.map((list, i) => `    {${list.join(', ')}},${' '.repeat(Math.max(1, 12 - list.join(', ').length))}// ${i}`).join('\n')}\n};`;
function bfsOrder(g: Graph, start = 0, reverse = false): number[] {
  const seen = new Set([start]), queue = [start], out: number[] = [];
  while (queue.length) {
    const node = queue.shift()!; out.push(node);
    for (const next of reverse ? [...g[node]].reverse() : g[node]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return out;
}
function dfsOrder(g: Graph, start = 0, reverse = false): number[] {
  const seen = new Set<number>(), out: number[] = [];
  const visit = (node: number) => { seen.add(node); out.push(node); for (const next of reverse ? [...g[node]].reverse() : g[node]) if (!seen.has(next)) visit(next); };
  visit(start);
  return out;
}
/** Depth-first with an explicit stack: neighbors pushed in order, so the last neighbor is visited first. */
function stackOrder(g: Graph, start = 0): number[] {
  const seen = new Set<number>(), stack = [start], out: number[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node); out.push(node);
    for (const next of g[node]) if (!seen.has(next)) stack.push(next);
  }
  return out;
}
const spaced = (xs: number[]) => xs.join(' ');
/** The answer with its last two entries swapped: always a distinct, plausible slip. */
const swapLast = (xs: number[]) => xs.length < 2 ? xs : [...xs.slice(0, -2), xs.at(-1)!, xs.at(-2)!];
const listText = (xs: number[]) => `[${xs.join(', ')}]`;

type Tree = { key: number; left?: Tree; right?: Tree } | undefined;
function insert(t: Tree, key: number): Tree { if (!t) return { key }; if (key < t.key) t.left = insert(t.left, key); else t.right = insert(t.right, key); return t; }
function walk(t: Tree, order: 'in' | 'pre' | 'post', out: number[] = []): number[] {
  if (!t) return out;
  if (order === 'pre') out.push(t.key);
  walk(t.left, order, out);
  if (order === 'in') out.push(t.key);
  walk(t.right, order, out);
  if (order === 'post') out.push(t.key);
  return out;
}
function levels(t: Tree): number[] { const out: number[] = [], queue = t ? [t] : []; while (queue.length) { const n = queue.shift()!; out.push(n.key); if (n.left) queue.push(n.left); if (n.right) queue.push(n.right); } return out; }
const height = (t: Tree): number => t ? 1 + Math.max(height(t.left), height(t.right)) : 0;
const NODE_CLASS = `    static class Node {\n        int key;\n        Node left, right;\n        Node(int key) { this.key = key; }\n    }\n\n    static Node insert(Node node, int key) {\n        if (node == null) {\n            return new Node(key);\n        }\n        if (key < node.key) {\n            node.left = insert(node.left, key);\n        } else {\n            node.right = insert(node.right, key);\n        }\n        return node;\n    }\n\n`;
function distinctKeys(r: Rng, n: number): number[] { const keys = new Set<number>(); while (keys.size < n) keys.add(r.int(1, 99)); return [...keys]; }

/** The indexes binary search checks; `upper` rounds the middle up, a common slip. */
function probes(values: number[], target: number, upper = false): number[] {
  let lo = 0, hi = values.length - 1;
  const out: number[] = [];
  while (lo <= hi && out.length < 12) {
    const mid = upper ? Math.floor((lo + hi + 1) / 2) : Math.floor((lo + hi) / 2);
    out.push(mid);
    if (values[mid] === target) break;
    if (values[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return out;
}

function bubble(a: number[], passes: number) { a = [...a]; for (let p = 0; p < passes; p++) for (let i = 0; i + 1 < a.length - p; i++) if (a[i] > a[i + 1]) [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a; }
function selection(a: number[], passes: number) { a = [...a]; for (let i = 0; i < passes; i++) { let m = i; for (let j = i + 1; j < a.length; j++) if (a[j] < a[m]) m = j; [a[i], a[m]] = [a[m], a[i]]; } return a; }
function insertion(a: number[], passes: number) { a = [...a]; for (let i = 1; i <= passes && i < a.length; i++) { const key = a[i]; let j = i - 1; while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; j--; } a[j + 1] = key; } return a; }
const SORTS = {
  bubble: { run: bubble, name: 'Bubble sort', loop: (k: number) => `for (int pass = 0; pass < ${k}; pass++) {\n    for (int i = 0; i + 1 < a.length - pass; i++) {\n        if (a[i] > a[i + 1]) {\n            int t = a[i];\n            a[i] = a[i + 1];\n            a[i + 1] = t;\n        }\n    }\n}` },
  selection: { run: selection, name: 'Selection sort', loop: (k: number) => `for (int i = 0; i < ${k}; i++) {\n    int min = i;\n    for (int j = i + 1; j < a.length; j++) {\n        if (a[j] < a[min]) {\n            min = j;\n        }\n    }\n    int t = a[i];\n    a[i] = a[min];\n    a[min] = t;\n}` },
  insertion: { run: insertion, name: 'Insertion sort', loop: (k: number) => `for (int i = 1; i <= ${k}; i++) {\n    int key = a[i];\n    int j = i - 1;\n    while (j >= 0 && a[j] > key) {\n        a[j + 1] = a[j];\n        j--;\n    }\n    a[j + 1] = key;\n}` },
} as const;

Object.assign(generators, {
  bfs: [
    r => {
      const g = randomGraph(r);
      const order = bfsOrder(g);
      return { concept: 'bfs', title: 'Breadth-first order', prompt: 'In what order does this program visit the nodes?', why: 'A queue hands back nodes in the order they were added, so breadth-first search finishes every node at distance 1 before any node at distance 2.',
        code: `import java.util.*;\n\n${program(`${graphLiteral(g)}\nboolean[] visited = new boolean[graph.length];\nQueue<Integer> queue = new ArrayDeque<>();\nStringBuilder order = new StringBuilder();\nvisited[0] = true;\nqueue.add(0);\nwhile (!queue.isEmpty()) {\n    int node = queue.remove();\n    order.append(node).append(' ');\n    for (int next : graph[node]) {\n        if (!visited[next]) {\n            visited[next] = true;\n            queue.add(next);\n        }\n    }\n}\nSystem.out.println(order.toString().trim());`)}`,
        mistakes: [spaced(dfsOrder(g)), spaced(stackOrder(g)), spaced(bfsOrder(g, 0, true)), spaced([...order].sort((a, b) => a - b)), spaced(swapLast(order))] };
    },
    r => {
      const g = randomGraph(r);
      const dist = new Array(g.length).fill(-1); dist[0] = 0;
      for (const node of bfsOrder(g)) for (const next of g[node]) if (dist[next] === -1) dist[next] = dist[node] + 1;
      // Depth of each node in a depth-first walk: what people get when they follow one path at a time.
      const depth = new Array(g.length).fill(-1);
      const visit = (node: number, d: number) => { depth[node] = d; for (const next of g[node]) if (depth[next] === -1) visit(next, d + 1); };
      visit(0, 0);
      const position = bfsOrder(g).reduce((acc, node, i) => { acc[node] = i; return acc; }, new Array(g.length).fill(0));
      return { concept: 'bfs', title: 'Distances from node 0', prompt: 'What does this program print?', why: 'dist[next] = dist[node] + 1 is set the first time a node is reached. Breadth-first search reaches every node first along a shortest path, so dist holds the fewest edges from node 0.',
        code: `import java.util.*;\n\n${program(`${graphLiteral(g)}\nint[] dist = new int[graph.length];\nArrays.fill(dist, -1);\nQueue<Integer> queue = new ArrayDeque<>();\ndist[0] = 0;\nqueue.add(0);\nwhile (!queue.isEmpty()) {\n    int node = queue.remove();\n    for (int next : graph[node]) {\n        if (dist[next] == -1) {\n            dist[next] = dist[node] + 1;\n            queue.add(next);\n        }\n    }\n}\nSystem.out.println(Arrays.toString(dist));`)}`,
        mistakes: [listText(depth), listText(position), listText(dist.map((d, i) => i === 0 ? 0 : d + 1)), listText(swapLast(dist))] };
    },
  ],
  dfs: [
    r => {
      const g = randomGraph(r);
      const order = dfsOrder(g);
      return { concept: 'dfs', title: 'Depth-first order', prompt: 'In what order does this program visit the nodes?', why: 'visit calls itself on the first unvisited neighbor before it looks at the next one, so the search follows one path as deep as it can, then backs up through the call stack.',
        code: program(`visit(0);\nSystem.out.println(order.toString().trim());`, `    ${graphLiteral(g).split('\n').join('\n    ').replace('int[][] graph', 'static int[][] graph')}\n    static boolean[] visited = new boolean[graph.length];\n    static StringBuilder order = new StringBuilder();\n\n    static void visit(int node) {\n        visited[node] = true;\n        order.append(node).append(' ');\n        for (int next : graph[node]) {\n            if (!visited[next]) {\n                visit(next);\n            }\n        }\n    }\n\n`),
        mistakes: [spaced(bfsOrder(g)), spaced(stackOrder(g)), spaced(dfsOrder(g, 0, true)), spaced([...order].sort((a, b) => a - b)), spaced(swapLast(order))] };
    },
    r => {
      const g = randomGraph(r);
      const order = stackOrder(g);
      return { concept: 'dfs', title: 'Depth-first with a stack', prompt: 'In what order does this program visit the nodes?', why: 'pop() returns the value pushed most recently, and the neighbors are pushed in order, so the last neighbor listed is visited first. Recursion would take the first neighbor first.',
        code: `import java.util.*;\n\n${program(`${graphLiteral(g)}\nboolean[] visited = new boolean[graph.length];\nDeque<Integer> stack = new ArrayDeque<>();\nStringBuilder order = new StringBuilder();\nstack.push(0);\nwhile (!stack.isEmpty()) {\n    int node = stack.pop();\n    if (visited[node]) {\n        continue;\n    }\n    visited[node] = true;\n    order.append(node).append(' ');\n    for (int next : graph[node]) {\n        if (!visited[next]) {\n            stack.push(next);\n        }\n    }\n}\nSystem.out.println(order.toString().trim());`)}`,
        mistakes: [spaced(dfsOrder(g)), spaced(bfsOrder(g)), spaced(dfsOrder(g, 0, true)), spaced(swapLast(order))] };
    },
  ],
  trees: [
    r => {
      const keys = distinctKeys(r, r.int(6, 7));
      let t: Tree;
      for (const k of keys) t = insert(t, k);
      const order = r.pick(['in', 'pre', 'post'] as const);
      const names = { in: 'inOrder', pre: 'preOrder', post: 'postOrder' };
      const body = { in: 'print(node.left);\n        System.out.print(node.key + " ");\n        print(node.right);', pre: 'System.out.print(node.key + " ");\n        print(node.left);\n        print(node.right);', post: 'print(node.left);\n        print(node.right);\n        System.out.print(node.key + " ");' }[order];
      return { concept: 'trees', title: `${{ in: 'In-order', pre: 'Pre-order', post: 'Post-order' }[order]} traversal`, prompt: 'What does this program print?', why: 'Smaller keys go left and larger keys go right. In-order visits left subtree, node, right subtree; pre-order visits the node first; post-order visits it last.',
        code: program(`int[] keys = {${keys.join(', ')}};\nNode root = null;\nfor (int key : keys) {\n    root = insert(root, key);\n}\nprint(root);\nSystem.out.println();`, `${NODE_CLASS}    /** ${names[order]} */\n    static void print(Node node) {\n        if (node == null) {\n            return;\n        }\n        ${body}\n    }\n\n`),
        mistakes: [...(['in', 'pre', 'post'] as const).filter(o => o !== order).map(o => spaced(walk(t, o))), spaced(keys), spaced(levels(t)), spaced(swapLast(walk(t, order)))] };
    },
    r => {
      const keys = distinctKeys(r, r.int(6, 8));
      let t: Tree;
      for (const k of keys) t = insert(t, k);
      const h = height(t);
      return { concept: 'trees', title: 'How tall is the tree?', prompt: 'What does this program print?', why: 'height counts the nodes on the longest path from the root down to a leaf. The shape depends on the insertion order: each key goes left or right of every node on its way down.',
        code: program(`int[] keys = {${keys.join(', ')}};\nNode root = null;\nfor (int key : keys) {\n    root = insert(root, key);\n}\nSystem.out.println(height(root));`, `${NODE_CLASS}    static int height(Node node) {\n        if (node == null) {\n            return 0;\n        }\n        return 1 + Math.max(height(node.left), height(node.right));\n    }\n\n`),
        mistakes: [String(h - 1), String(h + 1), String(keys.length), String(Math.ceil(Math.log2(keys.length + 1)))] };
    },
  ],
  'binary-search': [
    r => {
      const values = distinctKeys(r, r.int(7, 12)).sort((a, b) => a - b);
      const present = r.next() < 0.6;
      let target = present ? r.pick(values) : r.int(1, 99);
      while (!present && values.includes(target)) target++;
      const answer = probes(values, target);
      return { concept: 'binary-search', title: 'Where does it look?', prompt: 'Which indexes does this program check, in order?', why: 'Each step checks the middle of the range that could still hold the target, then discards the half that can’t. (lo + hi) / 2 rounds down.',
        code: program(`int[] values = {${values.join(', ')}};\nint target = ${target};\nint lo = 0, hi = values.length - 1;\nStringBuilder checked = new StringBuilder();\nwhile (lo <= hi) {\n    int mid = (lo + hi) / 2;\n    checked.append(mid).append(' ');\n    if (values[mid] == target) {\n        break;\n    }\n    if (values[mid] < target) {\n        lo = mid + 1;\n    } else {\n        hi = mid - 1;\n    }\n}\nSystem.out.println(checked.toString().trim());`),
        mistakes: [spaced(probes(values, target, true)), spaced(answer.map(i => values[i])), spaced(Array.from({ length: values.indexOf(target) + 1 || values.length }, (_, i) => i)), answer.length > 1 ? spaced(answer.slice(0, -1)) : String(answer[0] + 1)] };
    },
    r => {
      const values = distinctKeys(r, r.int(8, 15)).sort((a, b) => a - b);
      let target = r.int(1, 99);
      while (values.includes(target)) target++;
      const steps = probes(values, target).length;
      return { concept: 'binary-search', title: 'Count the steps', prompt: 'What does this program print?', why: 'Every pass halves the range that could hold the target. When the target is missing, the loop runs until lo passes hi, about log₂(n) + 1 times.',
        code: program(`int[] values = {${values.join(', ')}};\nint target = ${target};\nint lo = 0, hi = values.length - 1;\nint steps = 0;\nwhile (lo <= hi) {\n    steps++;\n    int mid = (lo + hi) / 2;\n    if (values[mid] == target) {\n        break;\n    }\n    if (values[mid] < target) {\n        lo = mid + 1;\n    } else {\n        hi = mid - 1;\n    }\n}\nSystem.out.println(steps);`),
        mistakes: [String(steps - 1), String(steps + 1), String(values.length), String(Math.floor(Math.log2(values.length)))] };
    },
  ],
  sorting: [
    r => {
      const a = distinctKeys(r, r.int(5, 6));
      const kind = r.pick(['bubble', 'selection', 'insertion'] as const);
      const k = r.pick([1, 2] as const);
      const sort = SORTS[kind];
      const others = (['bubble', 'selection', 'insertion'] as const).filter(o => o !== kind);
      return { concept: 'sorting', title: `${sort.name}, ${k === 1 ? 'one pass' : 'two passes'}`, prompt: 'What does this program print?', why: 'Bubble sort moves the largest value to the end in each pass; selection sort swaps the smallest remaining value to the front; insertion sort slides the next value left into the sorted part.',
        code: `import java.util.Arrays;\n\n${program(`int[] a = {${a.join(', ')}};\n${sort.loop(k)}\nSystem.out.println(Arrays.toString(a));`)}`,
        mistakes: [...others.map(o => listText(SORTS[o].run(a, k))), listText(sort.run(a, k + 1)), listText([...a].sort((x, y) => x - y)), listText(sort.run(a, k - 1))] };
    },
  ],
} satisfies Record<string, Generator[]>);

/** What an AI-written problem should practice, for concepts that need a hint beyond their name. */
const AI_TOPICS: Record<string, string> = {
  bfs: 'breadth-first search on a small graph with a queue', dfs: 'depth-first search on a small graph, recursive or with a stack', trees: 'binary search trees: insertion and traversals',
  'binary-search': 'binary search on a sorted array, including off-by-one bounds', sorting: 'what a simple sorting algorithm does to an array after a few passes',
  'state-change': 'how objects and variables change as a program runs', types: 'implicit and explicit type conversions', 'compile-errors': 'common reasons javac rejects a program',
};
/** Only these imports may appear in AI-written programs; anything that reaches files, the network, processes or reflection is refused. */
const ALLOWED_IMPORT = /^import\s+java\.(util|math|time|text)(\.[\w*]+)*\s*;$/;
const FORBIDDEN = /\b(java\.(io|nio|net|lang\.reflect|lang\.invoke|security|sql)|javax?\.\w+\.\w*(Process|Socket|File)|ProcessBuilder|Runtime|System\s*\.\s*(exit|getenv|getProperty|setProperty|load|loadLibrary|setOut|setErr|setIn|in)\b|Class\s*\.\s*forName|getDeclared\w+|setAccessible|ClassLoader|Thread|Executor|native|Unsafe|Random|Math\s*\.\s*random|currentTimeMillis|nanoTime|Scanner|Files|Paths|Path\b)/;

/** Why an AI-written program can't be run here, or null if it passes the checks. */
export function unsafeProgram(code: string): string | null {
  for (const line of code.split('\n').map(l => l.trim()).filter(l => l.startsWith('import '))) if (!ALLOWED_IMPORT.test(line)) return `It imports something outside java.util, java.math, java.time and java.text (${line}).`;
  const found = code.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/gm, '').match(FORBIDDEN);
  if (found) return `It uses ${found[0]}, which practice programs aren’t allowed to use.`;
  if (!/public\s+class\s+Main\b/.test(code) || !/static\s+void\s+main\s*\(/.test(code)) return 'It has no public class Main with a main method.';
  return null;
}

/** The request for an AI-written practice problem. The answer is never taken from the model: the program is run. */
export function aiPracticeMessages(concept: string, label: string, seed: number, problem?: string): { role: 'system' | 'user'; content: string }[] {
  return [{ role: 'system', content: `You write short Java practice problems for students who are learning to read and debug code.
Reply with one JSON object and nothing else (no Markdown fences). Fields:
- "title": at most 6 words.
- "code": a complete Java 21 program in one file: a public class Main with a main method, at most 35 lines. Use only java.util, java.math and java.time. No input, no randomness, no time, no threads, no files. It finishes instantly and prints a short result (one or a few lines).
- "prompt": the question, usually "What does this program print?".
- "wrong": an array of 3 different wrong answers that come from real misconceptions, each written exactly as the program would print it. Write "It throws ExceptionName" for an exception and "It doesn’t compile" for a compile error.
- "why": one or two sentences on the idea to check, without stating the answer.
The correct answer is found by running your program, so the program must be valid Java.` },
  { role: 'user', content: `Concept: ${label}${AI_TOPICS[concept] ? ` (${AI_TOPICS[concept]})` : ''}. Write problem #${seed % 997} for it, with different values and structure from a textbook example.${problem ? `\nYour previous program couldn’t be used: ${problem} Write a new one.` : ''}` }];
}

/** Reads the model's reply into a practice item, or explains what is wrong with it. */
export function parseAiPractice(text: string, concept: string): PracticeItem | string {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return 'The reply wasn’t a JSON object.';
  let value: Record<string, unknown>;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return 'The reply wasn’t valid JSON.'; }
  const str = (k: string, max: number) => typeof value[k] === 'string' && (value[k] as string).trim().length > 0 && (value[k] as string).length <= max ? (value[k] as string).trim() : null;
  const title = str('title', 80), code = str('code', 4000), prompt = str('prompt', 240), why = str('why', 500);
  const wrong = Array.isArray(value.wrong) ? value.wrong.filter((w): w is string => typeof w === 'string' && w.trim().length > 0 && w.length <= 300).map(w => w.replace(/\r\n/g, '\n').trimEnd()) : [];
  if (!title || !code || !prompt || !why) return 'The reply was missing a title, program, question or explanation.';
  if (wrong.length < 2) return 'The reply had fewer than two wrong answers.';
  const unsafe = unsafeProgram(code);
  if (unsafe) return unsafe;
  return { concept, title, code: code.endsWith('\n') ? code : `${code}\n`, prompt, why, mistakes: [...new Set(wrong)].slice(0, 5), source: 'ai' };
}

export const practiceConcepts = Object.keys(generators);
export function hasPractice(concept: string) { return concept in generators; }

/** A practice program for a concept (any concept when there's no generator for it). */
export function practiceFor(concept: string, seed: number): PracticeItem {
  const r = random(seed);
  const list = generators[concept] ?? generators[r.pick(practiceConcepts)];
  return list[Math.floor(r.next() * list.length)](r);
}

/** What the JVM did with a practice program, from a plain (unrecorded) run's events. */
export function practiceOutcome(events: TraceEvent[]): PracticeOutcome {
  const error = events.find(e => e.kind === 'diagnostic' && e.severity === 'error');
  if (error) return { kind: 'compile-error', line: error.line ?? 0, message: (error.message ?? '').split('\n')[0] };
  const end = events.at(-1);
  if (end?.exception && !end.exception.caught) return { kind: 'exception', type: end.exception.type.split('.').at(-1)! };
  if (end?.stopReason === 'completed') return { kind: 'output', text: events.filter(e => e.kind === 'output' && e.stream === 'stdout').map(e => e.text ?? '').join('').replace(/\r\n/g, '\n').trimEnd() };
  return { kind: 'other', reason: end?.stopReason ?? 'unknown' };
}

/** The answer text for an outcome, in the same words the generators use for wrong answers. */
export function answerText(outcome: PracticeOutcome): string {
  if (outcome.kind === 'output') return outcome.text;
  if (outcome.kind === 'exception') return THROWS(outcome.type);
  if (outcome.kind === 'compile-error') return 'It doesn’t compile';
  return outcome.reason === 'timeout' || outcome.reason === 'output-limit' ? 'It never finishes' : `It stops: ${outcome.reason}`;
}

/** Options: the real answer plus up to three distinct wrong ones, in a seeded order. */
export function practiceOptions(item: PracticeItem, outcome: PracticeOutcome, seed: number): { options: string[]; correct: number } {
  const answer = answerText(outcome);
  const wrong = [...new Set(item.mistakes.filter(m => m !== answer))];
  const r = random(seed ^ 0x5bd1e995);
  for (let i = wrong.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [wrong[i], wrong[j]] = [wrong[j], wrong[i]]; }
  const options = [answer, ...wrong.slice(0, 3)];
  for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { options, correct: options.indexOf(answer) };
}
