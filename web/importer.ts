import { analyzeJava, expectedPath, preferredMain, splitTopLevelTypes } from './javasource.ts';
import { fileLanguage, LANGUAGES, SINGLE_FILE } from './languages.ts';
import { validateProject } from './learning.ts';
import { readZip, writeZip } from './zip.ts';
import type { Language, Project, SourceFile } from './types';

/** Server limits, mirrored so problems are reported before a run. */
export const LIMITS = { files: 20, fileBytes: 65536, totalBytes: 262144 };
const FILE_PATTERN = /^(?:[A-Za-z_$][\w$]*\/)*[A-Za-z_$][\w$]*\.java$/;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
export const PROJECT_FILE = 'tracelab.json';

export type ImportResult = { project: Project; notes: string[] };
export type RawFile = { path: string; text: string };

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const bytes = (text: string) => new TextEncoder().encode(text).length;

export function validFileName(name: string, language: Language = 'java'): boolean {
  if (language !== 'java') return SINGLE_FILE.test(name) && name.endsWith(LANGUAGES[language].extension) && !RESERVED.test(name.split('.')[0]);
  return FILE_PATTERN.test(name) && name.length <= 180 && !name.replace(/\.java$/, '').split('/').some(part => RESERVED.test(part));
}

/** Checks a file set against the runner's limits. Returns a message, or null when it is fine. */
export function limitProblem(files: SourceFile[], language: Language = 'java'): string | null {
  if (language !== 'java') {
    // C and Python projects are one file, such as main.c.
    if (files.length !== 1) return `A ${LANGUAGES[language].name} project has exactly one file.`;
    if (!validFileName(files[0].name, language)) return `${files[0].name} is not a valid ${LANGUAGES[language].name} file name. Use a simple name such as ${LANGUAGES[language].mainFile}.`;
    if (bytes(files[0].content) > LIMITS.fileBytes) return `${files[0].name} is larger than 64 KiB.`;
    return null;
  }
  if (!files.length) return 'The project has no Java files.';
  if (files.length > LIMITS.files) return `A project can have up to ${LIMITS.files} Java files; this one has ${files.length}.`;
  const big = files.find(f => bytes(f.content) > LIMITS.fileBytes);
  if (big) return `${big.name} is larger than 64 KiB.`;
  if (files.reduce((sum, f) => sum + bytes(f.content), 0) > LIMITS.totalBytes) return 'The project’s source adds up to more than 256 KiB.';
  const seen = new Set<string>();
  for (const f of files) {
    if (!validFileName(f.name)) return `${f.name} is not a valid Java file path.`;
    if (seen.has(f.name.toLowerCase())) return `Two files would be named ${f.name}.`;
    seen.add(f.name.toLowerCase());
  }
  return null;
}

/**
 * Turns loose Java sources into project files. Each file is placed by its package and public type, not by
 * the folder it came from, so `src/main/java/com/x/Main.java` becomes `com/x/Main.java`. Pasted text with
 * several public types is split into one file per type.
 */
export function filesFromSources(raw: RawFile[]): { files: SourceFile[]; notes: string[] } {
  const notes: string[] = [];
  const files: SourceFile[] = [];
  for (const item of raw) {
    const text = normalize(item.text);
    if (!analyzeJava(text).types.length) { notes.push(`${item.path || 'Pasted text'} has no class, interface, enum or record, so it was skipped.`); continue; }
    const parts = splitTopLevelTypes(text);
    if (parts.length > 1) notes.push(`${item.path || 'The pasted code'} had ${parts.length} public types, so it was split into ${parts.map(p => p.name).join(', ')}.`);
    for (const part of parts) {
      const name = parts.length > 1 ? part.name : expectedPath(text, item.path.split('/').at(-1) ?? '');
      if (item.path && name !== item.path && !item.path.endsWith(`/${name}`) && parts.length === 1) notes.push(`${item.path} was placed at ${name} to match its package and class.`);
      files.push({ name, content: part.content.endsWith('\n') ? part.content : `${part.content}\n` });
    }
  }
  const unique = new Map<string, SourceFile>();
  for (const file of files) {
    if (unique.has(file.name.toLowerCase())) { notes.push(`More than one file declares ${file.name}; the first one was kept.`); continue; }
    unique.set(file.name.toLowerCase(), file);
  }
  return { files: [...unique.values()], notes };
}

/** Builds a new project from sources, detecting the main class. */
export function projectFromSources(name: string, raw: RawFile[]): ImportResult {
  const { files, notes } = filesFromSources(raw);
  const problem = limitProblem(files);
  if (problem) throw new Error(problem);
  const main = preferredMain(files);
  if (!main) notes.push('No class has a main method yet. Add public static void main(String[] args) to run the program, or test methods directly.');
  return { project: { version: 1, name: name.trim() || 'Imported project', example: '', mainClass: main ?? 'Main', stdin: '', maxSteps: 500, checks: [], files }, notes };
}

async function readFileText(file: File): Promise<string> {
  if (file.size > LIMITS.fileBytes) throw new Error(`${file.name} is larger than 64 KiB.`);
  return file.text();
}

/**
 * Imports a TraceLab project (.json), a .zip, Java sources, or one C/Python source file.
 * Paths from folder uploads are used only to report where files came from.
 */
export async function importFiles(input: { file: File; path: string }[], fallbackName: string): Promise<ImportResult> {
  if (input.length === 1 && /\.json$/i.test(input[0].file.name)) {
    if (input[0].file.size > 512 * 1024) throw new Error('Project files are limited to 512 KiB.');
    let value: unknown;
    try { value = JSON.parse(await input[0].file.text()); } catch { throw new Error('This JSON file could not be read.'); }
    if (!validateProject(value)) throw new Error('This JSON file is not a TraceLab project.');
    return { project: value, notes: [] };
  }
  if (input.length === 1 && /\.zip$/i.test(input[0].file.name)) {
    if (input[0].file.size > 4 * 1024 * 1024) throw new Error('Zip files are limited to 4 MiB.');
    return projectFromZip(new Uint8Array(await input[0].file.arrayBuffer()), input[0].file.name.replace(/\.zip$/i, ''));
  }
  // One C or Python file becomes a project of that language.
  const single = input.length === 1 ? fileLanguage(input[0].file.name) : null;
  if (single && single !== 'java') {
    const text = normalize(await readFileText(input[0].file));
    const original = input[0].file.name;
    const filename = validFileName(original, single) ? original : LANGUAGES[single].mainFile;
    return { project: singleFileProject(original.replace(/\.(c|py)$/i, '') || fallbackName, single, text, filename), notes: filename === original ? [] : [`${original} was placed at ${filename} to use a supported file name.`] };
  }
  const java = input.filter(i => /\.java$/i.test(i.file.name));
  const skipped = input.length - java.length;
  if (!java.length) throw new Error('Choose .java files, a folder that contains them, a .zip, a TraceLab .json project, or one .c or .py file.');
  if (java.length > 200) throw new Error('That is more than 200 Java files; TraceLab projects hold up to 20.');
  const raw = await Promise.all(java.map(async i => ({ path: i.path || i.file.name, text: await readFileText(i.file) })));
  const result = projectFromSources(folderName(java.map(i => i.path)) ?? suggestedName(raw) ?? fallbackName, raw);
  if (skipped) result.notes.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} not Java source and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  return result;
}

/** A C or Python project with one file, defaulting to `main.c` or `main.py`. */
export function singleFileProject(name: string, language: Exclude<Language, 'java'>, text: string, filename = LANGUAGES[language].mainFile): Project {
  const content = normalize(text);
  const project: Project = { version: 1, name: name.trim() || 'Imported project', example: '', mainClass: 'main', stdin: '', maxSteps: language === 'python' ? 1000 : 500, checks: [], language, files: [{ name: filename, content: content.endsWith('\n') ? content : `${content}\n` }] };
  const problem = limitProblem(project.files, language);
  if (problem) throw new Error(problem);
  return project;
}

/** A name for loose files: the main class, or the shared package. */
function suggestedName(raw: RawFile[]): string | undefined {
  const files = raw.map(r => ({ name: r.path, content: r.text }));
  const main = preferredMain(files);
  if (main) return main.split('.').at(-1);
  const packages = new Set(files.map(f => analyzeJava(f.content).packageName).filter(Boolean));
  return packages.size === 1 ? [...packages][0] : undefined;
}

function folderName(paths: string[]): string | undefined {
  const first = paths[0]?.split('/');
  return first && first.length > 1 && paths.every(p => p.split('/')[0] === first[0]) ? first[0] : undefined;
}

/** Reads a zip: a TraceLab export restores its tests and settings; any other zip contributes its .java files. */
export async function projectFromZip(data: Uint8Array, name: string): Promise<ImportResult> {
  const entries = await readZip(data, { maxEntries: 200, maxEntry: LIMITS.fileBytes, maxTotal: 2 * 1024 * 1024 },
    path => /\.(java|c|py)$/i.test(path) || path.split('/').at(-1) === PROJECT_FILE);
  const decoder = new TextDecoder();
  const manifest = entries.find(e => e.path.split('/').at(-1) === PROJECT_FILE);
  // A C or Python project exported from TraceLab: its one file is under src/.
  if (manifest) {
    let meta: Partial<Project> = {};
    try { meta = JSON.parse(decoder.decode(manifest.data)); } catch { /* Not a C or Python export. */ }
    if (meta.language === 'c' || meta.language === 'python') {
      const prefix = manifest.path.slice(0, manifest.path.length - PROJECT_FILE.length);
      const files = entries.filter(e => e.path.startsWith(`${prefix}src/`) && /\.(java|c|py)$/i.test(e.path))
        .map(e => ({ name: e.path.slice(prefix.length + 4), content: normalize(decoder.decode(e.data)) }));
      const candidate = { version: 1, name: meta.name ?? name, example: '', mainClass: 'main', language: meta.language, files, stdin: meta.stdin ?? '', maxSteps: meta.maxSteps ?? (meta.language === 'python' ? 1000 : 500), checks: meta.checks ?? [] };
      const problem = limitProblem(files, meta.language);
      if (problem) throw new Error(problem);
      if (validateProject(candidate)) return { project: candidate, notes: [] };
      throw new Error('This zip contains an invalid C or Python project.');
    }
  }
  const sources = entries.filter(e => /\.java$/i.test(e.path) && !e.path.split('/').some(part => part === '__MACOSX' || part.startsWith('.')));
  if (!sources.length) throw new Error('This zip has no .java files.');
  const raw = sources.map(e => ({ path: e.path, text: decoder.decode(e.data) }));
  if (manifest) {
    let meta: Partial<Project> = {};
    try { meta = JSON.parse(decoder.decode(manifest.data)); } catch { /* Fall back to plain sources. */ }
    const prefix = manifest.path.slice(0, manifest.path.length - PROJECT_FILE.length);
    const files = sources.filter(e => e.path.startsWith(`${prefix}src/`)).map(e => ({ name: e.path.slice(prefix.length + 4), content: normalize(decoder.decode(e.data)) }));
    const candidate = { version: 1, name: meta.name ?? name, example: '', mainClass: meta.mainClass ?? preferredMain(files) ?? 'Main', stdin: meta.stdin ?? '', maxSteps: meta.maxSteps ?? 500, checks: meta.checks ?? [], files };
    if (validateProject(candidate) && !limitProblem(candidate.files)) return { project: candidate, notes: [] };
  }
  const result = projectFromSources(folderName(raw.map(r => r.path)) ?? name, raw);
  return result;
}

/** Zip export: `src/<path>` for each file plus `tracelab.json` with name, main class, input and tests. */
export async function projectToZip(project: Project): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const { files, ...meta } = project;
  const run = project.language === 'c' ? `cc -o main src/${files[0].name} && ./main` : project.language === 'python' ? `python src/${files[0].name}` : `javac -d out $(find src -name "*.java") && java -cp out ${project.mainClass}`;
  const readme = `${project.name}\n\nExported from TraceLab. Source files are in src/.\n${project.language === 'python' ? 'Run' : 'Compile and run'}:  ${run}\nImport this zip into TraceLab to restore its tests.\n`;
  return writeZip([
    { path: PROJECT_FILE, data: encoder.encode(JSON.stringify(meta, null, 2)) },
    { path: 'README.txt', data: encoder.encode(readme) },
    ...files.map(f => ({ path: `src/${f.name}`, data: encoder.encode(f.content) })),
  ]);
}

/** Collects files from a drop, walking dropped folders. */
export async function droppedFiles(transfer: DataTransfer): Promise<{ file: File; path: string }[]> {
  const items = [...transfer.items].filter(i => i.kind === 'file');
  const entries = items.map(i => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  if (!entries.some(e => e?.isDirectory)) return [...transfer.files].map(file => ({ file, path: file.name }));
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length > 400) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: `${prefix}${entry.name}` });
    } else if (entry.isDirectory && !entry.name.startsWith('.')) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) if (entry) await walk(entry, '');
  return out;
}
