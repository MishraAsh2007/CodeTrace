/**
 * Spelling for Java source: words in comments and string literals, and the parts of identifiers
 * (`totalAmout` → `total`, `Amout`). Programming words and JDK names are accepted; javac decides what compiles.
 */
export type SpellToken = { word: string; offset: number; kind: 'comment' | 'string' | 'name' };

/** Words that are correct in code but not in an English dictionary. */
export const PROGRAMMING_WORDS = new Set(`
args argv arr arrs str strs num nums idx len tmp temp val vals cnt msg msgs err errs ctx obj objs src dst dest prev curr cur init max min avg calc chars enum enums impl int ints bool bools util utils config param params func funcs ptr ref refs regex println printf print sysout java javac jvm jdk jre todo fixme api apis url urls http https json xml html css ui id ids io lhs rhs iter itr elem elems pos dir dirs img btn ok fn eof stdin stdout stderr boolean booleans nullable getter getters setter setters enqueue dequeue deque deques hashmap hashmaps arraylist arraylists hashset treemap treeset linkedlist substring substrings tostring hashcode async lambda lambdas iterable iterator iterators comparator comparators runnable mutable immutable instanceof subclass subclasses superclass inline namespace foo bar baz qux fib factorial palindrome palindromes upto
utf ascii unicode len2 nextint nextline nextdouble hasnext hasnextint charat indexof lastindexof startswith endswith tolowercase touppercase isempty isblank tochararray valueof parseint parsedouble arraycopy sqrt pow abs floor ceil putifabsent getordefault containskey keyset entryset addall removeif foreach stringbuilder bufferedreader inputstreamreader filereader filewriter printwriter localdate datetime bigint bigdecimal biginteger
sb ch c2 lo hi mid tc dp dfs bfs gcd lcm ln mod div mul sub concat recursion recursive memo memoize memoization runtime classpath javadoc stacktrace npe tostr
`.split(/\s+/).filter(Boolean));

/** Comments, string literals and identifiers with their offsets in the source. */
export function spellingTokens(src: string): SpellToken[] {
  const tokens: SpellToken[] = [];
  const words = (text: string, base: number, kind: 'comment' | 'string') => {
    // Skip URLs, paths and format specifiers inside text.
    const cleaned = text.replace(/\b(?:https?:\/\/|www\.)\S+|%[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z]|\\[ntrbf"'\\]|@\w+|\{@\w+[^}]*\}/g, m => ' '.repeat(m.length));
    for (const m of cleaned.matchAll(/[A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z]/g)) tokens.push({ word: m[0].replace(/'s$/, ''), offset: base + m.index!, kind });
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const end = j < 0 ? n : j; words(src.slice(i + 2, end), i + 2, 'comment'); i = end; }
    else if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? n : j; words(src.slice(i + 2, end), i + 2, 'comment'); i = end + 2; }
    else if (src.startsWith('"""', i)) { let j = i + 3; while (j < n && !src.startsWith('"""', j)) j += src[j] === '\\' ? 2 : 1; words(src.slice(i + 3, j), i + 3, 'string'); i = j + 3; }
    else if (c === '"') { let j = i + 1; while (j < n && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; words(src.slice(i + 1, j), i + 1, 'string'); i = j + 1; }
    else if (c === "'") { let j = i + 1; while (j < n && src[j] !== "'" && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; i = j + 1; }
    else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      // Split camelCase, PascalCase and snake_case into words; an acronym such as URL stays together.
      for (const m of src.slice(i, j).matchAll(/[A-Z]{2,}(?=[A-Z][a-z]|\b|_|\d)|[A-Z]?[a-z]+|[A-Z]+/g)) tokens.push({ word: m[0], offset: i + m.index!, kind: 'name' });
      i = j;
    } else i++;
  }
  return tokens;
}

/** Tokens worth checking: no acronyms, no short name parts, nothing in the programming list. */
export function checkable(tokens: SpellToken[], extra: Set<string> = new Set()): SpellToken[] {
  // Short words are mostly abbreviations and sample data ("abc", "foo"), so only words of four or more letters count.
  return tokens.filter(t => t.word.length >= 4 && !/^[A-Z]+$/.test(t.word) && !PROGRAMMING_WORDS.has(t.word.toLowerCase()) && !extra.has(t.word.toLowerCase()));
}
