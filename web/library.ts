import type { Project } from './types';

/** Browser-local project library: many user projects, plus edits to examples kept separately. */
export type KV = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export type DocRef = { kind: 'project' | 'example'; id: string };
export type ProjectSummary = { id: string; name: string; createdAt: number; updatedAt: number; fileCount: number; origin?: string };
type Index = { version: 1; projects: ProjectSummary[]; current: DocRef | null };

const INDEX_KEY = 'tracelab.library.v1';
const LEGACY_KEY = 'tracelab.project.v1';
const projectKey = (id: string) => `tracelab.p.${id}`;
/** The project as it was created, for Reset. */
const originalKey = (id: string) => `tracelab.o.${id}`;
const exampleKey = (id: string) => `tracelab.ex.${id}`;
export const MAX_PROJECTS = 100;

/** Thrown when the browser refuses to store more data. */
export class StorageFullError extends Error {
  constructor() { super('Browser storage is full. Export or delete some projects, then try again.'); }
}

function newId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ?? Math.random().toString(36).slice(2, 14);
  return `p${Date.now().toString(36)}${random}`;
}

export class Library {
  private readonly storage: KV;
  private readonly validate: (value: unknown) => value is Project;
  private readonly now: () => number;
  private index: Index;

  constructor(storage: KV, validate: (value: unknown) => value is Project, now: () => number = Date.now) {
    this.storage = storage;
    this.validate = validate;
    this.now = now;
    this.index = this.readIndex();
  }

  private read(key: string): unknown {
    try { return JSON.parse(this.storage.getItem(key) ?? 'null'); } catch { return null; }
  }

  private write(key: string, value: unknown) {
    try { this.storage.setItem(key, JSON.stringify(value)); }
    catch (error) {
      if (error instanceof DOMException || (error instanceof Error && /quota/i.test(error.name + error.message))) throw new StorageFullError();
      throw error;
    }
  }

  private readIndex(): Index {
    const value = this.read(INDEX_KEY) as Partial<Index> | null;
    const projects = Array.isArray(value?.projects) ? value.projects.filter((p): p is ProjectSummary =>
      !!p && typeof p.id === 'string' && /^p[a-z0-9]{6,40}$/.test(p.id) && typeof p.name === 'string' && Number.isFinite(p.createdAt) && Number.isFinite(p.updatedAt)) : [];
    const current = value?.current && (value.current.kind === 'project' || value.current.kind === 'example') && typeof value.current.id === 'string' ? value.current : null;
    return { version: 1, projects, current };
  }

  private writeIndex() { this.write(INDEX_KEY, this.index); }

  /** User projects, most recently changed first. */
  list(): ProjectSummary[] { return [...this.index.projects].sort((a, b) => b.updatedAt - a.updatedAt); }
  get current(): DocRef | null { return this.index.current; }
  setCurrent(ref: DocRef | null) { this.index.current = ref; this.writeIndex(); }
  summary(id: string): ProjectSummary | undefined { return this.index.projects.find(p => p.id === id); }

  /** A user project, or an example's saved edits (null if the example is unedited). */
  load(ref: DocRef): Project | null {
    const value = this.read(ref.kind === 'project' ? projectKey(ref.id) : exampleKey(ref.id));
    return this.validate(value) ? value : null;
  }

  save(ref: DocRef, project: Project) {
    if (ref.kind === 'example') { this.write(exampleKey(ref.id), project); return; }
    const summary = this.summary(ref.id);
    if (!summary) throw new Error('This project no longer exists.');
    this.write(projectKey(ref.id), project);
    Object.assign(summary, { name: project.name, updatedAt: this.now(), fileCount: project.files.length });
    this.writeIndex();
  }

  /** Stores a new user project and returns its id. */
  create(project: Project, origin?: string): string {
    if (this.index.projects.length >= MAX_PROJECTS) throw new Error(`You can keep up to ${MAX_PROJECTS} projects in this browser. Delete or export some first.`);
    const id = newId();
    const time = this.now();
    this.write(projectKey(id), project);
    this.index.projects.push({ id, name: project.name, createdAt: time, updatedAt: time, fileCount: project.files.length, ...(origin ? { origin } : {}) });
    try { this.writeIndex(); }
    catch (error) { this.storage.removeItem(projectKey(id)); this.index.projects.pop(); throw error; }
    // The starting point is a convenience: a full browser storage keeps the project and skips it.
    try { this.write(originalKey(id), project); } catch { /* Reset won't be available for this project. */ }
    return id;
  }

  /** The project as it was created, or null for projects created before Reset existed. */
  original(id: string): Project | null {
    const value = this.read(originalKey(id));
    return this.validate(value) ? value : null;
  }

  /** Puts a project back to how it was created (keeping its current name) and returns it. */
  resetProject(id: string): Project | null {
    const start = this.original(id);
    const current = this.load({ kind: 'project', id });
    if (!start) return null;
    const reset = { ...structuredClone(start), name: current?.name ?? start.name };
    this.save({ kind: 'project', id }, reset);
    return reset;
  }

  duplicate(id: string): string | null {
    const project = this.load({ kind: 'project', id });
    if (!project) return null;
    return this.create({ ...structuredClone(project), name: this.uniqueName(`${project.name} (copy)`) }, this.summary(id)?.origin);
  }

  rename(ref: DocRef, name: string) {
    const project = this.load(ref);
    if (!project) return;
    project.name = name;
    this.save(ref, project);
  }

  remove(id: string) {
    this.index.projects = this.index.projects.filter(p => p.id !== id);
    if (this.index.current?.kind === 'project' && this.index.current.id === id) this.index.current = null;
    this.storage.removeItem(projectKey(id));
    this.storage.removeItem(originalKey(id));
    this.writeIndex();
  }

  hasExampleEdits(id: string): boolean { return this.storage.getItem(exampleKey(id)) !== null; }
  resetExample(id: string) { this.storage.removeItem(exampleKey(id)); }

  /** "Name", or "Name 2", "Name 3"… if that name is taken. */
  uniqueName(base: string): string {
    const taken = new Set(this.index.projects.map(p => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  }

  /**
   * Moves the single-workspace project from TraceLab 1.0 into the library.
   * `pristineExample` returns the example id when the project is an unedited copy of an example.
   */
  migrateLegacy(pristineExample: (project: Project) => string | null, exampleIds: Set<string>): DocRef | null {
    const legacy = this.read(LEGACY_KEY);
    if (!this.validate(legacy)) return null;
    let ref: DocRef;
    const pristine = pristineExample(legacy);
    if (pristine) ref = { kind: 'example', id: pristine };
    else if (legacy.example && exampleIds.has(legacy.example)) { ref = { kind: 'example', id: legacy.example }; this.save(ref, legacy); }
    else ref = { kind: 'project', id: this.create(legacy) };
    this.storage.removeItem(LEGACY_KEY);
    this.setCurrent(ref);
    return ref;
  }
}
