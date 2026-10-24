import type { TraceEvent } from './types';

/**
 * Practice problems for a concept: small programs with randomized values. The correct answer is never computed
 * here: the IDE runs each program on the JVM and the answer is what Java actually did. Generators only supply
 * the program, the question, and wrong answers that reflect common misconceptions.
 */
export type PracticeOutcome = { kind: 'output'; text: string } | { kind: 'exception'; type: string } | { kind: 'compile-error'; line: number; message: string } | { kind: 'other'; reason: string };
export type PracticeItem = { concept: string; title: string; code: string; prompt: string; mistakes: string[]; why: string };

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
