import type { SourceFile } from './types';

/**
 * A small Language Server Protocol client for Eclipse JDT LS, reached through the runner's HTTP bridge
 * (POST /api/lsp/send, long-polled GET /api/lsp/receive). It keeps the project's documents in sync and
 * exposes typed requests; web/lspmonaco.ts turns them into editor features.
 */
export type LspState = 'off' | 'starting' | 'ready' | 'unavailable' | 'stopped';
export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspTextEdit = { range: LspRange; newText: string };
export type LspDiagnostic = { range: LspRange; severity?: number; code?: string | number; source?: string; message: string; tags?: number[]; data?: unknown };
export type LspWorkspaceEdit = { changes?: Record<string, LspTextEdit[]>; documentChanges?: ({ textDocument: { uri: string; version?: number | null }; edits: LspTextEdit[] } | { kind: string })[] };
type Message = { jsonrpc: '2.0'; id?: string | number; method?: string; params?: any; result?: any; error?: { code: number; message: string } };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Settings sent at initialization and on workspace/configuration. */
function javaSettings(start: StartInfo) {
  return {
    java: {
      settings: { url: start.settingsPath },
      project: { sourcePaths: ['.'] },
      configuration: { runtimes: [{ name: start.runtimeName, path: start.runtimePath, default: true }], updateBuildConfiguration: 'automatic' },
      import: { gradle: { enabled: false }, maven: { enabled: false }, exclusions: ['**/node_modules/**', '**/.metadata/**'] },
      autobuild: { enabled: true },
      completion: { enabled: true, guessMethodArguments: 'insertParameterNames', postfix: { enabled: false }, chain: { enabled: false }, filteredTypes: ['java.awt.*', 'com.sun.*', 'sun.*', 'jdk.*', 'org.graalvm.*', 'javax.swing.*', 'java.lang.classfile.*', 'org.w3c.*', 'org.xml.*', 'javax.xml.*'], importOrder: ['java', 'javax', '', '#'] },
      signatureHelp: { enabled: true, description: { enabled: true } },
      format: { enabled: true, insertSpaces: true, tabSize: 4 },
      inlayHints: { parameterNames: { enabled: 'literals' } },
      references: { includeDecompiledSources: false },
      symbols: { includeSourceMethodDeclarations: true },
      saveActions: { organizeImports: false },
      cleanup: { actionsOnSave: [] },
      errors: { incompleteClasspath: { severity: 'ignore' } },
    },
  };
}
type StartInfo = { session: number; next: number; initialized: boolean; rootPath: string; settingsPath: string; runtimePath: string; runtimeName: string };

/** `file:///C:/a/b` for a native path, with each segment percent-encoded except a drive letter. */
export function fileUri(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  return `file:///${parts.map((p, i) => i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p)).join('/')}`;
}
/** Normalizes a file URI for comparison: decoded, forward slashes, lower-case drive letter. */
export function normalizeUri(uri: string): string {
  let text = uri;
  try { text = decodeURIComponent(uri); } catch { /* Keep the raw text. */ }
  return text.replace(/^file:\/+/i, 'file:///').replace(/^file:\/\/\/([A-Za-z]):/, (_, d: string) => `file:///${d.toLowerCase()}:`);
}

export class JavaLanguageClient {
  state: LspState = 'off';
  reason = '';
  /** 'starting' detail from language/status, such as "Importing projects". */
  progress = '';
  capabilities: any = {};
  onState: (state: LspState, reason: string) => void = () => {};
  onDiagnostics: (file: string, diagnostics: LspDiagnostic[]) => void = () => {};
  /** Applies a server-initiated workspace edit; returns whether it was applied. */
  onApplyEdit: (edit: LspWorkspaceEdit) => boolean = () => false;
  private base: string;
  private session = 0;
  private since = 0;
  private counter = 0;
  private token = Math.random().toString(36).slice(2, 8);
  private pending = new Map<string, Pending>();
  private outbox: Message[] = [];
  private sending: Promise<void> = Promise.resolve();
  private flushQueued = false;
  private rootUri = '';
  private start: StartInfo | null = null;
  private docs = new Map<string, { version: number; text: string }>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private polling = false;

  constructor(base = '') { this.base = base; }

  get ready() { return this.state === 'ready'; }

  private async http<T>(path: string, init: RequestInit = {}, timeout = 20000): Promise<T> {
    const response = await fetch(`${this.base}/api/lsp/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-TraceLab-Client': 'browser-v1' }, signal: AbortSignal.timeout(timeout) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `The language server bridge returned ${response.status}.`);
    return body as T;
  }

  private setState(state: LspState, reason = '') {
    if (state === this.state && reason === this.reason) return;
    this.state = state; this.reason = reason;
    this.onState(state, reason);
  }

  /** Starts (or reconnects to) the server and opens the project's files. */
  async connect(files: SourceFile[]): Promise<void> {
    if (this.state === 'starting' || this.state === 'ready') { await this.sync(files); return; }
    const status = await this.http<{ state: string; reason: string }>('status');
    if (status.state === 'unavailable') { this.setState('unavailable', status.reason); return; }
    this.setState('starting');
    try {
      const start = await this.http<StartInfo>('start', { method: 'POST', body: '{}' });
      this.start = start; this.session = start.session; this.since = start.next;
      this.rootUri = normalizeUri(fileUri(start.rootPath));
      this.docs.clear(); this.diagnostics.clear();
      this.poll();
      await this.http('files', { method: 'POST', body: JSON.stringify({ files }) });
      const root = fileUri(start.rootPath);
      const init = await this.request('initialize', {
        processId: null, clientInfo: { name: 'TraceLab' }, rootUri: root, workspaceFolders: [{ uri: root, name: 'project' }],
        capabilities: {
          workspace: { applyEdit: true, configuration: true, workspaceFolders: true, workspaceEdit: { documentChanges: true }, didChangeWatchedFiles: { dynamicRegistration: true }, executeCommand: { dynamicRegistration: false }, symbol: {} },
          textDocument: {
            synchronization: { didSave: false, willSave: false, dynamicRegistration: false },
            completion: { contextSupport: true, completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], deprecatedSupport: true, insertReplaceSupport: false, labelDetailsSupport: true, resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] } } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
            definition: {}, typeDefinition: {}, implementation: {}, references: {}, documentHighlight: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } }, isPreferredSupport: true },
            formatting: {}, rangeFormatting: {}, rename: { prepareSupport: true },
            publishDiagnostics: { relatedInformation: false, tagSupport: { valueSet: [1, 2] } },
            inlayHint: {},
          },
          window: { workDoneProgress: false, showMessage: {} },
        },
        initializationOptions: { settings: javaSettings(start), extendedClientCapabilities: { classFileContentsSupport: false, overrideMethodsPromptSupport: false, hashCodeEqualsPromptSupport: false, advancedOrganizeImportsSupport: false, generateConstructorsPromptSupport: false, advancedExtractRefactoringSupport: true, moveRefactoringSupport: false, resolveAdditionalTextEditsSupport: true, inferSelectedTextSupport: true }, bundles: [] },
      }, 120000);
      this.capabilities = init.capabilities ?? {};
      this.notify('initialized', {});
      this.notify('workspace/didChangeConfiguration', { settings: javaSettings(start) });
      for (const file of files) this.open(file.name, file.content);
      this.setState('ready');
    } catch (error) {
      this.setState('stopped', error instanceof Error ? error.message : String(error));
    }
  }

  /** Mirrors the project to the server: files on disk for indexing, open documents for edits. */
  async sync(files: SourceFile[]): Promise<void> {
    if (!this.ready) return;
    const names = new Set(files.map(f => f.name));
    const removed = [...this.docs.keys()].filter(n => !names.has(n));
    const added = files.filter(f => !this.docs.has(f.name));
    if (removed.length || added.length) {
      try { await this.http('files', { method: 'POST', body: JSON.stringify({ files }) }); } catch { /* Edits still reach open documents. */ }
      for (const name of removed) { this.notify('textDocument/didClose', { textDocument: { uri: this.uri(name) } }); this.docs.delete(name); this.diagnostics.delete(name); this.onDiagnostics(name, []); }
      this.notify('workspace/didChangeWatchedFiles', { changes: [...added.map(f => ({ uri: this.uri(f.name), type: 1 })), ...removed.map(n => ({ uri: this.uri(n), type: 3 }))] });
      for (const file of added) this.open(file.name, file.content);
    }
    for (const file of files) this.change(file.name, file.content);
  }

  private open(name: string, text: string) {
    this.docs.set(name, { version: 1, text });
    this.notify('textDocument/didOpen', { textDocument: { uri: this.uri(name), languageId: 'java', version: 1, text } });
  }

  /** Sends the full text of a document if it changed. Call before a request so the server sees the latest code. */
  change(name: string, text: string) {
    const doc = this.docs.get(name);
    if (!doc || doc.text === text || !this.ready) return;
    doc.version++; doc.text = text;
    this.notify('textDocument/didChange', { textDocument: { uri: this.uri(name), version: doc.version }, contentChanges: [{ text }] });
  }

  isOpen(name: string) { return this.docs.has(name); }
  diagnosticsFor(name: string): LspDiagnostic[] { return this.diagnostics.get(name) ?? []; }

  uri(name: string): string { return `${fileUri(this.start?.rootPath ?? '')}/${name.split('/').map(encodeURIComponent).join('/')}`; }
  /** Project file name for a server URI, or null when it is outside the project (for example a JDK class). */
  nameOf(uri: string): string | null {
    const normal = normalizeUri(uri);
    return normal.startsWith(`${this.rootUri}/`) ? normal.slice(this.rootUri.length + 1) : null;
  }

  request<T = any>(method: string, params: unknown, timeout = 15000): Promise<T> {
    if (!this.session) return Promise.reject(new Error('The language server is not connected.'));
    const id = `${this.token}-${++this.counter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.notify('$/cancelRequest', { id }); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method: string, params: unknown) { if (this.session) this.post({ jsonrpc: '2.0', method, params }); }
  private respond(id: string | number, result: unknown) { this.post({ jsonrpc: '2.0', id, result }); }

  /** Queues a message; queued messages go out together, in order. */
  private post(message: Message) {
    this.outbox.push(message);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const messages = this.outbox.splice(0);
      const session = this.session;
      this.sending = this.sending.then(() => this.http('send', { method: 'POST', body: JSON.stringify({ session, messages }) }).then(() => {}, error => this.lost(error)));
    });
  }

  private lost(error: unknown) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('The language server stopped.')); }
    this.pending.clear();
    this.setState('stopped', error instanceof Error ? error.message : String(error));
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    const session = this.session;
    try {
      while (this.session === session && this.state !== 'stopped') {
        let page: { session: number; state: string; reason: string; next: number; messages: Message[] };
        try { page = await this.http(`receive?session=${session}&since=${this.since}&wait=15000`, {}, 25000); }
        catch { await new Promise(r => setTimeout(r, 1500)); continue; }
        if (page.session !== session || page.state !== 'running') { this.lost(new Error(page.reason || 'The language server stopped.')); break; }
        this.since = page.next;
        for (const message of page.messages) this.dispatch(message);
      }
    } finally { this.polling = false; }
  }

  private dispatch(message: Message) {
    if (message.method && message.id !== undefined) { this.serverRequest(message); return; }
    if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id)); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      return;
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      const name = this.nameOf(message.params.uri);
      if (!name || !this.docs.has(name)) return;
      this.diagnostics.set(name, message.params.diagnostics);
      this.onDiagnostics(name, message.params.diagnostics);
    } else if (message.method === 'language/status') {
      this.progress = message.params.type === 'ServiceReady' ? '' : message.params.message ?? '';
      if (this.state === 'ready') this.onState('ready', this.progress);
    }
  }

  private serverRequest(message: Message) {
    const id = message.id!;
    switch (message.method) {
      case 'workspace/configuration': this.respond(id, (message.params?.items ?? []).map((item: { section?: string }) => {
        const settings: any = this.start ? javaSettings(this.start) : {};
        return item.section ? item.section.split('.').reduce((value, key) => value?.[key], settings) ?? null : settings;
      })); break;
      case 'workspace/applyEdit': this.respond(id, { applied: this.onApplyEdit(message.params.edit) }); break;
      case 'workspace/workspaceFolders': this.respond(id, this.start ? [{ uri: fileUri(this.start.rootPath), name: 'project' }] : []); break;
      default: this.respond(id, null);
    }
  }
}
