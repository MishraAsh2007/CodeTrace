import type { Language, Project, RunRequest } from './types';

/**
 * The project languages. Java runs on the JVM under JDI; C runs in the interpreter from the C_ver branch
 * (server/c); Python runs under pg_logger from the python branch (server/python.rs).
 */
export type LanguageInfo = {
  id: Language; name: string; label: string; extension: string; mainFile: string; monaco: string;
  /** What Run does, for the debugger's "Recording…" state. */
  engine: string;
  /** Who reports errors that stop the program from starting. */
  checker: string;
};

export const LANGUAGES: Record<Language, LanguageInfo> = {
  java: { id: 'java', name: 'Java', label: 'Java 21', extension: '.java', mainFile: 'Main.java', monaco: 'java', engine: 'TraceLab compiles your code with javac, runs it on a real JVM, and records every line it executes.', checker: 'javac' },
  c: { id: 'c', name: 'C', label: 'C', extension: '.c', mainFile: 'main.c', monaco: 'c', engine: 'TraceLab runs your C program in its interpreter and records the stack and heap after every statement.', checker: 'The C interpreter' },
  python: { id: 'python', name: 'Python', label: 'Python 3', extension: '.py', mainFile: 'main.py', monaco: 'python', engine: 'TraceLab runs your program with Python and records every step, the way Python Tutor does.', checker: 'Python' },
};

export const languageOf = (value: Pick<Project, 'language'> | Pick<RunRequest, 'language'> | null | undefined): Language => value?.language ?? 'java';
export const isJava = (value: Pick<Project, 'language'> | Pick<RunRequest, 'language'> | null | undefined) => languageOf(value) === 'java';
/** The language of a file, from its extension. */
export function fileLanguage(name: string): Language | null {
  if (name.endsWith('.java')) return 'java';
  if (name.endsWith('.c')) return 'c';
  if (name.endsWith('.py')) return 'python';
  return null;
}
/** C and Python projects hold one file with a simple name, such as main.c. */
export const SINGLE_FILE = /^[A-Za-z_]\w{0,63}\.(c|py)$/;
