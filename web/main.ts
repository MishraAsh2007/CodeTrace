import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// editor.api alone has no editor features; edcore.main adds them (suggestions, hovers, quick fixes, find, F1 commands).
import 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { createIcons, Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2, Folder, FolderOpen, FolderKanban, Package, Copy, FileArchive, ClipboardPaste, Save, Boxes, ListPlus, TriangleAlert, ArrowUp, ArrowDown, FileJson, CirclePlay, Braces, WandSparkles } from 'lucide';
import { categories, copyExample, demoFor, demos, exampleIndex, examples } from './examples';
import type { DemoCategory } from './examples';
import { exceptionMessage, failingCheck, normalizeOutput, output, questionsFor, sameSource, snapshots, validateProject, valueText } from './learning';
import { Library, StorageFullError } from './library';
import type { DocRef } from './library';
import { droppedFiles, importFiles, limitProblem, projectFromSources, projectToZip, validFileName } from './importer';
import { analyzeJava, fileIssues, mainClasses, preferredMain, renameType, setPackage, testTargets } from './javasource';
import { batchOutcome, batchRequest, batchResults, describeTest, evaluateTest, harnessErrorDetail, isCallTest, isHarnessFile, requestForTest, testExpression, testProblems } from './tests';
import type { BatchCase, BatchResult, TestOutcome } from './tests';
import { caseToCheck, packageOf, planTests } from './testgen';
import type { CaseResult } from './testgen';
import { templates } from './templates';
import { boxedValue, describeStep, describeValue, displayMethod, heapIndex, isInlineValue, returnedCall, simpleType, stepBackOver, stepOut, stepOver } from './narrate';
import type { StoryItem } from './narrate';
import { drawArrows, focusArrows } from './arrows';
import { cursorsByObject, cursorsFor, variableTargets } from './cursors';
import type { Cursor } from './cursors';
import { applyEdits, compileIssues } from './compilehelp';
import type { CompileFix, CompileIssue, LineEdit } from './compilehelp';
import { decodeProject, encodeProject, SHARE_PREFIX } from './share';
import { identifiers, registerJavaCompletions } from './snippets';
import { CONCEPTS, loadProgress, recordSolved, resetProgress } from './progress';
import { applyLayout, attachSplitter, clamp, DEFAULT_CONSOLE, DEFAULT_SPLIT, loadLayout, saveLayout } from './layout';
import type { SidebarView } from './layout';
import { applyTheme, onSystemThemeChange, resolvedTheme, setTheme, themeChoice } from './theme';
import type { ThemeChoice } from './theme';
import { categoryLabel, demoCard, demoName, filterBar, LOGO_SVG, visibleDemos } from './gallery';
import type { Check as TestCase, Frame, HeapObject, Project, Question, Run, RunRequest, SourceFile, TraceEvent, TraceValue, Variable } from './types';
import './tokens.css';
import './style.css';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const iconSet = { Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2, Folder, FolderOpen, FolderKanban, Package, Copy, FileArchive, ClipboardPaste, Save, Boxes, ListPlus, TriangleAlert, ArrowUp, ArrowDown, FileJson, CirclePlay, Braces, WandSparkles };
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Escapes text and renders `backtick` spans as inline code. */
const rich = (value: unknown): string => esc(value).replace(/`([^`]+)`/g, '<code>$1</code>');
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const icons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.75 } });
const VERSION = '1.2';
const DEFAULT_EXAMPLE = 'bounds';
/** "3 minutes ago"-style label for project lists. */
function relativeTime(time: number): string {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'just now';
  const units: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2629800, 'month'], [31557600, 'year']];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (let i = units.length - 1; i >= 0; i--) if (seconds >= units[i][0]) return format.format(-Math.round(seconds / units[i][0]), units[i][1]);
  return format.format(-Math.round(seconds / 60), 'minute');
}

type UiSettings = { arrows: boolean; inline: boolean };
function loadUi(): UiSettings {
  try { const value = JSON.parse(localStorage.getItem('tracelab.ui.v1') ?? '{}'); return { arrows: value.arrows !== false, inline: value.inline !== false }; }
  catch { return { arrows: true, inline: true }; }
}
function saveUi() { try { localStorage.setItem('tracelab.ui.v1', JSON.stringify(ui)); } catch { /* Preferences are optional. */ } }

applyTheme();
/** In-memory storage when the browser blocks localStorage (for example, some private modes). */
const memoryStorage = (() => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; })();
const storage = (() => { try { localStorage.setItem('tracelab.probe', '1'); localStorage.removeItem('tracelab.probe'); return localStorage; } catch { return memoryStorage; } })();
const library = new Library(storage, validateProject);
const exampleIds = new Set(examples.map(e => e.example));
const pristineExample = (value: Project) => examples.find(e => JSON.stringify(e) === JSON.stringify(value))?.example ?? null;
library.migrateLegacy(pristineExample, exampleIds);
/** The document being edited: a user project, or an example (whose edits are kept separately). */
let doc: DocRef = { kind: 'example', id: DEFAULT_EXAMPLE };
let project: Project = copyExample(exampleIndex(DEFAULT_EXAMPLE));
function loadDoc(ref: DocRef): Project | null {
  if (ref.kind === 'project') return library.load(ref);
  const index = exampleIndex(ref.id);
  return index < 0 ? null : library.load(ref) ?? copyExample(index);
}
{
  const ref = library.current ?? (library.list()[0] ? { kind: 'project' as const, id: library.list()[0].id } : null);
  const loaded = ref ? loadDoc(ref) : null;
  if (ref && loaded) { doc = ref; project = loaded; }
}
let storageFailed = storage === memoryStorage;
let activeFile = initialFile(project);
const collapsedFolders = new Set<string>();
let run: Run | null = null;
let previousRun: Run | null = null;
let step = 0;
let running = false;
let checking = false;
let currentRunId: string | null = null;
let checkCancelled = false;
let stopRequested = false;
let playTimer: ReturnType<typeof setInterval> | null = null;
let speed = 700;
let consoleTab = 'output';
let watchFilter = '';
let traceSource = false;
let galleryFilter: DemoCategory | 'all' = 'all';
let runnerOnline = false;
const ui = loadUi();
const layout = loadLayout();
let questions: Question[] = [];
let questionIndex = 0;
let questionAnswers: Record<string, number> = {};
let questionAttempts: Record<string, number> = {};
let solvedQuestions = new Set<string>();
let progress = loadProgress();
let hintsShown = 0;
let checkResults: { name: string; index: number; status: 'running' | 'passed' | 'failed'; detail?: string }[] = [];
let checksSource = '';
/** Compile-error help for the current run, and the result of compiling each suggested fix. */
let helpCache: { run: Run | null; issues: CompileIssue[] } = { run: null, issues: [] };
type FixCheck = { status: 'checking' | 'compiles' | 'fixed' | 'unchanged' | 'unknown'; remaining?: number };
let fixChecks = new Map<string, FixCheck>();
let fixTask: Promise<void> | null = null;
let fixCancel = false;
/** Test generation in progress; runs wait for it because the runner has one job slot. */
let genTask: Promise<unknown> | null = null;
const models = new Map<string, monaco.editor.ITextModel>();
const breakpoints = new Map<string, Set<number>>();
let changingModel = false;
let decorations: monaco.editor.IEditorDecorationsCollection;

$('#app').innerHTML = `
  <header class="topbar">
    <a class="logo" href="/" title="TraceLab home">${LOGO_SVG}<span>TraceLab</span></a>
    <span class="topbar-divider" aria-hidden="true"></span>
    <div class="menu-wrap project-wrap"><button class="project-switch" id="project-switch" aria-haspopup="menu" aria-expanded="false" aria-controls="project-menu" title="Switch project"><span id="doc-kind" class="doc-kind" hidden>Example</span><span id="project-title"></span>${icon('chevron-down')}</button>
      <div class="menu project-menu" id="project-menu" role="menu" hidden></div>
    </div>
    <button id="new-project-top" class="btn btn-ghost btn-compact" data-action="new-project" title="Start a new project from a template, pasted code or files" aria-label="New project">${icon('plus')}<span class="label">New project</span></button>
    <button id="save-copy" class="btn btn-secondary btn-compact" hidden title="Copy this example into your projects">${icon('save')}Save as my project</button>
    <span class="save-state" id="save-state">Saved</span>
    <div class="topbar-run">
      <button id="run" class="btn btn-primary" title="Compile, run and record (Ctrl+Enter)">${icon('play')}Run<kbd>Ctrl ↵</kbd></button>
      <button id="stop" class="btn btn-danger" hidden>${icon('square')}Stop</button>
      <button id="verify-top" class="btn btn-secondary" title="Run the project’s test cases against your current code">${icon('list-checks')}Run tests</button>
    </div>
    <div class="topbar-actions">
      <div class="segmented" role="group" aria-label="Panels">
        <button id="toggle-sidebar" class="icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar">${icon('panel-left')}</button>
        <button id="toggle-console" class="icon-btn" title="Toggle bottom panel" aria-label="Toggle bottom panel">${icon('panel-bottom')}</button>
        <button id="toggle-coach" class="icon-btn" title="Toggle Tutor" aria-label="Toggle Tutor">${icon('panel-right')}<span id="coach-count" class="count-badge" hidden></span></button>
      </div>
      <button id="theme" class="icon-btn" title="Theme" aria-label="Change theme"></button>
      <button id="share" class="btn btn-secondary" title="Copy a link that contains this project">${icon('share-2')}Share</button>
      <div class="menu-wrap"><button id="menu-button" class="icon-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="main-menu" title="More actions" aria-label="More actions">${icon('ellipsis')}</button>
        <div class="menu" id="main-menu" role="menu" hidden>
          <button role="menuitem" data-action="new-project">${icon('file-plus-2')}New project…</button>
          <button role="menuitem" data-action="projects">${icon('folder-kanban')}My projects</button>
          <button role="menuitem" data-action="gallery">${icon('layout-grid')}Browse examples…</button>
          <div class="menu-separator" role="separator"></div>
          <button role="menuitem" data-action="import">${icon('upload')}Import files, folder or zip…</button>
          <button role="menuitem" data-action="export-zip">${icon('file-archive')}Export as zip</button>
          <button role="menuitem" data-action="export">${icon('file-json')}Export as TraceLab file</button>
          <button role="menuitem" data-action="export-trace">${icon('history')}Export recorded trace</button>
          <div class="menu-separator" role="separator"></div>
          <button role="menuitem" data-action="settings">${icon('settings-2')}Project settings…</button>
          <button role="menuitem" data-action="shortcuts">${icon('keyboard')}Keyboard shortcuts</button>
          <button role="menuitem" data-action="about">${icon('info')}About TraceLab</button>
          <a role="menuitem" href="/">${icon('house')}TraceLab home</a>
        </div>
      </div>
    </div>
  </header>
  <div class="app-layout">
    <nav class="activity-bar" aria-label="Views">
      <button data-view="explorer" class="activity" title="Explorer" aria-label="Explorer">${icon('files')}</button>
      <button data-view="projects" class="activity" title="My projects" aria-label="My projects">${icon('folder-kanban')}</button>
      <button data-view="examples" class="activity" title="Examples" aria-label="Examples">${icon('flask-conical')}</button>
      <button data-action="new-project" class="activity" title="New project" aria-label="New project">${icon('plus')}</button>
      <span class="activity-spacer"></span>
      <button data-action="shortcuts" class="activity" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button>
      <button data-action="settings" class="activity" title="Project settings" aria-label="Project settings">${icon('settings-2')}</button>
    </nav>
    <aside class="sidebar" aria-label="Sidebar">
      <section data-view-panel="explorer" class="side-view" id="explorer">
        <div class="side-header"><h2>Explorer</h2><div><button id="new-file" class="icon-btn small" title="New Java file" aria-label="New Java file">${icon('file-plus-2')}</button><button data-action="add-files" class="icon-btn small" title="Add files to this project" aria-label="Add files to this project">${icon('upload')}</button></div></div>
        <div class="tree-root" id="tree-root">${icon('chevron-down')}<span id="folder-name"></span></div>
        <div id="file-list" class="file-list" role="tree" aria-label="Project files"></div>
        <div class="drop-hint">Drop .java files, a folder or a zip here to add them.</div>
        <div class="side-footer"><span id="side-footer">${icon('shield-check')} Saved in this browser</span></div>
      </section>
      <section data-view-panel="projects" class="side-view" hidden>
        <div class="side-header"><h2>My projects</h2><div><button data-action="new-project" class="icon-btn small" title="New project" aria-label="New project">${icon('plus')}</button><button data-action="import" class="icon-btn small" title="Import as a new project" aria-label="Import as a new project">${icon('upload')}</button></div></div>
        <div id="project-list" class="project-list"></div>
      </section>
      <section data-view-panel="examples" class="side-view" hidden>
        <div class="side-header"><h2>Examples</h2><button data-action="gallery" class="icon-btn small" title="Open gallery" aria-label="Open example gallery">${icon('layout-grid')}</button></div>
        <div id="example-list" class="example-list"></div>
      </section>
    </aside>
    <main class="workspace">
      <div class="workbench" id="workbench">
        <section class="editor-panel panel" aria-label="Code editor">
          <div class="panel-tabs editor-tabs" id="editor-tabs" role="tablist"></div>
          <div id="source-banner" class="source-banner" hidden></div>
          <div id="lint-banner" class="source-banner lint" hidden></div>
          <div class="editor-container" id="editor"></div>
        </section>
        <div class="splitter vertical" id="split-columns" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize editor and debugger" aria-controls="workbench" aria-valuemin="25" aria-valuemax="75" title="Drag to resize · double-click to reset"></div>
        <section class="visual-panel panel" aria-label="Debugger">
          <div class="panel-tabs debugger-header"><span class="panel-title">${icon('bug')}Debugger</span><div class="trace-summary" id="trace-summary"></div><span class="status-chip" id="run-status">Idle</span></div>
          <div class="trace-toolbar"><label class="watch-search">${icon('search')}<input id="watch-filter" placeholder="Filter variables and objects" aria-label="Filter variables and objects" /></label><button id="toggle-arrows" class="icon-btn toggle" aria-pressed="${ui.arrows}" title="Reference arrows" aria-label="Show reference arrows">${icon('spline')}</button><button id="toggle-inline" class="icon-btn toggle" aria-pressed="${ui.inline}" title="Show strings and boxed numbers inline" aria-label="Show strings and boxed numbers inline">${icon('type')}</button><button id="history" class="icon-btn" title="Switch to the previous run" aria-label="Switch to the previous run" disabled>${icon('rotate-ccw')}</button></div>
          <div class="memory-canvas" id="memory-canvas"></div>
          <div class="timeline">
            <div class="timeline-top"><span id="step-label">No recording</span><input id="scrubber" type="range" min="0" max="0" value="0" aria-label="Recorded step" disabled /><select id="speed" aria-label="Playback speed"><option value="1200">0.5×</option><option value="700" selected>1×</option><option value="250">2×</option></select></div>
            <div class="playback-controls">
              <div class="control-group"><button id="first" class="icon-btn" title="First step" aria-label="First step">${icon('chevrons-left')}</button><button id="back" class="icon-btn" title="Step back (Alt+←)" aria-label="Step back">${icon('chevron-left')}</button><button id="play" class="icon-btn play" title="Play" aria-label="Play">${icon('play')}</button><button id="next" class="icon-btn" title="Step into (F11 or Alt+→)" aria-label="Step into">${icon('chevron-right')}</button><button id="last" class="icon-btn" title="Last step" aria-label="Last step">${icon('chevrons-right')}</button></div>
              <div class="control-group" role="group" aria-label="Frame-aware stepping"><button id="back-over" class="step-button" title="Step back over (Shift+F10)">${icon('undo-2')}<span>Back</span></button><button id="step-over" class="step-button" title="Step over (F10)">${icon('redo-2')}<span>Over</span></button><button id="step-out" class="step-button" title="Step out (Shift+F11)">${icon('corner-left-up')}<span>Out</span></button></div>
              <button id="next-bookmark" class="step-button" title="Next bookmarked line. Click the editor gutter to add a bookmark.">${icon('bookmark')}<span>Bookmark</span></button>
            </div>
          </div>
        </section>
      </div>
      <div class="splitter horizontal" id="split-console" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize bottom panel" aria-valuemin="80" aria-valuemax="600" title="Drag to resize · double-click to reset"></div>
      <section class="console-panel panel" aria-label="Bottom panel">
        <div class="panel-tabs console-tabs" role="tablist"><button class="panel-tab" data-console="output" role="tab">${icon('terminal')}Output</button><button class="panel-tab" data-console="input" role="tab">Input</button><button class="panel-tab" data-console="diagnostics" role="tab">Problems<span class="tab-count" id="problem-count">0</span></button><button class="panel-tab" data-console="checks" role="tab">Tests<span class="tab-count" id="checks-count"></span></button><span id="console-context"></span><button id="collapse-console" class="icon-btn small console-collapse" title="Collapse panel" aria-label="Collapse bottom panel">${icon('chevron-down')}</button></div>
        <div id="console-content" class="console-content" role="tabpanel"></div>
      </section>
    </main>
    <aside class="coach" aria-label="Tutor">
      <div class="coach-header"><h2>${icon('lightbulb')}Tutor</h2><button id="collapse-coach" class="icon-btn small" title="Hide Tutor" aria-label="Hide Tutor">${icon('panel-right-close')}</button></div>
      <div class="coach-scroll">
        <ol class="learning-stages" id="learning-stages" aria-label="Debugging steps"></ol>
        <div id="coach-content"></div>
        <section class="tests-card"><div class="card-title">${icon('list-checks')}<h3>Tests</h3><span class="tab-count" id="tests-count"></span><button id="edit-checks" class="link-btn">Edit</button></div><p class="muted" id="tests-blurb">Each test runs your current code in a fresh JVM and checks its output or a method’s result.</p><div class="tests-actions"><button id="verify" class="btn btn-secondary">${icon('play')}Run tests</button><button id="add-test" class="btn btn-ghost">${icon('list-plus')}Add test</button><button id="generate-tests" class="btn btn-ghost" title="Try sample arguments on your methods and turn the results into tests you confirm">${icon('wand-sparkles')}Generate</button></div><button id="save-run-test" class="link-btn" hidden>${icon('save')}Save this run’s output as a test</button><div id="check-results" aria-live="polite"></div></section>
        <section class="progress-card" id="progress-card"></section>
        <p class="coach-footnote">Questions are generated from values recorded during your run and from the recorded source. Passing tests confirms those cases, not every possible input.</p>
      </div>
    </aside>
  </div>
  <footer class="statusbar">
    <button class="status-item" id="runner-status" data-action="about" title="About the runner"><span class="status-dot"></span><span id="runner-label">Connecting…</span></button>
    <span class="status-item" id="status-text"></span>
    <span class="status-spacer"></span>
    <span class="status-item" id="status-step"></span>
    <span class="status-item" id="editor-position">Ln 1, Col 1</span>
    <span class="status-item">Spaces: 4</span><span class="status-item">UTF-8</span><span class="status-item">Java 21</span>
  </footer>
  <input type="file" id="import-input" accept=".java,.zip,.json,application/zip,application/json" multiple hidden />
  <input type="file" id="import-folder" webkitdirectory multiple hidden />
  <div class="drop-overlay" id="drop-overlay" hidden><div>${icon('upload')}<strong id="drop-title">Drop to import</strong><span id="drop-detail">.java files, a folder, a zip or a TraceLab project</span></div></div>
  <dialog id="dialog" aria-labelledby="dialog-title"><form id="dialog-form" novalidate><div class="dialog-heading"><h2 id="dialog-title"></h2><button type="button" class="icon-btn" data-close-dialog aria-label="Close dialog">${icon('x')}</button></div><div id="dialog-body"></div><div class="dialog-error" id="dialog-error" role="alert"></div><div class="dialog-actions" id="dialog-actions"><button type="button" class="btn btn-secondary" id="dialog-cancel" data-close-dialog>Cancel</button><button type="submit" id="dialog-submit" class="btn btn-primary">Save</button></div></form></dialog>
  <dialog id="gallery" class="gallery-dialog" aria-labelledby="gallery-title"><div class="gallery-head"><div><h2 id="gallery-title">Examples</h2><p class="muted">Each buggy example comes with questions about what went wrong and tests that check your fix.</p></div><button class="icon-btn" id="gallery-close" aria-label="Close gallery">${icon('x')}</button></div><div class="filter-bar" id="gallery-filters"></div><div class="demo-grid" id="gallery-grid"></div></dialog>
  <div id="toast" role="status" hidden></div>
`;

// ---------- Editor ----------

const editorColors = (dark: boolean): Record<string, string> => dark
  ? { 'editor.background': '#12161C', 'editor.foreground': '#E7EAF0', 'editorLineNumber.foreground': '#4B5563', 'editorLineNumber.activeForeground': '#B7BFCB', 'editor.selectionBackground': '#2A3B4F', 'editor.lineHighlightBackground': '#171C23', 'editor.lineHighlightBorder': '#00000000', 'editorGutter.background': '#12161C', 'editorCursor.foreground': '#34D399', 'editorIndentGuide.background1': '#222832', 'editorWidget.background': '#161B22', 'editorWidget.border': '#323A45', 'editorSuggestWidget.background': '#161B22', 'editorSuggestWidget.selectedBackground': '#1E2A36' }
  : { 'editor.background': '#FFFFFF', 'editor.foreground': '#171C23', 'editorLineNumber.foreground': '#A3AAB5', 'editorLineNumber.activeForeground': '#444D5A', 'editor.selectionBackground': '#CFE3FF', 'editor.lineHighlightBackground': '#F6F7F9', 'editor.lineHighlightBorder': '#00000000', 'editorGutter.background': '#FFFFFF', 'editorCursor.foreground': '#0D8F6C', 'editorIndentGuide.background1': '#ECEEF2' };
monaco.editor.defineTheme('tracelab-light', { base: 'vs', inherit: true, colors: editorColors(false), rules: [
  { token: 'comment', foreground: '6B7280', fontStyle: 'italic' }, { token: 'keyword', foreground: '8B3FC9' }, { token: 'string', foreground: '0B7A57' }, { token: 'number', foreground: 'B4530A' }, { token: 'type.identifier', foreground: '1F5FBF' }, { token: 'annotation', foreground: '8B6D00' } ] });
monaco.editor.defineTheme('tracelab-dark', { base: 'vs-dark', inherit: true, colors: editorColors(true), rules: [
  { token: 'comment', foreground: '7C8796', fontStyle: 'italic' }, { token: 'keyword', foreground: 'C792EA' }, { token: 'string', foreground: '7FE0B4' }, { token: 'number', foreground: 'F5A962' }, { token: 'type.identifier', foreground: '82AAFF' }, { token: 'annotation', foreground: 'E6C07B' } ] });
const editor = monaco.editor.create($('#editor'), {
  language: 'java', theme: resolvedTheme() === 'dark' ? 'tracelab-dark' : 'tracelab-light', fontSize: 13.5, lineHeight: 21,
  fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, monospace', fontLigatures: false,
  minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true,
  padding: { top: 12, bottom: 12 }, glyphMargin: true, folding: true, smoothScrolling: true,
  lineNumbersMinChars: 3, overviewRulerLanes: 0, renderLineHighlight: 'all', cursorBlinking: 'smooth',
  tabSize: 4, wordWrap: 'off', fixedOverflowWidgets: true, suggest: { showWords: true }, bracketPairColorization: { enabled: true },
});
decorations = editor.createDecorationsCollection();
applyLayout(layout);
registerJavaCompletions(monaco, () => identifiers(project.files.map(f => f.content)));

function renderTheme() {
  const choice = themeChoice();
  const theme = resolvedTheme(choice);
  monaco.editor.setTheme(theme === 'dark' ? 'tracelab-dark' : 'tracelab-light');
  const next = { system: 'Light', light: 'Dark', dark: 'System' }[choice];
  $('#theme').innerHTML = icon(choice === 'system' ? 'monitor' : choice === 'dark' ? 'moon' : 'sun');
  $('#theme').title = `Theme: ${choice === 'system' ? `system (${theme})` : choice}. Click for ${next.toLowerCase()}.`;
  icons(); scheduleArrows();
}
onSystemThemeChange(() => renderTheme());

function setLayout(change: Partial<typeof layout>) {
  Object.assign(layout, change);
  applyLayout(layout); saveLayout(layout); scheduleArrows(); renderCoachCount();
}
function showView(view: SidebarView) { setLayout(layout.sidebar && layout.view === view ? { sidebar: false } : { sidebar: true, view }); }
/** When the Tutor is hidden, show how many questions are waiting. */
function renderCoachCount() {
  const badge = $('#coach-count');
  const waiting = questions.filter(q => questionAnswers[q.id] !== q.correct).length;
  badge.hidden = layout.coach || waiting === 0;
  badge.textContent = String(waiting);
  $('#toggle-coach').setAttribute('aria-label', layout.coach ? 'Hide Tutor' : `Show Tutor${waiting ? `, ${waiting} question${waiting === 1 ? '' : 's'} waiting` : ''}`);
}
const workbenchEl = $('#workbench');
attachSplitter($('#split-columns'), {
  axis: 'x', step: 4,
  fromPointer: e => { const box = workbenchEl.getBoundingClientRect(); return ((e.clientX - box.left) / box.width) * 100; },
  get: () => layout.split,
  set: value => { layout.split = clamp(value, 25, 75); applyLayout(layout); scheduleArrows(); },
  reset: () => { layout.split = DEFAULT_SPLIT; applyLayout(layout); },
  done: () => { saveLayout(layout); scheduleArrows(); },
});
attachSplitter($('#split-console'), {
  axis: 'y', step: 24, invertKeys: true,
  fromPointer: e => { const box = $('.workspace').getBoundingClientRect(); return box.bottom - e.clientY - 4; },
  get: () => layout.consoleHeight,
  set: value => { const max = Math.max(80, $('.workspace').getBoundingClientRect().height - 300); layout.consoleHeight = clamp(value, 80, Math.min(600, max)); layout.console = true; applyLayout(layout); },
  reset: () => { layout.consoleHeight = DEFAULT_CONSOLE; layout.console = true; applyLayout(layout); },
  done: () => { saveLayout(layout); scheduleArrows(); },
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  const el = $('#toast');
  el.className = `toast ${tone}`;
  el.innerHTML = `${icon(tone === 'success' ? 'circle-check' : tone === 'error' ? 'circle-x' : 'info')}<span>${esc(message)}</span>`;
  el.hidden = false; icons();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Saves the open document. Typing schedules a save; other changes save immediately. */
function save(delayed = false) {
  clearTimeout(saveTimer);
  if (delayed) { $('#save-state').textContent = 'Saving…'; saveTimer = setTimeout(() => save(), 400); return; }
  const blocked = storage === memoryStorage;
  // An example that matches its original has no edits to keep.
  const pristine = doc.kind === 'example' && JSON.stringify(project) === JSON.stringify(examples[exampleIndex(doc.id)]);
  try { if (pristine) library.resetExample(doc.id); else library.save(doc, project); storageFailed = blocked; }
  catch (error) { storageFailed = true; if (error instanceof StorageFullError) toast(error.message, 'error'); }
  $('#save-state').textContent = storageFailed ? (blocked ? 'Not saved: browser storage is blocked' : 'Not saved — export to keep changes') : doc.kind === 'example' ? 'Example · changes saved' : 'Saved';
  $('#save-state').classList.toggle('warning', storageFailed);
  renderDocChrome();
}
window.addEventListener('beforeunload', () => { if (saveTimer) save(); });
function sourceKey() { return JSON.stringify({ files: project.files, mainClass: project.mainClass, checks: project.checks }); }
function dirtyTrace() { return !!run && !sameSource(project, run); }
function currentStates() { return snapshots(run); }
function currentEvent() { return currentStates()[step]; }
function currentSnapshot(): TraceEvent | undefined {
  const states = currentStates();
  for (let i = Math.min(step, states.length - 1); i >= 0; i--) if (states[i].frames) return states[i];
  return undefined;
}
function stopPlayback() { if (playTimer) clearInterval(playTimer); playTimer = null; $('#play').innerHTML = icon('play'); $('#play').setAttribute('aria-label', 'Play'); icons(); }
function checksFresh() { return checkResults.length > 0 && checksSource === sourceKey(); }
function allChecksPassed() { return checksFresh() && checkResults.length === project.checks.length && checkResults.every(r => r.status === 'passed'); }

function getModel(file: string, historical: boolean) {
  const files = historical && run ? run.request.files : project.files;
  const source = files.find(f => f.name === file) ?? files[0];
  const key = historical && run ? `${run.id}/${source.name}` : `workspace/${source.name}`;
  let model = models.get(key);
  if (!model) {
    model = monaco.editor.createModel(source.content, 'java', monaco.Uri.parse(`inmemory://tracelab/${key}`));
    models.set(key, model);
    if (!historical) model.onDidChangeContent(() => {
      if (changingModel) return;
      const target = project.files.find(f => f.name === source.name);
      if (target) { target.content = model!.getValue(); monaco.editor.setModelMarkers(model!, 'java-compiler', []); save(true); renderSourceBanner(); renderCheckResults(); renderStages(); updateDecorations(); scheduleLint(); }
    });
  }
  return model;
}

function selectFile(name: string, historical = traceSource) {
  traceSource = historical;
  const available = historical && run ? run.request.files : project.files;
  activeFile = available.some(f => f.name === name) ? name : available[0].name;
  changingModel = true;
  editor.setModel(getModel(activeFile, historical));
  editor.updateOptions({ readOnly: historical });
  changingModel = false;
  renderFiles(); renderSourceBanner(); updateDecorations();
}

/** Explorer tree: files grouped into package folders, with main-class and path-problem markers. */
function renderTree(): string {
  const issues = fileIssues(project.files);
  const mains = new Set(mainClasses(project.files));
  type Node = { folders: Map<string, Node>; files: string[] };
  const root: Node = { folders: new Map(), files: [] };
  for (const file of [...project.files].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = file.name.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push(file.name);
  }
  const fileRow = (name: string, depth: number) => {
    const file = project.files.find(f => f.name === name)!;
    const info = analyzeJava(file.content);
    const qualified = info.types.filter(t => t.hasMain).map(t => info.packageName ? `${info.packageName}.${t.name}` : t.name);
    const isMain = qualified.includes(project.mainClass);
    const issue = issues.get(name);
    const runnable = qualified.find(q => q !== project.mainClass && mains.has(q));
    return `<div class="file-row ${name === activeFile && !traceSource ? 'active' : ''}" role="treeitem" aria-selected="${name === activeFile && !traceSource}" style="--depth:${depth}"><button data-file="${esc(name)}" title="${esc(issue ? issue.message : name)}">${icon('file-code-2')}<span>${esc(name.split('/').at(-1))}</span>${isMain ? `<span class="file-badge main" title="Main class: Run starts here">${icon('circle-play')}</span>` : ''}${issue ? `<span class="file-badge warn" title="${esc(issue.message)}">${icon('triangle-alert')}</span>` : ''}</button>${runnable ? `<button data-set-main="${esc(runnable)}" class="file-action" title="Run from ${esc(runnable)}" aria-label="Make ${esc(runnable)} the main class">${icon('circle-play')}</button>` : ''}<button data-rename="${esc(name)}" class="file-action" title="Rename or move" aria-label="Rename ${esc(name)}">${icon('pencil')}</button><button data-delete="${esc(name)}" class="file-action" title="Delete" aria-label="Delete ${esc(name)}">${icon('trash-2')}</button></div>`;
  };
  const folderRows = (node: Node, path: string, depth: number): string => [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, child]) => {
    const full = path ? `${path}/${name}` : name;
    const open = !collapsedFolders.has(full);
    return `<div class="folder-row" role="treeitem" aria-expanded="${open}" style="--depth:${depth}"><button data-folder="${esc(full)}" title="Package ${esc(full.replace(/\//g, '.'))}">${icon(open ? 'chevron-down' : 'chevron-right')}${icon(open ? 'folder-open' : 'folder')}<span>${esc(name)}</span></button><button data-new-in="${esc(full)}" class="file-action" title="New file in this package" aria-label="New file in ${esc(full)}">${icon('plus')}</button></div>${open ? `<div role="group">${folderRows(child, full, depth + 1)}${child.files.map(f => fileRow(f, depth + 1)).join('')}</div>` : ''}`;
  }).join('');
  return folderRows(root, '', 0) + root.files.map(f => fileRow(f, 0)).join('');
}

function renderFiles() {
  const available = traceSource && run ? run.request.files : project.files;
  $('#project-title').textContent = project.name;
  document.title = `${project.name} · TraceLab`;
  $('#folder-name').textContent = project.name;
  $('#file-list').innerHTML = renderTree();
  // Adding files works from the tab bar too, so it doesn't depend on the sidebar being open.
  $('#editor-tabs').innerHTML = available.map(f => `<button class="panel-tab ${f.name === activeFile ? 'active' : ''}" role="tab" aria-selected="${f.name === activeFile}" data-tab="${esc(f.name)}" title="${esc(f.name)}">${icon('file-code-2')}${esc(f.name.split('/').at(-1))}</button>`).join('')
    + (traceSource ? '<span class="tab-note">Recorded source · read-only</span>' : `<span class="tab-actions"><button class="icon-btn small" data-action="new-file" title="New Java file" aria-label="New Java file">${icon('plus')}</button><button class="icon-btn small" data-action="add-files" title="Add files from your computer" aria-label="Add files from your computer">${icon('upload')}</button></span>`);
  renderDocChrome();
  renderLint();
  $('#example-list').innerHTML = categories.map(c => {
    const items = demos.filter(d => d.category === c.id);
    return `<div class="example-group"><h3>${esc(c.label)}</h3>${items.map(d => `<button class="example-item ${project.example === d.id ? 'active' : ''}" data-open-demo="${esc(d.id)}" title="${esc(d.summary)}"><span class="example-dot ${c.id}"></span><span class="example-text"><span>${esc(demoName(d))}</span><small>${esc(d.symptom)}</small></span></button>`).join('')}</div>`;
  }).join('') + `<button class="btn btn-secondary btn-block" data-action="gallery">${icon('layout-grid')}Open gallery</button>`;
  $('#checks-count').textContent = String(project.checks.length);
  $('#tests-count').textContent = String(project.checks.length);
  icons();
}

/** Topbar and sidebar state that depends on which document is open. */
function renderDocChrome() {
  const example = doc.kind === 'example';
  $('#doc-kind').hidden = !example;
  $('#save-copy').hidden = !example;
  $('#side-footer').innerHTML = example
    ? `${icon('flask-conical')} Example · <button class="link-btn" data-action="save-copy">Save as my project</button>`
    : `${icon('shield-check')} Saved in this browser`;
  renderProjectList();
  icons();
}

function renderProjectList() {
  const list = library.list();
  const edited = examples.filter(e => library.hasExampleEdits(e.example));
  const row = (ref: DocRef, name: string, meta: string, actions: string) => `<div class="project-row ${doc.kind === ref.kind && doc.id === ref.id ? 'active' : ''}"><button data-open-doc="${ref.kind}:${esc(ref.id)}" title="Open ${esc(name)}">${icon(ref.kind === 'example' ? 'flask-conical' : 'folder')}<span class="project-text"><span>${esc(name)}</span><small>${esc(meta)}</small></span></button>${actions}</div>`;
  $('#project-list').innerHTML = `${list.length ? list.map(p => row({ kind: 'project', id: p.id }, p.name, `${p.fileCount} file${p.fileCount === 1 ? '' : 's'} · ${relativeTime(p.updatedAt)}`,
    `<button class="file-action" data-project-action="rename" data-id="${esc(p.id)}" title="Rename" aria-label="Rename ${esc(p.name)}">${icon('pencil')}</button><button class="file-action" data-project-action="duplicate" data-id="${esc(p.id)}" title="Duplicate" aria-label="Duplicate ${esc(p.name)}">${icon('copy')}</button><button class="file-action" data-project-action="export" data-id="${esc(p.id)}" title="Export as zip" aria-label="Export ${esc(p.name)}">${icon('download')}</button><button class="file-action" data-project-action="delete" data-id="${esc(p.id)}" title="Delete" aria-label="Delete ${esc(p.name)}">${icon('trash-2')}</button>`)).join('')
    : `<div class="side-empty"><p>Your projects appear here. Create one from a template, paste code, or drop in .java files.</p><p>Examples are separate: edits to an example stay with that example. Use Save as my project to copy one here.</p></div>`}
    <button class="btn btn-primary btn-block" data-action="new-project">${icon('plus')}New project</button>
    ${edited.length ? `<h3 class="side-subhead">Examples you changed</h3>${edited.map(e => row({ kind: 'example', id: e.example }, e.name, 'Edited example', `<button class="file-action" data-reset-example="${esc(e.example)}" title="Reset to the original" aria-label="Reset ${esc(e.name)}">${icon('rotate-ccw')}</button>`)).join('')}` : ''}`;
}

function renderProjectMenu() {
  const recent = library.list().slice(0, 8);
  $('#project-menu').innerHTML = `<div class="menu-label">Recent projects</div>${recent.length ? recent.map(p => `<button role="menuitem" data-open-doc="project:${esc(p.id)}" class="${doc.kind === 'project' && doc.id === p.id ? 'current' : ''}">${icon('folder')}<span class="menu-text">${esc(p.name)}<small>${esc(relativeTime(p.updatedAt))}</small></span></button>`).join('') : '<p class="menu-empty">No projects yet.</p>'}
    <div class="menu-separator" role="separator"></div>
    <button role="menuitem" data-action="new-project">${icon('plus')}New project…</button>
    <button role="menuitem" data-action="projects">${icon('folder-kanban')}All projects</button>
    <button role="menuitem" data-action="rename-project">${icon('pencil')}Rename “${esc(project.name)}”…</button>
    <button role="menuitem" data-action="settings">${icon('settings-2')}Project settings…</button>`;
  icons();
}

let lintTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLint() { clearTimeout(lintTimer); lintTimer = setTimeout(() => { renderLint(); $('#file-list').innerHTML = renderTree(); icons(); }, 500); }
/** Warns when a file's path does not match its package and public class, with a one-click move. */
function renderLint() {
  const issues = fileIssues(project.files);
  for (const file of project.files) {
    const issue = issues.get(file.name);
    const model = models.get(`workspace/${file.name}`);
    if (model) monaco.editor.setModelMarkers(model, 'tracelab-paths', issue ? [{ severity: monaco.MarkerSeverity.Warning, message: `${issue.message} TraceLab records a class only when its file path matches.`, startLineNumber: issue.line, endLineNumber: issue.line, startColumn: 1, endColumn: model.getLineMaxColumn(issue.line) }] : []);
  }
  const issue = !traceSource ? issues.get(activeFile) : undefined;
  const banner = $('#lint-banner');
  banner.hidden = !issue;
  banner.innerHTML = issue ? `${icon('triangle-alert')}<span>${esc(issue.message)}</span><button class="link-btn" data-move-file="${esc(activeFile)}" data-move-to="${esc(issue.expected)}">Move to ${esc(issue.expected)}</button>` : '';
  icons();
}

function moveFile(from: string, to: string): boolean {
  if (from === to) return true;
  if (!validFileName(to)) { toast(`${to} is not a valid Java file path.`, 'error'); return false; }
  if (project.files.some(f => f.name !== from && f.name.toLowerCase() === to.toLowerCase())) { toast(`${to} already exists.`, 'error'); return false; }
  const file = project.files.find(f => f.name === from);
  if (!file) return false;
  file.name = to;
  // A changed package renames the class's qualified name: keep the main class and test targets pointing at it.
  if (!mainClasses(project.files).includes(project.mainClass)) {
    const moved = mainClasses([file]).find(m => m.split('.').at(-1) === project.mainClass.split('.').at(-1));
    if (moved) project.mainClass = moved;
  }
  const targets = testTargets(project.files);
  for (const check of project.checks) {
    if (!check.target || targets.some(t => t.qualified === check.target)) continue;
    const match = targets.filter(t => t.name === check.target!.split('.').at(-1));
    if (match.length === 1) check.target = match[0].qualified;
  }
  const key = `workspace/${from}`; models.get(key)?.dispose(); models.delete(key);
  const marks = breakpoints.get(from); breakpoints.delete(from); if (marks) breakpoints.set(to, marks);
  if (activeFile === from) activeFile = to;
  save(); selectFile(activeFile, false);
  return true;
}

function renderSourceBanner() {
  const banner = $('#source-banner');
  if (traceSource) {
    banner.hidden = false; banner.innerHTML = `${icon('history')}<span>Viewing the source recorded with this run.</span><button id="return-editor" class="link-btn">Back to editing</button>`;
  } else if (dirtyTrace()) {
    banner.hidden = false; banner.innerHTML = `${icon('info')}<span>The code changed after this run. Line highlights are paused.</span><button id="view-recorded" class="link-btn">View recorded source</button>`;
  } else { banner.hidden = true; banner.innerHTML = ''; }
  icons();
}

function updateDecorations() {
  const marks: monaco.editor.IModelDeltaDecoration[] = [];
  const event = currentEvent();
  const aligned = !dirtyTrace() || traceSource;
  if (event?.location && event.kind !== 'terminated' && event.location.file === activeFile && aligned) {
    marks.push({ range: new monaco.Range(event.location.line, 1, event.location.line, 1), options: { isWholeLine: true, className: event.exception ? 'trace-line-error' : 'trace-line', glyphMarginClassName: event.exception ? 'trace-glyph error' : 'trace-glyph', glyphMarginHoverMessage: { value: event.exception ? 'The exception was thrown here' : 'Paused before this line runs' } } });
  }
  const focus = questions[questionIndex]?.focus;
  if (focus && focus.file === activeFile && aligned) {
    marks.push({ range: new monaco.Range(focus.line, 1, focus.line, 1), options: { isWholeLine: true, className: 'question-line', linesDecorationsClassName: 'question-line-marker', hoverMessage: { value: 'The current Tutor question is about this line' } } });
  }
  for (const line of breakpoints.get(activeFile) ?? []) marks.push({ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'bookmark-glyph', glyphMarginHoverMessage: { value: 'Replay bookmark: jump here with the Bookmark button. Execution is not paused.' } } });
  decorations.set(marks);
}

editor.onDidChangeCursorPosition(event => { $('#editor-position').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`; });
editor.onMouseDown(event => {
  if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) return;
  const line = event.target.position.lineNumber;
  const set = breakpoints.get(activeFile) ?? new Set();
  if (set.has(line)) set.delete(line); else set.add(line);
  breakpoints.set(activeFile, set); updateDecorations();
});
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => startRun());
// Monaco binds Shift+F10 to its context menu; in TraceLab it steps back over, as everywhere else on the page.
editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F10, () => navigate('back-over'));

// ---------- Memory rendering ----------

type RenderContext = { heap: Map<string, HeapObject>; previousHeap: Map<string, HeapObject>; cursors: Map<string, Cursor[]>; targets: Map<string, Cursor>; topFrame?: string };
function refColor(id = '') { return ['green', 'blue', 'orange', 'violet'][Number(id.replace(/\D/g, '')) % 4]; }
function inlineText(object: HeapObject): string { return object.kind === 'string' ? `“${object.text ?? ''}”${object.truncated ? '…' : ''}` : boxedValue(object) ?? ''; }

function renderValue(value: TraceValue, previous: TraceValue | undefined, ctx: RenderContext) {
  const object = value.kind === 'reference' ? ctx.heap.get(value.ref!) : undefined;
  // A string being indexed gets its own card, so it is drawn as a reference with an arrow.
  if (ui.inline && object && isInlineValue(object) && !ctx.cursors.has(object.id)) {
    const before = previous?.kind === 'reference' ? ctx.previousHeap.get(previous.ref!) : undefined;
    const changed = previous && (previous.ref !== value.ref || (before && inlineText(before) !== inlineText(object)));
    return `<span class="inline-value ${changed ? 'changed' : ''}" title="${esc(`${simpleType(object.type)} object @${object.id}${changed && previous ? ` · previously ${previous.kind === 'reference' && before ? inlineText(before) : valueText(previous)}` : ''}`)}">${esc(inlineText(object))}<small>@${esc(object.id)}</small></span>`;
  }
  const changed = previous && JSON.stringify(previous) !== JSON.stringify(value);
  if (value.kind === 'reference') return `<button class="ref ${refColor(value.ref)} ${changed ? 'changed' : ''} ${value.omitted ? 'omitted' : ''}" data-ref="${esc(value.ref)}" title="${value.omitted ? 'Not captured: object limit reached' : `Go to ${esc(simpleType(value.type ?? 'object'))} @${esc(value.ref)}`}">${icon('arrow-up-right')}@${esc(value.ref)}${value.omitted ? ' …' : ''}</button>`;
  return `<span class="primitive ${value.kind === 'null' ? 'null' : ''} ${changed ? 'changed' : ''}" ${changed ? `title="Previously ${esc(valueText(previous!))}"` : ''}>${esc(valueText(value))}</span>`;
}
/** "→ values[2] = 7" next to an index variable in the running frame. */
function indexHint(cursor: Cursor, ctx: RenderContext): string {
  const object = ctx.heap.get(cursor.objectId);
  if (!object) return '';
  const length = object.kind === 'string' ? object.text?.length ?? 0 : object.length ?? 0;
  if (!cursor.inRange) return `<span class="index-hint error" title="${esc(`${cursor.name}[${cursor.label}] is outside 0 to ${length - 1}`)}">→ past the end of ${esc(cursor.name)} (length ${length})</span>`;
  const element = object.kind === 'string' ? `'${object.text?.[cursor.index] ?? '?'}'` : object.elements?.[cursor.index] ? describeValue(object.elements[cursor.index], ctx.heap) : '…';
  return `<span class="index-hint" title="${esc(cursor.kind === 'for-each' ? `This iteration is at position ${cursor.index} of ${cursor.name}` : `${cursor.name}[${cursor.label}]`)}">→ ${esc(cursor.name)}[${cursor.index}] = ${esc(element)}</span>`;
}

function renderVariables(variables: Variable[], previous: Variable[] | undefined, ctx: RenderContext, qualified = false, frameId?: string) {
  return variables.filter(v => !watchFilter || `${v.name} ${v.type} ${valueText(v.value)}`.toLowerCase().includes(watchFilter)).map(v => {
    const prior = previous?.find(p => p.name === v.name);
    const fresh = previous && !prior;
    const target = frameId && frameId === ctx.topFrame ? ctx.targets.get(v.name) : undefined;
    return `<div class="variable ${fresh ? 'fresh' : ''}"><div class="variable-label"><span class="variable-name">${esc(v.name.split('.').slice(qualified ? -2 : -1).join('.'))}</span><span class="variable-type">${esc(simpleType(v.type))}${v.argument ? ' · param' : ''}</span>${target ? indexHint(target, ctx) : ''}</div>${renderValue(v.value, prior?.value, ctx)}</div>`;
  }).join('');
}

/** Array, list or string cells, with markers for the indexes the running method is using. */
function renderCells(object: HeapObject, previous: HeapObject | undefined, ctx: RenderContext): string {
  const cursors = ctx.cursors.get(object.id) ?? [];
  const tags = (index: number) => cursors.filter(c => c.index === index).map(c => `<span class="cursor-tag ${c.inRange ? '' : 'error'} ${c.kind}" title="${esc(c.kind === 'for-each' ? `${c.label} is element ${index} in this iteration` : `${c.name}[${c.label}] is index ${index}`)}">${esc(c.label)}</span>`).join('');
  const isString = object.kind === 'string';
  const values = isString ? [...(object.text ?? '')].slice(0, 64) : object.elements ?? [];
  const cells = values.map((v, i) => {
    const marks = tags(i);
    const content = typeof v === 'string' ? `<span class="primitive char">${esc(v === ' ' ? '␣' : v)}</span>` : renderValue(v, previous?.elements?.[i], ctx);
    return `<div class="array-cell ${marks ? 'pointed' : ''}">${object.kind === 'set' ? '' : `<span class="array-index">${i}</span>`}${content}${marks ? `<div class="cursor-tags">${marks}</div>` : ''}</div>`;
  }).join('');
  const length = isString ? (object.text?.length ?? 0) : (object.length ?? 0);
  // Indexes outside the array get a ghost cell, so the failed access is visible next to the real cells.
  const outside = [...new Set(cursors.filter(c => !c.inRange).map(c => c.index))].sort((a, b) => a - b);
  const ghosts = outside.map(i => `<div class="array-cell ghost ${i < 0 ? 'before' : ''}"><span class="array-index">${i}</span><span class="ghost-box" title="No element at index ${i}: valid indexes are 0 to ${length - 1}">✕</span><div class="cursor-tags">${tags(i)}</div></div>`);
  const before = ghosts.filter((_, k) => outside[k] < 0).join(''), after = ghosts.filter((_, k) => outside[k] >= 0).join('');
  const hidden = cursors.filter(c => c.inRange && c.index >= values.length);
  const note = hidden.length ? `<div class="array-caption">${hidden.map(c => `${esc(c.label)} = ${c.index}`).join(', ')} (beyond the ${values.length} elements captured)</div>` : '';
  const empty = !values.length && !ghosts.length ? `<span class="empty-array">${object.kind === 'array' ? 'Empty · no valid indices' : isString ? 'Empty string' : `Empty ${object.kind}`}</span>` : '';
  return `<div class="array-cells ${object.kind} ${cursors.length ? 'has-cursor' : ''}">${before}${cells}${after}${empty}</div>${note}`;
}
function renderHeap(object: HeapObject, previous: HeapObject | undefined, isNew: boolean, ctx: RenderContext, snapshot: TraceEvent) {
  const indexed = ctx.cursors.has(object.id);
  if (ui.inline && isInlineValue(object) && !indexed) return '';
  if (watchFilter && !JSON.stringify(object).toLowerCase().includes(watchFilter)) return '';
  const refs = snapshot.frames?.flatMap(f => f.locals.filter(v => v.value.ref === object.id).map(v => v.name)) ?? [];
  let body = '';
  if (object.kind === 'string' && indexed && (object.text?.length ?? 0) <= 64) body = renderCells(object, previous, ctx);
  else if (object.kind === 'string') body = `<div class="string-value ${previous && previous.text !== object.text ? 'changed' : ''}">“${esc(object.text)}”</div>`;
  else if (object.kind === 'map') body = `<div class="map-entries">${object.entries?.map(e => {
    const before = previous?.entries?.find(p => JSON.stringify(p.key) === JSON.stringify(e.key));
    return `<div class="map-entry ${previous && !before ? 'fresh' : ''}">${renderValue(e.key, undefined, ctx)}<span class="map-arrow">→</span>${renderValue(e.value, before?.value, ctx)}</div>`;
  }).join('') || '<span class="empty-array">Empty map</span>'}</div>`;
  else if (object.elements) body = renderCells(object, previous, ctx);
  else if (object.fields) body = `<div class="object-fields">${renderVariables(object.fields, previous?.fields, ctx)}</div>`;
  else body = `<p class="object-note">${esc(object.message ?? 'No visible fields.')}</p>`;
  const note = object.message && object.kind !== 'opaque' && object.kind !== 'unavailable' ? `<p class="object-note">${esc(object.message)}</p>` : '';
  const caption = object.length !== undefined ? `<div class="array-caption">${object.kind === 'string' || object.kind === 'array' ? 'length' : 'size'} ${object.length}${object.truncated ? ` · first ${object.elements?.length ?? object.entries?.length ?? 0} shown` : ''}</div>` : object.truncated ? '<div class="array-caption">Preview truncated</div>' : '';
  // Empty arrays (such as main's args) stay collapsed so they do not crowd the objects that matter.
  const empty = object.kind === 'array' && object.length === 0;
  return `<details class="heap-object ${refColor(object.id)} ${isNew ? 'new-object' : ''}" id="heap-${esc(object.id)}" ${object.kind === 'opaque' || empty ? '' : 'open'}><summary><span class="object-type">${esc(simpleType(object.type))}${empty ? ' <span class="empty-tag">empty</span>' : ''}</span>${isNew ? '<span class="new-badge">New</span>' : ''}<span class="object-id">@${esc(object.id)}</span></summary>${refs.length ? `<div class="object-references">Referenced by ${refs.map(esc).join(', ')}</div>` : ''}${body}${note}${caption}</details>`;
}

const storyIcons: Record<StoryItem['kind'], string> = { start: 'play', call: 'corner-down-right', return: 'corner-left-up', change: 'pencil', new: 'plus', output: 'terminal', exception: 'bug', end: 'flag', same: 'equal' };
function renderStory(states: TraceEvent[]): string {
  if (!run || !states[step]) return '';
  // The exception card already states the exception, so the narration skips that item.
  const items = describeStep(run, states, step).filter(item => item.kind !== 'exception' && item.kind !== 'end');
  if (!items.length) return '';
  const previous = states.slice(0, step).reverse().find(s => s.location);
  const where = previous?.location ? `before ${previous.location.file}:${previous.location.line}` : 'program start';
  // Kept short so the stack and heap stay in view; the rest is one click away.
  const shown = items.slice(0, 3), more = items.slice(3);
  const li = (item: StoryItem) => `<li class="story-${item.kind}">${icon(storyIcons[item.kind])}<span>${esc(item.text)}</span></li>`;
  return `<section class="step-story" aria-label="Changes since the previous step"><div class="story-label" title="Changes between the stop ${esc(where)} and this one">Changes</div><div class="story-body"><ul>${shown.map(li).join('')}</ul>${more.length ? `<details class="story-more"><summary>${more.length} more</summary><ul>${more.map(li).join('')}</ul></details>` : ''}</div></section>`;
}

function renderFrame(frame: Frame, index: number, previous: TraceEvent | undefined, event: TraceEvent | undefined, ctx: RenderContext) {
  const returns = index === 0 ? (event?.returns ?? []) : [];
  const states = currentStates();
  const at = event ? states.indexOf(event) : -1;
  const returnNotes = returns.map(r => `<div class="return-note">${icon('corner-left-up')}<span>${esc(returnedCall(states, at, r.frameId, r.method, ctx.previousHeap))} ${r.void ? 'finished' : 'returned'}</span>${r.value ? renderValue(r.value, undefined, ctx) : ''}</div>`).join('');
  const prior = previous?.frames?.find(f => f.id === frame.id);
  const isNew = !!previous && !prior;
  return `<details class="frame ${index === 0 ? 'current' : ''} ${isNew ? 'new-frame' : ''}" open><summary><span class="frame-name">${index === 0 ? '<span class="frame-active-dot"></span>' : ''}${esc(displayMethod(frame.method))}<span class="method-parens">()</span></span><span class="frame-location">${esc(frame.file)}:${frame.line}</span></summary><div class="frame-variables">${returnNotes}${renderVariables(frame.locals, prior?.locals, ctx, false, frame.id) || '<div class="no-vars">No local variables in scope</div>'}${frame.truncated ? '<div class="array-caption">Locals truncated</div>' : ''}</div></details>`;
}

let arrowFrame = 0;
function scheduleArrows() {
  cancelAnimationFrame(arrowFrame);
  arrowFrame = requestAnimationFrame(() => { const root = document.getElementById('memory-columns'); if (root) drawArrows(root, ui.arrows); });
}

const STOP_LABELS: Record<string, [string, string]> = {
  completed: ['Finished', 'ok'], exception: ['Exception', 'error'], 'compile-error': ['Compile error', 'error'], 'runtime-error': ['Exited with error', 'error'],
  'step-limit': ['Step limit reached', 'warning'], timeout: ['Time limit reached', 'warning'], cancelled: ['Stopped', 'warning'],
  'unsupported-concurrency': ['Multiple threads', 'warning'], 'trace-limit': ['Trace too large', 'warning'], 'worker-error': ['Runner error', 'error'],
};

function renderEmptyDebugger(reason: string | undefined) {
  if (running) return `<div class="empty-state"><span class="empty-icon spin">${icon('loader-circle')}</span><h3>Recording your program…</h3><p>TraceLab compiles your code with javac, runs it on a real JVM, and records every line it executes.</p></div>`;
  if (reason === 'compile-error') return `<div class="empty-state"><span class="empty-icon error">${icon('circle-x')}</span><h3>The program didn’t compile</h3><p>The Tutor explains each error in plain language and suggests fixes that TraceLab has checked with javac. You can also press Ctrl+. on a red underline.</p><div class="empty-actions"><button class="btn btn-primary" data-action="show-tutor">${icon('wrench')}Show fixes</button><button class="btn btn-secondary" data-console-open="diagnostics">Show problems</button></div></div>`;
  return `<div class="empty-state"><span class="empty-icon">${icon('bug')}</span><h3>Run your program to start debugging</h3><p>TraceLab records the execution, so you can step forward and back through every line and inspect the call stack and heap at each step.</p><button class="btn btn-primary" data-run>${icon('play')}Run <kbd>Ctrl ↵</kbd></button><div class="empty-hints"><span><kbd class="key">F10</kbd> Step over</span><span><kbd class="key">F11</kbd> Step into</span><span><kbd class="key">⇧F11</kbd> Step out</span></div></div>`;
}

function renderTrace(followLine = false) {
  const states = currentStates();
  step = Math.max(0, Math.min(step, states.length - 1));
  const event = states[step];
  const snapshot = currentSnapshot();
  const previous = states.slice(0, states.indexOf(snapshot!) >= 0 ? states.indexOf(snapshot!) : step).reverse().find(s => s.frames);
  const reason = run?.events.findLast(e => e.kind === 'terminated')?.stopReason;
  const [label, tone] = running ? ['Recording', 'info'] : !run ? ['Idle', ''] : STOP_LABELS[reason ?? ''] ?? ['Recorded', ''];
  const status = $('#run-status');
  status.textContent = label; status.className = `status-chip ${tone}`;
  $('#trace-summary').innerHTML = event?.location
    ? `<span class="where ${event.exception ? 'error' : ''}">${event.exception ? 'Exception at' : 'Before'} <strong>${esc(event.location.file)}:${event.location.line}</strong> in ${esc(displayMethod(event.frames?.[0]?.method ?? ''))}</span>`
    : `<span class="where">${esc(run && event?.message ? event.message : '')}</span>`;
  const canvas = $('#memory-canvas');
  const scroll = canvas.scrollTop;
  if (!snapshot) {
    canvas.innerHTML = renderEmptyDebugger(reason);
  } else {
    // Index markers use the recorded source, so they pause while the code differs from the recording.
    const cursors = run && (!dirtyTrace() || traceSource) ? cursorsFor(run, states, step) : [];
    const ctx: RenderContext = { heap: heapIndex(snapshot), previousHeap: heapIndex(previous), cursors: cursorsByObject(cursors), targets: variableTargets(cursors, snapshot.frames?.[0]), topFrame: snapshot.frames?.[0]?.id };
    const heapCards = snapshot.heap?.map(o => renderHeap(o, previous?.heap?.find(p => p.id === o.id), !!previous && !ctx.previousHeap.has(o.id), ctx, snapshot)).join('') ?? '';
    const message = event?.exception ? exceptionMessage(run!, event) : '';
    canvas.innerHTML = `${event?.exception ? `<div class="exception-card">${icon('bug')}<div><strong>${esc(event.exception.type.split('.').at(-1))}</strong>${message ? `<p>${esc(message)}</p>` : ''}</div></div>` : ''}
      ${renderStory(states)}
      <div class="memory-columns" id="memory-columns"><svg class="arrow-layer" aria-hidden="true"></svg>
        <div class="stack-column"><div class="section-label">Call stack <span>${snapshot.frames?.length ?? 0} frame${snapshot.frames?.length === 1 ? '' : 's'}</span></div>
          <div class="frames">${snapshot.frames?.map((frame, i) => renderFrame(frame, i, previous, event, ctx)).join('')}
          ${snapshot.statics?.length ? `<details class="frame statics"><summary><span class="frame-name">Static fields</span></summary><div class="frame-variables">${renderVariables(snapshot.statics, previous?.statics, ctx, true)}</div></details>` : ''}</div></div>
        <div class="heap-column"><div class="section-label">Heap <span>${ui.inline ? 'strings and boxed values shown inline' : 'all objects'}</span></div>
          <div class="heap">${heapCards || '<div class="no-vars">No reachable objects at this step.</div>'}</div></div>
      </div>
      ${snapshot.heapTruncated || snapshot.framesTruncated ? '<div class="trace-notice">Capture limits reached at this step. Some frames or objects are not shown.</div>' : ''}
      <div class="memory-legend"><span><i class="swatch changed"></i>Changed</span><span><i class="swatch new"></i>New</span><span>${icon('arrow-up-right')}Reference</span></div>`;
    canvas.scrollTop = scroll;
  }
  const scrubber = $<HTMLInputElement>('#scrubber');
  scrubber.max = String(Math.max(0, states.length - 1)); scrubber.value = String(step); scrubber.disabled = states.length === 0;
  scrubber.style.setProperty('--progress', states.length > 1 ? `${(step / (states.length - 1)) * 100}%` : '0%');
  $('#step-label').innerHTML = states.length ? `Step <strong>${step + 1}</strong> of ${states.length}` : 'No recording';
  $('#status-step').textContent = states.length ? `Step ${step + 1}/${states.length}` : '';
  ['first', 'back', 'next', 'last', 'play', 'next-bookmark', 'step-over', 'step-out', 'back-over'].forEach(id => { $<HTMLButtonElement>(`#${id}`).disabled = states.length < 2; });
  for (const id of ['back', 'first', 'back-over']) $<HTMLButtonElement>(`#${id}`).disabled ||= step === 0;
  for (const id of ['next', 'last', 'step-over', 'step-out']) $<HTMLButtonElement>(`#${id}`).disabled ||= step >= states.length - 1;
  $<HTMLButtonElement>('#history').disabled = !previousRun || running || checking;
  if (followLine && event?.location) {
    if (!dirtyTrace() || traceSource) {
      if (activeFile !== event.location.file) selectFile(event.location.file, traceSource);
      editor.revealLineInCenterIfOutsideViewport(event.location.line);
    }
  }
  updateDecorations(); renderConsole(); icons(); scheduleArrows();
}

function renderConsole() {
  document.querySelectorAll<HTMLButtonElement>('.console-tabs [data-console]').forEach(b => { b.classList.toggle('active', b.dataset.console === consoleTab); b.setAttribute('aria-selected', String(b.dataset.console === consoleTab)); });
  const diagnostics = run?.events.filter(e => e.kind === 'diagnostic') ?? [];
  $('#problem-count').textContent = String(diagnostics.length);
  $('#problem-count').classList.toggle('error', diagnostics.some(d => d.severity === 'error'));
  $('#console-context').textContent = run && consoleTab === 'output' ? (currentEvent()?.kind === 'terminated' ? 'Final output' : 'Output received by this step') : '';
  const el = $('#console-content');
  if (consoleTab === 'input' && document.activeElement?.id === 'stdin') return;
  if (consoleTab === 'input') {
    el.innerHTML = `<label class="input-label" for="stdin">Standard input<span>Sent to the program on the next run, then closed.</span></label><textarea id="stdin" spellcheck="false">${esc(project.stdin)}</textarea>`;
    $('#stdin').addEventListener('input', e => { project.stdin = (e.target as HTMLTextAreaElement).value; save(); });
  } else if (consoleTab === 'diagnostics') {
    // Each error shows the Tutor's plain-language title and its first suggested fix.
    const help = new Map(compileHelp().map(i => [`${i.file}:${i.line}:${errorKey(i.message)}`, i]));
    const shown = new Set<CompileIssue>();
    el.innerHTML = diagnostics.length ? diagnostics.map(d => {
      const issue = d.severity === 'error' ? help.get(`${d.file}:${d.line}:${errorKey(d.message)}`) : undefined;
      const first = issue && !shown.has(issue);
      if (issue) shown.add(issue);
      const extra = issue && first ? `<div class="diagnostic-help"><span>${icon('lightbulb')}${esc(issue.title)}</span>${issue.fixes[0] && !fixesFolded() ? renderFix(issue.fixes[0], true) : ''}</div>` : '';
      return `<div class="diagnostic-item"><button class="diagnostic ${d.severity}" data-diagnostic="${esc(d.file)}" data-line="${d.line ?? 1}">${icon(d.severity === 'error' ? 'circle-x' : 'info')}<span><strong>${esc(d.message)}</strong><small>${esc(d.file)} · line ${d.line}, column ${d.column}</small></span></button>${extra}</div>`;
    }).join('') : '<div class="console-empty">No problems in the last run.</div>';
  } else if (consoleTab === 'checks') {
    el.innerHTML = project.checks.length ? `<table class="test-table"><thead><tr><th>Test</th><th>Type</th><th>Input or call</th><th>Expected</th></tr></thead><tbody>${project.checks.map(c => { const d = describeTest(c); return `<tr><td>${esc(c.name)}</td><td>${esc(d.kind)}</td><td><code>${esc(d.given)}</code></td><td><code>${esc(d.expects)}</code></td></tr>`; }).join('')}</tbody></table>` : `<div class="console-empty">This project has no tests yet. Write one with Add test in the Tutor panel, or <button class="link-btn" data-action="generate-tests">generate tests from your methods</button>.</div>`;
  } else {
    const sequence = currentEvent()?.sequence ?? Infinity;
    const stdout = run ? output(run, 'stdout', sequence) : '';
    const stderr = run ? output(run, 'stderr', sequence) : '';
    el.innerHTML = !run ? '<div class="console-empty">Program output appears here when you run.</div>' : `${stdout ? `<pre class="stdout">${esc(stdout)}</pre>` : '<div class="console-empty">No output yet at this step.</div>'}${stderr ? `<pre class="stderr">${esc(stderr)}</pre>` : ''}${run.events.at(-1)?.outputTruncated ? '<p class="trace-notice">Output was capped at 32,768 characters.</p>' : ''}`;
  }
  icons();
}

// ---------- Tutor ----------

function renderStages() {
  const q = questions[questionIndex];
  const explained = questions.some(x => x.kind === 'explain' && solvedQuestions.has(x.id));
  const stages = [
    { label: 'Observe', active: !q || q.kind === 'predict', done: !!run && !running },
    { label: 'Explain', active: q?.kind === 'explain', done: explained },
    { label: 'Fix', active: q?.kind === 'repair' || checking, done: allChecksPassed() },
  ];
  $('#learning-stages').innerHTML = stages.map((s, i) => `<li class="${s.active ? 'active' : ''} ${s.done ? 'done' : ''}"><span class="stage-mark">${s.done ? icon('check') : i + 1}</span>${s.label}</li>`).join('');
  renderCoachCount(); icons();
}

function renderProgress() {
  const entries = Object.entries(progress).filter(([concept]) => CONCEPTS[concept]);
  $('#progress-card').innerHTML = entries.length ? `<div class="card-title">${icon('trophy')}<h3>Concepts practiced</h3><button id="reset-progress" class="link-btn" title="Clear practice history in this browser">Reset</button></div><div class="concept-chips">${entries.map(([concept, p]) => `<span class="concept-chip" title="${p.answered} answered · ${p.firstTry} correct on the first try">${esc(CONCEPTS[concept])}<b>${p.firstTry}/${p.answered}</b></span>`).join('')}</div>` : '';
  icons();
}

function renderCoach() {
  const el = $('#coach-content');
  const q = questions[questionIndex];
  const demo = demoFor(project.example);
  const mismatch = !dirtyTrace() ? failingCheck(run, project.checks) : null;
  const mismatchCard = mismatch ? `<div class="callout warning">${icon('target')}<div><strong>Output doesn’t match “${esc(mismatch.check.name)}”</strong><p>This run used that test’s input. Expected <code>${esc(JSON.stringify(normalizeOutput(mismatch.check.expectedOutput)))}</code>, got <code>${esc(JSON.stringify(mismatch.actual))}</code>. Step back from the output to find where the values diverge.</p></div></div>` : '';
  if (!q) {
    const brief = demo && demo.category !== 'tour' && !run
      ? `<div class="brief"><span class="chip ${({ runtime: 'danger', output: 'warning', hang: 'violet', compile: 'info', tour: 'accent' } as const)[demo.category]}">${esc(categoryLabel(demo.category))}</span><h3>${esc(project.name)}</h3><p>${esc(demo.summary)}</p><dl><dt>Symptom</dt><dd>${esc(demo.symptom)}</dd><dt>Look at</dt><dd><code>${esc(demo.snippet)}</code></dd></dl><p class="muted">Run the program. The Tutor will ask about what actually happened, then help you choose a fix.</p><button class="btn btn-primary btn-block" data-run>${icon('play')}Run program</button></div>`
      : `<div class="empty-coach">${icon('lightbulb')}<h3>${run ? (running ? 'Recording…' : 'No questions for this run') : 'Questions appear after you run'}</h3><p>${run ? 'TraceLab asks only about things it can confirm from the recorded run, such as exceptions, values that changed, references and return values. Step through the trace and compare it with your tests.' : 'Run your program and the Tutor will ask about what it actually did: predict a value, explain an error, then choose a fix and test it.'}</p>${!run ? `<button class="btn btn-secondary" data-action="gallery">${icon('layout-grid')}Try an example</button>` : ''}</div>`;
    const help = compileHelpCard();
    el.innerHTML = `${mismatchCard}${help || brief}`;
    renderStages(); icons();
    return;
  }
  const answer = questionAnswers[q.id];
  const correct = answer === q.correct;
  const label = { predict: 'Predict', explain: 'Explain', repair: 'Fix' }[q.kind];
  const editCta = correct && q.kind === 'repair' && q.focus ? `<button id="edit-focus" class="btn btn-secondary btn-block">${icon('wrench')}Edit ${esc(q.focus.file)}, line ${q.focus.line}</button>` : '';
  const inspect = q.step >= 0 || q.focus ? `<button id="go-question" class="link-btn">${icon('microscope')}${q.step >= 0 ? 'Show this moment' : 'Show the line'}${q.focus ? ` · line ${q.focus.line}` : ''}</button>` : '';
  el.innerHTML = `${mismatchCard}<article class="question-card ${q.kind}"><header class="question-top"><span class="question-type">${label}</span><span class="question-count">${questionIndex + 1} of ${questions.length}</span></header><h3>${esc(q.title)}</h3><p class="question-context">${rich(q.context)}</p>${inspect}<h4>${rich(q.prompt)}</h4><div class="answer-options" role="group" aria-label="Answers">${q.options.map((option, index) => `<button class="answer-option ${answer === index ? (correct ? 'correct' : 'incorrect') : ''}" data-answer="${index}" aria-pressed="${answer === index}"><span class="option-key">${String.fromCharCode(65 + index)}</span><span>${rich(option)}</span>${answer === index ? icon(correct ? 'circle-check' : 'circle-x') : ''}</button>`).join('')}</div>${answer !== undefined ? `<div class="answer-feedback ${correct ? 'correct' : ''}" role="status"><strong>${correct ? 'Correct — that matches the recorded run.' : 'Not quite.'}</strong><p>${correct ? rich(q.explanation) : 'Compare your answer with the recorded values. Try again, or reveal a hint.'}</p>${editCta}</div>` : ''}<footer class="question-footer"><button id="hint" class="link-btn" ${hintsShown >= q.hints.length ? 'disabled' : ''}>${icon('lightbulb')}${hintsShown < q.hints.length ? `Hint (${hintsShown + 1} of ${q.hints.length})` : 'No more hints'}</button>${questions.length > 1 ? `<button id="next-question" class="link-btn">${questionIndex === questions.length - 1 ? 'First question' : 'Next question'}${icon('arrow-right')}</button>` : ''}</footer>${q.hints.slice(0, hintsShown).map(h => `<div class="hint">${rich(h)}</div>`).join('')}</article>${compileHelpCard()}`;
  renderStages(); icons();
}

function answerQuestion(index: number) {
  const q = questions[questionIndex];
  if (!q) return;
  questionAnswers[q.id] = index;
  questionAttempts[q.id] = (questionAttempts[q.id] ?? 0) + 1;
  if (index === q.correct && !solvedQuestions.has(q.id)) {
    solvedQuestions.add(q.id);
    progress = recordSolved(progress, q.concept, questionAttempts[q.id] === 1);
    renderProgress();
  }
  renderCoach();
  if (consoleTab === 'diagnostics') renderConsole();
}

function renderCheckResults() {
  const stale = checkResults.length && !checksFresh();
  $('#check-results').innerHTML = `${stale ? '<div class="callout subtle">The code or tests changed since these results. Run the tests again.</div>' : ''}${checkResults.map(r => `<div class="check-result ${r.status}">${icon(r.status === 'passed' ? 'circle-check' : r.status === 'failed' ? 'circle-x' : 'loader-circle', r.status === 'running' ? 'spin' : '')}<div><span>${esc(r.name)}</span>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}${r.status === 'failed' && !stale && !running && !checking ? `<button class="link-btn trace-case" data-trace-check="${r.index}">${icon('microscope')}Debug this test</button>` : ''}</div></div>`).join('')}${allChecksPassed() ? `<div class="callout success">${icon('circle-check')}<span>All ${checkResults.length} tests pass.</span></div>` : ''}`;
  renderStages(); icons();
}

// ---------- Compile-error help ----------

/** Explanations and suggested fixes for the current run's javac errors (computed once per run). */
function compileHelp(): CompileIssue[] {
  if (!run || running) return [];
  if (helpCache.run !== run) helpCache = { run, issues: run.events.some(e => e.kind === 'diagnostic' && e.severity === 'error') ? compileIssues(run.request.files, run.events) : [] };
  return helpCache.issues;
}
function findFix(id: string): { issue: CompileIssue; fix: CompileFix } | null {
  for (const issue of compileHelp()) { const fix = issue.fixes.find(f => f.id === id); if (fix) return { issue, fix }; }
  return null;
}
const errorKey = (message: string | undefined) => (message ?? '').split('\n').slice(0, 2).join(' ').replace(/\s+/g, ' ');
/** Whether a diagnostic from compiling a fix is the original error, allowing for lines the fix inserted above it. */
function sameError(issue: CompileIssue, fix: CompileFix, event: TraceEvent): boolean {
  const file = fix.action.kind === 'move' && fix.action.from === issue.file ? fix.action.to : issue.file;
  if (event.file !== file || errorKey(event.message) !== errorKey(issue.message)) return false;
  let line = issue.line;
  if (fix.action.kind === 'edit') for (const e of fix.action.edits) if (e.file === issue.file && (e.line < issue.line || (e.line === issue.line && e.remove === 0))) line += e.insert.length - e.remove;
  return Math.abs((event.line ?? 0) - line) <= 1;
}
function fixStatusHtml(id: string): { tone: string; html: string } {
  const check = fixChecks.get(id);
  if (!check) return { tone: '', html: '' };
  if (check.status === 'checking') return { tone: '', html: `${icon('loader-circle', 'spin')}Checking with javac…` };
  if (check.status === 'compiles') return { tone: 'ok', html: `${icon('circle-check')}Compiles` };
  if (check.status === 'fixed') return { tone: 'ok', html: `${icon('circle-check')}Clears this error · ${check.remaining} other${check.remaining === 1 ? '' : 's'} left` };
  if (check.status === 'unchanged') return { tone: 'warning', html: `${icon('triangle-alert')}Doesn’t clear this error` };
  return { tone: '', html: 'Not checked' };
}
function renderFix(fix: CompileFix, compact = false): string {
  const status = fixStatusHtml(fix.id);
  const diff = fix.action.kind === 'move'
    ? `<code class="del">${esc(fix.before)}</code><code class="ins">${esc(fix.after)}</code>`
    : `${fix.before ? `<code class="del">${esc(fix.before)}</code>` : ''}${fix.after ? `<code class="ins">${esc(fix.after)}</code>` : '<code class="ins">(line removed)</code>'}`;
  return `<div class="fix">${compact ? '' : `<div class="fix-diff" aria-label="Change">${diff}</div>`}<div class="fix-row"><button class="btn btn-secondary btn-compact" data-apply-fix="${esc(fix.id)}" ${dirtyTrace() || running || checking ? 'disabled' : ''} title="Apply this change and run again">${icon('wrench')}${esc(fix.label)}</button><span class="fix-status ${status.tone}" data-fix-status="${esc(fix.id)}">${status.html}</span></div>${fix.caution && !compact ? `<p class="fix-caution">${esc(fix.caution)}</p>` : ''}</div>`;
}
function renderIssue(issue: CompileIssue, hideFixes: boolean): string {
  const fixes = issue.fixes.map(f => renderFix(f)).join('');
  const fixBlock = !issue.fixes.length ? '<p class="fix-none">No automatic fix for this one; the explanation describes what to change.</p>'
    : hideFixes ? `<details class="fix-reveal"><summary>Show ${issue.fixes.length === 1 ? 'the suggested fix' : `${issue.fixes.length} suggested fixes`}</summary>${fixes}</details>` : fixes;
  return `<article class="compile-issue"><header>${icon('circle-x')}<div><h4>${esc(issue.title)}</h4><button class="link-btn" data-diagnostic="${esc(issue.file)}" data-line="${issue.line}">${esc(issue.file)} · line ${issue.line}</button>${issue.count > 1 ? `<small> · reported ${issue.count} times</small>` : ''}</div></header><p>${esc(issue.explanation)}</p><details class="javac-message"><summary>What javac said</summary><pre>${esc(issue.message)}</pre></details>${fixBlock}</article>`;
}
/** In an example the fix is the exercise, so suggested fixes stay folded until the Tutor's questions are answered. */
const fixesFolded = () => doc.kind === 'example' && questions.some(q => !solvedQuestions.has(q.id));
/** Tutor card for compile errors. */
function compileHelpCard(): string {
  const issues = compileHelp();
  if (!issues.length) return '';
  const hideFixes = fixesFolded();
  const shown = issues.slice(0, 3);
  const note = dirtyTrace() ? '<div class="callout subtle">The code changed since this compile. Run again to refresh these suggestions.</div>'
    : `<p class="muted">TraceLab compiles each suggested fix before marking it as working. Applying a fix edits your code and runs it again; Ctrl+Z undoes it.${issues.length > 1 ? ' Start with the first error: later ones are often caused by it.' : ''}</p>`;
  return `<section class="compile-help"><div class="card-title">${icon('wrench')}<h3>${issues.length === 1 ? 'Compile error' : 'Compile errors'}</h3><span class="tab-count error">${issues.length}</span></div>${note}${shown.map(i => renderIssue(i, hideFixes)).join('')}${issues.length > shown.length ? `<button class="link-btn" data-console-open="diagnostics">${icon('arrow-right')}${issues.length - shown.length} more under Problems</button>` : ''}</section>`;
}
function updateFixStatuses() {
  document.querySelectorAll<HTMLElement>('[data-fix-status]').forEach(el => {
    const status = fixStatusHtml(el.dataset.fixStatus!);
    el.className = `fix-status ${status.tone}`; el.innerHTML = status.html;
  });
  icons();
}

/** Compiles a request without recording it. */
const compileOnly = (request: RunRequest) => quietRun({ ...request, mode: 'compile' });
/** A background job (compile check or plain run) that doesn't change the current run. `stoppable` lets Stop cancel it. */
async function quietRun(request: RunRequest, stoppable = false): Promise<TraceEvent[]> {
  const created = await api<{ id: string }>('/runs', { method: 'POST', body: JSON.stringify(request) });
  if (stoppable) { currentRunId = created.id; if (checkCancelled) await api(`/runs/${created.id}`, { method: 'DELETE' }).catch(() => {}); }
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 120));
      const page = await api<Run & { total: number }>(`/runs/${created.id}`);
      if (page.status === 'finished') return page.events;
    }
    await api(`/runs/${created.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('The runner did not finish in time.');
  } finally { if (stoppable) currentRunId = null; }
}

/** Compiles each suggested fix for the first errors in the background, one at a time (the runner has one job slot). */
async function verifyFixes(forRun: Run) {
  fixChecks = new Map(); fixCancel = false;
  const queue = compileHelp().slice(0, 3).flatMap(issue => issue.fixes.map(fix => ({ issue, fix })));
  for (const { fix } of queue) fixChecks.set(fix.id, { status: 'checking' });
  updateFixStatuses();
  for (const { issue, fix } of queue) {
    if (fixCancel || run !== forRun) break;
    try {
      const events = await compileOnly({ ...forRun.request, files: applyEdits(forRun.request.files, fix.action) });
      const errors = events.filter(e => e.kind === 'diagnostic' && e.severity === 'error');
      // Count errors the way the Tutor lists them: one per message and line.
      const remaining = new Set(errors.map(e => `${e.file}:${e.line}:${errorKey(e.message)}`)).size;
      fixChecks.set(fix.id, events.at(-1)?.stopReason === 'compiled' ? { status: 'compiles' }
        : errors.some(e => sameError(issue, fix, e)) ? { status: 'unchanged' }
        : remaining ? { status: 'fixed', remaining } : { status: 'unknown' });
    } catch { fixChecks.set(fix.id, { status: 'unknown' }); }
    updateFixStatuses();
  }
  for (const [id, check] of fixChecks) if (check.status === 'checking') fixChecks.set(id, { status: 'unknown' });
  updateFixStatuses();
}
function startFixChecks() {
  if (!run || !compileHelp().some(i => i.fixes.length)) return;
  const task = verifyFixes(run).finally(() => { if (fixTask === task) fixTask = null; });
  fixTask = task;
}
/** Stops background fix checks and waits for jobs in flight (including test generation), so the runner's slot is free. */
async function settleFixChecks() {
  if (fixTask) { fixCancel = true; await fixTask.catch(() => {}); }
  if (genTask) await genTask.catch(() => {});
}

/** A Monaco edit that replaces whole lines, matching applyEdits in compilehelp.ts. */
function lineOperation(model: monaco.editor.ITextModel, e: LineEdit): { range: monaco.Range; text: string } {
  const count = model.getLineCount();
  const text = e.insert.join('\n').replace(/\r/g, '');
  if (e.remove === 0) {
    if (e.line > count) return { range: new monaco.Range(count, model.getLineMaxColumn(count), count, model.getLineMaxColumn(count)), text: `\n${text}` };
    return { range: new monaco.Range(e.line, 1, e.line, 1), text: `${text}\n` };
  }
  const last = Math.min(count, e.line + e.remove - 1);
  if (e.insert.length) return { range: new monaco.Range(e.line, 1, last, model.getLineMaxColumn(last)), text };
  // Delete whole lines with their line break.
  if (last < count) return { range: new monaco.Range(e.line, 1, last + 1, 1), text: '' };
  return { range: new monaco.Range(Math.max(1, e.line - 1), e.line > 1 ? model.getLineMaxColumn(e.line - 1) : 1, last, model.getLineMaxColumn(last)), text: '' };
}

/** Applies a suggested fix to the editor (undoable), then runs again so the Tutor sees the new result. */
async function applyFix(id: string) {
  const found = findFix(id);
  if (!found || running || checking) return;
  if (dirtyTrace()) { toast('The code changed since this compile. Run again to refresh the suggested fixes.', 'error'); return; }
  const { fix } = found;
  if (fix.action.kind === 'move') {
    if (!moveFile(fix.action.from, fix.action.to)) return;
  } else {
    const byFile = new Map<string, LineEdit[]>();
    for (const e of fix.action.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
    for (const [file, edits] of byFile) {
      if (!project.files.some(f => f.name === file)) continue;
      const model = getModel(file, false);
      model.pushStackElement();
      model.pushEditOperations([], edits.map(e => lineOperation(model, e)), () => null);
      model.pushStackElement();
    }
    const first = fix.action.edits[0];
    selectFile(first.file, false);
    const line = Math.min(first.line, editor.getModel()!.getLineCount());
    editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 });
  }
  toast(`Applied “${fix.label}”. Running again…`, 'success');
  await startRun();
}

monaco.languages.registerCodeActionProvider('java', {
  provideCodeActions(model, range, context) {
    const name = [...models.entries()].find(([, m]) => m === model)?.[0];
    if (!name?.startsWith('workspace/') || dirtyTrace()) return { actions: [], dispose() {} };
    const file = name.slice('workspace/'.length);
    const actions = compileHelp().filter(i => i.file === file && i.line >= range.startLineNumber && i.line <= range.endLineNumber).flatMap(issue => issue.fixes
      .filter(fix => fix.action.kind === 'edit' && fix.action.edits.every(e => e.file === file))
      .map(fix => {
        const check = fixChecks.get(fix.id);
        const edits = fix.action.kind === 'edit' ? fix.action.edits : [];
        return { title: `${fix.label}${check?.status === 'compiles' ? ' (compiles)' : ''}`, kind: 'quickfix', isPreferred: check?.status === 'compiles',
          diagnostics: context.markers.filter(m => m.startLineNumber === issue.line),
          edit: { edits: edits.map(e => ({ resource: model.uri, textEdit: lineOperation(model, e), versionId: model.getVersionId() })) } };
      }));
    return { actions, dispose() {} };
  },
});

// ---------- Runner API ----------

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-TraceLab-Client': 'browser-v1', ...options.headers }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    let message = `The runner returned ${response.status}.`;
    try { message = (await response.json()).error ?? message; } catch { /* Non-JSON error. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
function requestFor(stdin = project.stdin): RunRequest { return { files: structuredClone(project.files), mainClass: project.mainClass, stdin, maxSteps: project.maxSteps, timeoutMs: 8000 }; }
function setBusy() {
  for (const id of ['#run', '#verify', '#verify-top']) $<HTMLButtonElement>(id).disabled = running || checking || (id !== '#run' && project.checks.length === 0);
  $('#stop').hidden = !running && !checking;
  $('#status-text').textContent = checking ? 'Running tests…' : running ? 'Recording…' : '';
}
/** Polls a run incrementally; each event is transferred once. */
async function collect(request: RunRequest, onUpdate?: (value: Run) => void): Promise<Run> {
  const created = await api<{ id: string }>('/runs', { method: 'POST', body: JSON.stringify(request) });
  currentRunId = created.id;
  if (stopRequested || (checking && checkCancelled)) await api(`/runs/${created.id}`, { method: 'DELETE' });
  const events: TraceEvent[] = [];
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const page = await api<Run & { total: number }>(`/runs/${created.id}?since=${events.length}`);
    events.push(...page.events);
    const value: Run = { id: page.id, status: page.status, request: page.request, events };
    onUpdate?.(value);
    if (page.status === 'finished' && events.length >= page.total) { currentRunId = null; return value; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await api(`/runs/${created.id}`, { method: 'DELETE' }).catch(() => {});
  throw new Error('The runner did not finish in time, so the run was stopped.');
}

function resetQuestions() { questions = []; questionIndex = 0; questionAnswers = {}; questionAttempts = {}; solvedQuestions = new Set(); hintsShown = 0; }

/** Checks the main class before a run, switching automatically when exactly one class has main. */
function ensureMainClass(): boolean {
  const mains = mainClasses(project.files);
  if (mains.includes(project.mainClass) || !mains.length) return true;
  if (mains.length === 1 || mains.some(m => m.split('.').at(-1) === 'Main')) {
    const chosen = preferredMain(project.files)!;
    toast(`${project.mainClass} has no main method, so TraceLab is running ${chosen}.`);
    project.mainClass = chosen; save(); renderFiles();
    return true;
  }
  toast(`${project.mainClass} has no main method. Choose which class to run.`, 'error');
  settingsDialog();
  return false;
}

async function startRun(override?: RunRequest) {
  if (running || checking) return;
  if (!runnerOnline) { toast('The Java runner isn’t connected. Start it with npm start, then try again.', 'error'); checkHealth(); return; }
  const problem = limitProblem(project.files);
  if (problem) { toast(problem, 'error'); return; }
  if (!override && !ensureMainClass()) return;
  // Background fix checks hold the runner's only job slot for about half a second each.
  await settleFixChecks();
  if (running || checking) return;
  stopPlayback(); traceSource = false; selectFile(activeFile, false);
  if (run) previousRun = run;
  run = null; step = 0; resetQuestions();
  running = true; stopRequested = false; setBusy(); renderTrace(); renderCoach();
  try {
    let lastRender = 0;
    run = await collect(override ?? requestFor(), value => {
      run = value;
      if (Date.now() - lastRender < 150) return;
      lastRender = Date.now(); step = Math.max(0, snapshots(value).length - 1); renderTrace();
    });
    const states = currentStates();
    const failure = states.findIndex(e => e.exception && !e.exception.caught);
    step = failure >= 0 ? failure : Math.max(0, states.length - 1);
    questions = questionsFor(run); questionIndex = 0;
    consoleTab = run.events.some(e => e.kind === 'diagnostic' && e.severity === 'error') ? 'diagnostics' : 'output';
    if (questions.length && !layout.coach && window.innerWidth >= 1100) setLayout({ coach: true });
    applyDiagnostics();
  } catch (error) { toast(error instanceof Error ? error.message : 'The run failed.', 'error'); }
  finally {
    running = false; currentRunId = null; setBusy(); renderTrace(true); renderCoach(); renderSourceBanner(); renderCheckResults(); renderSaveRunTest();
    if (!stopRequested) startFixChecks();
  }
}

/** Offers to save a finished run's output as a test, unless a test already covers that input. */
function renderSaveRunTest() {
  const offer = !!run && run.status === 'finished' && run.events.at(-1)?.stopReason === 'completed' && !dirtyTrace()
    && !run.request.files.some(f => f.name.endsWith('TraceLabCall__.java'))
    && !project.checks.some(c => !isCallTest(c) && normalizeOutput(c.stdin) === normalizeOutput(run!.request.stdin));
  $('#save-run-test').hidden = !offer;
}

function applyDiagnostics() {
  for (const file of project.files) {
    const diagnostics = run?.events.filter(e => e.kind === 'diagnostic' && e.file === file.name) ?? [];
    monaco.editor.setModelMarkers(getModel(file.name, false), 'java-compiler', !dirtyTrace() ? diagnostics.map(d => ({ severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: d.message ?? '', startLineNumber: Math.max(1, d.line ?? 1), endLineNumber: Math.max(1, d.line ?? 1), startColumn: Math.max(1, d.column ?? 1), endColumn: Math.max(2, (d.column ?? 1) + 1) })) : []);
  }
}

async function verify() {
  if (running || checking || !project.checks.length) return;
  if (!runnerOnline) { toast('The Java runner isn’t connected. Start it with npm start, then try again.', 'error'); checkHealth(); return; }
  const problem = limitProblem(project.files);
  if (problem) { toast(problem, 'error'); return; }
  if (project.checks.some(c => !isCallTest(c)) && !ensureMainClass()) return;
  await settleFixChecks();
  if (running || checking) return;
  if (!layout.coach) setLayout({ coach: true });
  stopPlayback(); checking = true; checkCancelled = false; stopRequested = false; setBusy();
  checksSource = sourceKey(); checkResults = [];
  // Tests run on a plain JVM (no recording), which is about twice as fast; "Debug this test" records one.
  const request: RunRequest = { ...requestFor(), mode: 'run', timeoutMs: 4000 }; const checks = structuredClone(project.checks);
  // Method tests with the same package and input run together in one JVM; output tests run one at a time.
  const batched = new Map<number, TestOutcome>();
  const batchKey = (test: TestCase) => `${packageOf(test.target ?? '')}\u0000${test.stdin}`;
  async function runCallBatch(key: string) {
    const group = checks.map((test, index) => ({ test, index })).filter(({ test, index }) => isCallTest(test) && !batched.has(index) && batchKey(test) === key && !testProblems(test, project).length);
    const cases = group.map(({ test, index }) => ({ id: index, expression: testExpression(test, request.files) }));
    try {
      const results = await runBatches({ ...request, stdin: group[0].test.stdin }, new Map([[packageOf(group[0].test.target ?? ''), cases]]), { stoppable: true });
      for (const { test, index } of group) batched.set(index, batchOutcome(test, results.get(index)!));
    } catch (error) {
      if (!(error instanceof ProjectCompileError)) throw error;
      for (const { index } of group) batched.set(index, { passed: false, detail: 'The project does not compile. Fix the errors under Problems first.' });
    }
  }
  try {
    for (const [index, test] of checks.entries()) {
      if (checkCancelled) break;
      const result = { name: test.name, index, status: 'running' as 'running' | 'passed' | 'failed', detail: '' };
      checkResults.push(result); renderCheckResults();
      const invalid = testProblems(test, project);
      if (invalid.length) { result.status = 'failed'; result.detail = invalid[0]; renderCheckResults(); continue; }
      if (isCallTest(test) && !batched.has(index)) await runCallBatch(batchKey(test));
      const outcome = batched.get(index) ?? evaluateTest(await collect(requestForTest(project, test, request)), test);
      result.status = outcome.passed ? 'passed' : 'failed';
      result.detail = outcome.detail;
      renderCheckResults();
    }
  } catch (error) {
    const current = checkResults.find(r => r.status === 'running');
    if (current) { current.status = 'failed'; current.detail = error instanceof Error ? error.message : 'Runner unavailable'; }
    toast(error instanceof Error ? error.message : 'The tests could not run.', 'error');
  } finally {
    checking = false; currentRunId = null; setBusy(); renderCheckResults();
    if (allChecksPassed()) toast(`All ${checkResults.length} tests pass. Run the program again to see the fixed trace.`, 'success');
  }
}

function traceCheck(index: number) {
  const check = project.checks[index];
  if (!check || running || checking) return;
  if (isCallTest(check)) {
    toast(`Recording the call ${check.call} from the “${check.name}” test.`);
    startRun(requestForTest(project, check, requestFor(check.stdin)));
    return;
  }
  project.stdin = check.stdin; save();
  toast(`Input set to the “${check.name}” test.`);
  startRun();
}

async function stopRun() {
  checkCancelled = true;
  stopRequested = true;
  if (currentRunId) {
    try { await api(`/runs/${currentRunId}`, { method: 'DELETE' }); $('#status-text').textContent = 'Stopping…'; }
    catch (error) { toast(String(error), 'error'); }
  }
}

// ---------- Navigation ----------

function goTo(next: number) { step = Math.max(0, Math.min(next, currentStates().length - 1)); renderTrace(true); }
function togglePlayback() {
  if (playTimer) { stopPlayback(); return; }
  if (step >= currentStates().length - 1) step = 0;
  $('#play').innerHTML = icon('pause'); $('#play').setAttribute('aria-label', 'Pause'); icons();
  renderTrace(true);
  playTimer = setInterval(() => { if (step >= currentStates().length - 1) stopPlayback(); else goTo(step + 1); }, speed);
}
function navigate(kind: 'over' | 'out' | 'back-over' | 'into' | 'back') {
  stopPlayback();
  const states = currentStates();
  if (states.length < 2) return;
  goTo(kind === 'over' ? stepOver(states, step) : kind === 'out' ? stepOut(states, step) : kind === 'back-over' ? stepBackOver(states, step) : kind === 'into' ? step + 1 : step - 1);
}

// ---------- Dialogs, menus, files, sharing ----------

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openDialog(title: string, body: string, onSave: () => void, button = 'Save', options: { cancel?: string | null; danger?: boolean; wide?: boolean } = {}) {
  // Replace the body element so listeners added by the previous dialog are discarded.
  const fresh = $('#dialog-body').cloneNode(false) as HTMLElement;
  $('#dialog-body').replaceWith(fresh);
  $('#dialog').classList.toggle('wide', !!options.wide);
  $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body; $('#dialog-error').textContent = '';
  $('#dialog-submit').textContent = button;
  $<HTMLButtonElement>('#dialog-submit').disabled = false;
  $('#dialog-submit').className = `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`;
  $('#dialog-cancel').hidden = options.cancel === null;
  $('#dialog-cancel').textContent = options.cancel ?? 'Cancel';
  // Enter in a single-line field submits; the form never navigates.
  $<HTMLFormElement>('#dialog-form').onsubmit = event => {
    event.preventDefault();
    try { onSave(); $<HTMLDialogElement>('#dialog').close(); }
    catch (e) { $('#dialog-error').textContent = e instanceof Error ? e.message : String(e); }
  };
  const dialog = $<HTMLDialogElement>('#dialog');
  if (!dialog.open) dialog.showModal();
  icons();
  $<HTMLElement>('#dialog-body input:not([type="radio"]):not([type="checkbox"]), #dialog-body textarea')?.focus();
}
/** Promise-based confirmation in the app's own dialog. */
function confirmDialog(title: string, message: string, button: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    let accepted = false;
    const dialog = $<HTMLDialogElement>('#dialog');
    dialog.addEventListener('close', () => resolve(accepted), { once: true });
    openDialog(title, `<p class="dialog-note">${esc(message)}</p>`, () => { accepted = true; }, button, { danger });
    $('#dialog-submit').focus();
  });
}
/** Shows a document in the IDE. The previous document was saved as it was edited. */
function showDoc(ref: DocRef, next: Project) {
  if (saveTimer) save();
  stopPlayback(); doc = ref; project = next; run = null; previousRun = null; step = 0; resetQuestions(); checkResults = []; traceSource = false; breakpoints.clear();
  for (const model of models.values()) model.dispose(); models.clear();
  try { library.setCurrent(ref); } catch { /* The open document is still usable. */ }
  activeFile = initialFile(project);
  save(); selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); renderSaveRunTest(); setBusy();
}
function openDoc(ref: DocRef): boolean {
  if (running || checking) { toast('Stop the current run before switching projects.'); return false; }
  if (ref.kind === doc.kind && ref.id === doc.id) return true;
  const loaded = loadDoc(ref);
  if (!loaded) { toast('That project could not be opened. It may have been deleted in another tab.', 'error'); renderProjectList(); return false; }
  showDoc(ref, loaded);
  return true;
}
/** Adds a project to the library and opens it. */
function createAndOpen(next: Project, origin?: string): boolean {
  if (running || checking) { toast('Stop the current run before opening another project.'); return false; }
  try {
    const named = { ...next, name: library.uniqueName(next.name.trim() || 'Untitled project') };
    const id = library.create(named, origin);
    showDoc({ kind: 'project', id }, named);
    return true;
  } catch (error) { toast(error instanceof Error ? error.message : 'The project could not be created.', 'error'); return false; }
}
function saveExampleCopy() {
  if (doc.kind !== 'example') return;
  const exampleId = doc.id;
  const copy = { ...structuredClone(project), name: project.name };
  if (createAndOpen(copy, exampleId)) {
    library.resetExample(exampleId);
    renderProjectList(); icons();
    toast(`Saved “${project.name}” to your projects. The example is back to its original version.`, 'success');
  }
}
/** Opens the file that contains the demo's key line, so the bug is in view. */
function initialFile(value: Project): string {
  const snippet = demoFor(value.example)?.snippet.split('…')[0].trim();
  return (snippet && value.files.find(f => f.content.includes(snippet))?.name) || value.files.find(f => f.name.endsWith('Main.java'))?.name || value.files[0].name;
}
function openDemo(id: string) {
  const index = exampleIndex(id);
  if (index < 0) { toast('That example does not exist.', 'error'); return; }
  const already = doc.kind === 'example' && doc.id === id;
  if (!openDoc({ kind: 'example', id })) return;
  closeGallery();
  if (!already) toast(library.hasExampleEdits(id) ? `Opened “${examples[index].name}” with your earlier changes.` : `Opened “${examples[index].name}”. Press Run to start.`);
}
async function resetExample(id: string) {
  const name = examples[exampleIndex(id)]?.name ?? 'this example';
  if (!(await confirmDialog(`Reset “${name}”?`, 'Your changes to this example are discarded and the original code and tests come back. Save it as your own project first to keep them.', 'Reset example', true))) return;
  library.resetExample(id);
  if (doc.kind === 'example' && doc.id === id) showDoc(doc, copyExample(exampleIndex(id)));
  else renderProjectList();
  toast(`“${name}” is back to the original.`);
}

async function projectAction(action: string, id: string) {
  const summary = library.summary(id);
  if (!summary) return;
  if (action === 'rename') renameProject({ kind: 'project', id });
  else if (action === 'duplicate') {
    try { const copy = library.duplicate(id); if (copy) { renderProjectList(); toast(`Duplicated “${summary.name}”.`, 'success'); } }
    catch (error) { toast(error instanceof Error ? error.message : 'Could not duplicate the project.', 'error'); }
  } else if (action === 'export') { const value = library.load({ kind: 'project', id }); if (value) await exportZip(value); }
  else if (action === 'delete') {
    if (running || checking) { toast('Stop the current run first.'); return; }
    if (!(await confirmDialog(`Delete “${summary.name}”?`, 'The project and its tests are removed from this browser. This cannot be undone unless you exported it.', 'Delete project', true))) return;
    const wasOpen = doc.kind === 'project' && doc.id === id;
    library.remove(id);
    if (wasOpen) {
      const next = library.list()[0];
      if (next) openDoc({ kind: 'project', id: next.id }); else showDoc({ kind: 'example', id: DEFAULT_EXAMPLE }, loadDoc({ kind: 'example', id: DEFAULT_EXAMPLE })!);
    }
    renderProjectList();
    toast(`Deleted “${summary.name}”.`);
  }
}

function renameProject(ref: DocRef = doc) {
  const current = ref.kind === doc.kind && ref.id === doc.id ? project : library.load(ref);
  if (!current) return;
  openDialog('Rename project', `<label class="dialog-label">Project name<input id="project-name" value="${esc(current.name)}" maxlength="120" autocomplete="off" /></label>`, () => {
    const name = $<HTMLInputElement>('#project-name').value.trim();
    if (!name) throw new Error('Enter a name.');
    if (ref.kind === doc.kind && ref.id === doc.id) { project.name = name; save(); renderFiles(); }
    else library.rename(ref, name);
    renderProjectList();
  }, 'Rename');
  setTimeout(() => $<HTMLInputElement>('#project-name').select());
}

async function exportZip(value: Project) {
  try {
    const bytes = await projectToZip(value);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = `${value.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project'}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast(error instanceof Error ? error.message : 'The zip could not be created.', 'error'); }
}

/** Imports files as a new project, or adds them to the open one. */
async function handleImport(files: { file: File; path: string }[], mode: 'new' | 'add') {
  if (!files.length) return;
  try {
    const { project: imported, notes } = await importFiles(files, 'Imported project');
    if (mode === 'add') { addFilesToProject(imported.files, notes); return; }
    if (createAndOpen(imported)) toast(`Imported “${imported.name}”: ${imported.files.length} file${imported.files.length === 1 ? '' : 's'}${imported.mainClass && mainClasses(imported.files).includes(imported.mainClass) ? `, main class ${imported.mainClass}` : ''}.${notes.length ? ` ${notes.join(' ')}` : ''}`, 'success');
  } catch (error) { toast(error instanceof Error ? error.message : 'Those files could not be imported.', 'error'); }
}

function addFilesToProject(files: Project['files'], allNotes: string[] = []) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  const replaced = files.filter(f => project.files.some(p => p.name.toLowerCase() === f.name.toLowerCase())).map(f => f.name);
  const merged = [...project.files.filter(p => !files.some(f => f.name.toLowerCase() === p.name.toLowerCase())), ...files];
  // The importer judged the new files alone; the merged project may already have a main class.
  const notes = mainClasses(merged).length ? allNotes.filter(n => !n.startsWith('No class has a main method')) : allNotes;
  const problem = limitProblem(merged);
  if (problem) { toast(problem, 'error'); return; }
  project.files = merged;
  for (const name of replaced) { const key = `workspace/${name}`; models.get(key)?.dispose(); models.delete(key); }
  if (!mainClasses(project.files).includes(project.mainClass)) project.mainClass = preferredMain(project.files) ?? project.mainClass;
  save(); selectFile(files[0].name, false);
  toast(`Added ${files.length} file${files.length === 1 ? '' : 's'}${replaced.length ? `, replacing ${replaced.join(', ')}` : ''}.${notes.length ? ` ${notes.join(' ')}` : ''}`, 'success');
}

function renderGallery() {
  $('#gallery-filters').innerHTML = filterBar(galleryFilter);
  $('#gallery-grid').innerHTML = visibleDemos(galleryFilter).map(d => demoCard(d, icon('arrow-right'))).join('');
  icons();
}
function openGallery() { closeMenu(); renderGallery(); $<HTMLDialogElement>('#gallery').showModal(); }
function closeGallery() { const g = $<HTMLDialogElement>('#gallery'); if (g.open) g.close(); }

async function shareProject() {
  try {
    const url = `${location.origin}${location.pathname}${SHARE_PREFIX}${await encodeProject(project)}`;
    if (url.length > 60000) toast('This link is long, and some apps may cut it off. Export works better for large projects.');
    try { await navigator.clipboard.writeText(url); toast('Link copied. Anyone who opens it gets a copy of this project, including its code.', 'success'); }
    catch {
      openDialog('Share link', `<p class="dialog-note">The project is stored inside the link itself, after the #, which browsers don’t send to servers. Opening the link loads a copy.</p><label class="dialog-label">Link<textarea id="share-link" rows="5" readonly spellcheck="false">${esc(url)}</textarea></label>`, () => {}, 'Done', { cancel: null });
      $<HTMLTextAreaElement>('#share-link').select();
    }
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not create a share link.', 'error'); }
}

async function openSharedProject() {
  if (!location.hash.startsWith(SHARE_PREFIX)) return;
  const payload = location.hash.slice(SHARE_PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const value = await decodeProject(payload);
    if (!validateProject(value)) throw new Error('This share link does not contain a valid TraceLab project.');
    if (createAndOpen(value)) toast(`Saved the shared project “${project.name}” to your projects.`, 'success');
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not open this share link.', 'error'); }
}

/** Accepts `Helper`, `Helper.java`, `util.Helper` or `util/Helper.java` and returns a file path. */
function toFilePath(input: string): string {
  const text = input.trim().replace(/\\/g, '/').replace(/\.java$/i, '');
  return `${text.includes('/') ? text : text.replace(/\./g, '/')}.java`;
}

function renameFile(oldName: string) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  const oldClass = oldName.split('/').at(-1)!.replace(/\.java$/, '');
  const declaresOld = analyzeJava(project.files.find(f => f.name === oldName)?.content ?? '').types.some(t => t.name === oldClass);
  openDialog('Rename or move file', `<label class="dialog-label">File<input id="rename-name" value="${esc(oldName)}" maxlength="180" autocomplete="off" /><small>Use folders for packages, for example <code>util/Helper.java</code> or <code>util.Helper</code>.</small></label>${declaresOld ? `<label class="check-label"><input type="checkbox" id="rename-code" checked /> Also update the class name and package declaration in the file</label>` : ''}<p class="dialog-note">Other files that refer to this class by name are not changed.</p>`, () => {
    const name = toFilePath($<HTMLInputElement>('#rename-name').value);
    if (name === oldName) return;
    if (!validFileName(name)) throw new Error('Use a Java path such as Helper.java or util/Helper.java.');
    if (project.files.some(f => f.name !== oldName && f.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
    const file = project.files.find(f => f.name === oldName)!;
    if (declaresOld && $<HTMLInputElement>('#rename-code')?.checked) {
      const newClass = name.split('/').at(-1)!.replace(/\.java$/, '');
      const packageName = name.includes('/') ? name.slice(0, name.lastIndexOf('/')).replace(/\//g, '.') : '';
      const oldPackage = analyzeJava(file.content).packageName;
      const oldQualified = oldPackage ? `${oldPackage}.${oldClass}` : oldClass;
      file.content = setPackage(renameType(file.content, oldClass, newClass), packageName);
      if (project.mainClass === oldQualified) project.mainClass = packageName ? `${packageName}.${newClass}` : newClass;
      for (const check of project.checks) if (check.target === oldQualified) check.target = packageName ? `${packageName}.${newClass}` : newClass;
    }
    const key = `workspace/${oldName}`; models.get(key)?.dispose(); models.delete(key);
    file.name = name;
    const marks = breakpoints.get(oldName); breakpoints.delete(oldName); if (marks) breakpoints.set(name, marks);
    save(); selectFile(name, false);
  }, 'Rename');
  setTimeout(() => { const input = $<HTMLInputElement>('#rename-name'); input.focus(); input.setSelectionRange(input.value.lastIndexOf('/') + 1, input.value.lastIndexOf('.java')); });
}

async function deleteFile(name: string) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  if (project.files.length === 1) { toast('A project needs at least one Java file.'); return; }
  if (!(await confirmDialog(`Delete ${name}?`, 'The file is removed from this project. This cannot be undone unless you exported the project.', 'Delete', true))) return;
  project.files = project.files.filter(f => f.name !== name);
  const key = `workspace/${name}`; models.get(key)?.dispose(); models.delete(key);
  save(); selectFile(project.files[0].name, false);
}

const FILE_KINDS: Record<string, (name: string) => string> = {
  class: name => `public class ${name} {\n\n}\n`,
  main: name => `public class ${name} {\n    public static void main(String[] args) {\n        \n    }\n}\n`,
  interface: name => `public interface ${name} {\n\n}\n`,
  enum: name => `public enum ${name} {\n    \n}\n`,
  record: name => `public record ${name}() {\n}\n`,
};

function newFile(folder = '') {
  if (running || checking) { toast('Wait for the run to finish before changing files.'); return; }
  const prefix = folder ? `${folder.replace(/\//g, '.')}.` : '';
  openDialog('New Java file', `<label class="dialog-label">Name<input id="file-name" value="${esc(prefix)}" placeholder="Helper or util.Helper" maxlength="180" autocomplete="off" /><small>Add a package with dots or slashes, for example <code>util.Helper</code>.</small></label><label class="dialog-label">Kind<select id="file-kind"><option value="class">Class</option><option value="main">Class with main method</option><option value="interface">Interface</option><option value="enum">Enum</option><option value="record">Record</option></select></label>`, () => {
    const name = toFilePath($<HTMLInputElement>('#file-name').value);
    if (!validFileName(name)) throw new Error('Use a Java name such as Helper or util.Helper.');
    if (project.files.some(f => f.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
    if (project.files.length >= 20) throw new Error('A project can have up to 20 files.');
    const parts = name.replace(/\.java$/, '').split('/'); const className = parts.pop()!;
    const kind = $<HTMLSelectElement>('#file-kind').value;
    project.files.push({ name, content: `${parts.length ? `package ${parts.join('.')};\n\n` : ''}${FILE_KINDS[kind](className)}` });
    if (kind === 'main' && !mainClasses(project.files.filter(f => f.name !== name)).includes(project.mainClass)) project.mainClass = [...parts, className].join('.');
    collapsedFolders.delete(parts.join('/'));
    save(); selectFile(name, false);
    const line = kind === 'main' ? 3 : kind === 'record' ? 1 : 2;
    editor.setPosition({ lineNumber: line + (parts.length ? 2 : 0), column: kind === 'main' ? 9 : 5 }); editor.focus();
  }, 'Create');
  setTimeout(() => { const input = $<HTMLInputElement>('#file-name'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
}

function settingsDialog() {
  const mains = mainClasses(project.files);
  const options = [...new Set([...mains, project.mainClass])];
  openDialog('Project settings', `<label class="dialog-label">Project name<input id="setting-name" value="${esc(project.name)}" maxlength="120" /></label><label class="dialog-label">Main class<select id="setting-main">${options.map(m => `<option value="${esc(m)}" ${m === project.mainClass ? 'selected' : ''}>${esc(m)}${mains.includes(m) ? '' : ' (no main method found)'}</option>`).join('')}</select><small>${mains.length ? `Run starts in this class’s <code>main</code> method. ${mains.length} class${mains.length === 1 ? ' has' : 'es have'} one.` : 'No class has a <code>public static void main(String[] args)</code> method yet.'}</small></label><label class="dialog-label">Step limit<input id="setting-steps" type="number" min="10" max="2000" value="${project.maxSteps}" /><small>Recording stops after this many line steps (10–2,000). The steps recorded so far stay available.</small></label><p class="dialog-note">Runs use Java 21 with an 8-second time limit. Each step captures up to 24 frames, 64 objects and 32 elements per array or collection.</p>`, () => {
    const mainClass = $<HTMLSelectElement>('#setting-main').value;
    const maxSteps = Number($<HTMLInputElement>('#setting-steps').value);
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(mainClass)) throw new Error('Choose a main class.');
    if (!Number.isInteger(maxSteps) || maxSteps < 10 || maxSteps > 2000) throw new Error('Choose a step limit from 10 to 2,000.');
    project.mainClass = mainClass; project.maxSteps = maxSteps; project.name = $<HTMLInputElement>('#setting-name').value.trim() || 'Untitled project';
    save(); renderFiles(); renderSourceBanner(); renderCheckResults();
  });
}

// ---------- New project ----------

function newProjectDialog() {
  if (running || checking) { toast('Stop the current run before creating a project.'); return; }
  closeMenu();
  const cards = templates.map((t, i) => `<label class="template-card"><input type="radio" name="template" value="${t.id}" ${i === 0 ? 'checked' : ''} />${icon(t.icon)}<span><strong>${esc(t.name)}</strong><small>${esc(t.description)}</small></span></label>`).join('');
  openDialog('New project', `<label class="dialog-label">Project name<input id="new-project-name" value="${esc(library.uniqueName('My project'))}" maxlength="120" autocomplete="off" /></label>
    <fieldset class="template-grid"><legend>Start from</legend>${cards}<label class="template-card"><input type="radio" name="template" value="paste" />${icon('clipboard-paste')}<span><strong>Paste code</strong><small>Paste one or more Java classes. TraceLab creates the files.</small></span></label></fieldset>
    <div id="paste-area" hidden><label class="dialog-label">Java source<textarea id="paste-code" rows="10" spellcheck="false" placeholder="public class Main {&#10;    public static void main(String[] args) {&#10;        …&#10;    }&#10;}"></textarea></label><p class="paste-preview" id="paste-preview" aria-live="polite"></p></div>
    <div class="import-row">${icon('upload')}<span>Have files already?</span><button type="button" class="link-btn" data-action="import">Import .java files or a zip</button><button type="button" class="link-btn" data-action="import-folder">Import a folder</button><button type="button" class="link-btn" data-action="gallery">Open an example</button></div>`, () => {
    const name = $<HTMLInputElement>('#new-project-name').value.trim() || 'My project';
    const choice = document.querySelector<HTMLInputElement>('input[name="template"]:checked')?.value ?? 'blank';
    if (choice === 'paste') {
      const code = $<HTMLTextAreaElement>('#paste-code').value;
      if (!code.trim()) throw new Error('Paste some Java code first.');
      const { project: created, notes } = projectFromSources(name, [{ path: '', text: code }]);
      if (createAndOpen(created)) toast(`Created “${project.name}” with ${created.files.map(f => f.name).join(', ')}.${notes.length ? ` ${notes.join(' ')}` : ''}`, 'success');
      return;
    }
    const template = templates.find(t => t.id === choice)!;
    if (createAndOpen(template.create(name))) toast(`Created “${project.name}”. Press Run to try it.`, 'success');
  }, 'Create project', { wide: true });
  const preview = () => {
    const code = $<HTMLTextAreaElement>('#paste-code').value;
    const el = $('#paste-preview');
    if (!code.trim()) { el.textContent = ''; return; }
    try {
      const { project: draft, notes } = projectFromSources('preview', [{ path: '', text: code }]);
      const mains = mainClasses(draft.files);
      el.innerHTML = `${icon('check')}<span>Creates ${draft.files.map(f => `<code>${esc(f.name)}</code>`).join(', ')}${mains.length ? ` · runs <code>${esc(draft.mainClass)}</code>` : ' · no main method yet'}${notes.length ? `<br><small>${esc(notes.join(' '))}</small>` : ''}</span>`;
      el.className = 'paste-preview ok';
    } catch (error) { el.innerHTML = `${icon('triangle-alert')}<span>${esc(error instanceof Error ? error.message : String(error))}</span>`; el.className = 'paste-preview warn'; }
    icons();
  };
  $('#dialog-body').addEventListener('change', e => {
    if ((e.target as HTMLInputElement).name !== 'template') return;
    const paste = (e.target as HTMLInputElement).value === 'paste';
    $('#paste-area').hidden = !paste;
    if (paste) $<HTMLTextAreaElement>('#paste-code').focus();
  });
  $('#paste-code').addEventListener('input', preview);
  setTimeout(() => $<HTMLInputElement>('#new-project-name').select());
}

// ---------- Test editor ----------

type DraftTest = TestCase & { kind: 'output' | 'call' };

function testFields(test: DraftTest, index: number, targets: ReturnType<typeof testTargets>): string {
  const call = test.kind === 'call';
  return `<article class="test-editor" data-index="${index}">
    <header><input class="test-name" data-field="name" value="${esc(test.name)}" maxlength="120" aria-label="Test name" placeholder="Test name" />
      <div class="segmented-text" role="radiogroup" aria-label="Test type"><button type="button" role="radio" data-kind="output" aria-checked="${!call}">Program output</button><button type="button" role="radio" data-kind="call" aria-checked="${call}">Method call</button></div>
      <div class="test-tools"><button type="button" class="icon-btn small" data-test-move="-1" title="Move up" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button type="button" class="icon-btn small" data-test-move="1" title="Move down" aria-label="Move down">${icon('arrow-down')}</button><button type="button" class="icon-btn small" data-test-copy title="Duplicate" aria-label="Duplicate test">${icon('copy')}</button><button type="button" class="icon-btn small" data-test-delete title="Delete" aria-label="Delete test">${icon('trash-2')}</button></div></header>
    ${call ? `<div class="test-grid call">
        <label>Class<select data-field="target">${targets.map(t => `<option value="${esc(t.qualified)}" ${t.qualified === test.target ? 'selected' : ''}>${esc(t.qualified)}</option>`).join('') || '<option value="">No classes found</option>'}</select></label>
        <label>Call<input data-field="call" value="${esc(test.call ?? '')}" placeholder="sum(new int[]{1, 2})" spellcheck="false" maxlength="500" /><small>Call a static method by name, or create an object: <code>new Counter().next()</code></small></label>
        <label>Expected value<input data-field="expectedOutput" value="${esc(test.expectedOutput)}" placeholder='3   "text"   [1, 2]   throws ArithmeticException' spellcheck="false" /><small>Quotes around text are optional. Decimals match to about 9 digits.</small></label>
      </div>`
    : `<div class="test-grid">
        <label><span>Input <span class="muted">(standard input)</span></span><textarea data-field="stdin" rows="3" spellcheck="false" placeholder="No input">${esc(test.stdin)}</textarea></label>
        <label>Expected output<textarea data-field="expectedOutput" rows="3" spellcheck="false">${esc(test.expectedOutput)}</textarea><small>Compared exactly, ignoring trailing spaces and line-ending style.</small></label>
      </div>`}
    <p class="test-problem" hidden></p>
  </article>`;
}

function testsDialog(initial?: DraftTest, note?: string) {
  const drafts: DraftTest[] = project.checks.map(c => ({ ...structuredClone(c), kind: c.kind === 'call' ? 'call' : 'output' }));
  if (initial) drafts.push(initial);
  const targets = testTargets(project.files);
  const defaultTarget = () => targets.find(t => t.methods.some(m => m.isStatic && m.name !== 'main'))?.qualified ?? targets[0]?.qualified ?? '';
  const render = () => {
    $('#test-list').innerHTML = drafts.length ? drafts.map((t, i) => testFields(t, i, targets)).join('') : '<p class="dialog-note">No tests yet. Add one to describe what correct behavior looks like.</p>';
    $('#test-count').textContent = `${drafts.length} of 20`;
    icons();
  };
  openDialog('Tests', `${note ? `<div class="callout warning">${icon('triangle-alert')}<div>${note}</div></div>` : ''}<p class="dialog-note">Tests run your current code in a fresh JVM. Use program-output tests for what <code>main</code> prints, and method-call tests to check one method’s return value.</p><div id="test-list" class="test-list"></div><div class="test-add"><button type="button" class="btn btn-secondary" data-add-test="output">${icon('plus')}Output test</button><button type="button" class="btn btn-secondary" data-add-test="call">${icon('braces')}Method test</button><span class="muted" id="test-count"></span></div>`, () => {
    const problems: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>('#test-list .test-editor')) {
      const test = drafts[Number(card.dataset.index)];
      const found = testProblems(test, project);
      const el = card.querySelector<HTMLElement>('.test-problem')!;
      el.hidden = !found.length; el.textContent = found.join(' ');
      card.classList.toggle('invalid', found.length > 0);
      if (found.length) problems.push(`“${test.name || 'Untitled test'}”: ${found[0]}`);
    }
    if (problems.length) throw new Error(problems.length === 1 ? problems[0] : `${problems.length} tests need attention. ${problems[0]}`);
    const checks: TestCase[] = drafts.map(t => t.kind === 'call'
      ? { name: t.name.trim(), kind: 'call', target: t.target, call: t.call!.trim(), stdin: t.stdin ?? '', expectedOutput: t.expectedOutput.trim() }
      : { name: t.name.trim(), stdin: t.stdin, expectedOutput: t.expectedOutput });
    if (!validateProject({ ...project, checks })) throw new Error('One of the tests is too long. Inputs are limited to 16 KiB and outputs to 32 KiB.');
    project.checks = checks; save(); renderFiles(); renderConsole(); renderCheckResults(); renderCoach(); renderSaveRunTest(); setBusy();
    toast(`Saved ${checks.length} test${checks.length === 1 ? '' : 's'}.`, 'success');
  }, 'Save tests', { wide: true });
  render();
  const body = $('#dialog-body');
  body.addEventListener('input', e => {
    const field = (e.target as HTMLElement).dataset.field as keyof DraftTest | undefined;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.test-editor');
    if (!field || !card) return;
    (drafts[Number(card.dataset.index)] as Record<string, unknown>)[field] = (e.target as HTMLInputElement).value;
  });
  body.addEventListener('change', e => {
    const field = (e.target as HTMLElement).dataset.field;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.test-editor');
    if (field && card) (drafts[Number(card.dataset.index)] as Record<string, unknown>)[field] = (e.target as HTMLSelectElement).value;
  });
  body.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    const card = button.closest<HTMLElement>('.test-editor');
    const index = card ? Number(card.dataset.index) : -1;
    if (button.dataset.addTest) {
      if (drafts.length >= 20) { $('#dialog-error').textContent = 'A project can have up to 20 tests.'; return; }
      const call = button.dataset.addTest === 'call';
      drafts.push(call ? { name: `Method test ${drafts.length + 1}`, kind: 'call', target: defaultTarget(), call: '', stdin: '', expectedOutput: '' } : { name: `Test ${drafts.length + 1}`, kind: 'output', stdin: '', expectedOutput: '' });
      render();
      $<HTMLElement>(`#test-list .test-editor:last-child ${call ? '[data-field="call"]' : '[data-field="stdin"]'}`)?.focus();
    } else if (button.dataset.kind && index >= 0) {
      const test = drafts[index];
      test.kind = button.dataset.kind as DraftTest['kind'];
      if (test.kind === 'call' && !test.target) test.target = defaultTarget();
      render();
    } else if (button.dataset.testMove && index >= 0) {
      const to = index + Number(button.dataset.testMove);
      if (to < 0 || to >= drafts.length) return;
      [drafts[index], drafts[to]] = [drafts[to], drafts[index]]; render();
    } else if (button.dataset.testCopy !== undefined && index >= 0) {
      if (drafts.length >= 20) return;
      drafts.splice(index + 1, 0, { ...structuredClone(drafts[index]), name: `${drafts[index].name} (copy)` }); render();
    } else if (button.dataset.testDelete !== undefined && index >= 0) { drafts.splice(index, 1); render(); }
  });
  if (initial) setTimeout(() => $<HTMLElement>('#test-list .test-editor:last-child .test-name')?.focus());
}

/** Opens the test editor with a new test built from the last run's input and output. */
function saveRunAsTest() {
  if (!run) return;
  const actual = normalizeOutput(output(run, 'stdout'));
  testsDialog({ name: `Test ${project.checks.length + 1}`, kind: 'output', stdin: run.request.stdin, expectedOutput: actual },
    '<strong>Check the expected output before saving.</strong><p>This copies what the program printed. If the program has a bug, this test would expect the wrong answer.</p>');
}

// ---------- Test generation ----------

const GEN_TIMEOUT = 3000;
class ProjectCompileError extends Error {}
/**
 * Evaluates method calls on a plain JVM, one batch per package. A call that doesn't compile is dropped and the batch
 * retried; a call that hangs or exits is reported, and the calls after it run in a new batch. `related` marks other
 * calls to skip after a hang (for generation: the same method), so one endless loop costs one time limit.
 */
async function runBatches<T extends BatchCase>(base: RunRequest, byPackage: Map<string, T[]>, options: { related?: (stuck: T, other: T) => boolean; label?: (c: T) => string; onProgress?: (done: number) => void; stoppable?: boolean } = {}): Promise<Map<number, BatchResult>> {
  const results = new Map<number, BatchResult>();
  for (const [pkg, cases] of byPackage) {
    let pending = cases;
    for (let attempt = 0; attempt < 8 && pending.length && !(options.stoppable && checkCancelled); attempt++) {
      const { request, lines } = batchRequest(base, pkg, pending);
      const events = await quietRun(request, options.stoppable);
      const errors = events.filter(e => e.kind === 'diagnostic' && e.severity === 'error');
      if (errors.length) {
        const bad = new Map<number, string>();
        for (const e of errors) { const id = isHarnessFile(e.file ?? '') ? lines.get(e.line ?? 0) : undefined; if (id !== undefined && !bad.has(id)) bad.set(id, e.message ?? ''); }
        if (!bad.size) throw new ProjectCompileError('The project doesn’t compile, so its methods can’t be called. Fix the errors under Problems first.');
        for (const [id, message] of bad) results.set(id, { id, status: 'invalid', value: '', detail: harnessErrorDetail(message) });
        pending = pending.filter(c => !bad.has(c.id));
        continue;
      }
      const found = batchResults(output({ id: '', status: 'finished', request, events }, 'stdout'));
      for (const [id, r] of found) results.set(id, r);
      options.onProgress?.(results.size);
      const missing = pending.filter(c => !found.has(c.id));
      if (!missing.length) break;
      const reason = events.at(-1)?.stopReason;
      if (reason === 'cancelled') { for (const c of missing) results.set(c.id, { id: c.id, status: 'unfinished', value: '', detail: 'Stopped' }); pending = []; break; }
      const stuck = missing[0];
      results.set(stuck.id, { id: stuck.id, status: 'unfinished', value: '', detail: reason === 'timeout' ? `Didn’t finish within ${(base.timeoutMs ?? 0) / 1000} seconds (an endless loop?)` : reason === 'output-limit' ? 'Printed too much output (an endless loop?)' : 'Ended the program, for example with System.exit' });
      const related = (c: T) => !!options.related?.(stuck, c);
      for (const c of missing.slice(1).filter(related)) results.set(c.id, { id: c.id, status: 'unfinished', value: '', detail: `Skipped because ${options.label?.(stuck) ?? 'an earlier call'} didn’t finish` });
      pending = missing.slice(1).filter(c => !related(c));
    }
    for (const c of pending) if (!results.has(c.id)) results.set(c.id, { id: c.id, status: 'unfinished', value: '', detail: 'Wasn’t run' });
  }
  return results;
}
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

type GenRow = { key: string; check: TestCase; label: string; expected: string; status: CaseResult['status'] | 'output'; detail?: string; checked: boolean };

async function generateTestsDialog() {
  if (running || checking || genTask) return;
  if (!runnerOnline) { toast('The Java runner isn’t connected. Start it with npm start, then try again.', 'error'); checkHealth(); return; }
  const problem = limitProblem(project.files);
  if (problem) { toast(problem, 'error'); return; }
  const room = 20 - project.checks.length;
  if (room <= 0) { toast('This project already has 20 tests, the maximum. Remove some first.', 'error'); return; }
  const plan = planTests(project.files);
  const known = new Set(project.checks.filter(isCallTest).map(c => `${c.target}|${c.call}`));
  plan.cases = plan.cases.filter(c => !known.has(`${c.target}|${c.call}`));
  const withOutput = mainClasses(project.files).includes(project.mainClass) && !project.checks.some(c => !isCallTest(c) && normalizeOutput(c.stdin) === normalizeOutput(project.stdin));
  const noHarnessSlot = project.files.length >= 20;
  if (noHarnessSlot) plan.cases = [];
  const files = structuredClone(project.files);
  const forDoc = `${doc.kind}:${doc.id}`;
  let rows: GenRow[] = [];
  const skippedNote = plan.skipped.length ? `<details class="gen-skipped"><summary>${plan.skipped.length} method${plan.skipped.length === 1 ? '' : 's'} skipped</summary><ul>${plan.skipped.map(s => `<li><code>${esc(s.className)}.${esc(s.method)}</code>: ${esc(s.reason)}</li>`).join('')}</ul></details>` : '';
  const total = plan.cases.length + (withOutput ? 1 : 0);
  openDialog('Generate tests', `<div id="gen-body"><p class="gen-progress">${icon('loader-circle', 'spin')}<span id="gen-status">Trying ${plan.cases.length} sample call${plan.cases.length === 1 ? '' : 's'}${withOutput ? ' and your program’s output' : ''} on a plain JVM…</span></p>${skippedNote}</div>`, () => {
    const chosen = rows.filter(r => r.checked);
    if (!chosen.length) throw new Error('Select at least one test to add.');
    if (chosen.length > room) throw new Error(`Only ${room} more test${room === 1 ? '' : 's'} fit (a project can have 20). Clear some checkboxes.`);
    if (`${doc.kind}:${doc.id}` !== forDoc) throw new Error('The open project changed. Generate the tests again.');
    const checks = chosen.map(r => ({ ...r.check, expectedOutput: isCallTest(r.check) ? r.expected.trim() : r.expected }));
    const empty = checks.find(c => isCallTest(c) && !c.expectedOutput);
    if (empty) throw new Error(`Enter an expected value for ${empty.call}.`);
    if (!validateProject({ ...project, checks: [...project.checks, ...checks] })) throw new Error('One of the tests is too long. Outputs are limited to 32 KiB.');
    project.checks = [...project.checks, ...checks]; save(); renderFiles(); renderConsole(); renderCheckResults(); renderCoach(); renderSaveRunTest(); setBusy();
    toast(`Added ${checks.length} test${checks.length === 1 ? '' : 's'}. Run tests to check them against your code.`, 'success');
  }, 'Add selected tests', { wide: true });
  const submit = $<HTMLButtonElement>('#dialog-submit');
  submit.disabled = true;
  if (!total) {
    $('#gen-body').innerHTML = `<p class="dialog-note">${noHarnessSlot ? 'Method tests need one free file slot, and this project already has 20 files.' : 'There’s nothing new to generate. TraceLab generates tests for public static methods that return a value and take numbers, booleans, characters, Strings, arrays or lists, plus one output test for the current input.'}</p>${skippedNote}`;
    icons(); return;
  }
  const task = (async () => {
    await settleFixChecks();
    const base: RunRequest = { ...requestFor(''), files, mode: 'run', timeoutMs: GEN_TIMEOUT };
    const results = plan.cases.length ? await runBatches(base, groupBy(plan.cases, c => packageOf(c.target)), {
      related: (stuck, c) => c.target === stuck.target && c.method === stuck.method, label: c => c.call,
      onProgress: done => { const el = document.getElementById('gen-status'); if (el) el.textContent = `Tried ${done} of ${plan.cases.length} calls…`; },
    }) : new Map<number, CaseResult>();
    let outputRow: GenRow | null = null;
    if (withOutput) {
      const request: RunRequest = { ...requestFor(), files, mode: 'run', timeoutMs: GEN_TIMEOUT };
      const events = await quietRun(request);
      const finished = { id: '', status: 'finished', request, events } as Run;
      if (events.at(-1)?.stopReason === 'completed') {
        const stdout = normalizeOutput(output(finished, 'stdout'));
        if (stdout) outputRow = { key: 'output', check: { name: project.stdin.trim() ? 'Output for the current input' : 'Program output', stdin: project.stdin, expectedOutput: stdout }, label: '', expected: stdout, status: 'output', checked: true };
      }
    }
    return { results, outputRow };
  })();
  genTask = task;
  try {
    const { results, outputRow } = await task;
    rows = plan.cases.map(c => {
      const r = results.get(c.id) ?? { id: c.id, status: 'unfinished' as const, value: '', detail: 'wasn’t run' };
      return { key: String(c.id), check: caseToCheck(c, r.value), label: `${c.className}.${c.call}`, expected: r.value, status: r.status, detail: r.detail, checked: r.status === 'value' };
    });
    if (outputRow) rows.unshift(outputRow);
    // Pre-select returned values (not exceptions) up to the project's test limit.
    let budget = room;
    for (const r of rows) { if (r.checked && budget > 0) budget--; else r.checked = false; }
  } catch (error) {
    if (!$<HTMLDialogElement>('#dialog').open) return;
    $('#gen-body').innerHTML = `<div class="callout warning">${icon('triangle-alert')}<div><strong>Couldn’t generate tests</strong><p>${esc(error instanceof Error ? error.message : String(error))}</p></div></div>${skippedNote}`;
    icons(); return;
  } finally { genTask = null; }
  if (!$<HTMLDialogElement>('#dialog').open || !document.getElementById('gen-body')) return;
  const row = (r: GenRow, i: number) => {
    const usable = r.status === 'value' || r.status === 'throws' || r.status === 'output';
    const note = r.status === 'throws' ? `<small class="gen-note warn">Threw an exception. Keep it only if that’s the intended behavior.</small>` : !usable ? `<small class="gen-note">${esc(r.detail ?? '')}</small>` : '';
    const field = r.status === 'output'
      ? `<textarea data-gen-expected="${i}" rows="3" spellcheck="false" aria-label="Expected output">${esc(r.expected)}</textarea>`
      : usable ? `<input data-gen-expected="${i}" value="${esc(r.expected)}" spellcheck="false" aria-label="Expected value for ${esc(r.label)}" />` : '';
    return `<tr class="${usable ? '' : 'unusable'}"><td><input type="checkbox" data-gen="${i}" ${r.checked ? 'checked' : ''} ${usable ? '' : 'disabled'} aria-label="Add ${esc(r.label || r.check.name)}" /></td><td>${r.status === 'output' ? `<strong>${esc(r.check.name)}</strong><small>${r.check.stdin ? `Input: <code>${esc(JSON.stringify(r.check.stdin))}</code>` : 'No input'}</small>` : `<code>${esc(r.label)}</code>`}</td><td>${field}${note}</td></tr>`;
  };
  $('#gen-body').innerHTML = `<div class="callout warning">${icon('triangle-alert')}<div><strong>Check every expected value before adding</strong><p>Each value is what your code returns <em>right now</em>. If the code has a bug, the test will expect the wrong answer. Change any value that isn’t what the method should return.</p></div></div>
    ${rows.length ? `<table class="gen-table"><thead><tr><th><span class="sr-only">Add</span></th><th>Call</th><th>Expected value</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>` : '<p class="dialog-note">None of the sample calls produced a result.</p>'}
    <p class="dialog-note" id="gen-count"></p>${skippedNote}`;
  const count = () => { const n = rows.filter(r => r.checked).length; $('#gen-count').textContent = `${n} selected · ${room} more test${room === 1 ? '' : 's'} fit in this project`; submit.disabled = n === 0; };
  const body = $('#gen-body');
  body.addEventListener('change', e => { const el = e.target as HTMLInputElement; if (el.dataset.gen !== undefined) { rows[Number(el.dataset.gen)].checked = el.checked; count(); } });
  body.addEventListener('input', e => { const el = e.target as HTMLInputElement; if (el.dataset.genExpected !== undefined) rows[Number(el.dataset.genExpected)].expected = el.value; });
  count(); icons();
}

function shortcutsDialog() {
  const rows: [string, string][] = [['Ctrl + Enter', 'Run and record'], ['F10', 'Step over'], ['F11 or Alt + →', 'Step into'], ['Shift + F11', 'Step out'], ['Shift + F10', 'Step back over'], ['Alt + ←', 'Step back'], ['Ctrl + S', 'Save to this browser'], ['Ctrl + Space', 'Code completion'], ['Ctrl + F', 'Find in file'], ['F1', 'Editor command palette']];
  openDialog('Keyboard shortcuts', `<table class="shortcut-table">${rows.map(([keys, action]) => `<tr><td>${keys.split(' or ').map(k => k.split(' + ').map(p => `<kbd class="key">${esc(p)}</kbd>`).join(' + ')).join(' or ')}</td><td>${esc(action)}</td></tr>`).join('')}</table>`, () => {}, 'Done', { cancel: null });
}

function aboutDialog() {
  openDialog('About TraceLab', `<div class="about">${LOGO_SVG}<div><strong>TraceLab ${VERSION}</strong><p class="muted">Java IDE with a recording debugger and a built-in tutor.</p></div></div>
    <dl class="about-list"><dt>Runner</dt><dd>${runnerOnline ? 'Connected' : 'Not connected'} · local service on 127.0.0.1:4317</dd><dt>Java</dt><dd>Compiled with javac --release 21, traced with the Java Debug Interface</dd><dt>Your code</dt><dd>Projects are saved in this browser. Share links keep the project in the link itself.</dd></dl>
    <div class="callout warning">${icon('shield-check')}<div><strong>Runs code on this computer</strong><p>This release runs programs through a local runner under your own account, with your normal file and network access. Only run code you trust.</p></div></div>`, () => {}, 'Close', { cancel: null });
}

const menu = () => $('#main-menu');
function closeMenu() { if (!menu().hidden) { menu().hidden = true; $('#menu-button').setAttribute('aria-expanded', 'false'); } }
function toggleMenu() {
  const open = menu().hidden;
  menu().hidden = !open; $('#menu-button').setAttribute('aria-expanded', String(open));
  if (open) menu().querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

let importMode: 'new' | 'add' = 'new';
function closeProjectMenu() { if (!$('#project-menu').hidden) { $('#project-menu').hidden = true; $('#project-switch').setAttribute('aria-expanded', 'false'); } }
function toggleProjectMenu() {
  const open = $('#project-menu').hidden;
  closeMenu();
  if (open) renderProjectMenu();
  $('#project-menu').hidden = !open; $('#project-switch').setAttribute('aria-expanded', String(open));
  if (open) $('#project-menu').querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

async function runAction(action: string) {
  closeMenu(); closeProjectMenu();
  // Actions that open a chooser or another dialog replace an open dialog.
  if (['import', 'import-folder', 'add-files', 'gallery', 'new-project', 'settings', 'shortcuts', 'about', 'rename-project'].includes(action)) { const d = $<HTMLDialogElement>('#dialog'); if (d.open) d.close(); }
  if (action === 'new-project') newProjectDialog();
  else if (action === 'projects') setLayout({ sidebar: true, view: 'projects' });
  else if (action === 'rename-project') renameProject();
  else if (action === 'save-copy') saveExampleCopy();
  else if (action === 'gallery') openGallery();
  else if (action === 'import') { importMode = 'new'; $<HTMLInputElement>('#import-input').click(); }
  else if (action === 'import-folder') { importMode = 'new'; $<HTMLInputElement>('#import-folder').click(); }
  else if (action === 'add-files') { importMode = 'add'; $<HTMLInputElement>('#import-input').click(); }
  else if (action === 'export-zip') await exportZip(project);
  else if (action === 'export') download(`${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'project'}.tracelab.json`, project);
  else if (action === 'export-trace') { if (run) download(`trace-${run.id}.json`, run); else toast('Run the program first to record a trace.'); }
  else if (action === 'settings') settingsDialog();
  else if (action === 'shortcuts') shortcutsDialog();
  else if (action === 'about') aboutDialog();
  else if (action === 'generate-tests') generateTestsDialog();
  else if (action === 'new-file') newFile();
  else if (action === 'show-tutor') { setLayout({ coach: true }); document.querySelector('.compile-help')?.scrollIntoView({ block: 'nearest' }); }
}

// ---------- Wiring ----------

$('#run').onclick = () => startRun();
$('#stop').onclick = () => stopRun();
$('#verify').onclick = () => verify();
$('#verify-top').onclick = () => verify();
$('#share').onclick = () => shareProject();
$('#theme').onclick = () => { const order: ThemeChoice[] = ['system', 'light', 'dark']; setTheme(order[(order.indexOf(themeChoice()) + 1) % 3]); renderTheme(); };
$('#project-switch').onclick = e => { e.stopPropagation(); toggleProjectMenu(); };
$('#save-copy').onclick = () => saveExampleCopy();
$('#menu-button').onclick = e => { e.stopPropagation(); closeProjectMenu(); toggleMenu(); };
$('#new-file').onclick = () => newFile();
$('#edit-checks').onclick = () => testsDialog();
$('#add-test').onclick = () => testsDialog({ name: `Test ${project.checks.length + 1}`, kind: 'output', stdin: '', expectedOutput: '' });
$('#save-run-test').onclick = () => saveRunAsTest();
$('#generate-tests').onclick = () => generateTestsDialog();
$('#gallery-close').onclick = () => closeGallery();
$('#gallery').addEventListener('click', e => { if (e.target === e.currentTarget) closeGallery(); });
$('#gallery-filters').addEventListener('click', e => { const b = (e.target as Element).closest<HTMLElement>('[data-filter]'); if (b) { galleryFilter = b.dataset.filter as DemoCategory | 'all'; renderGallery(); } });
for (const id of ['#import-input', '#import-folder']) $<HTMLInputElement>(id).onchange = async e => {
  const input = e.target as HTMLInputElement;
  const files = [...input.files ?? []].map(file => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
  input.value = '';
  await handleImport(files, importMode);
};

// Drag and drop: onto the Explorer adds files to this project; anywhere else imports a new project.
let dragDepth = 0;
const dropMode = (e: DragEvent): 'new' | 'add' => (e.target as Element).closest?.('#explorer') && layout.sidebar && layout.view === 'explorer' ? 'add' : 'new';
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const mode = dropMode(e);
  $('#drop-overlay').classList.toggle('add', mode === 'add');
  $('#explorer').classList.toggle('drop-target', mode === 'add');
  $('#drop-title').textContent = mode === 'add' ? `Add to “${project.name}”` : 'Import as a new project';
});
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; $('#explorer').classList.remove('drop-target'); } });
document.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true; $('#explorer').classList.remove('drop-target');
  const mode = dropMode(e);
  try { await handleImport(await droppedFiles(e.dataTransfer!), mode); }
  catch (error) { toast(error instanceof Error ? error.message : 'Those files could not be read.', 'error'); }
});
$('#first').onclick = () => { stopPlayback(); goTo(0); };
$('#back').onclick = () => navigate('back');
$('#next').onclick = () => navigate('into');
$('#last').onclick = () => { stopPlayback(); goTo(currentStates().length - 1); };
$('#step-over').onclick = () => navigate('over');
$('#step-out').onclick = () => navigate('out');
$('#back-over').onclick = () => navigate('back-over');
$('#play').onclick = togglePlayback;
$('#scrubber').oninput = e => { stopPlayback(); goTo(Number((e.target as HTMLInputElement).value)); };
$('#speed').onchange = e => { speed = Number((e.target as HTMLSelectElement).value); if (playTimer) { stopPlayback(); togglePlayback(); } };
$('#watch-filter').oninput = e => { watchFilter = (e.target as HTMLInputElement).value.trim().toLowerCase(); renderTrace(); };
$('#toggle-arrows').onclick = () => { ui.arrows = !ui.arrows; saveUi(); $('#toggle-arrows').setAttribute('aria-pressed', String(ui.arrows)); scheduleArrows(); };
$('#toggle-inline').onclick = () => { ui.inline = !ui.inline; saveUi(); $('#toggle-inline').setAttribute('aria-pressed', String(ui.inline)); renderTrace(); };
$('#toggle-sidebar').onclick = () => setLayout({ sidebar: !layout.sidebar });
$('#toggle-coach').onclick = () => setLayout({ coach: !layout.coach });
$('#collapse-coach').onclick = () => setLayout({ coach: false });
$('#toggle-console').onclick = () => setLayout({ console: !layout.console });
$('#collapse-console').onclick = () => setLayout({ console: !layout.console });
$('#next-bookmark').onclick = () => {
  const states = currentStates();
  let found = -1;
  for (let offset = 1; offset <= states.length; offset++) {
    const index = (step + offset) % states.length; const location = states[index].location;
    if (location && breakpoints.get(location.file)?.has(location.line)) { found = index; break; }
  }
  if (found >= 0) { stopPlayback(); goTo(found); } else toast('Click in the editor gutter to bookmark a line, then use Bookmark to jump to its recorded steps.');
};
$('#history').onclick = () => {
  if (!previousRun) return;
  stopPlayback(); [run, previousRun] = [previousRun, run]; traceSource = dirtyTrace(); step = 0; resetQuestions(); questions = questionsFor(run!);
  selectFile(run!.request.files[0].name, traceSource); renderTrace(true); renderCoach();
  toast('Switched to the other recorded run.');
};

const canvas = $('#memory-canvas');
canvas.addEventListener('toggle', () => scheduleArrows(), true);
canvas.addEventListener('mouseover', e => { const root = document.getElementById('memory-columns'); if (root) focusArrows(root, e.target as Element); });
canvas.addEventListener('mouseleave', () => { const root = document.getElementById('memory-columns'); if (root) focusArrows(root, null); });
canvas.addEventListener('focusin', e => { const root = document.getElementById('memory-columns'); if (root) focusArrows(root, e.target as Element); });
new ResizeObserver(() => scheduleArrows()).observe(canvas);
document.fonts?.ready.then(() => scheduleArrows());

document.addEventListener('click', e => {
  if (!(e.target as Element).closest('.menu-wrap')) { closeMenu(); closeProjectMenu(); }
  const target = (e.target as Element).closest<HTMLElement>('button, a[data-action]');
  if (!target) return;
  if (target.dataset.closeDialog !== undefined) { $<HTMLDialogElement>('#dialog').close(); return; }
  if (target.dataset.action) { e.preventDefault(); runAction(target.dataset.action); }
  if (target.dataset.openDoc) {
    const [kind, ...rest] = target.dataset.openDoc.split(':');
    closeProjectMenu();
    if (kind === 'example') openDemo(rest.join(':')); else openDoc({ kind: 'project', id: rest.join(':') });
  }
  if (target.dataset.projectAction && target.dataset.id) projectAction(target.dataset.projectAction, target.dataset.id);
  if (target.dataset.resetExample) resetExample(target.dataset.resetExample);
  if (target.dataset.folder) { const f = target.dataset.folder; if (collapsedFolders.has(f)) collapsedFolders.delete(f); else collapsedFolders.add(f); $('#file-list').innerHTML = renderTree(); icons(); }
  if (target.dataset.newIn) newFile(target.dataset.newIn);
  if (target.dataset.setMain) { project.mainClass = target.dataset.setMain; save(); renderFiles(); toast(`Run now starts in ${project.mainClass}.`); }
  if (target.dataset.moveFile && target.dataset.moveTo && moveFile(target.dataset.moveFile, target.dataset.moveTo)) toast(`Moved to ${target.dataset.moveTo}.`, 'success');
  if (target.dataset.view) showView(target.dataset.view as SidebarView);
  if (target.dataset.openDemo) openDemo(target.dataset.openDemo);
  if (target.dataset.run !== undefined) startRun();
  if (target.dataset.consoleOpen) { consoleTab = target.dataset.consoleOpen; setLayout({ console: true }); renderConsole(); }
  if (target.dataset.file) selectFile(target.dataset.file, false);
  if (target.dataset.tab) selectFile(target.dataset.tab);
  if (target.dataset.rename) renameFile(target.dataset.rename);
  if (target.dataset.delete) deleteFile(target.dataset.delete);
  if (target.dataset.console) { consoleTab = target.dataset.console; if (!layout.console) setLayout({ console: true }); renderConsole(); }
  if (target.dataset.ref) {
    const object = document.getElementById(`heap-${target.dataset.ref}`) as HTMLDetailsElement | null;
    if (object) { object.open = true; object.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); object.classList.remove('reference-flash'); void object.offsetWidth; object.classList.add('reference-flash'); }
    else toast('That object is hidden by the filter or was not captured at this step.');
  }
  if (target.dataset.traceCheck !== undefined) traceCheck(Number(target.dataset.traceCheck));
  if (target.dataset.applyFix) applyFix(target.dataset.applyFix);
  if (target.dataset.diagnostic) { selectFile(target.dataset.diagnostic, dirtyTrace()); editor.revealLineInCenter(Number(target.dataset.line)); editor.setPosition({ lineNumber: Number(target.dataset.line), column: 1 }); editor.focus(); }
  if (target.id === 'view-recorded') { selectFile(activeFile, true); renderTrace(true); }
  if (target.id === 'return-editor') selectFile(activeFile, false);
  if (target.dataset.answer !== undefined) answerQuestion(Number(target.dataset.answer));
  if (target.id === 'hint') { hintsShown++; renderCoach(); }
  if (target.id === 'go-question') {
    const q = questions[questionIndex];
    stopPlayback(); traceSource = dirtyTrace(); selectFile(activeFile, traceSource);
    if (q.step >= 0) goTo(q.step);
    if (q.focus && (!dirtyTrace() || traceSource)) { selectFile(q.focus.file, traceSource); editor.revealLineInCenterIfOutsideViewport(q.focus.line); }
  }
  if (target.id === 'edit-focus') {
    const focus = questions[questionIndex]?.focus;
    if (focus && project.files.some(f => f.name === focus.file)) { selectFile(focus.file, false); editor.setPosition({ lineNumber: focus.line, column: 1 }); editor.revealLineInCenter(focus.line); editor.focus(); }
  }
  if (target.id === 'next-question') { questionIndex = (questionIndex + 1) % questions.length; hintsShown = 0; renderCoach(); updateDecorations(); }
  if (target.id === 'reset-progress') confirmDialog('Reset practice history?', 'This clears the concepts you have practiced in this browser.', 'Reset', true).then(ok => { if (ok) { progress = resetProgress(); renderProgress(); } });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMenu(); closeProjectMenu(); }
  const openMenu = !menu().hidden ? menu() : !$('#project-menu').hidden ? $('#project-menu') : null;
  if (openMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = [...openMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    return;
  }
  if ((e.target as HTMLElement).closest?.('dialog')) return;
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigate('into'); }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigate('back'); }
  if (e.key === 'F10') { e.preventDefault(); navigate(e.shiftKey ? 'back-over' : 'over'); }
  if (e.key === 'F11') { e.preventDefault(); navigate(e.shiftKey ? 'out' : 'into'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); toast('Saved in this browser.', 'success'); }
});

async function checkHealth() {
  try {
    const health = await api<{ ok: boolean; workerReady: boolean }>('/health');
    runnerOnline = health.workerReady;
    $('#runner-label').textContent = health.workerReady ? 'Local runner' : 'Runner not built';
  } catch {
    runnerOnline = false;
    $('#runner-label').textContent = 'Runner offline';
  }
  $('#runner-status').classList.toggle('offline', !runnerOnline);
  $('#runner-status').title = runnerOnline ? 'Connected to the local Java runner. Click for details.' : 'The Java runner is not reachable. Start it with npm start.';
}

/** Handles `?demo=<id>` (open an example) and `?new` (start a new project) from links. */
function openRequestedDoc() {
  const params = new URLSearchParams(location.search);
  const id = params.get('demo');
  const wantsNew = params.has('new');
  if (!id && !wantsNew) return;
  params.delete('demo'); params.delete('new');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (id) openDemo(id);
  else newProjectDialog();
}

renderTheme();
selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); renderProgress(); setBusy(); save(); icons();
checkHealth().then(() => { if (!runnerOnline) toast('The Java runner isn’t running. Start it with npm start to run programs.', 'error'); });
setInterval(() => { if (!runnerOnline) checkHealth(); }, 5000);
openRequestedDoc();
openSharedProject();
window.addEventListener('hashchange', () => openSharedProject());
// Another tab changed the library: refresh lists, and reload the open project if it was edited elsewhere.
window.addEventListener('storage', e => {
  if (!e.key?.startsWith('tracelab.')) return;
  renderProjectList();
  if (doc.kind === 'project' && !library.summary(doc.id)) toast('This project was deleted in another tab. Keep editing to save a new copy, or export it.', 'error');
});
