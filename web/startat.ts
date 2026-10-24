import type { StartAt } from './types';

/**
 * Start points for recording. The worker evaluates the condition (worker/TraceWorker.java, Condition); this file
 * checks the same grammar while the user types, so mistakes show up before a run.
 *
 *   or  := and ('||' and)*        and := not ('&&' not)*        not := '!' not | cmp
 *   cmp := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?           sum := product (('+'|'-') product)*
 *   product := unary (('*'|'/'|'%') unary)*                    unary := '-' unary | postfix
 *   postfix := primary ('.' name ('(' ')')? | '[' or ']')*      primary := number | "text" | 'c' | true | false | null | name | '(' or ')'
 */
const TOKEN = /\s*(\d+(?:\.\d+)?[lLdDfF]?|[A-Za-z_$][\w$]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)'|==|!=|<=|>=|&&|\|\||[-+*/%<>!().[\]])/y;

/** Null when the condition can be read, otherwise what is wrong with it. */
export function checkCondition(text: string): string | null {
  const tokens: string[] = [];
  let at = 0;
  while (at < text.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(text);
    if (!m) { if (!text.slice(at).trim()) break; return `Unexpected “${text.slice(at).trim()[0]}”.`; }
    tokens.push(m[1]); at = TOKEN.lastIndex;
  }
  if (!tokens.length) return null;
  let p = 0;
  const peek = () => tokens[p] ?? '';
  const accept = (t: string) => { if (peek() === t) { p++; return true; } return false; };
  const fail = (message: string): never => { throw new Error(message); };
  const expect = (t: string) => { if (!accept(t)) fail(`Expected “${t}”${peek() ? ` before “${peek()}”` : ' at the end'}.`); };
  const or = (): void => { and(); while (accept('||')) and(); };
  const and = (): void => { not(); while (accept('&&')) not(); };
  const not = (): void => { if (accept('!')) not(); else comparison(); };
  const comparison = () => { sum(); if (['==', '!=', '<', '<=', '>', '>='].includes(peek())) { p++; sum(); } };
  const sum = () => { product(); while (peek() === '+' || peek() === '-') { p++; product(); } };
  const product = () => { unary(); while (['*', '/', '%'].includes(peek())) { p++; unary(); } };
  const unary = (): void => { if (accept('-')) unary(); else postfix(); };
  const postfix = () => {
    primary();
    for (;;) {
      if (accept('.')) {
        if (!/^[A-Za-z_$][\w$]*$/.test(peek())) fail('Expected a name after “.”.');
        const name = tokens[p++];
        if (accept('(')) {
          if (!['size', 'isEmpty', 'length'].includes(name)) fail('Only .size(), .isEmpty() and .length() can be called, because recording never runs your methods.');
          expect(')');
        }
      } else if (accept('[')) { or(); expect(']'); }
      else return;
    }
  };
  const primary = () => {
    const t = peek();
    if (!t) fail('The condition ends too early.');
    p++;
    if (t === '(') { or(); expect(')'); return; }
    if (/^\d|^"|^'|^[A-Za-z_$]/.test(t)) return;
    fail(`Unexpected “${t}”.`);
  };
  try {
    or();
    if (p < tokens.length) fail(`Unexpected “${tokens[p]}”.`);
    return null;
  } catch (error) { return (error as Error).message; }
}

/** "line 12 of Main.java when i == 5, the 3rd time" */
export function describeStart(start: StartAt): string {
  const hit = start.hit ?? 1;
  const nth = hit === 1 ? '' : `, the ${hit}${hit % 10 === 1 && hit % 100 !== 11 ? 'st' : hit % 10 === 2 && hit % 100 !== 12 ? 'nd' : hit % 10 === 3 && hit % 100 !== 13 ? 'rd' : 'th'} time`;
  return `line ${start.line} of ${start.file}${start.condition ? ` when ${start.condition}` : ''}${nth}`;
}

/** Where a line moves after edits. Monaco lists changes from the end of the file to the start. */
export function shiftLine(line: number, changes: { range: { startLineNumber: number; startColumn: number; endLineNumber: number }; text: string }[]): number {
  for (const change of changes) {
    const { startLineNumber: start, startColumn, endLineNumber: end } = change.range;
    const added = change.text.split('\n').length - 1, removed = end - start;
    if (end < line || (start === line && end === line && startColumn === 1 && change.text.endsWith('\n'))) line += added - removed;
    else if (start < line && line <= end) line = start + Math.min(added, line - start);
  }
  return Math.max(1, line);
}

/** A start point that still fits the project (its file exists and the line is in range), or undefined. */
export function usableStart(start: StartAt | undefined, files: { name: string; content: string }[]): StartAt | undefined {
  const file = start && files.find(f => f.name === start.file);
  return file && start!.line >= 1 && start!.line <= file.content.split('\n').length ? start : undefined;
}
