/**
 * Lightweight Java source analysis for project management: package, top-level types, main methods and methods.
 * It is a tokenizer-level heuristic, not a parser. It never decides what compiles; javac does.
 */
export type JavaMethod = { name: string; isStatic: boolean };
export type JavaType = {
  name: string;
  kind: 'class' | 'interface' | 'enum' | 'record' | 'annotation';
  isPublic: boolean;
  /** Index where the declaration (including modifiers) starts. */
  start: number;
  /** Index of the name token. */
  nameIndex: number;
  bodyStart: number;
  /** Index just after the closing brace. */
  end: number;
  hasMain: boolean;
  methods: JavaMethod[];
};
export type JavaSource = { packageName: string; packageIndex: number; packageEnd: number; imports: string[]; types: JavaType[] };

const IDENT = '[A-Za-z_$][\\w$]*';
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'else', 'try', 'do', 'throw', 'super', 'this', 'assert']);

/** Replaces comments, string/char literals and text blocks with spaces, keeping newlines and indices. */
export function maskJava(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const end = j < 0 ? n : j; blank(i, end); i = end; }
    else if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? n : j + 2; blank(i, end); i = end; }
    else if (src.startsWith('"""', i)) { let j = i + 3; while (j < n && !src.startsWith('"""', j)) j += src[j] === '\\' ? 2 : 1; const end = Math.min(n, j + 3); blank(i, end); i = end; }
    else if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; const end = Math.min(n, j + 1); blank(i, end); i = end; }
    else i++;
  }
  return out.join('');
}

function depths(masked: string): Int32Array {
  const depth = new Int32Array(masked.length + 1);
  let d = 0;
  for (let k = 0; k < masked.length; k++) {
    depth[k] = d;
    if (masked[k] === '{') d++;
    else if (masked[k] === '}') d = Math.max(0, d - 1);
  }
  depth[masked.length] = d;
  return depth;
}

function matchingBrace(masked: string, open: number): number {
  let d = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === '{') d++;
    else if (masked[k] === '}' && --d === 0) return k + 1;
  }
  return masked.length;
}

function matchingParen(masked: string, open: number): number {
  let d = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === '(') d++;
    else if (masked[k] === ')' && --d === 0) return k;
  }
  return -1;
}

/** Start of the declaration that ends at `index`: just after the previous `;`, `{` or `}`. */
function declarationStart(masked: string, index: number): number {
  let k = index - 1;
  while (k >= 0 && !';{}'.includes(masked[k])) k--;
  return k + 1;
}

export function analyzeJava(src: string): JavaSource {
  const masked = maskJava(src);
  const depth = depths(masked);
  const pkg = new RegExp(`\\bpackage\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT})*)\\s*;`, 'g');
  let packageName = '', packageIndex = -1, packageEnd = -1;
  for (let m; (m = pkg.exec(masked));) if (depth[m.index] === 0) { packageName = m[1].replace(/\s+/g, ''); packageIndex = m.index; packageEnd = m.index + m[0].length; break; }
  const imports: string[] = [];
  for (const m of masked.matchAll(/\bimport\s+(static\s+)?([\w$.*\s]+?)\s*;/g)) if (depth[m.index!] === 0) imports.push(`${m[1] ? 'static ' : ''}${m[2].replace(/\s+/g, '')}`);
  const types: JavaType[] = [];
  const typeRe = new RegExp(`(@interface|\\b(?:class|interface|enum|record))\\s+(${IDENT})`, 'g');
  for (let m; (m = typeRe.exec(masked));) {
    if (depth[m.index] !== 0 || masked[m.index - 1] === '.') continue;
    const bodyStart = masked.indexOf('{', m.index);
    if (bodyStart < 0) break;
    const end = matchingBrace(masked, bodyStart);
    const start = declarationStart(masked, m.index);
    const prefix = masked.slice(start, m.index);
    const kind = m[1] === '@interface' ? 'annotation' : m[1] as JavaType['kind'];
    const nameIndex = m.index + m[0].length - m[2].length;
    types.push({ name: m[2], kind, isPublic: /\bpublic\b/.test(prefix), start: start + (src.slice(start, m.index).length - src.slice(start, m.index).trimStart().length), nameIndex, bodyStart, end, ...members(masked, depth, bodyStart, end, m[2]) });
    typeRe.lastIndex = end;
  }
  return { packageName, packageIndex, packageEnd, imports, types };
}

function members(masked: string, depth: Int32Array, bodyStart: number, end: number, typeName: string): { hasMain: boolean; methods: JavaMethod[] } {
  const body = masked.slice(0, end);
  const methods: JavaMethod[] = [];
  let hasMain = false;
  const call = new RegExp(`(${IDENT})\\s*\\(`, 'g');
  call.lastIndex = bodyStart;
  for (let m; (m = call.exec(body));) {
    if (depth[m.index] !== 1 || KEYWORDS.has(m[1]) || m[1] === typeName) continue;
    const open = m.index + m[0].length - 1;
    const close = matchingParen(masked, open);
    if (close < 0) break;
    const after = masked.slice(close + 1, close + 200);
    if (!/^\s*(?:throws\s+[\w$.<>,\s]+)?[{;]/.test(after)) continue;
    const prefix = masked.slice(declarationStart(masked, m.index), m.index);
    // A method declaration has a return type (or void) before its name; this excludes field initializers like `int x = f();`.
    if (prefix.includes('=') || !/[\w$>\]]\s+$/.test(prefix) || /\b(?:record|new|class|interface|enum|throw|return)\s+$/.test(prefix)) continue;
    const isStatic = /\bstatic\b/.test(prefix);
    methods.push({ name: m[1], isStatic });
    if (m[1] === 'main' && isStatic && /\bvoid\s+$/.test(prefix) && /^\(\s*(?:final\s+)?String\s*(?:\[\s*\]\s*[\w$]+|\.\.\.\s*[\w$]+|[\w$]+\s*\[\s*\])\s*\)$/.test(masked.slice(open, close + 1))) hasMain = true;
    call.lastIndex = close + 1;
  }
  return { hasMain, methods };
}

/** Line number (1-based) of an index. */
export function lineOf(src: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
}

const baseName = (path: string) => path.split('/').at(-1)!.replace(/\.java$/, '');

/** The path a file should have: its package folders plus its public type's name. */
export function expectedPath(src: string, currentName = ''): string {
  const info = analyzeJava(src);
  const current = currentName ? baseName(currentName) : '';
  const type = info.types.find(t => t.isPublic) ?? info.types.find(t => t.name === current) ?? info.types[0];
  const name = type?.name ?? (current || 'Main');
  return `${info.packageName ? `${info.packageName.replace(/\./g, '/')}/` : ''}${name}.java`;
}

/**
 * Splits pasted source that contains more than one public top-level type into one file per public type.
 * Package and import lines are copied to every file; non-public types stay with the preceding public type.
 */
export function splitTopLevelTypes(src: string): { name: string; content: string }[] {
  const info = analyzeJava(src);
  if (info.types.filter(t => t.isPublic).length <= 1) return [{ name: expectedPath(src), content: src }];
  const header = src.slice(0, info.types[0].start).trimEnd();
  const groups: { name: string; parts: string[] }[] = [];
  info.types.forEach((type, index) => {
    const from = index === 0 ? info.types[0].start : info.types[index - 1].end;
    const text = src.slice(from, type.end).trim();
    if (type.isPublic || !groups.length) groups.push({ name: type.name, parts: [text] });
    else groups.at(-1)!.parts.push(text);
  });
  const folder = info.packageName ? `${info.packageName.replace(/\./g, '/')}/` : '';
  return groups.map(g => ({ name: `${folder}${g.name}.java`, content: `${header ? `${header}\n\n` : ''}${g.parts.join('\n\n')}\n` }));
}

/** Fully qualified names of top-level classes with a `public static void main(String[])` method. */
export function mainClasses(files: { name: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const info = analyzeJava(file.content);
    for (const type of info.types) if (type.hasMain) out.push(info.packageName ? `${info.packageName}.${type.name}` : type.name);
  }
  return out;
}

/** Picks the most likely entry point: a class named Main, otherwise the first class with main. */
export function preferredMain(files: { name: string; content: string }[]): string | undefined {
  const mains = mainClasses(files);
  return mains.find(m => m.split('.').at(-1) === 'Main') ?? mains[0];
}

export type FileIssue = { expected: string; message: string; line: number };

/** Files whose path does not match their package and public type. TraceLab can trace a class only when they match. */
export function fileIssues(files: { name: string; content: string }[]): Map<string, FileIssue> {
  const issues = new Map<string, FileIssue>();
  for (const file of files) {
    const info = analyzeJava(file.content);
    if (!info.types.length) continue;
    const expected = expectedPath(file.content, file.name);
    if (expected === file.name) continue;
    const folder = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/')).replace(/\//g, '.') : '';
    const publicType = info.types.find(t => t.isPublic);
    let message: string, line: number;
    if (folder !== info.packageName) {
      message = info.packageName ? `This file declares package ${info.packageName}, so it belongs at ${expected}.` : `This file has no package declaration, so it belongs at ${expected}.`;
      line = info.packageIndex >= 0 ? lineOf(file.content, info.packageIndex) : 1;
    } else {
      message = `The public ${publicType?.kind ?? 'class'} is named ${publicType?.name}, so the file must be named ${expected.split('/').at(-1)}.`;
      line = publicType ? lineOf(file.content, publicType.nameIndex) : 1;
    }
    issues.set(file.name, { expected, message, line });
  }
  return issues;
}

/** Renames the public top-level type `from` to `to`, editing only its declaration name. */
export function renameType(src: string, from: string, to: string): string {
  const type = analyzeJava(src).types.find(t => t.name === from);
  if (!type) return src;
  return src.slice(0, type.nameIndex) + to + src.slice(type.nameIndex + from.length);
}

/** Sets, changes or removes the package declaration. */
export function setPackage(src: string, packageName: string): string {
  const info = analyzeJava(src);
  if (info.packageIndex >= 0) {
    if (!packageName) return (src.slice(0, info.packageIndex) + src.slice(info.packageEnd)).replace(/^\s*\n/, '');
    return `${src.slice(0, info.packageIndex)}package ${packageName};${src.slice(info.packageEnd)}`;
  }
  return packageName ? `package ${packageName};\n\n${src}` : src;
}

/** Top-level classes that a method test can target. */
export function testTargets(files: { name: string; content: string }[]): { qualified: string; name: string; file: string; methods: JavaMethod[] }[] {
  const out: { qualified: string; name: string; file: string; methods: JavaMethod[] }[] = [];
  for (const file of files) {
    const info = analyzeJava(file.content);
    for (const type of info.types) {
      if (type.kind === 'annotation') continue;
      out.push({ qualified: info.packageName ? `${info.packageName}.${type.name}` : type.name, name: type.name, file: file.name, methods: type.methods });
    }
  }
  return out;
}
