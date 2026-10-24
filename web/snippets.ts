import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

const KEYWORDS = ['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'new', 'null', 'package', 'private', 'protected', 'public', 'record', 'return', 'short', 'static', 'super', 'switch', 'this', 'throw', 'throws', 'true', 'false', 'try', 'var', 'void', 'while'];
const TYPES = ['String', 'StringBuilder', 'Integer', 'Double', 'Boolean', 'Character', 'Math', 'Scanner', 'ArrayList', 'LinkedList', 'HashMap', 'TreeMap', 'HashSet', 'TreeSet', 'ArrayDeque', 'List', 'Map', 'Set', 'Arrays', 'Collections', 'Object', 'System'];

/**
 * Lightweight Java completions: snippets, keywords, common JDK types and identifiers from open files.
 * This is not semantic IntelliSense; it does not know types, members or imports.
 */
export function registerJavaCompletions(monaco: typeof Monaco, documentWords: () => string[], semantic: () => boolean = () => false) {
  const { CompletionItemKind: Kind, CompletionItemInsertTextRule: Rule } = monaco.languages;
  const snippets: [string, string, string][] = [
    ['sout', 'System.out.println(${1});', 'Print a line to standard output'],
    ['souf', 'System.out.printf("${1:%d}%n", ${2});', 'Formatted print'],
    ['main', 'public static void main(String[] args) {\n\t$0\n}', 'Program entry point'],
    ['psvm', 'public static void main(String[] args) {\n\t$0\n}', 'Program entry point'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:values.length}; ${1:i}++) {\n\t$0\n}', 'Indexed for loop'],
    ['foreach', 'for (${1:int} ${2:value} : ${3:values}) {\n\t$0\n}', 'Enhanced for loop'],
    ['while', 'while (${1:condition}) {\n\t$0\n}', 'While loop'],
    ['ifelse', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', 'If / else'],
    ['trycatch', 'try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t$0\n}', 'Try / catch'],
    ['scanner', 'Scanner ${1:input} = new Scanner(System.in);', 'Read standard input (needs import java.util.Scanner;)'],
    ['class', 'public class ${1:Name} {\n\t$0\n}', 'Class declaration'],
    ['method', '${1:static} ${2:int} ${3:name}(${4}) {\n\t$0\n}', 'Method declaration'],
  ];
  monaco.languages.registerCompletionItemProvider('java', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const seen = new Set<string>();
      const suggestions: Monaco.languages.CompletionItem[] = [];
      const add = (item: Omit<Monaco.languages.CompletionItem, 'range'>) => { if (!seen.has(String(item.label))) { seen.add(String(item.label)); suggestions.push({ ...item, range }); } };
      // Snippets only after a dot would be noise; the language server handles member completion.
      if (model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1).trimEnd().endsWith('.')) return { suggestions: [] };
      for (const [label, insertText, detail] of snippets) add({ label, kind: Kind.Snippet, insertText, insertTextRules: Rule.InsertAsSnippet, detail, sortText: `0${label}` });
      // With the language server running, it provides keywords, types and names with real type information.
      if (semantic()) return { suggestions };
      for (const keyword of KEYWORDS) add({ label: keyword, kind: Kind.Keyword, insertText: keyword, sortText: `2${keyword}` });
      for (const type of TYPES) add({ label: type, kind: Kind.Class, insertText: type, detail: 'JDK type', sortText: `3${type}` });
      for (const identifier of documentWords()) if (identifier !== word.word) add({ label: identifier, kind: Kind.Text, insertText: identifier, sortText: `1${identifier}` });
      return { suggestions };
    },
  });
}

/** Distinct identifiers in source text, longest-lived first by occurrence count. */
export function identifiers(sources: string[]): string[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const code = source.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/gm, ' ');
    for (const match of code.matchAll(/[A-Za-z_$][\w$]{1,}/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([word]) => !KEYWORDS.includes(word)).sort((a, b) => b[1] - a[1]).slice(0, 300).map(([word]) => word);
}
