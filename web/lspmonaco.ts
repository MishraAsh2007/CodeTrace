import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { JavaLanguageClient, LspDiagnostic, LspRange, LspTextEdit, LspWorkspaceEdit } from './lsp';

/** What the IDE provides so language features can map between editor models and project files. */
export type LspHost = {
  client: JavaLanguageClient;
  /** Project file shown by a model, or null for recorded (read-only) source. */
  fileOf(model: Monaco.editor.ITextModel): string | null;
  /** The editable model for a project file, created if needed. */
  modelOf(file: string): Monaco.editor.ITextModel | null;
  /** Opens a project file in the editor and selects a range. */
  reveal(file: string, range: Monaco.IRange): void;
  editor(): Monaco.editor.IStandaloneCodeEditor;
};

/** LSP CompletionItemKind (1-based) to Monaco's names. */
const COMPLETION_KINDS = ['', 'Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter'] as const;
const ALL_ACTION_KINDS = ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'];

export function registerJavaLanguageFeatures(monaco: typeof Monaco, host: LspHost): Monaco.IDisposable[] {
  const { client } = host;
  const L = monaco.languages;
  const active = (model: Monaco.editor.ITextModel) => client.ready && host.fileOf(model) !== null;
  /** Identifies a model's document, sending its latest text first. */
  const doc = (model: Monaco.editor.ITextModel) => { const file = host.fileOf(model)!; client.change(file, model.getValue()); return { uri: client.uri(file) }; };
  const pos = (p: Monaco.IPosition) => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const toRange = (r: LspRange) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
  const fromRange = (r: Monaco.IRange) => ({ start: { line: r.startLineNumber - 1, character: r.startColumn - 1 }, end: { line: r.endLineNumber - 1, character: r.endColumn - 1 } });
  const overlaps = (a: LspRange, b: LspRange) => !(a.end.line < b.start.line || (a.end.line === b.start.line && a.end.character < b.start.character) || a.start.line > b.end.line || (a.start.line === b.end.line && a.start.character > b.end.character));
  const markdown = (value: any): Monaco.IMarkdownString | undefined => !value ? undefined : typeof value === 'string' ? { value } : { value: value.value };
  const hoverParts = (contents: any): Monaco.IMarkdownString[] => (Array.isArray(contents) ? contents : [contents]).filter(Boolean)
    .map((c: any) => typeof c === 'string' ? c : 'language' in c ? `\`\`\`${c.language}\n${c.value}\n\`\`\`` : c.value)
    // JDT LS adds a link to the internal workspace folder; it means nothing to a student.
    .map((text: string) => text.replace(/\n*Source: \*\[[^\]]*\]\([^)]*\)\*/g, '').trim()).filter(Boolean).map((value: string) => ({ value }));
  const location = (loc: any): Monaco.languages.Location | null => {
    const file = client.nameOf(loc.uri ?? loc.targetUri);
    const model = file ? host.modelOf(file) : null;
    return model ? { uri: model.uri, range: toRange(loc.targetSelectionRange ?? loc.range) } : null;
  };
  const locations = (result: any) => (Array.isArray(result) ? result : result ? [result] : []).map(location).filter(Boolean) as Monaco.languages.Location[];

  /** Text edits per project file from an LSP workspace edit. File operations are not supported. */
  const editsByFile = (edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> => {
    const out = new Map<string, LspTextEdit[]>();
    const add = (uri: string, edits: LspTextEdit[]) => { const file = client.nameOf(uri); if (file) out.set(file, [...(out.get(file) ?? []), ...edits]); };
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
    for (const change of edit.documentChanges ?? []) if ('textDocument' in change) add(change.textDocument.uri, change.edits);
    return out;
  };
  const toWorkspaceEdit = (edit: LspWorkspaceEdit): Monaco.languages.WorkspaceEdit => ({
    edits: [...editsByFile(edit)].flatMap(([file, edits]) => {
      const model = host.modelOf(file);
      return model ? edits.map(e => ({ resource: model.uri, textEdit: { range: toRange(e.range), text: e.newText }, versionId: undefined })) : [];
    }),
  });
  /** Applies a workspace edit to the editor models as one undoable step per file. */
  const applyEdit = (edit: LspWorkspaceEdit): boolean => {
    let applied = false;
    for (const [file, edits] of editsByFile(edit)) {
      const model = host.modelOf(file);
      if (!model) continue;
      model.pushStackElement();
      model.pushEditOperations([], edits.map(e => ({ range: toRange(e.range), text: e.newText })), () => null);
      model.pushStackElement();
      applied = true;
    }
    return applied;
  };
  client.onApplyEdit = applyEdit;

  const disposables: Monaco.IDisposable[] = [];

  disposables.push(L.registerCompletionItemProvider('java', {
    triggerCharacters: ['.', '@', '#'],
    async provideCompletionItems(model, position, context) {
      if (!active(model)) return { suggestions: [] };
      const result = await client.request('textDocument/completion', { textDocument: doc(model), position: pos(position), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } }).catch(() => null);
      const items: any[] = Array.isArray(result) ? result : result?.items ?? [];
      const word = model.getWordUntilPosition(position);
      const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        incomplete: !Array.isArray(result) && !!result?.isIncomplete,
        suggestions: items.map(item => ({
          label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
          kind: L.CompletionItemKind[COMPLETION_KINDS[item.kind] as keyof typeof L.CompletionItemKind] ?? L.CompletionItemKind.Text,
          detail: item.detail, documentation: markdown(item.documentation), sortText: item.sortText, filterText: item.filterText, preselect: item.preselect,
          insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
          range: item.textEdit ? toRange(item.textEdit.range ?? item.textEdit.insert) : fallback,
          insertTextRules: item.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          additionalTextEdits: item.additionalTextEdits?.map((e: LspTextEdit) => ({ range: toRange(e.range), text: e.newText })),
          command: item.command?.command === 'editor.action.triggerParameterHints' ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined,
          tags: item.deprecated || item.tags?.includes(1) ? [L.CompletionItemTag.Deprecated] : undefined,
          lsp: item,
        }) as Monaco.languages.CompletionItem),
      };
    },
    async resolveCompletionItem(item) {
      const original = (item as any).lsp;
      if (!original || !client.ready) return item;
      const resolved = await client.request('completionItem/resolve', original, 3000).catch(() => null);
      if (!resolved) return item;
      return { ...item, detail: resolved.detail ?? item.detail, documentation: markdown(resolved.documentation) ?? item.documentation,
        additionalTextEdits: resolved.additionalTextEdits?.map((e: LspTextEdit) => ({ range: toRange(e.range), text: e.newText })) ?? item.additionalTextEdits };
    },
  }));

  disposables.push(L.registerHoverProvider('java', {
    async provideHover(model, position) {
      if (!active(model)) return null;
      const result = await client.request('textDocument/hover', { textDocument: doc(model), position: pos(position) }).catch(() => null);
      const contents = result ? hoverParts(result.contents) : [];
      return contents.length ? { contents, range: result.range ? toRange(result.range) : undefined } : null;
    },
  }));

  disposables.push(L.registerSignatureHelpProvider('java', {
    signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(model, position) {
      if (!active(model)) return null;
      const help = await client.request('textDocument/signatureHelp', { textDocument: doc(model), position: pos(position) }).catch(() => null);
      if (!help?.signatures?.length) return null;
      return { value: { activeSignature: help.activeSignature ?? 0, activeParameter: help.activeParameter ?? 0,
        signatures: help.signatures.map((s: any) => ({ label: s.label, documentation: markdown(s.documentation), activeParameter: s.activeParameter, parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: markdown(p.documentation) })) })) }, dispose() {} };
    },
  }));

  const navigation = (method: string) => async (model: Monaco.editor.ITextModel, position: Monaco.Position) => active(model) ? locations(await client.request(method, { textDocument: doc(model), position: pos(position) }).catch(() => null)) : [];
  disposables.push(L.registerDefinitionProvider('java', { provideDefinition: navigation('textDocument/definition') }));
  disposables.push(L.registerDeclarationProvider('java', { provideDeclaration: navigation('textDocument/declaration') }));
  disposables.push(L.registerTypeDefinitionProvider('java', { provideTypeDefinition: navigation('textDocument/typeDefinition') }));
  disposables.push(L.registerImplementationProvider('java', { provideImplementation: navigation('textDocument/implementation') }));
  disposables.push(L.registerReferenceProvider('java', {
    async provideReferences(model, position, context) {
      return active(model) ? locations(await client.request('textDocument/references', { textDocument: doc(model), position: pos(position), context: { includeDeclaration: context.includeDeclaration } }).catch(() => null)) : [];
    },
  }));
  disposables.push(L.registerDocumentHighlightProvider('java', {
    async provideDocumentHighlights(model, position) {
      if (!active(model)) return [];
      const result = await client.request('textDocument/documentHighlight', { textDocument: doc(model), position: pos(position) }).catch(() => null);
      return (result ?? []).map((h: any) => ({ range: toRange(h.range), kind: (h.kind ?? 1) - 1 }));
    },
  }));

  disposables.push(L.registerRenameProvider('java', {
    async resolveRenameLocation(model, position) {
      if (!active(model)) return { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'Renaming needs the Java language server.' };
      const result = await client.request('textDocument/prepareRename', { textDocument: doc(model), position: pos(position) }).catch(() => null);
      if (!result) return { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'This element can’t be renamed.' };
      const range = toRange(result.range ?? result);
      return { range, text: result.placeholder ?? model.getValueInRange(range) };
    },
    async provideRenameEdits(model, position, newName) {
      if (!active(model)) return { edits: [], rejectReason: 'Renaming needs the Java language server.' };
      const result = await client.request('textDocument/rename', { textDocument: doc(model), position: pos(position), newName }, 30000).catch((e: Error) => ({ error: e.message }));
      if (!result || 'error' in result) return { edits: [], rejectReason: (result as any)?.error ?? 'Rename failed.' };
      return toWorkspaceEdit(result);
    },
  }));

  const formatting = async (model: Monaco.editor.ITextModel, options: Monaco.languages.FormattingOptions, range?: Monaco.IRange) => {
    if (!active(model)) return [];
    const result = await client.request(range ? 'textDocument/rangeFormatting' : 'textDocument/formatting', { textDocument: doc(model), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces }, ...(range ? { range: fromRange(range) } : {}) }).catch(() => null);
    return (result ?? []).map((e: LspTextEdit) => ({ range: toRange(e.range), text: e.newText }));
  };
  disposables.push(L.registerDocumentFormattingEditProvider('java', { provideDocumentFormattingEdits: (model, options) => formatting(model, options) }));
  disposables.push(L.registerDocumentRangeFormattingEditProvider('java', { provideDocumentRangeFormattingEdits: (model, range, options) => formatting(model, options, range) }));

  disposables.push(L.registerDocumentSymbolProvider('java', {
    displayName: 'Java',
    async provideDocumentSymbols(model) {
      if (!active(model)) return [];
      const result = await client.request('textDocument/documentSymbol', { textDocument: doc(model) }).catch(() => null);
      const map = (s: any): Monaco.languages.DocumentSymbol => ({ name: s.name, detail: s.detail ?? '', kind: Math.max(0, (s.kind ?? 1) - 1), tags: [], range: toRange(s.range ?? s.location.range), selectionRange: toRange(s.selectionRange ?? s.location.range), children: (s.children ?? []).map(map) });
      return (result ?? []).map(map);
    },
  }));

  disposables.push(L.registerInlayHintsProvider('java', {
    async provideInlayHints(model, range) {
      if (!active(model)) return { hints: [], dispose() {} };
      const result = await client.request('textDocument/inlayHint', { textDocument: doc(model), range: fromRange(range) }).catch(() => null);
      const hints = (result ?? []).map((h: any) => ({ label: typeof h.label === 'string' ? h.label : h.label.map((p: any) => p.value).join(''), position: { lineNumber: h.position.line + 1, column: h.position.character + 1 }, kind: h.kind === 2 ? L.InlayHintKind.Parameter : L.InlayHintKind.Type, paddingRight: h.paddingRight ?? true }));
      return { hints, dispose() {} };
    },
  }));

  // Commands that code actions can carry. Refactorings return an edit to apply and sometimes a rename to start.
  const startRename = (args: any) => {
    const target = args?.[0];
    const file = target?.uri ? client.nameOf(target.uri) : null;
    const model = file ? host.modelOf(file) : null;
    if (!model || typeof target.offset !== 'number') return;
    const p = model.getPositionAt(target.offset);
    host.reveal(file!, new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column));
    setTimeout(() => host.editor().trigger('lsp', 'editor.action.rename', null), 50);
  };
  disposables.push(monaco.editor.registerCommand('tracelab.lsp.command', async (_accessor, command: { command: string; arguments?: any[] }) => {
    if (command.command === 'java.apply.workspaceEdit') { applyEdit(command.arguments?.[0]); return; }
    if (command.command === 'java.action.rename') { startRename(command.arguments); return; }
    if (command.command === 'java.action.applyRefactoringCommand') {
      const [name, context, ...rest] = command.arguments ?? [];
      const result = await client.request('java/getRefactorEdit', { command: name, context, options: { tabSize: 4, insertSpaces: true }, commandArguments: rest }, 30000).catch(() => null);
      if (result?.edit) applyEdit(result.edit);
      if (result?.command?.command === 'java.action.rename') startRename(result.command.arguments);
      return;
    }
    const result = await client.request('workspace/executeCommand', { command: command.command, arguments: command.arguments ?? [] }, 30000).catch(() => null);
    if (result && typeof result === 'object' && ('changes' in result || 'documentChanges' in result)) applyEdit(result);
  }));
  const supported = (command: string) => ['java.apply.workspaceEdit', 'java.action.rename', 'java.action.applyRefactoringCommand'].includes(command)
    || (client.capabilities?.executeCommandProvider?.commands ?? []).includes(command);
  const toCommand = (c: { command: string; title: string; arguments?: any[] }): Monaco.languages.Command => ({ id: 'tracelab.lsp.command', title: c.title, arguments: [c] });

  disposables.push(L.registerCodeActionProvider('java', {
    async provideCodeActions(model, range, context) {
      if (!active(model)) return { actions: [], dispose() {} };
      const file = host.fileOf(model)!;
      const lspRange = fromRange(range);
      const diagnostics = client.diagnosticsFor(file).filter((d: LspDiagnostic) => overlaps(d.range, lspRange));
      const result = await client.request('textDocument/codeAction', { textDocument: doc(model), range: lspRange, context: { diagnostics, only: context.only ? [context.only] : undefined, triggerKind: context.trigger === L.CodeActionTriggerType.Invoke ? 1 : 2 } }, 8000).catch(() => null);
      const actions: Monaco.languages.CodeAction[] = [];
      for (const a of result ?? []) {
        if (typeof a.command === 'string') { if (supported(a.command)) actions.push({ title: a.title, command: toCommand(a) }); continue; }
        if (a.command && !supported(a.command.command)) continue;
        const edit = a.edit ? toWorkspaceEdit(a.edit) : a.command?.command === 'java.apply.workspaceEdit' ? toWorkspaceEdit(a.command.arguments[0]) : undefined;
        actions.push({ title: a.title, kind: a.kind, isPreferred: a.isPreferred, edit, command: a.command && a.command.command !== 'java.apply.workspaceEdit' ? toCommand(a.command) : undefined,
          diagnostics: (a.diagnostics ?? []).map((d: LspDiagnostic) => ({ message: d.message, severity: monaco.MarkerSeverity.Error, ...toRange(d.range) })) });
      }
      return { actions, dispose() {} };
    },
  }, { providedCodeActionKinds: ALL_ACTION_KINDS }));

  return disposables;
}

/** Monaco markers for LSP diagnostics. */
export function toMarkers(monaco: typeof Monaco, diagnostics: LspDiagnostic[], explain: (message: string) => string | null = () => null): Monaco.editor.IMarkerData[] {
  const severity = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
  return diagnostics.map(d => ({
    severity: severity[d.severity ?? 1] ?? monaco.MarkerSeverity.Error, message: explain(d.message) ? `${d.message}\n${explain(d.message)}` : d.message, source: 'Java',
    startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
    tags: (d.tags ?? []).map(t => t === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated),
  }));
}
