import { exceptionGuide } from './exceptions.ts';
import { recursionTree } from './structures.ts';
import type { Check, HeapObject, Project, Question, Run, TraceEvent, TraceValue, Variable } from './types';

export function snapshots(run: Run | null): TraceEvent[] {
  return run?.events.filter(e => e.kind === 'line' || e.kind === 'exception' || e.kind === 'terminated') ?? [];
}

/** Expands the compact wire form of primitive arrays (`elementType` + `values`) into ordinary elements, in place. */
export function expandEvents(events: TraceEvent[]): TraceEvent[] {
  for (const event of events) {
    for (const object of event.heap ?? []) {
      if (!object.values) continue;
      const type = object.elementType;
      object.elements = object.values.map(value => ({ kind: 'primitive' as const, type, value }));
      delete object.values; delete object.elementType;
    }
  }
  return events;
}

export function output(run: Run, stream: string, sequence = Infinity): string {
  return run.events.filter(e => e.kind === 'output' && e.stream === stream && e.sequence <= sequence).map(e => e.text ?? '').join('');
}

export function normalizeOutput(text: string): string { return text.replace(/\r\n/g, '\n').trimEnd(); }
/** Pass/fail for a program-output test. Method-call tests are evaluated by tests.ts. */
export function checkPassed(run: Run, check: Check): boolean {
  return check.kind !== 'call' && run.events.at(-1)?.stopReason === 'completed' && normalizeOutput(output(run, 'stdout')) === normalizeOutput(check.expectedOutput);
}
export function valueText(value: TraceValue): string {
  if (value.kind === 'reference') return `@${value.ref}`;
  return value.value ?? 'null';
}
/** Files TraceLab generates to run method tests; they are not part of the student's project. */
const generated = (name: string) => name.split('/').at(-1) === 'TraceLabCall__.java';
/** Whether a run recorded exactly the project's current source. Method-test runs also match, ignoring their harness. */
export function sameSource(project: Project, run: Run): boolean {
  const recorded = run.request.files.filter(f => !generated(f.name));
  const harnessRun = recorded.length !== run.request.files.length;
  return (harnessRun || project.mainClass === run.request.mainClass) && project.files.length === recorded.length
    && project.files.every(file => recorded.some(r => r.name === file.name && r.content === file.content));
}

/**
 * The exception's message. JVM-created NullPointerExceptions compute their helpful message lazily, and the tracer
 * never invokes target methods, so for an uncaught exception fall back to the message the JVM printed to stderr.
 */
export function exceptionMessage(run: Run, event: TraceEvent): string {
  const exception = event.exception;
  if (!exception) return '';
  if (exception.message || exception.caught) return exception.message;
  const prefix = `${exception.type}: `;
  const line = output(run, 'stderr').split(/\r?\n/).find(l => l.startsWith('Exception in thread ') && l.includes(prefix));
  return line ? line.slice(line.indexOf(prefix) + prefix.length).trim() : '';
}

/** A completed traced run whose input matches a check but whose output does not. */
export function failingCheck(run: Run | null, checks: Check[]): { check: Check; actual: string } | null {
  if (!run || run.status !== 'finished' || run.events.at(-1)?.stopReason !== 'completed' || run.request.files.some(f => generated(f.name))) return null;
  const check = checks.find(c => c.kind !== 'call' && normalizeOutput(c.stdin) === normalizeOutput(run.request.stdin));
  if (!check || checkPassed(run, check)) return null;
  return { check, actual: normalizeOutput(output(run, 'stdout')) };
}

const IDENT = '[A-Za-z_$][\\w$]*';
const shortName = (qualified: string) => qualified.split('.').at(-1) ?? qualified;
const code = (text: string) => `\`${text}\``;

function recordedLine(run: Run, file: string, line: number): string | undefined {
  return run.request.files.find(f => f.name === file)?.content.split(/\r?\n/)[line - 1];
}
function heapOf(state: TraceEvent): Map<string, HeapObject> { return new Map((state.heap ?? []).map(o => [o.id, o])); }
function local(state: TraceEvent | undefined, name: string): Variable | undefined { return state?.frames?.[0]?.locals.find(v => v.name === name); }

/** Deterministically rotates options so the correct answer is not always first. */
function make(base: Omit<Question, 'options' | 'correct'>, options: string[], answer: number): Question {
  let hash = 0;
  for (const c of base.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const shift = hash % options.length;
  return { ...base, options: options.map((_, i) => options[(i + shift) % options.length]), correct: (answer - shift + options.length) % options.length };
}

function exceptionQuestions(run: Run, states: TraceEvent[]): Question[] {
  const index = states.findIndex(e => e.exception && !e.exception.caught);
  if (index < 0) return [];
  const event = states[index];
  const exception = event.exception!;
  const location = event.location!;
  const where = `${location.file}:${location.line}`;
  const out: Question[] = [];
  if (/(Array|String)IndexOutOfBoundsException$/.test(exception.type)) {
    const isString = exception.type.endsWith('StringIndexOutOfBoundsException');
    const noun = isString ? 'String' : 'array';
    const match = exception.message.match(/Index (-?\d+) out of bounds for length (\d+)/i);
    const length = match ? Number(match[2]) : -1;
    out.push(make({ id: isString ? 'string-bounds' : 'array-bounds', kind: 'explain', concept: isString ? 'string-bounds' : 'array-bounds', title: 'Explain the failed access',
      context: match ? `The JVM reported index ${match[1]} for ${isString ? 'a String' : 'an array'} of length ${match[2]} at ${where}.` : `The JVM reported an invalid ${noun} access at ${where}: ${exception.message}`,
      prompt: length > 0 ? `Which indices are valid for this length-${length} ${noun}?` : `What must be true before accessing an element of this ${noun}?`,
      explanation: `${isString ? 'A String' : 'An array'} of length n has indices 0 through n − 1. When it is empty, no index is valid. Check the value used by the access and the condition that allows execution to reach it.`,
      hints: ['Compare the reported index with the array length.', 'Look at the condition that allowed the failed access. Does it include the upper boundary?'], step: index },
      length > 0 ? [`0 through ${length - 1}`, `1 through ${length}`, `0 through ${length}`] : ['0 <= i && i < values.length', '0 <= i && i <= values.length', 'i can equal values.length'], 0));
    // Repair: `s.charAt(s.length() - v)` where the recorded values make the index equal the length.
    const text = recordedLine(run, location.file, location.line);
    const charAt = text?.match(new RegExp(`(${IDENT})\\.charAt\\(\\s*\\1\\.length\\(\\)\\s*-\\s*(${IDENT})\\s*\\)`));
    if (match && charAt && text && local(event, charAt[2])?.value.kind === 'primitive' && Number(match[2]) - Number(local(event, charAt[2])!.value.value) === Number(match[1])) {
      const [expression, s, v] = charAt;
      out.push(make({ id: 'charat-repair', kind: 'repair', concept: 'string-bounds', title: 'Choose the repair',
        context: `Line ${location.line} reads ${code(text.trim())}. With ${code(v)} = ${local(event, v)!.value.value}, ${code(expression)} asked for index ${match[1]}, one past the last valid index ${length - 1}.`,
        prompt: `Which expression reads the character that mirrors index ${code(v)}?`,
        explanation: `The last character is at ${code(`${s}.length() - 1`)}, so the mirror of index ${code(v)} is ${code(`${s}.length() - 1 - ${v}`)}. Make the edit, then run the tests.`,
        hints: ['What is the index of the last character?', `When ${code(v)} is 0, which index should be read?`],
        step: index, focus: { file: location.file, line: location.line }, code: text.trim() },
        [code(`${s}.charAt(${s}.length() - 1 - ${v})`), code(`${s}.charAt(${s}.length() - ${v} + 1)`), code(`${s}.charAt(${s}.length() - ${v}) - 1`)], 0));
    }
    // Repair: only when the failing index equals the length and a nearby loop condition admits that value.
    if (match && match[1] === match[2] && !charAt) {
      for (let line = location.line; line >= Math.max(1, location.line - 15); line--) {
        const text = recordedLine(run, location.file, line);
        const found = text?.match(new RegExp(`\\b(${IDENT})\\s*<=\\s*(${IDENT}(?:\\.${IDENT})*\\.(?:length\\b|size\\(\\)))`));
        if (!text || !found || !/\b(for|while)\b/.test(text)) continue;
        const [condition, variable, bound] = found;
        if (local(event, variable)?.value.value !== match[1]) break; // The recorded state does not support the premise.
        out.push(make({ id: 'bounds-repair', kind: 'repair', concept: 'array-bounds', title: 'Choose the repair',
          context: `Line ${line} reads ${code(text.trim())}. When the access failed, ${code(variable)} was ${match[1]}, equal to the length, and ${code(condition)} still allowed the loop body to run.`,
          prompt: 'Which loop condition keeps every access in range, including for an empty array?',
          explanation: `${code(`${variable} < ${bound}`)} stops the loop when ${code(variable)} reaches the length, so the last access uses index length − 1. With an empty array, the body never runs. Make the edit yourself, then check your repair.`,
          hints: [`The loop has to stop before ${code(variable)} equals the length.`, 'Which comparison operator excludes the boundary value itself?'],
          step: index, focus: { file: location.file, line }, code: text.trim() },
          [code(`${variable} < ${bound}`), code(`${variable} <= ${bound} + 1`), code(`${variable} < ${bound} + 1`)], 0));
        break;
      }
    }
  } else if (exception.type.endsWith('NullPointerException')) {
    const message = exceptionMessage(run, event);
    const mapGet = message.match(/because the return value of "java\.util\.(?:Hash|LinkedHash|Tree)?Map\.get\(Object\)" is null/);
    const nullName = message.match(new RegExp(`because "(${IDENT})" is null`))?.[1];
    const others = (event.frames?.[0]?.locals ?? []).filter(v => v.name !== nullName && v.name !== 'this').map(v => v.name);
    if (mapGet) {
      out.push(make({ id: 'map-missing-key', kind: 'explain', concept: 'null-reference', title: 'What does get return?', context: `${where}: ${message}`,
        prompt: 'What does Map.get return for a key that is not in the map yet?',
        explanation: 'Map.get returns null when the key has no entry. Unboxing that null to do arithmetic throws a NullPointerException. The map card shows which keys existed at this moment.',
        hints: ['Inspect the map card: is the current key one of its entries?', 'What happens when Java converts a null Integer to an int?'], step: index },
        ['null, because the key has no entry yet', '0, because missing keys start at zero', 'An empty string'], 0));
      const text = recordedLine(run, location.file, location.line);
      const found = text?.match(new RegExp(`(${IDENT})\\.get\\(([^()]+)\\)\\s*\\+\\s*1\\b`));
      if (text && found) {
        const [, map, key] = found;
        out.push(make({ id: 'map-repair', kind: 'repair', concept: 'null-reference', title: 'Choose the repair',
          context: `Line ${location.line} reads ${code(text.trim())}. For a new key, ${code(`${map}.get(${key})`)} produced null before the addition.`,
          prompt: 'Which expression counts the first occurrence as 1 without unboxing null?',
          explanation: `${code(`${map}.getOrDefault(${key}, 0)`)} supplies 0 when the key is missing, so the first occurrence stores 1. Make the edit, then check your repair.`,
          hints: ['You need a value to use when the key is missing.', 'Map has a method that takes a fallback value.'],
          step: index, focus: { file: location.file, line: location.line }, code: text.trim() },
          [code(`${map}.getOrDefault(${key}, 0) + 1`), code(`${map}.get(${key}) + 0`), code(`${map}.get(${key} + 1)`)], 0));
      }
    } else if (fieldQuestion(run, event, index, message)) {
      out.push(...fieldQuestion(run, event, index, message)!);
    } else if (nullName && local(event, nullName)?.value.kind === 'null' && others.length >= 2) {
      out.push(make({ id: 'null', kind: 'explain', concept: 'null-reference', title: 'Find the missing object', context: `${where}: ${message}`,
        prompt: 'Which variable held null when this line ran?',
        explanation: `The recorded frame shows ${code(nullName)} = null. A null reference does not refer to an object, so calling a method or reading a field through it fails. Trace backward to where ${code(nullName)} was assigned.`,
        hints: ['Inspect the locals in the current frame.', 'Step backward to the assignment that produced null.'], step: index },
        [code(nullName), code(others[0]), code(others[1])], 0));
    } else {
      out.push(make({ id: 'null', kind: 'explain', concept: 'null-reference', title: 'Explain the missing object', context: `${where}: ${message || exception.type}`,
        prompt: 'What does this exception tell us about a reference used by the failing operation?',
        explanation: 'A null reference does not refer to an object. Identify the reference used by the failing operation and trace where it should have been initialized.',
        hints: ['Inspect the local references and object fields.', 'Trace backward to the assignment that produced null.'], step: index },
        ['It was null when an object was required.', 'Every object in the program was deleted.', 'The compiler could not find the class.'], 0));
    }
  } else if (exception.type.endsWith('ArithmeticException') && exception.message.includes('/ by zero')) {
    out.push(make({ id: 'division', kind: 'explain', concept: 'division-by-zero', title: 'Explain the arithmetic failure', context: `${where}: ${exception.message}`,
      prompt: 'What can cause this integer arithmetic exception?',
      explanation: 'Integer division and remainder require a nonzero divisor. Check the divisor and the input or computation that produced it.',
      hints: ['Inspect the divisor at the highlighted line.'], step: index },
      ['Division or remainder with a zero divisor.', 'Any negative result.', 'Any decimal result.'], 0));
    // Repair: the divisor is a local recorded as 0, and the line assigns the quotient.
    const text = recordedLine(run, location.file, location.line)?.trim() ?? '';
    const divisor = text.match(new RegExp(`/\\s*(${IDENT})\\b(?!\\s*\\()`))?.[1];
    const assign = text.match(new RegExp(`^((?:int|long|short|byte)\\s+)?(${IDENT})\\s*=\\s*(.+);$`));
    if (divisor && assign && local(event, divisor)?.value.value === '0') {
      const [, type = '', target, expression] = assign;
      const divisorPattern = new RegExp(`/\\s*${divisor}\\b`);
      out.push(make({ id: 'division-repair', kind: 'repair', concept: 'division-by-zero', title: 'Choose the repair',
        context: `Line ${location.line} reads ${code(text)}. ${code(divisor)} was 0 when it ran, and the tests expect ${code('0')} when there is nothing to average.`,
        prompt: `Which version handles ${code(`${divisor} == 0`)} without changing the answer for normal input?`,
        explanation: `Checking the divisor first avoids the division entirely when ${code(divisor)} is 0. Dividing by ${code(`${divisor} + 1`)} avoids the exception but changes every other average, and ${code('%')} by zero throws the same exception.`,
        hints: ['The fix should only matter when the divisor is 0.', 'Would the second option still give 80 for 90, 80 and 70?'],
        step: index, focus: { file: location.file, line: location.line }, code: text },
        [code(`${type}${target} = ${divisor} == 0 ? 0 : ${expression};`), code(`${type}${target} = ${expression.replace(divisorPattern, `/ (${divisor} + 1)`)};`), code(`${type}${target} = ${expression.replace(divisorPattern, `% ${divisor}`)};`)], 0));
    }
  } else if (exception.type.endsWith('NumberFormatException')) {
    const input = exception.message.match(/For input string: "(.*)"/)?.[1];
    const text = recordedLine(run, location.file, location.line)?.trim() ?? '';
    if (input !== undefined) {
      const whole = /^[+-]?\d+$/.test(input);
      const correct = input === '' ? 'The text was empty, so there was no number to read.'
        : whole ? `"${input}" is a whole number, but too large for an int.` : `"${input}" is not written as a whole number, so it cannot be read as an int.`;
      const distractors = ['Integer.parseInt only accepts numbers typed in the source code.', 'The Scanner closed the input before it was read.'];
      out.push(make({ id: 'parse', kind: 'explain', concept: 'parsing-input', title: 'Explain the conversion failure',
        context: `${where}: Integer.parseInt received ${JSON.stringify(input)} and threw NumberFormatException.`,
        prompt: 'Why could this text not be converted?',
        explanation: 'Integer.parseInt accepts only an optional sign followed by digits that fit in an int. Anything else, including a decimal point, is rejected.',
        hints: ['Look at the exact text in the exception message.', 'Is a decimal point part of an int?'], step: index },
        [correct, ...distractors], 0));
      const parse = text.match(new RegExp(`^int\\s+(${IDENT})\\s*=\\s*Integer\\.parseInt\\((.+)\\);$`));
      if (parse && /^[+-]?\d*\.\d+$/.test(input)) {
        const [, name, argument] = parse;
        out.push(make({ id: 'parse-repair', kind: 'repair', concept: 'parsing-input', title: 'Choose the repair',
          context: `Line ${location.line} reads ${code(text)}. The input ${JSON.stringify(input)} has a fractional part.`,
          prompt: 'Which line reads a price that may include cents?',
          explanation: `${code('Double.parseDouble')} accepts decimal text such as ${JSON.stringify(input)}. Trimming spaces does not remove the decimal point, and a String cannot be cast to an int.`,
          hints: ['You need a type that can hold a fractional part.'],
          step: index, focus: { file: location.file, line: location.line }, code: text },
          [code(`double ${name} = Double.parseDouble(${argument});`), code(`int ${name} = Integer.parseInt(${argument}.trim());`), code(`int ${name} = (int) ${argument};`)], 0));
      }
    }
  } else if (exception.type.endsWith('ConcurrentModificationException')) {
    out.push(...modificationQuestions(run, states, index));
  } else {
    out.push(...otherExceptionQuestions(run, event, index));
  }
  return out;
}

/** NPE on `this.field`: the recorded object shows the field as null; repair initializes a JDK collection field. */
function fieldQuestion(run: Run, event: TraceEvent, index: number, message: string): Question[] | null {
  const field = message.match(new RegExp(`because "this\\.(${IDENT})" is null`))?.[1];
  const self = local(event, 'this');
  const object = self?.value.ref ? heapOf(event).get(self.value.ref) : undefined;
  const value = object?.fields?.find(f => f.name.endsWith(`.${field}`));
  if (!field || !object || value?.value.kind !== 'null') return null;
  const location = event.location!;
  const owner = shortName(object.type);
  const others = (event.frames?.[0]?.locals ?? []).filter(v => v.name !== 'this').map(v => code(v.name));
  const out = [make({ id: 'null-field', kind: 'explain', concept: 'null-reference', title: 'Find the missing object',
    context: `${location.file}:${location.line}: ${message}`,
    prompt: 'Which reference was null when this line ran?',
    explanation: `The ${owner} object’s ${code(field)} field is null: it was declared but never assigned an object. Calling a method through it fails.`,
    hints: [`Expand the ${owner} card in the heap.`, 'Where in the class is this field given a value?'], step: index },
    [`${code(field)}, a field of this ${owner} that was never assigned`, ...others.slice(0, 1), `${code('this')}, the ${owner} object itself`].slice(0, 3), 0)];
  for (const file of run.request.files) {
    if (!new RegExp(`\\bclass\\s+${owner}\\b`).test(file.content)) continue;
    const lines = file.content.split(/\r?\n/);
    const pattern = new RegExp(`^(\\s*)((?:(?:private|protected|public|final)\\s+)*)((ArrayList|LinkedList|HashMap|TreeMap|HashSet|TreeSet|ArrayDeque|StringBuilder)(<[^;=]*>)?)\\s+${field}\\s*;\\s*$`);
    const line = lines.findIndex(l => pattern.test(l));
    if (line < 0) break;
    const [, , modifiers, type, base, generic] = lines[line].match(pattern)!;
    out.push(make({ id: 'field-repair', kind: 'repair', concept: 'null-reference', title: 'Choose the repair',
      context: `${file.name} line ${line + 1} declares ${code(lines[line].trim())}. A field of object type starts as null until something assigns it.`,
      prompt: `Which declaration gives every ${owner} its own ${simpleName(base)}?`,
      explanation: `Initializing the field creates a new ${simpleName(base)} for each ${owner}, so ${code(`${field}.add(…)`)} has an object to call. Assigning null or changing visibility leaves it null.`,
      hints: ['Something has to create the object with new.'],
      step: index, focus: { file: file.name, line: line + 1 }, code: lines[line].trim() },
      [code(`${modifiers}${type} ${field} = new ${base}${generic ? '<>' : ''}();`), code(`${modifiers}${type} ${field} = null;`), code(`public ${type} ${field};`)], 0));
    break;
  }
  return out;
}
const simpleName = (type: string) => type.replace(/<.*$/, '');

/** A for-each loop shrank its own list, then the iterator threw. */
function modificationQuestions(run: Run, states: TraceEvent[], index: number): Question[] {
  let shrink: { name: string; from: number; to: number } | null = null;
  for (let i = 1; i <= index && !shrink; i++) {
    const before = heapOf(states[i - 1]);
    for (const object of states[i].heap ?? []) {
      const old = before.get(object.id);
      if (object.kind !== 'list' || old?.length === undefined || object.length === undefined || object.length >= old.length) continue;
      const name = states[i].frames?.flatMap(f => f.locals).find(v => v.value.ref === object.id)?.name;
      if (name) { shrink = { name, from: old.length, to: object.length }; break; }
    }
  }
  if (!shrink) return [];
  const event = states[index];
  const location = event.location!;
  const out = [make({ id: 'modification', kind: 'explain', concept: 'concurrent-modification', title: 'Explain the exception',
    context: `${code(shrink.name)} went from ${shrink.from} to ${shrink.to} elements inside the loop at ${location.file}:${location.line}, and the loop’s next step threw ConcurrentModificationException.`,
    prompt: 'What does this exception mean here?',
    explanation: 'A for-each loop uses an iterator. When the list changes size behind the iterator’s back, the next step detects it and throws. No second thread is involved.',
    hints: ['Watch the list’s size between the stops before the exception.', 'Which statement inside the loop changes the list?'], step: index },
    ['The loop removed an element from the list it was iterating over.', 'Two threads changed the list at the same time.', 'The list contained a null element.'], 0)];
  const lines = run.request.files.find(f => f.name === location.file)?.content.split(/\r?\n/) ?? [];
  const header = lines.findIndex(l => new RegExp(`for\\s*\\(\\s*[\\w<>]+\\s+(${IDENT})\\s*:\\s*${shrink!.name}\\s*\\)`).test(l));
  const variable = header >= 0 ? lines[header].match(new RegExp(`for\\s*\\(\\s*[\\w<>]+\\s+(${IDENT})\\s*:`))![1] : '';
  const condition = lines.slice(header + 1, header + 6).map(l => l.match(/^\s*if\s*\((.*)\)\s*\{?\s*$/)?.[1]).find(Boolean);
  if (header >= 0 && condition && lines.slice(header + 1, header + 8).some(l => l.includes(`${shrink!.name}.remove(${variable})`))) {
    out.push(make({ id: 'modification-repair', kind: 'repair', concept: 'concurrent-modification', title: 'Choose the repair',
      context: `Line ${header + 1} loops over ${code(shrink.name)} and removes from it when ${code(condition)}.`,
      prompt: 'Which change removes every matching name safely?',
      explanation: `${code('removeIf')} lets the list remove matching elements itself, without an iterator in your code to invalidate. Catching the exception or stopping after one removal leaves names behind.`,
      hints: ['Can the list do the removal for you?', 'Would stopping after the first removal still remove “Cy”?'],
      step: index, focus: { file: location.file, line: header + 1 }, code: lines[header].trim() },
      [`Replace the loop with ${code(`${shrink.name}.removeIf(${variable} -> ${condition});`)}`, `Wrap ${code(`${shrink.name}.remove(${variable})`)} in try/catch and keep looping`, `Add ${code('break;')} right after the first removal`], 0));
  }
  return out;
}

/**
 * Any other uncaught exception (list indexes, Scanner input, casts, unmodifiable lists, stack overflow, …): an explain
 * question whose answer is the exception's meaning and whose distractors describe other exceptions.
 */
function otherExceptionQuestions(run: Run, event: TraceEvent, index: number): Question[] {
  const exception = event.exception!;
  const name = shortName(exception.type);
  const message = exceptionMessage(run, event);
  const guide = exceptionGuide(exception.type, message);
  if (guide.meaning.startsWith('The program threw')) return [];
  const others = ['NullPointerException', 'ArithmeticException', 'NumberFormatException', 'ClassCastException', 'NoSuchElementException', 'UnsupportedOperationException', 'IndexOutOfBoundsException']
    .filter(n => n !== name).map(n => exceptionGuide(n, '/ by zero').meaning);
  const location = event.location!;
  const text = recordedLine(run, location.file, location.line)?.trim() ?? '';
  const id = name.replace(/Exception$|Error$/, '').toLowerCase();
  // Input problems: say what the program read, since the Input tab is where the fix often is.
  const input = /InputMismatch|NoSuchElement/.test(name) && run.request.stdin.trim()
    ? ` The input had ${run.request.stdin.trim().split(/\s+/).length} token${run.request.stdin.trim().split(/\s+/).length === 1 ? '' : 's'}: ${code(run.request.stdin.trim().slice(0, 60))}.` : '';
  return [make({ id: `exception-${id}`, kind: 'explain', concept: /Input|NoSuchElement/.test(name) ? 'parsing-input' : /IndexOutOfBounds/.test(name) ? 'array-bounds' : /StackOverflow/.test(name) ? 'recursion' : 'state-change',
    title: 'Explain the exception', context: `${location.file}:${location.line} threw ${code(name)}${message ? `: “${message}”` : ''}. The line reads ${code(text)}.${input}`,
    prompt: `What does ${code(name)} mean here?`, explanation: `${guide.meaning} Common causes: ${guide.causes.join(' ')}`,
    hints: ['Read the exception message: it usually names the value or index involved.', guide.causes[0] ?? 'Step back from the exception to see the values that led to it.'], step: index, focus: { file: location.file, line: location.line }, code: text },
    [guide.meaning, others[0], others[1]], 0)];
}

/** javac errors: explained from the diagnostic text and the recorded line. */
function compileQuestions(run: Run): Question[] {
  const diagnostic = run.events.find(e => e.kind === 'diagnostic' && e.severity === 'error');
  if (!diagnostic?.file || !diagnostic.line) return [];
  const text = recordedLine(run, diagnostic.file, diagnostic.line)?.trim() ?? '';
  const where = `${diagnostic.file}:${diagnostic.line}`;
  const focus = { file: diagnostic.file, line: diagnostic.line };
  const message = diagnostic.message ?? '';
  const out: Question[] = [];
  const lossy = message.match(/possible lossy conversion from (\w+) to (\w+)/);
  if (lossy) {
    const [, from, to] = lossy;
    out.push(make({ id: 'lossy', kind: 'explain', concept: 'types', title: 'Read the compiler error',
      context: `javac stopped at ${where}: “incompatible types: possible lossy conversion from ${from} to ${to}”. The line reads ${code(text)}.`,
      prompt: 'What is the compiler objecting to?',
      explanation: `The right-hand side produces ${article(from)} ${from}. Storing it in ${article(to)} ${to} could lose information, such as a fractional part, so Java makes you choose: change the variable’s type or convert explicitly.`,
      hints: ['What type does the right-hand side produce?', 'Can an int hold 3.5?'], step: -1, focus, code: text },
      [`The right side is ${article(from)} ${from}, and storing it in ${article(to)} ${to} could lose information.`, 'Java cannot divide by a decimal number.', 'The variable must be declared before the line that assigns it.'], 0));
    const declaration = text.match(new RegExp(`^(?:final\\s+)?${to}\\s+(${IDENT})\\s*=\\s*(.+);$`));
    if (declaration) {
      const [, name, expression] = declaration;
      out.push(make({ id: 'lossy-repair', kind: 'repair', concept: 'types', title: 'Choose the repair',
        context: `The tests expect the exact result, including any fractional part.`,
        prompt: `Which line compiles and keeps the fractional part of ${code(expression)}?`,
        explanation: `Declaring ${code(name)} as ${article(from)} ${from} stores the value without loss. Adding 0 or parentheses does not change the expression’s type, so those still fail to compile.`,
        hints: ['Which type can hold the result as it is?'], step: -1, focus, code: text },
        [code(`${from} ${name} = ${expression};`), code(`${to} ${name} = ${expression} + 0;`), code(`${to} ${name} = (${expression});`)], 0));
    }
  }
  // Only for variables: an unknown method or class has other causes (arrays have no length(), a missing import),
  // which the compile-help card explains.
  const missing = message.match(/cannot find symbol[\s\S]*?symbol:\s+variable\s+([\w$]+)/);
  if (missing && !/location:\s+variable\s/.test(message)) {
    const name = missing[1];
    const source = run.request.files.find(f => f.name === diagnostic.file)?.content ?? '';
    const words = [...new Set(source.match(new RegExp(IDENT, 'g')) ?? [])].filter(w => w !== name);
    const suggestion = words.map(w => [w, editDistance(w, name)] as const).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1])[0]?.[0];
    out.push(make({ id: 'missing-symbol', kind: 'explain', concept: 'compile-errors', title: 'Read the compiler error',
      context: `javac stopped at ${where}: it cannot find ${code(name)}. The line reads ${code(text)}.`,
      prompt: `Why can’t the compiler find ${code(name)}?`,
      explanation: suggestion ? `No declaration named ${code(name)} is visible here. The file does declare ${code(suggestion)}; check the spelling, and check that the declaration is in scope at this line.` : `No declaration named ${code(name)} is visible here. Declare it, or check its spelling and scope.`,
      hints: ['Search the file for where this name is declared.'], step: -1, focus, code: text },
      [suggestion ? `Nothing named ${code(name)} is declared here; it may be a misspelling of ${code(suggestion)}.` : `Nothing named ${code(name)} is declared in this scope.`, 'Every variable needs an import statement.', 'Variables must be declared final before use.'], 0));
  }
  return out;
}

const article = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a';

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** A double assigned from int / int, where the recorded operands prove the fraction was dropped. */
function integerDivisionQuestions(run: Run, states: TraceEvent[]): Question[] {
  for (let i = 0; i < states.length - 1; i++) {
    const a = states[i], b = states[i + 1];
    if (a.kind !== 'line' || !a.frames?.[0] || b.frames?.[0]?.id !== a.frames[0].id) continue;
    const text = recordedLine(run, a.location!.file, a.location!.line)?.trim() ?? '';
    const found = text.match(new RegExp(`^(?:(double|float)\\s+)?(${IDENT})\\s*=\\s*(${IDENT})\\s*/\\s*(${IDENT}(?:\\.length|\\.size\\(\\))?)\\s*;$`));
    if (!found) continue;
    const [, declared, target, left, right] = found;
    const result = local(b, target);
    const leftValue = local(a, left);
    if (!result || !['double', 'float'].includes(result.type) || !/^-?\d+\.0$/.test(result.value.value ?? '')) continue;
    if (!leftValue || !['int', 'long', 'short', 'byte'].includes(leftValue.type)) continue;
    let rightValue: number | undefined;
    const member = right.match(new RegExp(`^(${IDENT})\\.(length|size\\(\\))$`));
    if (member) {
      const ref = local(a, member[1])?.value.ref;
      const object = ref ? heapOf(a).get(ref) : undefined;
      if (object && (member[2] === 'length' ? object.kind === 'array' : object.kind === 'list')) rightValue = object.length;
    } else if (['int', 'long', 'short', 'byte'].includes(local(a, right)?.type ?? '')) rightValue = Number(local(a, right)!.value.value);
    const l = Number(leftValue.value.value);
    if (!rightValue || l % rightValue === 0 || Math.trunc(l / rightValue) !== Number(result.value.value)) continue;
    const exact = l / rightValue;
    const type = declared ?? result.type;
    const out = [make({ id: 'integer-division', kind: 'explain', concept: 'integer-division', title: 'Where did the decimals go?',
      context: `Line ${a.location!.line} ran with ${code(left)} = ${l} and ${code(right)} = ${rightValue}. Afterwards ${code(target)} was recorded as ${result.value.value}, not ${exact}.`,
      prompt: 'Why was the fractional part lost?',
      explanation: `${code(left)} and ${code(right)} are both ints, so ${code(`${left} / ${right}`)} is integer division: it produces ${Math.trunc(exact)} and drops the remainder. Only then is the result widened to ${type}.`,
      hints: ['What are the types of the two operands?', 'When does the conversion to double happen: before or after the division?'],
      step: i, focus: { file: a.location!.file, line: a.location!.line }, code: text },
      [`Both operands are ints, so Java divides as integers before storing the result in the ${type}.`, `A ${type} cannot store more than one decimal place.`, 'println rounds floating-point numbers to whole numbers.'], 0)];
    out.push(make({ id: 'integer-division-repair', kind: 'repair', concept: 'integer-division', title: 'Choose the repair',
      context: `Line ${a.location!.line} reads ${code(text)}.`,
      prompt: `Which line computes ${exact}?`,
      explanation: `Casting ${code(left)} before dividing makes the division floating-point. Casting the result of ${code(`(${left} / ${right})`)} or multiplying by 1.0 afterwards is too late: the integer division has already happened.`,
      hints: ['The conversion has to happen before the division.'],
      step: i, focus: { file: a.location!.file, line: a.location!.line }, code: text },
      [code(`${declared ? `${declared} ` : ''}${target} = (${type}) ${left} / ${right};`), code(`${declared ? `${declared} ` : ''}${target} = (${type}) (${left} / ${right});`), code(`${declared ? `${declared} ` : ''}${target} = ${left} / ${right} * 1.0;`)], 0));
    return out;
  }
  return [];
}

/** A method changes a primitive parameter, and the caller's variable keeps its value after the call. */
function passByValueQuestions(states: TraceEvent[]): Question[] {
  const seen = new Set<string>();
  for (let i = 0; i < states.length; i++) {
    const frame = states[i].frames?.[0];
    if (!frame || (states[i].frames?.length ?? 0) < 2 || seen.has(frame.id)) continue;
    seen.add(frame.id);
    const caller = states[i].frames![1];
    const lastIndex = states.findLastIndex(s => s.frames?.[0]?.id === frame.id);
    const last = states[lastIndex].frames![0];
    const after = states.findIndex((s, j) => j > lastIndex && s.frames?.[0]?.id === caller.id);
    if (after < 0) continue;
    for (const parameter of frame.locals.filter(v => v.argument && v.value.kind === 'primitive')) {
      const final = last.locals.find(v => v.name === parameter.name)?.value.value;
      if (final === undefined || final === parameter.value.value) continue;
      const original = caller.locals.find(v => v.value.kind === 'primitive' && v.value.value === parameter.value.value
        && states[after].frames![0].locals.find(w => w.name === v.name)?.value.value === v.value.value);
      if (!original) continue;
      const method = displayName(frame.method), callerName = displayName(caller.method);
      const out = [make({ id: 'pass-by-value', kind: 'predict', concept: 'pass-by-value', title: 'Predict after the call',
        context: `Inside ${code(method)}, parameter ${code(parameter.name)} changed from ${parameter.value.value} to ${final}. When ${code(method)} was called, ${code(original.name)} in ${code(callerName)} was ${parameter.value.value}.`,
        prompt: `After ${code(method)} returns, what is ${code(original.name)} in ${code(callerName)}?`,
        explanation: `Java passes primitive arguments by value: ${code(parameter.name)} started as a copy of ${code(original.name)}’s value. The recorded run shows ${code(original.name)} is still ${parameter.value.value} after the call.`,
        hints: ['Is the parameter the same variable as the caller’s, or a copy?', 'Step forward past the return and look at the caller’s frame.'], step: lastIndex },
        [`${parameter.value.value}, because ${method} changed only its own copy`, `${final}, because ${parameter.name} and ${original.name} are the same variable`, `0, because the method’s variables are cleared`], 0)];
      out.push(make({ id: 'pass-by-value-repair', kind: 'repair', concept: 'pass-by-value', title: 'Choose the repair',
        context: `${code(method)} reassigns its parameters, but ${code(callerName)}’s variables are separate.`,
        prompt: `Which change makes ${code(callerName)}’s variables actually change?`,
        explanation: `A method cannot reassign its caller’s primitive variables. Do the assignment in ${code(callerName)}, or return the new value and assign it there. Renaming parameters does not connect them to the caller’s variables.`,
        hints: ['Which method owns the variables you want to change?'], step: after },
        [`Do the reassignment in ${code(callerName)} itself, or return the new value and assign it there`, `Rename ${code(method)}’s parameters to match ${code(callerName)}’s variable names`, `Declare ${code(method)}’s parameters as ${code('final')}`], 0));
      return out;
    }
  }
  return [];
}
const displayName = (method: string) => method.split('.').at(-1) ?? method;

/** The step budget ran out while one method kept calling itself and no activation of it returned. */
function recursionQuestions(run: Run, states: TraceEvent[]): Question[] {
  const reason = run.events.at(-1)?.stopReason;
  if (reason !== 'step-limit' && reason !== 'timeout') return [];
  const lastIndex = states.findLastIndex(s => s.frames?.length);
  const last = states[lastIndex];
  const method = last?.frames?.[0]?.method;
  if (!method || last.frames!.filter(f => f.method === method).length < 12) return [];
  if (states.some(s => s.returns?.some(r => r.method === method))) return [];
  const calls = new Set(states.flatMap(s => s.frames ?? []).filter(f => f.method === method).map(f => f.id)).size;
  const parameter = last.frames![0].locals.find(v => v.argument && v.value.kind === 'primitive');
  const first = parameter ? states.flatMap(s => s.frames ?? []).find(f => f.method === method)?.locals.find(v => v.name === parameter.name) : undefined;
  const name = displayName(method);
  const where = last.location!;
  const out = [make({ id: 'runaway-recursion', kind: 'explain', concept: 'recursion', title: 'Why doesn’t the recursion end?',
    context: `The run recorded ${calls} nested calls to ${code(name)} before the ${reason === 'timeout' ? 'time' : 'step'} budget stopped it, and none of them returned.${parameter && first ? ` ${code(parameter.name)} went from ${first.value.value} to ${parameter.value.value}.` : ''}`,
    prompt: `Why does ${code(name)} keep calling itself?`,
    explanation: `Every call to ${code(name)} makes another call before it can return, so the stack only grows. Given enough steps, the JVM would throw StackOverflowError. A base case returns without recursing.`,
    hints: ['Is there any path through the method that does not call itself?', 'Watch the parameter shrink past the value where the answer is obvious.'], step: lastIndex },
    [`Nothing stops ${name}: it has no base case that returns without calling itself.`, 'The step budget is too small for recursion.', 'Recursive methods must be declared void.'], 0)];
  const lines = run.request.files.find(f => f.name === where.file)?.content.split(/\r?\n/) ?? [];
  const declaration = lines.findIndex(l => new RegExp(`\\b(int|long|double|void)\\s+${name}\\s*\\(`).test(l));
  const returnType = declaration >= 0 ? lines[declaration].match(new RegExp(`\\b(int|long|double|void)\\s+${name}\\s*\\(`))![1] : '';
  if (parameter && first && Number(parameter.value.value) < Number(first.value.value) && returnType) {
    const p = parameter.name;
    const done = returnType === 'void' ? 'return;' : 'return 0;';
    out.push(make({ id: 'recursion-repair', kind: 'repair', concept: 'recursion', title: 'Choose the repair',
      context: `${code(p)} decreases with every call, so the recursion needs to stop once ${code(p)} reaches 0.`,
      prompt: `Which line, added at the start of ${code(name)}, gives the recursion a way to stop?`,
      explanation: `${code(`if (${p} <= 0) ${done}`)} returns without recursing, so the calls unwind: each one finishes its own addition on the way back. The other options still call ${code(name)} or never return early.`,
      hints: ['The base case must return without calling the method again.'],
      step: lastIndex, focus: { file: where.file, line: declaration + 1 }, code: lines[declaration].trim() },
      [code(`if (${p} <= 0) ${done}`), code(returnType === 'void' ? `if (${p} <= 0) ${name}(${p});` : `if (${p} <= 0) return ${name}(${p});`), code(`${p} = ${p} - 1;`)], 0));
  }
  return out;
}

function loopCondition(text: string): { condition: string; header: 'while' | 'for' } | null {
  const whileLoop = text.match(/\bwhile\s*\((.*)\)\s*\{?\s*$/);
  if (whileLoop) return { condition: whileLoop[1].trim(), header: 'while' };
  const forLoop = text.match(/\bfor\s*\(([^;]*);([^;]*);([^)]*)\)/);
  if (forLoop && forLoop[2].trim()) return { condition: forLoop[2].trim(), header: 'for' };
  return null;
}

/** A loop that consumed the budget while every primitive in its condition kept the same recorded value. */
function loopQuestions(run: Run, states: TraceEvent[]): Question[] {
  const reason = run.events.at(-1)?.stopReason;
  if (reason !== 'step-limit' && reason !== 'timeout') return [];
  const window = states.filter(s => s.kind === 'line' && s.frames?.length).slice(-80);
  const counts = new Map<string, TraceEvent[]>();
  for (const s of window) {
    const key = `${s.location!.file}\n${s.location!.line}\n${s.frames![0].id}`;
    counts.set(key, [...(counts.get(key) ?? []), s]);
  }
  for (const hits of [...counts.values()].sort((a, b) => b.length - a.length)) {
    if (hits.length < 3) break;
    const { file, line } = hits[0].location!;
    const text = recordedLine(run, file, line);
    const loop = text ? loopCondition(text) : null;
    if (!text || !loop) continue;
    const names = [...new Set(loop.condition.match(new RegExp(IDENT, 'g')) ?? [])]
      .filter(name => local(hits[0], name)?.value.kind === 'primitive');
    if (!names.length || !names.every(name => hits.every(h => local(h, name)?.value.value === local(hits[0], name)?.value.value))) continue;
    const step = states.indexOf(hits.at(-1)!);
    const values = names.map(name => `${code(name)} was ${local(hits[0], name)!.value.value}`).join(' and ');
    const out = [make({ id: 'loop-stuck', kind: 'explain', concept: 'loop-termination', title: 'Why doesn’t the loop end?',
      context: `In the last ${window.length} recorded stops, the run reached line ${line} ${code(text.trim())} ${hits.length} times before the ${reason === 'timeout' ? 'time' : 'step'} budget stopped it. ${values} at every one of those stops.`,
      prompt: `Why can ${code(loop.condition)} stay true indefinitely?`,
      explanation: 'A loop ends only when its condition becomes false. The values in this condition never changed between iterations, so it kept producing the same result.',
      hints: ['Compare the condition’s variables across two visits to the loop header.', 'Which statement should move the loop toward its end on every iteration?'],
      step, focus: { file, line }, code: text.trim() },
      [`Nothing in the loop changes ${names.map(code).join(' or ')}.`, 'Java repeats a loop until the step budget is used up.', 'The condition is checked only before the first iteration.'], 0)];
    const simple = loop.condition.match(new RegExp(`^(${IDENT})\\s*(<=|<|>=|>)\\s*(.+)$`));
    if (simple && names.includes(simple[1])) {
      const [, variable, operator, bound] = simple;
      const current = local(hits[0], variable)!.value.value;
      const forward = operator.startsWith('<');
      const fix = `${variable}${forward ? '++' : '--'}`, wrong = `${variable}${forward ? '--' : '++'}`;
      out.push(make({ id: 'loop-repair', kind: 'repair', concept: 'loop-termination', title: 'Choose the repair',
        context: `${code(variable)} stayed ${current} while ${code(loop.condition)} was checked ${hits.length} times.`,
        prompt: loop.header === 'for' ? `Which update in the loop header lets ${code(loop.condition)} eventually become false?` : `Which statement, added inside the loop body, lets ${code(loop.condition)} eventually become false?`,
        explanation: `${code(fix)} moves ${code(variable)} toward ${code(bound.trim())} on every iteration, so the condition eventually fails. Make the edit, run again, and compare the output with your checks.`,
        hints: [`Should ${code(variable)} grow or shrink for ${code(loop.condition)} to become false?`, 'Reassigning the current value does not change anything.'],
        step, focus: { file, line }, code: text.trim() },
        [loop.header === 'for' ? code(fix) : code(`${fix};`), loop.header === 'for' ? code(wrong) : code(`${wrong};`), code(`${variable} = ${current}${loop.header === 'for' ? '' : ';'}`)], 0));
    }
    return out;
  }
  return [];
}

/** Two String references in one frame with equal text but different object identities. */
function stringIdentityQuestions(run: Run, states: TraceEvent[]): Question[] {
  for (let i = 0; i < states.length; i++) {
    const top = states[i].frames?.[0];
    if (!top) continue;
    const heap = heapOf(states[i]);
    const strings = top.locals.filter(v => v.value.ref && heap.get(v.value.ref)?.kind === 'string' && heap.get(v.value.ref)?.type === 'java.lang.String');
    for (let a = 0; a < strings.length; a++) for (let b = a + 1; b < strings.length; b++) {
      const x = heap.get(strings[a].value.ref!)!, y = heap.get(strings[b].value.ref!)!;
      if (x.id === y.id || x.text !== y.text || x.truncated) continue;
      const [first, second] = [strings[a].name, strings[b].name];
      const out = [make({ id: 'string-identity', kind: 'explain', concept: 'string-equality', title: 'Same text, different objects?',
        context: `${code(first)} refers to @${x.id} and ${code(second)} refers to @${y.id}. Both objects contain "${x.text}".`,
        prompt: `What does ${code(`${first} == ${second}`)} evaluate to at this moment?`,
        explanation: `For object references, == checks identity: whether both names refer to the same object. These are two distinct objects with equal text, so == is false while ${code(`${first}.equals(${second})`)} is true.`,
        hints: ['Compare the object IDs, not the text.', 'Does == compare contents or identity for objects?'], step: i },
        ['false, because they are different objects', `true, because both contain "${x.text}"`, 'It does not compile'], 0)];
      const lines = run.request.files.find(f => f.name === top.file)?.content.split(/\r?\n/) ?? [];
      const pattern = new RegExp(`\\b(${first}\\s*==\\s*${second}|${second}\\s*==\\s*${first})\\b`);
      const lineIndex = lines.findIndex(l => pattern.test(l));
      if (lineIndex >= 0) {
        const [left, right] = lines[lineIndex].match(pattern)![1].split(/\s*==\s*/);
        out.push(make({ id: 'string-repair', kind: 'repair', concept: 'string-equality', title: 'Choose the repair',
          context: `Line ${lineIndex + 1} reads ${code(lines[lineIndex].trim())}.`,
          prompt: 'Which condition compares the text of the two strings?',
          explanation: `${code(`${left}.equals(${right})`)} compares characters, so equal text matches even when the objects differ. Make the edit, then check your repair.`,
          hints: ['You want to compare contents, not identity.', 'String has a method for content equality.'],
          step: i, focus: { file: top.file, line: lineIndex + 1 }, code: lines[lineIndex].trim() },
          [code(`${left}.equals(${right})`), code(`${left} == ${right}`), code(`${left} = ${right}`)], 0));
      }
      return out;
    }
  }
  return [];
}

function aliasQuestions(run: Run, states: TraceEvent[]): Question[] {
  const out: Question[] = [];
  for (let i = 0; i < states.length && !out.length; i++) {
    const vars = states[i].frames?.[0]?.locals ?? [];
    for (let j = 0; j < vars.length && !out.length; j++) for (let k = j + 1; k < vars.length; k++) {
      if (vars[j].value.ref && vars[j].value.ref === vars[k].value.ref) {
        out.push(make({ id: 'alias', kind: 'explain', concept: 'aliasing', title: 'Follow the references',
          context: `${code(vars[j].name)} and ${code(vars[k].name)} both refer to @${vars[j].value.ref}.`, prompt: 'How many distinct objects do these two references identify?',
          explanation: 'Both references carry the same object identity. A mutation through either reference affects the shared object.', hints: ['Match the object IDs in the stack and heap.'], step: i },
          ['One shared object', 'Two independent copies', 'No objects'], 0));
        break;
      }
    }
  }
  // Predict: a field or the elements of a shared object change between two stops of the same frame.
  for (let i = 0; i < states.length - 1; i++) {
    const a = states[i], b = states[i + 1];
    const top = a.frames?.[0];
    if (a.kind !== 'line' || !top || b.frames?.[0]?.id !== top.id) continue;
    const text = recordedLine(run, a.location!.file, a.location!.line)?.trim() ?? '';
    const after = heapOf(b);
    for (const object of a.heap ?? []) {
      const names = top.locals.filter(v => v.value.ref === object.id).map(v => v.name);
      if (names.length < 2 || (object.kind !== 'object' && object.kind !== 'array')) continue;
      const writer = names.find(n => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(text));
      const reader = names.find(n => n !== writer);
      if (!writer || !reader) continue;
      if (object.kind === 'array') {
        const show = (o?: HeapObject) => `[${(o?.elements ?? []).map(v => v.value ?? '?').join(', ')}]`;
        const next = after.get(object.id);
        if (!next || object.elements?.some(v => v.kind !== 'primitive') || show(next) === show(object)) continue;
        out.push(make({ id: 'alias-predict', kind: 'predict', concept: 'aliasing', title: 'Predict through an alias',
          context: `Paused before line ${a.location!.line}: ${code(text)}. ${code(writer)} and ${code(reader)} both refer to array @${object.id}, which holds ${show(object)}.`,
          prompt: `After this line runs, what will ${code(reader)} contain?`,
          explanation: `The recorded run shows the array changing to ${show(next)}. There is only one array, so the change made through ${code(writer)} is visible through ${code(reader)}.`,
          hints: ['Count the arrays in the heap. Is there one, or two?'], step: i },
          [`${show(next)}, because both names refer to the same array`, `${show(object)}, because ${reader} is a separate copy`, 'It depends on which name is printed'], 0));
        const lines = run.request.files.find(f => f.name === top.file)?.content.split(/\r?\n/) ?? [];
        const pattern = new RegExp(`^\\s*([\\w<>]+\\[\\])\\s+(${names.join('|')})\\s*=\\s*(${names.join('|')})\\s*;`);
        const line = lines.findIndex(l => pattern.test(l));
        if (line >= 0) {
          const [, type, copy, source] = lines[line].match(pattern)!;
          out.push(make({ id: 'copy-repair', kind: 'repair', concept: 'aliasing', title: 'Choose the repair',
            context: `Line ${line + 1} reads ${code(lines[line].trim())}. Assigning an array variable copies the reference, not the elements.`,
            prompt: `Which line makes ${code(copy)} an independent array with the same elements?`,
            explanation: `${code(`${source}.clone()`)} allocates a new array and copies the elements, so changes to one array no longer affect the other. A cast or ${code('final')} still copies only the reference.`,
            hints: ['You need a second array object in the heap.'],
            step: i, focus: { file: top.file, line: line + 1 }, code: lines[line].trim() },
            [code(`${type} ${copy} = ${source}.clone();`), code(`${type} ${copy} = (${type}) ${source};`), code(`final ${type} ${copy} = ${source};`)], 0));
        }
        return out;
      }
      for (const field of object.fields ?? []) {
        const next = after.get(object.id)?.fields?.find(f => f.name === field.name);
        if (field.value.kind !== 'primitive' || next?.value.kind !== 'primitive' || next.value.value === field.value.value) continue;
        const member = `${reader}.${shortName(field.name)}`;
        out.push(make({ id: 'alias-predict', kind: 'predict', concept: 'aliasing', title: 'Predict through an alias',
          context: `Paused before line ${a.location!.line}: ${code(text)}. ${code(writer)} and ${code(reader)} refer to @${object.id}, and ${code(member)} is ${field.value.value}.`,
          prompt: `After this line runs, what will ${code(member)} be?`,
          explanation: `The recorded run shows ${code(member)} changing from ${field.value.value} to ${next.value.value}. Both names reach one object, so a write through ${code(writer)} is visible through ${code(reader)}.`,
          hints: ['Is there one object here, or two?'], step: i },
          [`${next.value.value}, because both names reach the same object`, `${field.value.value}, because ${reader} keeps its own copy`, 'It depends on which name is printed'], 0));
        return out;
      }
    }
  }
  return out;
}

/** Predict the result of a recorded call, preferring the middle of a recursive chain. */
function returnQuestion(states: TraceEvent[]): Question | null {
  type Call = { state: number; method: string; frameId: string; value: string };
  const byMethod = new Map<string, Call[]>();
  states.forEach((s, state) => s.returns?.forEach(r => {
    if (r.void || r.value?.kind !== 'primitive' || !r.frameId) return;
    byMethod.set(r.method, [...(byMethod.get(r.method) ?? []), { state, method: r.method, frameId: r.frameId, value: r.value.value! }]);
  }));
  const [method, calls] = [...byMethod.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!method || !calls) return null;
  const pick = calls[Math.floor(calls.length / 2)];
  const deeper = calls[calls.indexOf(pick) - 1];
  const entry = states.findIndex(s => s.frames?.some(f => f.id === pick.frameId));
  const args = entry >= 0 ? states[entry].frames!.find(f => f.id === pick.frameId)!.locals.filter(v => v.argument) : [];
  if (entry < 0 || !args.length || args.some(a => a.value.kind !== 'primitive')) return null;
  const call = `${shortName(method)}(${args.map(a => a.value.value).join(', ')})`;
  const recursive = calls.length >= 3;
  const options = [...new Set([pick.value, deeper?.value, ...args.map(a => a.value.value!), String(Number(pick.value) + 1), String(Number(pick.value) - 1)].filter((v): v is string => v !== undefined && v !== 'NaN'))].slice(0, 3);
  if (options.length < 3) return null;
  return make({ id: `return-${pick.frameId}`, kind: 'predict', concept: recursive ? 'recursion' : 'return-values', title: 'Predict a return value',
    context: `${code(call)} is one of ${calls.length} recorded call${calls.length === 1 ? '' : 's'} to ${code(shortName(method))}.${recursive ? ' Each call has its own frame with its own arguments.' : ''}`,
    prompt: `What value does ${code(call)} return?`,
    explanation: `In this run, ${code(call)} returned ${pick.value}${deeper ? ` after the deeper call returned ${deeper.value}` : ''}. Step forward from this moment to watch the frames return in reverse order.`,
    hints: recursive ? ['Work outward from the base case.', 'What does the deeper call return first, and what does this call do with it?'] : ['Read the method body with these argument values.'],
    step: entry }, options, 0);
}

/** An integer local that changes between two consecutive stops in the same frame. */
function statePrediction(states: TraceEvent[]): Question | null {
  for (let i = 0; i < states.length - 1; i++) {
    const a = states[i], b = states[i + 1];
    if (a.kind !== 'line' || b.kind !== 'line' || a.frames?.[0]?.id !== b.frames?.[0]?.id) continue;
    for (const before of a.frames?.[0]?.locals ?? []) {
      const after = b.frames?.[0]?.locals.find(v => v.name === before.name);
      if (before.value.kind !== 'primitive' || !after || after.value.kind !== 'primitive' || before.value.value === after.value.value) continue;
      if (!['int', 'long', 'short', 'byte'].includes(before.type)) continue;
      const next = after.value.value!;
      if (!Number.isSafeInteger(Number(next))) continue;
      const options = [...new Set([next, before.value.value!, String(Number(next) + 1)])];
      if (options.length < 3) options.push(String(Number(next) - 1));
      return make({ id: `predict-${a.sequence}`, kind: 'predict', concept: 'state-change', title: 'Predict the next state',
        context: `Paused before ${a.location?.file}:${a.location?.line}. ${code(before.name)} is ${before.value.value}.`,
        prompt: `What is ${code(before.name)} at the next recorded source stop?`,
        explanation: `In this recorded run, ${code(before.name)} changes from ${before.value.value} to ${next} between these two source stops. Step forward to verify it.`,
        hints: ['Read the highlighted line and inspect the values it uses.'], step: i }, options.slice(0, 3), 0);
    }
  }
  return null;
}

/** A variable by name at a step: a local of the running method, a field of `this`, or a static field. */
function visible(state: TraceEvent, name: string): Variable | undefined {
  const top = state.frames?.[0];
  const direct = top?.locals.find(v => v.name === name);
  if (direct) return direct;
  const self = top?.locals.find(v => v.name === 'this')?.value.ref;
  const field = self ? heapOf(state).get(self)?.fields?.find(f => shortName(f.name) === name) : undefined;
  return field ?? state.statics?.find(s => shortName(s.name) === name);
}
/** A primitive, String or boxed value as plain text. */
function plain(value: TraceValue, heap: Map<string, HeapObject>): string | undefined {
  if (value.kind === 'primitive') return value.value;
  const o = value.kind === 'reference' ? heap.get(value.ref!) : undefined;
  if (o?.kind === 'string' || o?.kind === 'value') return o.text;
  return o?.kind === 'object' && /^java\.lang\.[A-Z]\w+$/.test(o.type) ? o.fields?.[0]?.value.value : undefined;
}
const REMOVE = /\b([A-Za-z_$][\w$]*)\s*\.\s*(poll|remove|pop|removeFirst|removeLast|pollFirst|pollLast)\s*\(\s*\)/;

/** Which value leaves a queue or stack next, asked at a line that removes one and checked against the next step. */
function removalQuestions(run: Run, states: TraceEvent[]): Question[] {
  // Values that came out earlier make a good wrong answer: "it returns the one I just processed".
  const removed: string[] = [];
  for (let i = 0; i < states.length - 1; i++) {
    const s = states[i];
    if (s.kind !== 'line' || !s.frames?.length) continue;
    const text = recordedLine(run, s.location!.file, s.location!.line);
    const m = text?.match(REMOVE);
    if (!m) continue;
    const [, name, method] = m;
    const heap = heapOf(s);
    const object = heap.get(visible(s, name)?.value.ref ?? '');
    const kind = object?.type.match(/^java\.util\.(ArrayDeque|LinkedList|PriorityQueue|Stack)$/)?.[1];
    if (!object || !kind || object.kind !== 'list' || !object.elements || object.truncated || !object.elements.length) continue;
    if (kind === 'Stack' && method !== 'pop') continue;
    const values = object.elements.map(e => plain(e, heap));
    if (values.some(v => v === undefined)) continue;
    const fromEnd = kind === 'Stack' || method === 'removeLast' || method === 'pollLast';
    const answer = fromEnd ? values.at(-1)! : values[0]!;
    if (values.length < 2) { removed.push(answer); continue; }
    // Confirm with the recording: at the method's next stop the collection has lost exactly that value.
    const next = states.slice(i + 1).find(n => n.frames?.[0]?.id === s.frames![0].id);
    const after = next ? heapOf(next).get(object.id) : undefined;
    const rest = after?.elements?.map(e => plain(e, heapOf(next!)));
    const expected = [...values]; expected.splice(fromEnd ? values.length - 1 : 0, 1);
    const sorted = (xs: (string | undefined)[]) => [...xs].sort().join('\u0000');
    if (!rest || (kind === 'PriorityQueue' ? sorted(rest) !== sorted(expected) : rest.slice(0, expected.length).join('\u0000') !== expected.join('\u0000'))) continue;
    const numbers = values.map(Number);
    const options = [...new Set([answer, fromEnd ? values[0]! : values.at(-1)!, values[1]!, ...removed.slice(-1), ...(numbers.every(Number.isFinite) ? [String(Math.max(...numbers)), String(Math.min(...numbers))] : [])])].slice(0, 4);
    removed.push(answer);
    if (options.length < 3) continue;
    const call = `${name}.${method}()`;
    const shown = kind === 'Stack' ? 'bottom to top' : kind === 'PriorityQueue' ? 'in its internal order' : 'first to last';
    const queueLike = !fromEnd && method !== 'pop';
    const why = kind === 'PriorityQueue'
      ? `${code(call)} takes the smallest value by the queue’s ordering, wherever it was added. Shortest-path searches such as Dijkstra’s algorithm rely on this.`
      : queueLike ? `${code(call)} takes the head: the value that has waited longest (first in, first out). Breadth-first search relies on this to visit nodes in order of distance from the start.`
        : kind === 'Stack' ? `${code(call)} takes the top of the stack: the value pushed most recently (last in, first out). Depth-first search with an explicit stack relies on this.`
          : method === 'pop' ? `On a deque, ${code('push')} and ${code('pop')} both use the front, so ${code(call)} returns the value pushed most recently (last in, first out). Depth-first search with a stack relies on this.`
            : `${code(call)} takes from the back: the value added most recently.`;
    return [make({ id: `removal-${s.sequence}`, kind: 'predict', concept: queueLike || kind === 'PriorityQueue' ? 'bfs' : 'dfs', title: 'Which value comes out next?',
      context: `Paused before line ${s.location!.line}: ${code(text!.trim())}. ${code(name)} is ${article(kind)} ${kind} holding [${values.join(', ')}], ${shown}.`,
      prompt: `Which value does ${code(call)} return?`,
      explanation: `${why} In this run it returned ${answer}; step forward to see ${code(name)} without it.`,
      hints: [`Which end of the ${kind === 'Stack' ? 'stack' : 'queue'} does ${code(method)} take from?`, 'Think about the order the values were added.'],
      step: i, focus: { file: s.location!.file, line: s.location!.line }, code: text!.trim() }, options, 0)];
  }
  return [];
}

/** How many calls a recursion makes, which returns first, and which call starts next (depth first). */
function recursionTreeQuestions(run: Run, states: TraceEvent[]): Question[] {
  const end = run.events.at(-1);
  if (end?.stopReason !== 'completed' || run.request.startAt || states.some(s => s.framesTruncated)) return [];
  const tree = recursionTree(states, states.length - 1, 1000);
  if (!tree) return [];
  const method = tree.method, name = displayName(method);
  const calls = tree.nodes.filter(n => n.method === method);
  const out: Question[] = [];
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  // The outermost call with the most calls under it (main may start several separate recursions).
  const under = (id: string): typeof calls => { const kids = calls.filter(c => c.parent === id); return [...kids, ...kids.flatMap(k => under(k.id))]; };
  const roots = calls.filter(n => !n.parent || byId.get(n.parent)?.method !== method);
  const root = roots.map(r => ({ r, size: under(r.id).length })).sort((a, b) => b.size - a.size)[0]?.r ?? calls[0];
  const family = [root, ...under(root.id)];
  const parameterTypes = states.flatMap(s => s.frames ?? []).find(f => f.method === method)?.locals.filter(v => v.argument).map(v => v.type) ?? [];
  const graphLike = states.some(s => [...(s.statics ?? []), ...(s.frames?.[0]?.locals ?? [])].some(v => /visit|seen|mark/i.test(shortName(v.name))));
  const concept = parameterTypes.some(t => !/^(int|long|short|byte|char|boolean|double|float)$|^java\./.test(t) && !t.endsWith('[]')) ? 'trees' : graphLike ? 'dfs' : 'recursion';
  if (family.length >= 3 && family.length <= 60) {
    const count = family.length;
    const distinct = new Set(family.map(c => c.label)).size;
    const options = [...new Set([String(count), String(count + 1), String(count - 1), String(distinct)])].filter(o => Number(o) > 0).slice(0, 4);
    if (options.length >= 3) out.push(make({ id: 'call-count', kind: 'predict', concept, title: 'Count the calls',
      context: `${code(root.label)} starts a recursion: ${code(name)} keeps calling itself until it reaches a base case.`,
      prompt: `How many calls to ${code(name)} happen from the start of ${code(root.label)} until it returns, counting ${code(root.label)} itself?`,
      explanation: `The recording has ${count} separate calls to ${code(name)} in that recursion, each with its own frame${distinct < count ? `, though only ${distinct} different argument lists: some calls repeat work another branch already did` : ''}. The Calls view above the stack draws every one of them.`,
      hints: ['Draw each call as a box under the call that made it.', 'A call with the same arguments made from two places counts twice.'], step: root.step }, options, 0));
  }
  // The first call to return is the first one to reach a base case.
  const familyIds = new Set(family.map(c => c.id));
  const order: string[] = [];
  for (const s of states) for (const r of s.returns ?? []) if (r.frameId && familyIds.has(r.frameId)) order.push(r.frameId);
  const first = byId.get(order[0] ?? '');
  const firstChild = family.find(c => c.parent === root.id);
  if (first && first.id !== root.id) {
    const options = [...new Set([first.label, root.label, firstChild?.label, family.find(c => c.id === order.at(-2))?.label].filter((x): x is string => !!x))].slice(0, 4);
    if (options.length >= 3) out.push(make({ id: 'first-return', kind: 'predict', concept, title: 'Which call finishes first?',
      context: `${code(root.label)} is the first call. Every call waits for the calls it makes before it can return.`,
      prompt: `Which call to ${code(name)} returns first?`,
      explanation: `A call can return only after the calls it made have returned, so the first to return is the first call that reaches a base case without recursing: ${code(first.label)}. ${code(root.label)}, the first call, returns last.`,
      hints: ['Follow the first call down until a call stops recursing.', 'Which calls are still waiting on the stack at that moment?'], step: root.step }, options, 0));
  }
  // Depth first: a call's own calls run before the call after it at the same level.
  for (const child of calls) {
    const parent = child.parent ? byId.get(child.parent) : undefined;
    const grand = parent?.parent ? byId.get(parent.parent) : undefined;
    if (!parent || !grand || parent.method !== method || grand.method !== method) continue;
    const siblings = calls.filter(c => c.parent === grand.id);
    const later = siblings[siblings.indexOf(parent) + 1];
    if (!later || child.step < 1 || states[child.step - 1]?.frames?.[0]?.id !== parent.id) continue;
    if (calls.some(c => c.parent === parent.id && c.step < child.step)) continue;
    const options = [child.label, later.label, `${parent.label} returns to ${grand.label} first`];
    if (new Set(options).size < 3) continue;
    out.push(make({ id: 'next-call', kind: 'predict', concept, title: 'Which call starts next?',
      context: `${code(parent.label)} is running; it was called by ${code(grand.label)}, which will also call ${code(later.label)} later.`,
      prompt: `Which call to ${code(name)} starts next?`,
      explanation: `${code(parent.label)} makes its own call, ${code(child.label)}, before it returns, so the recursion goes deeper before it moves sideways to ${code(later.label)}. That is what depth first means: the call stack remembers the way back.`,
      hints: [`Does ${code(parent.label)} call ${code(name)} itself before it finishes?`, 'Look at the call stack: which frame is on top?'], step: child.step - 1 }, options, 0));
    break;
  }
  return out;
}

/** Questions are generated only from recorded values and the exact recorded source. */
export function questionsFor(run: Run): Question[] {
  const states = snapshots(run);
  const questions = [...compileQuestions(run), ...exceptionQuestions(run, states), ...loopQuestions(run, states), ...recursionQuestions(run, states),
    ...stringIdentityQuestions(run, states), ...integerDivisionQuestions(run, states), ...passByValueQuestions(states), ...removalQuestions(run, states), ...recursionTreeQuestions(run, states)];
  if (questions.length < 3) {
    // The array alias questions explain the bug, so put them before the generic aliasing question.
    const alias = aliasQuestions(run, states);
    questions.push(...alias.filter(q => q.id !== 'alias'), ...alias.filter(q => q.id === 'alias'));
  }
  const returned = questions.length < 4 && !questions.some(q => q.id === 'runaway-recursion') ? returnQuestion(states) : null;
  if (returned) questions.push(returned);
  if (questions.length < 3) { const predicted = statePrediction(states); if (predicted) questions.push(predicted); }
  return questions.slice(0, 4);
}

export function validateProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Project;
  return p.version === 1 && typeof p.name === 'string' && p.name.length <= 120 && typeof p.example === 'string'
    && typeof p.mainClass === 'string' && /^[\w$]+(?:\.[\w$]+)*$/.test(p.mainClass)
    && typeof p.stdin === 'string' && p.stdin.length <= 16384 && Number.isInteger(p.maxSteps) && p.maxSteps >= 10 && p.maxSteps <= 2000
    && Array.isArray(p.files) && p.files.length >= 1 && p.files.length <= 20
    && p.files.every(f => typeof f?.name === 'string' && /^(?:[A-Za-z_$][\w$]*\/)*[A-Za-z_$][\w$]*\.java$/.test(f.name) && typeof f.content === 'string' && f.content.length <= 65536)
    && new Set(p.files.map(f => f.name.toLowerCase())).size === p.files.length
    && Array.isArray(p.checks) && p.checks.length <= 20 && p.checks.every(c => c && typeof c.name === 'string' && c.name.length <= 120 && typeof c.stdin === 'string' && c.stdin.length <= 16384 && typeof c.expectedOutput === 'string' && c.expectedOutput.length <= 32768
      && (c.kind === undefined || c.kind === 'output' || (c.kind === 'call' && typeof c.call === 'string' && c.call.length <= 500 && typeof c.target === 'string' && /^[\w$]+(?:\.[\w$]+)*$/.test(c.target))))
    && (p.startAt === undefined || (!!p.startAt && typeof p.startAt === 'object' && p.files.some(f => f.name === p.startAt!.file) && Number.isInteger(p.startAt.line) && p.startAt.line >= 1 && p.startAt.line <= 100000
      && (p.startAt.condition === undefined || (typeof p.startAt.condition === 'string' && p.startAt.condition.length <= 200 && !/[\r\n]/.test(p.startAt.condition)))
      && (p.startAt.hit === undefined || (Number.isInteger(p.startAt.hit) && p.startAt.hit >= 1 && p.startAt.hit <= 1000000))));
}
