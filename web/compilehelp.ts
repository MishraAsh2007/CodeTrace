import { analyzeJava, enclosingMethod, lineOf, maskJava } from './javasource.ts';
import type { SourceFile, TraceEvent } from './types';

/**
 * Plain-language help for javac errors, with concrete fixes. A fix is a line edit or a file move; the IDE
 * compiles each fix before calling it verified. Fixes are suggestions for the student to apply, not guesses
 * about intent: when a message can have several causes, the explanation says so.
 */
export type LineEdit = { file: string; line: number; remove: number; insert: string[] };
export type FixAction = { kind: 'edit'; edits: LineEdit[] } | { kind: 'move'; from: string; to: string };
export type CompileFix = { id: string; label: string; action: FixAction; before?: string; after?: string; caution?: string };
export type CompileIssue = { key: string; file: string; line: number; column: number; message: string; title: string; explanation: string; fixes: CompileFix[]; count: number };

const JDK_CLASSES: Record<string, string> = {
  Scanner: 'java.util', ArrayList: 'java.util', List: 'java.util', Map: 'java.util', HashMap: 'java.util', Set: 'java.util', HashSet: 'java.util',
  LinkedList: 'java.util', LinkedHashMap: 'java.util', LinkedHashSet: 'java.util', TreeMap: 'java.util', TreeSet: 'java.util', Arrays: 'java.util',
  Collections: 'java.util', Random: 'java.util', Queue: 'java.util', Deque: 'java.util', ArrayDeque: 'java.util', Stack: 'java.util', Iterator: 'java.util',
  PriorityQueue: 'java.util', Optional: 'java.util', Objects: 'java.util', StringJoiner: 'java.util', Collection: 'java.util',
  File: 'java.io', FileReader: 'java.io', FileWriter: 'java.io', BufferedReader: 'java.io', InputStreamReader: 'java.io', PrintWriter: 'java.io',
  IOException: 'java.io', FileNotFoundException: 'java.io', LocalDate: 'java.time', LocalDateTime: 'java.time', Duration: 'java.time',
  BigInteger: 'java.math', BigDecimal: 'java.math', Function: 'java.util.function', Predicate: 'java.util.function', Supplier: 'java.util.function', Consumer: 'java.util.function',
  Collectors: 'java.util.stream', Stream: 'java.util.stream', IntStream: 'java.util.stream',
};
const LANG_CLASSES = ['String', 'Integer', 'Double', 'Long', 'Boolean', 'Character', 'Math', 'System', 'Object', 'StringBuilder', 'Exception', 'RuntimeException', 'IllegalArgumentException', 'Float', 'Short', 'Byte'];
const STRING_METHODS = ['length', 'charAt', 'substring', 'indexOf', 'lastIndexOf', 'equals', 'equalsIgnoreCase', 'compareTo', 'toUpperCase', 'toLowerCase', 'trim', 'strip', 'isEmpty', 'isBlank', 'contains', 'startsWith', 'endsWith', 'replace', 'split', 'toCharArray', 'repeat', 'chars', 'matches'];
const LIST_METHODS = ['add', 'get', 'set', 'remove', 'size', 'isEmpty', 'contains', 'indexOf', 'clear', 'addAll', 'sort', 'forEach'];
const MAP_METHODS = ['put', 'get', 'getOrDefault', 'containsKey', 'containsValue', 'remove', 'size', 'isEmpty', 'keySet', 'values', 'entrySet', 'putIfAbsent', 'merge'];
const PRIMITIVES = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char']);

export function editDistance(a: string, b: string): number {
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
/** The closest candidate within two edits (or a case-only difference), preferring the shortest distance. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, score = Infinity;
  for (const c of new Set(candidates)) {
    if (c === name) continue;
    const d = c.toLowerCase() === name.toLowerCase() ? 0.5 : editDistance(c, name);
    if (d <= (name.length <= 3 ? 1 : 2) && d < score) { best = c; score = d; }
  }
  return best;
}

/** javac columns expand tabs to multiples of 8; convert one to a string index. */
export function indexAtColumn(text: string, column: number): number {
  let col = 1;
  for (let i = 0; i < text.length; i++) {
    if (col >= column) return i;
    col = text[i] === '\t' ? col + 8 - ((col - 1) % 8) : col + 1;
  }
  return text.length;
}

const defaultValue = (type: string) => /^(int|long|short|byte)$/.test(type) ? '0' : /^(double|float)$/.test(type) ? '0.0' : type === 'boolean' ? 'false' : type === 'char' ? "'?'" : 'null';
const indentOf = (text: string) => text.match(/^\s*/)![0];
/** "an int", "a double"; capitalized with `upper`. */
const an = (word: string, upper = false) => `${/^[aeiou]/i.test(word) ? (upper ? 'An' : 'an') : (upper ? 'A' : 'a')} ${word}`;
const simple = (type: string) => type.replace(/^java\.lang\./, '').replace(/(?:[\w$]+\.)+([\w$]+)/g, '$1');

type Context = { files: SourceFile[]; file: SourceFile; lines: string[]; line: number; column: number; text: string; index: number; message: string; fix: (label: string, action: FixAction, caution?: string) => CompileFix };

/** Replaces the first occurrence of `from` on a line at or after `near`; falls back to the last occurrence before it. */
function replaceNear(text: string, near: number, from: string, to: string, wholeWord = true): string | null {
  const isWord = (i: number) => !wholeWord || ((i === 0 || !/[\w$]/.test(text[i - 1])) && !/[\w$]/.test(text[i + from.length] ?? ''));
  let at = -1;
  for (let i = text.indexOf(from, Math.max(0, near - from.length)); i >= 0; i = text.indexOf(from, i + 1)) if (isWord(i)) { at = i; break; }
  if (at < 0) for (let i = text.lastIndexOf(from); i >= 0; i = i > 0 ? text.lastIndexOf(from, i - 1) : -1) if (isWord(i)) { at = i; break; }
  return at < 0 ? null : text.slice(0, at) + to + text.slice(at + from.length);
}

function lineEdit(c: Context, after: string, line = c.line, file = c.file.name): FixAction {
  return { kind: 'edit', edits: [{ file, line, remove: 1, insert: after.split('\n') }] };
}

function importLine(file: SourceFile, qualified: string): FixAction {
  const info = analyzeJava(file.content);
  const lines = file.content.split('\n');
  let at = 0;
  const lastImport = lines.findLastIndex(l => /^\s*import\s/.test(l));
  if (lastImport >= 0) at = lastImport + 1;
  else if (info.packageIndex >= 0) at = lineOf(file.content, info.packageIndex);
  const insert = lastImport < 0 && info.packageIndex >= 0 ? ['', `import ${qualified};`] : lastImport < 0 ? [`import ${qualified};`, ''] : [`import ${qualified};`];
  return { kind: 'edit', edits: [{ file: file.name, line: at + 1, remove: 0, insert }] };
}

/** The header line of the method containing a line, and its declared return type. */
function methodHeader(file: SourceFile, line: number): { line: number; text: string; returnType: string; name: string } | null {
  const range = enclosingMethod(file.content, line);
  if (!range) return null;
  const headLine = lineOf(file.content, range.start);
  const masked = maskJava(file.content);
  const declStart = Math.max(masked.lastIndexOf(';', range.start), masked.lastIndexOf('}', range.start - 1), masked.lastIndexOf('{', range.start - 1)) + 1;
  const decl = masked.slice(declStart, range.start).replace(/\s+/g, ' ').trim();
  const m = decl.match(/(?:^|\s)([\w$<>\[\],. ?]+?)\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)/);
  return { line: headLine, text: file.content.split('\n')[headLine - 1], returnType: m ? m[1].replace(/\b(public|private|protected|static|final|abstract|synchronized)\b/g, '').trim() : '', name: m?.[2] ?? '' };
}

/** Line (1-based) declaring `name` as a local or field before `before`, and the declared type. */
function declarationOf(c: Context, name: string, before = c.line): { line: number; type: string; text: string } | null {
  // The type must start with a word character, so an assignment such as "    x = 1;" isn't read as a declaration.
  const re = new RegExp(`^(\\s*)((?:(?:public|private|protected|static|final)\\s+)*)([\\w$][\\w$<>\\[\\], .?]*?)\\s+${name.replace(/\$/g, '\\$')}\\s*(=|;|,)`);
  for (let l = Math.min(before, c.lines.length); l >= 1; l--) {
    const m = c.lines[l - 1].match(re);
    if (m && !/^(return|new|else|throw)$/.test(m[3].trim())) return { line: l, type: m[3].trim(), text: c.lines[l - 1] };
  }
  return null;
}

type Handler = (c: Context) => { title: string; explanation: string; fixes?: CompileFix[] } | null;

const handlers: Handler[] = [
  // Missing punctuation.
  c => {
    const m = c.message.match(/^'([;)\]])' expected|^'\)' or ',' expected/);
    if (!m) return null;
    const ch = m[1] ?? ')';
    const at = Math.min(c.index, c.text.length);
    const after = c.text.slice(0, at).trimEnd() + ch + c.text.slice(at).replace(/^\s*$/, '');
    const what = ch === ';' ? 'a semicolon' : ch === ')' ? 'a closing parenthesis' : 'a closing bracket';
    return { title: ch === ';' ? 'Missing semicolon' : `Missing ${ch}`, explanation: ch === ';' ? 'Each Java statement ends with a semicolon. javac reached the end of a statement on this line without finding one.' : `javac expected ${what} here. Check that every ( or [ on this line is closed.`,
      fixes: [c.fix(`Add ${ch}`, lineEdit(c, after))] };
  },
  c => {
    if (c.message !== 'unclosed string literal') return null;
    const quote = c.text.indexOf('"', Math.max(0, c.index - 1));
    const rest = c.text.slice(quote + 1);
    const m = rest.match(/(\)*;?\s*)$/);
    const cut = quote + 1 + rest.length - (m?.[1].length ?? 0);
    return { title: 'Text is missing its closing quote', explanation: 'A string literal starts with " and must end with " on the same line.', fixes: [c.fix('Close the string', lineEdit(c, `${c.text.slice(0, cut)}"${c.text.slice(cut)}`))] };
  },
  c => {
    if (c.message !== 'reached end of file while parsing') return null;
    const masked = maskJava(c.file.content);
    const open: number[] = [];
    for (let k = 0; k < masked.length; k++) { if (masked[k] === '{') open.push(k); else if (masked[k] === '}') open.pop(); }
    if (!open.length) return { title: 'The file ended too soon', explanation: 'javac reached the end of the file while a declaration was still incomplete.' };
    const innermost = lineOf(c.file.content, open.at(-1)!);
    const last = c.lines.length - (c.lines.at(-1) === '' ? 1 : 0);
    const closing = open.map((_, i) => `${'    '.repeat(open.length - 1 - i)}}`);
    return { title: `Missing closing brace${open.length > 1 ? 's' : ''}`, explanation: `${open.length === 1 ? 'One { is' : `${open.length} { are`} never closed. The innermost open block starts on line ${innermost}. Every { needs a matching }, and the code inside a block should be indented one level.`,
      fixes: [c.fix(`Add ${open.length === 1 ? 'a closing brace' : `${open.length} closing braces`} at the end`, { kind: 'edit', edits: [{ file: c.file.name, line: last + 1, remove: 0, insert: closing }] }, 'Check that the brace belongs at the end and not earlier, where a block stops being indented.')] };
  },
  // Names that don't resolve.
  c => {
    const m = c.message.match(/^cannot find symbol\n\s*symbol:\s+(variable|method|class)\s+([\w$]+)(\(([^)]*)\))?(?:\n\s*location:\s+(?:(?:variable|class|interface)\s+([\w$.]+)(?:\s+of type\s+(\S+))?))?/);
    if (!m) return null;
    const [, kind, name, , args = '', locationName = '', locationType = ''] = m;
    const type = simple(locationType || '');
    const replaceName = (to: string) => replaceNear(c.text, c.index, name, to);
    if (kind === 'class') {
      const pkg = JDK_CLASSES[name];
      if (pkg) return { title: `${name} needs an import`, explanation: `${name} lives in the ${pkg} package. Classes outside java.lang must be imported at the top of the file.`, fixes: [c.fix(`Add import ${pkg}.${name};`, importLine(c.file, `${pkg}.${name}`))] };
      const projectTypes = c.files.flatMap(f => analyzeJava(f.content).types.map(t => t.name));
      const guess = closest(name, [...projectTypes, ...LANG_CLASSES, ...Object.keys(JDK_CLASSES)]);
      const fixed = guess ? replaceName(guess) : null;
      return { title: `Unknown class ${name}`, explanation: guess ? `No class named ${name} is visible here. Did you mean ${guess}? Class names are case-sensitive.` : `No class named ${name} is visible here. Check the spelling, create the class, or import it.`, fixes: fixed && guess ? [c.fix(`Change to ${guess}`, lineEdit(c, fixed))] : [] };
    }
    if (kind === 'method') {
      if (name === 'length' && /\[\]$/.test(type)) { const t = replaceNear(c.text, c.index, '.length()', '.length', false); return { title: 'Arrays use length, not length()', explanation: 'An array’s length is a field, written values.length without parentheses. Strings use length() with parentheses.', fixes: t ? [c.fix('Change to .length', lineEdit(c, t))] : [] }; }
      if (name === 'size' && /\[\]$/.test(type)) { const t = replaceNear(c.text, c.index, '.size()', '.length', false); return { title: 'Arrays use length, not size()', explanation: 'Lists have a size() method. For an array, use its length field.', fixes: t ? [c.fix('Change to .length', lineEdit(c, t))] : [] }; }
      if ((name === 'size' || name === 'length') && type === 'String' && name === 'size') { const t = replaceNear(c.text, c.index, '.size()', '.length()', false); return { title: 'Strings use length()', explanation: 'A String’s number of characters comes from length().', fixes: t ? [c.fix('Change to .length()', lineEdit(c, t))] : [] }; }
      const pool = type === 'String' ? STRING_METHODS : /List|ArrayList/.test(type) ? LIST_METHODS : /Map/.test(type) ? MAP_METHODS
        : c.files.flatMap(f => analyzeJava(f.content).types.filter(t => !locationName || t.name === simple(locationName) || !type).flatMap(t => t.methods.map(x => x.name)));
      const guess = closest(name, pool);
      const fixed = guess ? replaceName(guess) : null;
      return { title: `Unknown method ${name}(${args ? '…' : ''})`, explanation: guess ? `${type ? an(type, true) : 'This class'} has no method called ${name}${args ? ` that takes (${args})` : ''}. Did you mean ${guess}? Method names are case-sensitive.` : `No method ${name}(${args}) exists${type ? ` on ${type}` : ' here'}. Check the name, the number and types of arguments, or define the method.`, fixes: fixed && guess ? [c.fix(`Change to ${guess}`, lineEdit(c, fixed))] : [] };
    }
    if (name === 'length' && (type === 'String' || /List|ArrayList/.test(type))) {
      const to = type === 'String' ? '.length()' : '.size()';
      const t = replaceNear(c.text, c.index, '.length', to, false);
      return { title: `${type === 'String' ? 'Strings' : 'Lists'} use ${to.slice(1)}`, explanation: `length without parentheses only works on arrays. ${type === 'String' ? 'A String' : 'A list'} uses the ${to.slice(1)} method.`, fixes: t ? [c.fix(`Change to ${to}`, lineEdit(c, t))] : [] };
    }
    const declared = new Set(maskJava(c.file.content).match(/[A-Za-z_$][\w$]*/g) ?? []);
    const guess = closest(name, declared);
    const fixed = guess ? replaceName(guess) : null;
    return { title: `Unknown name ${name}`, explanation: guess ? `Nothing named ${name} is declared where this line can see it. Did you mean ${guess}? Also check that the variable is declared before this line and inside the same block.` : `Nothing named ${name} is declared where this line can see it. Declare it first, or check its spelling and the block it was declared in.`, fixes: fixed && guess ? [c.fix(`Change to ${guess}`, lineEdit(c, fixed))] : [] };
  },
  // Type mismatches.
  c => {
    const m = c.message.match(/^incompatible types: (?:possible lossy conversion from (\w+) to (\w+)|([\w$.\[\]<>]+) cannot be converted to ([\w$.\[\]<>]+)|unexpected return value)/);
    if (!m) return null;
    const assign = c.text.match(/^(\s*)((?:final\s+)?([\w$<>\[\]]+)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*$/);
    if (m[1]) {
      const [, from, to] = m;
      const fixes: CompileFix[] = [];
      if (assign?.[2] && assign[3] === to) fixes.push(c.fix(`Declare ${assign[4]} as ${from}`, lineEdit(c, `${assign[1]}${assign[2].replace(to, from)}${assign[4]} = ${assign[5]};`)));
      if (assign) fixes.push(c.fix(`Convert with (${to})`, lineEdit(c, `${assign[1]}${assign[2] ?? ''}${assign[4]} = (${to}) (${assign[5]});`), `A cast to ${to} drops information, such as the part after the decimal point.`));
      return { title: `${an(from, true)} doesn’t fit in ${an(to)}`, explanation: `The value on the right is ${an(from)}. Storing it in ${an(to)} could lose information, so Java needs you to choose: use ${an(from)} variable, or convert explicitly.`, fixes };
    }
    if (m[3]) {
      const from = simple(m[3]), to = simple(m[4]);
      const fixes: CompileFix[] = [];
      if (from === 'String' && ['int', 'double', 'long'].includes(to) && assign) {
        const parse = to === 'int' ? 'Integer.parseInt' : to === 'long' ? 'Long.parseLong' : 'Double.parseDouble';
        fixes.push(c.fix(`Convert with ${parse}`, lineEdit(c, `${assign[1]}${assign[2] ?? ''}${assign[4]} = ${parse}(${assign[5]});`)));
        const scanner = assign[5].match(/^([\w$]+)\.nextLine\(\)$/);
        if (scanner && to !== 'long') fixes.push(c.fix(`Read with ${scanner[1]}.next${to === 'int' ? 'Int' : 'Double'}()`, lineEdit(c, `${assign[1]}${assign[2] ?? ''}${assign[4]} = ${scanner[1]}.next${to === 'int' ? 'Int' : 'Double'}();`), 'Mixing nextInt() and nextLine() can leave an empty line behind; read the input consistently.'));
      } else if (to === 'String' && (PRIMITIVES.has(from) || /^(Integer|Double|Long|Character|Boolean)$/.test(from)) && assign) {
        fixes.push(c.fix('Convert with String.valueOf', lineEdit(c, `${assign[1]}${assign[2] ?? ''}${assign[4]} = String.valueOf(${assign[5]});`)));
      }
      return { title: `${an(from, true)} can’t be used as ${an(to)}`, explanation: from === 'String' && PRIMITIVES.has(to) ? `Text and numbers are different types in Java. "42" is a String; to get the number 42, parse the text.` : to === 'String' && PRIMITIVES.has(from) ? `${an(from, true)} is a number, not text. Convert it to a String explicitly.` : `This expression has type ${from}, but the code needs ${an(to)} here. Check the method’s parameter types or the variable’s declared type.`, fixes };
    }
    const header = methodHeader(c.file, c.line);
    const value = c.text.match(/return\s+(.+?);/)?.[1] ?? '';
    const type = /^-?\d+$/.test(value) ? 'int' : /^-?\d*\.\d+$/.test(value) ? 'double' : /^"/.test(value) ? 'String' : /^(true|false)$/.test(value) ? 'boolean' : /^'.'$/.test(value) ? 'char' : '';
    const fixes = header && type && /\bvoid\b/.test(header.text) ? [c.fix(`Make ${header.name}() return ${type}`, lineEdit(c, header.text.replace(/\bvoid\b/, type), header.line))] : [];
    return { title: 'A void method can’t return a value', explanation: `${header?.name ? `${header.name}()` : 'This method'} is declared void, which means it returns nothing. Either remove the value from return, or change void to the type it should return.`, fixes };
  },
  c => {
    if (c.message !== 'missing return statement') return null;
    const header = methodHeader(c.file, Math.max(1, c.line - 1));
    const type = header?.returnType ?? '';
    const indent = indentOf(c.text) + '    ';
    return { title: 'Not every path returns a value', explanation: `${header?.name ? `${header.name}()` : 'This method'} promises to return ${type ? an(type) : 'a value'}, but execution can reach its end without a return, for example when an if condition is false.`,
      fixes: type ? [c.fix(`Add return ${defaultValue(type)}; at the end`, { kind: 'edit', edits: [{ file: c.file.name, line: c.line, remove: 0, insert: [`${indent}return ${defaultValue(type)};`] }] }, `${defaultValue(type)} is a placeholder. Return whatever this method should give back when no earlier return runs.`)] : [] };
  },
  c => {
    const m = c.message.match(/^variable ([\w$]+) might not have been initialized/);
    if (!m) return null;
    const decl = declarationOf(c, m[1]);
    const fixed = decl && decl.text.match(new RegExp(`^(.*\\b${m[1]})\\s*;`));
    return { title: `${m[1]} has no starting value`, explanation: `Local variables have no default value in Java. ${m[1]} is used on this line, but some path reaches it before anything is assigned.`, fixes: decl && fixed ? [c.fix(`Start ${m[1]} at ${defaultValue(decl.type)}`, lineEdit(c, decl.text.replace(new RegExp(`\\b${m[1]}\\s*;`), `${m[1]} = ${defaultValue(decl.type)};`), decl.line))] : [] };
  },
  c => {
    const m = c.message.match(/^class ([\w$]+) is public, should be declared in a file named ([\w$]+)\.java/);
    if (!m) return null;
    const folder = c.file.name.includes('/') ? c.file.name.slice(0, c.file.name.lastIndexOf('/') + 1) : '';
    const fileClass = c.file.name.split('/').at(-1)!.replace(/\.java$/, '');
    const fixes = [c.fix(`Rename the file to ${m[2]}.java`, { kind: 'move', from: c.file.name, to: `${folder}${m[2]}.java` })];
    const type = analyzeJava(c.file.content).types.find(t => t.name === m[1]);
    if (type && /^[A-Za-z_$][\w$]*$/.test(fileClass)) fixes.push(c.fix(`Rename the class to ${fileClass}`, lineEdit(c, c.lines[lineOf(c.file.content, type.nameIndex) - 1].replace(new RegExp(`\\b${m[1]}\\b`), fileClass), lineOf(c.file.content, type.nameIndex)), `Other code that uses ${m[1]} must be renamed too.`));
    return { title: 'File name and class name differ', explanation: `A public class must be in a file with the same name. This file is ${c.file.name.split('/').at(-1)}, but the class is ${m[1]}.`, fixes };
  },
  c => {
    const m = c.message.match(/^non-static (method|variable) ([\w$]+)(\([^)]*\))? cannot be referenced from a static context/);
    if (!m) return null;
    const [, kind, name] = m;
    const fixes: CompileFix[] = [];
    const re = kind === 'method' ? new RegExp(`^(\\s*)((?:public|private|protected)\\s+)?((?:final\\s+)?[\\w$<>\\[\\], ]+\\s+${name}\\s*\\()`) : new RegExp(`^(\\s*)((?:public|private|protected)\\s+)?((?:final\\s+)?[\\w$<>\\[\\], ]+\\s+${name}\\s*(?:=|;))`);
    const declLine = c.lines.findIndex(l => re.test(l) && !/\bstatic\b/.test(l));
    if (declLine >= 0) fixes.push(c.fix(`Make ${name}${kind === 'method' ? '()' : ''} static`, lineEdit(c, c.lines[declLine].replace(re, '$1$2static $3'), declLine + 1), kind === 'variable' ? 'A static field is shared by every object of the class.' : `A static method can't use instance fields; if ${name}() needs them, create an object instead.`));
    return { title: `main can’t use ${name} without an object`, explanation: `main is static: it runs without any object of this class. ${name}${kind === 'method' ? '()' : ''} belongs to an object. Either make it static, or create an object first, for example new ${analyzeJava(c.file.content).types[0]?.name ?? 'Main'}().${name}${kind === 'method' ? '()' : ''}.`, fixes };
  },
  c => {
    const m = c.message.match(/^unreported exception ([\w$.]+); must be caught or declared to be thrown/);
    if (!m) return null;
    const header = methodHeader(c.file, c.line);
    const imports = analyzeJava(c.file.content).imports;
    const pkg = m[1].slice(0, m[1].lastIndexOf('.'));
    const name = pkg === 'java.lang' || imports.includes(m[1]) || imports.includes(`${pkg}.*`) ? simple(m[1]) : m[1];
    const fixes: CompileFix[] = [];
    if (header) {
      const after = /\bthrows\b/.test(header.text) ? header.text.replace(/\bthrows\s+([^{]+?)\s*\{/, (_, list) => `throws ${list.trim()}, ${name} {`) : header.text.replace(/\)\s*\{/, `) throws ${name} {`);
      if (after !== header.text) fixes.push(c.fix(`Add throws ${simple(m[1])} to ${header.name}()`, lineEdit(c, after, header.line), 'The exception then propagates to the caller; in main it ends the program with a stack trace.'));
    }
    return { title: `${simple(m[1])} must be handled`, explanation: `${simple(m[1])} is a checked exception: Java requires you to either catch it with try/catch or declare that ${header?.name ? `${header.name}()` : 'the method'} throws it.`, fixes };
  },
  c => {
    const m = c.message.match(/^variable ([\w$]+) is already defined/);
    if (!m) return null;
    const re = new RegExp(`^(\\s*)(?:final\\s+)?[\\w$<>\\[\\], ]+?\\s+(${m[1]}\\s*=.*)$`);
    return { title: `${m[1]} is declared twice`, explanation: `A variable can be declared only once in a scope. To change its value, assign it without the type.`, fixes: re.test(c.text) ? [c.fix(`Assign ${m[1]} instead of declaring it again`, lineEdit(c, c.text.replace(re, '$1$2')))] : [] };
  },
  c => c.message === 'unreachable statement' ? { title: 'This line can never run', explanation: 'A return, break, continue or throw just above always leaves this block first, so Java rejects the code after it. Move the line above that statement, or remove it.', fixes: /;\s*$/.test(c.text) ? [c.fix('Delete this line', { kind: 'edit', edits: [{ file: c.file.name, line: c.line, remove: 1, insert: [] }] })] : [] } : null,
  c => {
    if (c.message !== "'else' without 'if'") return null;
    for (let l = c.line - 1; l >= Math.max(1, c.line - 6); l--) {
      if (/\bif\s*\(.*\)\s*;\s*$/.test(c.lines[l - 1])) return { title: 'An if ends with a stray semicolon', explanation: `The semicolon after the if condition on line ${l} ends the if statement, so the else that follows has nothing to attach to.`, fixes: [c.fix(`Remove the ; after the condition on line ${l}`, lineEdit(c, c.lines[l - 1].replace(/\)\s*;\s*$/, ')'), l))] };
    }
    return { title: 'else without a matching if', explanation: 'An else must come right after the if block. Check for a missing { } around the if’s statements, or a stray semicolon.' };
  },
  c => {
    const m = c.message.match(/^(\w+) cannot be dereferenced/);
    return m ? { title: `${m[1]} values have no methods`, explanation: `${m[1]} is a primitive type, not an object, so it has no methods or fields to call with a dot. Compare primitives with ==, and use helpers such as String.valueOf(x) or Integer.toString(x).` } : null;
  },
  c => {
    const m = c.message.match(/^bad operand types for binary operator '([^']+)'\n\s*first type:\s+(\S+)\n\s*second type:\s+(\S+)/);
    if (!m) return null;
    const [, op, a, b] = m;
    const sa = simple(a), sb = simple(b);
    if ((sa === 'char' && sb === 'String') || (sa === 'String' && sb === 'char')) {
      const fixed = c.text.replace(/"(\\.|[^"\\])"/, "'$1'");
      return { title: 'Comparing a char with a String', explanation: `charAt returns a char, written in single quotes like 'a'. "a" in double quotes is a String, which is a different type.`, fixes: fixed !== c.text ? [c.fix('Use single quotes for the character', lineEdit(c, fixed))] : [] };
    }
    return { title: `${op} can’t combine ${sa} and ${sb}`, explanation: `The ${op} operator doesn’t work between ${an(sa)} and ${an(sb)}. Convert one side first${sa === 'String' || sb === 'String' ? ', for example with Integer.parseInt(text), and compare Strings with equals()' : ''}.` };
  },
  c => {
    const m = c.message.match(/^cannot assign a value to final variable ([\w$]+)/);
    if (!m) return null;
    const decl = declarationOf(c, m[1]);
    return { title: `${m[1]} is final`, explanation: `${m[1]} was declared final, so it can be assigned only once.`, fixes: decl && /\bfinal\s+/.test(decl.text) ? [c.fix(`Remove final from ${m[1]}`, lineEdit(c, decl.text.replace(/\bfinal\s+/, ''), decl.line))] : [] };
  },
  c => {
    if (c.message !== 'invalid method declaration; return type required') return null;
    const name = c.text.slice(c.index).match(/^[\w$]+/)?.[0] ?? '';
    const type = analyzeJava(c.file.content).types[0]?.name;
    if (type && name && closest(name, [type]) === type) return { title: 'Constructor name doesn’t match the class', explanation: `A constructor must have exactly the class’s name, ${type}. Because ${name} doesn’t match, Java reads it as a method without a return type.`, fixes: [c.fix(`Rename to ${type}`, lineEdit(c, replaceNear(c.text, c.index, name, type) ?? c.text))] };
    return { title: 'Method is missing its return type', explanation: 'Every method declaration needs a return type before its name, such as void or int. Only constructors, named exactly like the class, have none.', fixes: name ? [c.fix(`Add void before ${name}`, lineEdit(c, replaceNear(c.text, c.index, name, `void ${name}`) ?? c.text))] : [] };
  },
  c => {
    if (c.message !== 'not a statement') return null;
    if (/[^=!<>]==[^=]/.test(c.text) && /;\s*$/.test(c.text)) return { title: '== compares; = assigns', explanation: '== checks whether two values are equal and produces true or false, which can’t stand alone as a statement. To store a value, use a single =.', fixes: [c.fix('Change == to =', lineEdit(c, c.text.replace('==', '=')))] };
    return { title: 'This expression doesn’t do anything on its own', explanation: 'A statement must do something: assign, call a method, declare a variable, or control the flow.' };
  },
  c => /^array required, but (\S+) found/.test(c.message) ? { title: 'Using [ ] on something that isn’t an array', explanation: `Square brackets index into an array. This value is ${simple(c.message.match(/found$/) ? c.message.split('but ')[1].replace(' found', '') : '')}, not an array.` } : null,
  c => (c.message === '<identifier> expected' || c.message === 'illegal start of type') && /\w+\s*\(.*\)\s*;\s*$/.test(c.text) && !enclosingMethod(c.file.content, c.line)
    ? { title: 'Code outside a method', explanation: 'Statements such as method calls must be inside a method body, for example inside main. Directly inside a class, only declarations of fields, methods and constructors are allowed.' } : null,
  c => /^class, interface, enum, or record expected/.test(c.message) ? { title: 'Extra code after the class ended', explanation: 'javac found code after the class’s final closing brace. This usually means there is an extra } somewhere above, which closed the class early.' } : null,
  c => /^illegal start of expression/.test(c.message) ? { title: 'Something is missing before this point', explanation: 'javac could not make sense of this line. A common cause is a missing ) or } on the line above, or a method declared inside another method.' } : null,
];

/** Groups javac errors by location and adds explanations and fixes. */
export function compileIssues(files: SourceFile[], diagnostics: TraceEvent[]): CompileIssue[] {
  const issues = new Map<string, CompileIssue>();
  for (const d of diagnostics) {
    if (d.kind !== 'diagnostic' || d.severity !== 'error' || !d.file) continue;
    const file = files.find(f => f.name === d.file);
    const message = d.message ?? '';
    const key = `${d.file}:${d.line}:${message.split('\n').slice(0, 2).join(' ')}`;
    const known = issues.get(key);
    if (known) { known.count++; continue; }
    const base = { key, file: d.file, line: d.line ?? 1, column: d.column ?? 1, message, count: 1 };
    if (!file) { issues.set(key, { ...base, title: message.split('\n')[0], explanation: '', fixes: [] }); continue; }
    const lines = file.content.split('\n');
    const text = lines[(d.line ?? 1) - 1] ?? '';
    let n = 0;
    const context: Context = { files, file, lines, line: d.line ?? 1, column: d.column ?? 1, text, index: indexAtColumn(text, d.column ?? 1), message,
      fix: (label, action, caution) => ({ id: `${key}#${n++}`, label, action, ...preview(files, action), ...(caution ? { caution } : {}) }) };
    let help: ReturnType<Handler> = null;
    for (const handler of handlers) { help = handler(context); if (help) break; }
    issues.set(key, { ...base, title: help?.title ?? message.split('\n')[0], explanation: help?.explanation ?? 'javac reported this error. The location points to where it noticed the problem, which can be just after the actual mistake.', fixes: (help?.fixes ?? []).filter(f => f.action.kind === 'move' || f.after !== f.before) });
  }
  return [...issues.values()];
}

function preview(files: SourceFile[], action: FixAction): { before?: string; after?: string } {
  if (action.kind === 'move') return { before: action.from, after: action.to };
  const edit = action.edits[0];
  const lines = files.find(f => f.name === edit.file)?.content.split('\n') ?? [];
  const before = lines.slice(edit.line - 1, edit.line - 1 + edit.remove).map(l => l.trim()).join(' ');
  return { before, after: edit.insert.map(l => l.trim()).filter(Boolean).join(' ') };
}

/** Applies a fix's line edits (bottom-up within each file) and returns new files. Moves are left to the caller. */
export function applyEdits(files: SourceFile[], action: FixAction): SourceFile[] {
  if (action.kind === 'move') return files.map(f => f.name === action.from ? { ...f, name: action.to } : f);
  return files.map(file => {
    const edits = action.edits.filter(e => e.file === file.name).sort((a, b) => b.line - a.line);
    if (!edits.length) return file;
    const lines = file.content.split('\n');
    for (const e of edits) lines.splice(e.line - 1, e.remove, ...e.insert);
    return { ...file, content: lines.join('\n') };
  });
}
