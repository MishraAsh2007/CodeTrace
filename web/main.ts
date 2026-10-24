import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// editor.api alone has no editor features; edcore.main adds them (suggestions, hovers, quick fixes, find, F1 commands).
import 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { createIcons, Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2, Folder, FolderOpen, FolderKanban, Package, Copy, FileArchive, ClipboardPaste, Save, Boxes, ListPlus, TriangleAlert, ArrowUp, ArrowDown, FileJson, CirclePlay, Braces, WandSparkles, Dumbbell, ArrowLeft, MessagesSquare, Send, Sparkles, GitFork, Maximize2, Minimize2, Network, Grid3x3, ListTree, Link, FlagTriangleRight } from 'lucide';
import { categories, copyExample, demoFor, demos, exampleIndex, examples } from './examples';
import type { DemoCategory } from './examples';
import { exceptionMessage, expandEvents, failingCheck, normalizeOutput, originNote, output, questionsFor, sameSource, snapshots, validateProject, valueText } from './learning';
import { Library, StorageFullError } from './library';
import type { DocRef } from './library';
import { droppedFiles, importFiles, limitProblem, projectFromSources, projectToZip, validFileName } from './importer';
import { analyzeJava, fileIssues, mainClasses, preferredMain, renameType, setPackage, testTargets } from './javasource';
import { batchOutcome, batchRequest, batchResults, describeTest, evaluateTest, harnessErrorDetail, isCallTest, isHarnessFile, qualifyCall, requestForTest, testExpression, testProblems, valuesMatch } from './tests';
import type { BatchCase, BatchResult, TestOutcome } from './tests';
import { aiTestMessages, caseToCheck, packageOf, parseAiTests, planTests } from './testgen';
import type { AiTest, CaseResult } from './testgen';
import { isStarterCheck, templates } from './templates';
import { boxedValue, describeStep, describeValue, displayMethod, heapIndex, isInlineValue, returnedCall, simpleType, stepBackOver, stepOut, stepOver } from './narrate';
import type { StoryItem } from './narrate';
import { drawArrows, focusArrows } from './arrows';
import { cursorsByObject, cursorsFor, variableTargets } from './cursors';
import type { Cursor } from './cursors';
import { applyEdits, compileIssues } from './compilehelp';
import type { CompileFix, CompileIssue, LineEdit } from './compilehelp';
import { JavaLanguageClient } from './lsp';
import { lintHelp } from './linthelp';
import { buildHelp } from './help';
import { chainViews, graphViews, gridViews, recursionTree, treeViews } from './structures';
import { checkCondition, describeStart, shiftLine, usableStart } from './startat';
import type { CallTree, GraphView, GridView } from './structures';
import type { HelpVisual } from './help';
import { aiPracticeMessages, hasPractice, parseAiPractice, practiceFor, practiceOptions, practiceOutcome } from './practice';
import type { PracticeItem } from './practice';
import { buildMessages, contextMessage, PROVIDERS, renderMarkdown } from './assistant';
import type { AssistStatus, ChatMessage } from './assistant';
import { checkable, spellingTokens } from './spell';
import SpellWorker from './spell.worker?worker';
import { registerJavaLanguageFeatures, toMarkers } from './lspmonaco';
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
const iconSet = { Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2, Folder, FolderOpen, FolderKanban, Package, Copy, FileArchive, ClipboardPaste, Save, Boxes, ListPlus, TriangleAlert, ArrowUp, ArrowDown, FileJson, CirclePlay, Braces, WandSparkles, Dumbbell, ArrowLeft, MessagesSquare, Send, Sparkles, GitFork, Maximize2, Minimize2, Network, Grid3x3, ListTree, Link, FlagTriangleRight };
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

type UiSettings = { arrows: boolean; inline: boolean; spelling: boolean; hints: boolean };
function loadUi(): UiSettings {
  try { const value = JSON.parse(localStorage.getItem('tracelab.ui.v1') ?? '{}'); return { arrows: value.arrows !== false, inline: value.inline !== false, spelling: value.spelling !== false, hints: value.hints !== false }; }
  catch { return { arrows: true, inline: true, spelling: true, hints: true }; }
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
    <button id="reset-doc" class="btn btn-ghost btn-compact" data-action="reset-doc" hidden title="Go back to the starting code, input and tests">${icon('rotate-ccw')}<span class="label">Reset</span></button>
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
          <button role="menuitem" data-action="reset-doc">${icon('rotate-ccw')}Reset to the starting code…</button>
          <button role="menuitem" data-action="settings">${icon('settings-2')}Project settings…</button>
          <button role="menuitem" data-action="language-server">${icon('type')}Editor settings…</button>
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
          <div class="trace-toolbar"><label class="watch-search">${icon('search')}<input id="watch-filter" placeholder="Filter variables and objects" aria-label="Filter variables and objects" /></label><span class="start-chip" id="start-chip" hidden></span><button id="toggle-arrows" class="icon-btn toggle" aria-pressed="${ui.arrows}" title="Reference arrows" aria-label="Show reference arrows">${icon('spline')}</button><button id="toggle-inline" class="icon-btn toggle" aria-pressed="${ui.inline}" title="Show strings and boxed numbers inline" aria-label="Show strings and boxed numbers inline">${icon('type')}</button><button id="history" class="icon-btn" title="Switch to the previous run" aria-label="Switch to the previous run" disabled>${icon('rotate-ccw')}</button></div>
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
      <div class="coach-header"><h2>${icon('lightbulb')}Tutor</h2><div class="coach-header-actions"><button id="toggle-assist" class="btn btn-ghost btn-compact" title="Ask the AI assistant about this program" aria-expanded="false">${icon('messages-square')}Ask</button><button id="collapse-coach" class="icon-btn small" title="Hide Tutor" aria-label="Hide Tutor">${icon('panel-right-close')}</button></div></div>
      <div class="coach-scroll">
        <ol class="learning-stages" id="learning-stages" aria-label="Debugging steps"></ol>
        <section id="assistant" class="assistant-card" aria-label="AI assistant" hidden>
          <div class="card-title">${icon('messages-square')}<h3>Assistant</h3><span class="assist-actions"><button id="assist-new" class="icon-btn small" title="New conversation" aria-label="New conversation">${icon('rotate-ccw')}</button><button id="assist-settings" class="icon-btn small" title="Assistant settings" aria-label="Assistant settings">${icon('settings-2')}</button><button id="assist-close" class="icon-btn small" title="Close the assistant" aria-label="Close the assistant">${icon('x')}</button></span></div>
          <span id="assist-model" class="assist-model"></span>
          <div id="assist-log" class="assist-log" aria-live="polite"></div>
          <div class="assist-quick" id="assist-quick"></div>
          <form id="assist-form" class="assist-form"><label class="sr-only" for="assist-input">Ask about this program</label><textarea id="assist-input" rows="2" placeholder="Ask about this program, the error or a line…" maxlength="4000"></textarea><div class="assist-buttons"><button type="button" id="assist-stop" class="btn btn-secondary btn-compact" hidden>${icon('square')}Stop</button><button type="submit" id="assist-send" class="btn btn-primary btn-compact">${icon('send')}Send</button></div></form>
          <p class="assist-note" id="assist-note"></p>
        </section>
        <div id="coach-content"></div>
        <section class="tests-card"><div class="card-title">${icon('list-checks')}<h3>Tests</h3><span class="tab-count" id="tests-count"></span><button id="edit-checks" class="link-btn">Edit</button></div><p class="muted" id="tests-blurb">Each test runs your current code in a fresh JVM and checks its output or a method’s result.</p><div class="tests-actions"><button id="verify" class="btn btn-secondary">${icon('play')}Run tests</button><button id="add-test" class="btn btn-ghost">${icon('list-plus')}Add test</button><button id="generate-tests" class="btn btn-ghost" title="Try sample arguments on your methods and turn the results into tests you confirm">${icon('wand-sparkles')}Generate</button></div><button id="save-run-test" class="link-btn" hidden>${icon('save')}Save this run’s output as a test</button><div id="check-results" aria-live="polite"></div></section>
        <section class="progress-card" id="progress-card"></section>
        <p class="coach-footnote">Questions are generated from values recorded during your run and from the recorded source. Passing tests confirms those cases, not every possible input.</p>
      </div>
    </aside>
  </div>
  <footer class="statusbar">
    <button class="status-item" id="runner-status" data-action="about" title="About the runner"><span class="status-dot"></span><span id="runner-label">Connecting…</span></button>
    <button class="status-item" id="lsp-status" data-action="language-server"><span class="status-dot"></span><span>Java: off</span></button>
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
  inlayHints: { enabled: ui.hints ? 'on' : 'off' }, lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
});
decorations = editor.createDecorationsCollection();
applyLayout(layout);
registerJavaCompletions(monaco, () => identifiers(project.files.map(f => f.content)), () => lsp.ready);

// ---------- Java language server (Eclipse JDT LS through the runner) ----------

const lsp = new JavaLanguageClient();
/** Project file name for an editable workspace model; null for recorded source. */
function fileOfModel(model: monaco.editor.ITextModel): string | null {
  for (const [key, value] of models) if (value === model) return key.startsWith('workspace/') ? key.slice('workspace/'.length) : null;
  return null;
}
registerJavaLanguageFeatures(monaco, {
  client: lsp,
  fileOf: fileOfModel,
  modelOf: file => project.files.some(f => f.name === file) ? getModel(file, false) : null,
  reveal: (file, range) => {
    if (traceSource || activeFile !== file) selectFile(file, false);
    editor.setSelection(range); editor.revealRangeInCenterIfOutsideViewport(range); editor.focus();
  },
  editor: () => editor,
});
// Go to definition and references open the target file in the single editor.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selection) {
    const model = monaco.editor.getModel(resource);
    const file = model ? fileOfModel(model) : null;
    if (!file) return false;
    selectFile(file, false);
    if (selection) {
      const range = 'startLineNumber' in selection ? selection : new monaco.Range(selection.lineNumber, selection.column, selection.lineNumber, selection.column);
      editor.setSelection(range); editor.revealRangeInCenterIfOutsideViewport(range);
    }
    editor.focus();
    return true;
  },
});
lsp.onDiagnostics = (file, diagnostics) => {
  const model = models.get(`workspace/${file}`);
  if (model) monaco.editor.setModelMarkers(model, 'java-ls', toMarkers(monaco, diagnostics, lintHelp));
  scheduleProblems();
};
lsp.onState = () => {
  renderLspStatus();
  // The project may have changed while the server was starting.
  if (lsp.ready) { lsp.sync(project.files); scheduleProblems(); for (const f of project.files) getModel(f.name, false); }
};
// Monaco cancels hover, completion and code-action requests as the cursor moves; those aren't errors.
window.addEventListener('unhandledrejection', e => { if ((e.reason as Error | undefined)?.name === 'Canceled' || (e.reason as Error | undefined)?.message === 'Canceled') e.preventDefault(); });
let lspTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLspSync() { clearTimeout(lspTimer); lspTimer = setTimeout(() => { if (lsp.ready) lsp.sync(project.files); }, 250); }
function connectLanguageServer() { if (lsp.state === 'off' || lsp.state === 'stopped') lsp.connect(project.files).then(() => renderLspStatus()); }
// A second tab takes over the shared server when it becomes visible.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && lsp.ready) lsp.sync(project.files); });
function renderLspStatus() {
  const el = $('#lsp-status');
  const label = { off: 'Java: off', starting: 'Java: starting…', ready: lsp.progress ? `Java: ${lsp.progress.toLowerCase()}` : 'Java: ready', unavailable: 'Java: basic', stopped: 'Java: stopped' }[lsp.state];
  el.querySelector('span:last-child')!.textContent = label;
  el.classList.toggle('offline', lsp.state === 'stopped');
  el.classList.toggle('basic', lsp.state === 'unavailable' || lsp.state === 'off');
  el.classList.toggle('pending', lsp.state === 'starting' || (lsp.ready && !!lsp.progress));
  el.title = lsp.ready ? 'Java language server: completions with types, hovers, go to definition, rename, refactorings and errors as you type. Click for details.'
    : lsp.state === 'unavailable' ? 'Basic editing only. Click to see how to turn on the Java language server.' : lsp.reason || 'Java language server';
}
// ---------- Spelling (comments, strings and identifier parts) ----------

const DICTIONARY_KEY = 'tracelab.dictionary.v1';
const userWords = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(DICTIONARY_KEY) ?? '[]') as string[]; } catch { return []; } })());
let spellWorker: Worker | null = null;
let spellRequest = 0;
const spellReplies = new Map<number, (value: any) => void>();
function speller<T>(message: Record<string, unknown>): Promise<T> {
  if (!spellWorker) {
    spellWorker = new SpellWorker();
    spellWorker.onmessage = e => { spellReplies.get(e.data.id)?.(e.data); spellReplies.delete(e.data.id); };
  }
  const id = ++spellRequest;
  return new Promise<T>(resolve => { spellReplies.set(id, resolve); spellWorker!.postMessage({ ...message, id }); });
}
const spellTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleSpelling(file: string, delay = 700) { clearTimeout(spellTimers.get(file)); spellTimers.set(file, setTimeout(() => checkSpelling(file), delay)); }
async function checkSpelling(file: string) {
  const model = models.get(`workspace/${file}`);
  if (!model || model.isDisposed()) return;
  if (!ui.spelling) { monaco.editor.setModelMarkers(model, 'spelling', []); return; }
  const version = model.getVersionId();
  const tokens = checkable(spellingTokens(model.getValue()), userWords);
  const { misspelled } = await speller<{ misspelled: string[] }>({ type: 'check', words: [...new Set(tokens.map(t => t.word))], extra: [] });
  if (model.isDisposed() || model.getVersionId() !== version) return;
  const bad = new Set(misspelled);
  monaco.editor.setModelMarkers(model, 'spelling', tokens.filter(t => bad.has(t.word)).slice(0, 300).map(t => {
    const start = model.getPositionAt(t.offset), end = model.getPositionAt(t.offset + t.word.length);
    return { severity: monaco.MarkerSeverity.Info, source: 'Spelling', message: `“${t.word}” may be misspelled${t.kind === 'name' ? ' (part of a name)' : ''}.`, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
  }));
}
function recheckSpelling() { for (const f of project.files) scheduleSpelling(f.name, 50); }
monaco.editor.registerCommand('tracelab.spell.add', (_accessor, word: string) => {
  userWords.add(word.toLowerCase());
  try { localStorage.setItem(DICTIONARY_KEY, JSON.stringify([...userWords])); } catch { /* The word is still accepted for this session. */ }
  recheckSpelling();
});
monaco.languages.registerCodeActionProvider('java', {
  async provideCodeActions(model, _range, context) {
    const marker = context.markers.find(m => m.source === 'Spelling');
    if (!marker) return { actions: [], dispose() {} };
    const word = model.getValueInRange(marker);
    const { suggestions } = await speller<{ suggestions: string[] }>({ type: 'suggest', word });
    // Keep the original capitalization, so a fix inside an identifier stays a valid name.
    const shape = (s: string) => /^[A-Z]/.test(word) ? s[0].toUpperCase() + s.slice(1) : s[0].toLowerCase() + s.slice(1);
    const actions: monaco.languages.CodeAction[] = suggestions.filter(s => /^[A-Za-z]+$/.test(s)).slice(0, 3).map((s, i) => ({ title: `Change to “${shape(s)}”`, kind: 'quickfix', isPreferred: i === 0, diagnostics: [marker], edit: { edits: [{ resource: model.uri, textEdit: { range: marker, text: shape(s) }, versionId: model.getVersionId() }] } }));
    actions.push({ title: `Add “${word}” to my dictionary`, kind: 'quickfix', diagnostics: [marker], command: { id: 'tracelab.spell.add', title: 'Add to dictionary', arguments: [word] } });
    return { actions, dispose() {} };
  },
});

let problemsTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleProblems() { clearTimeout(problemsTimer); problemsTimer = setTimeout(() => { if (consoleTab === 'diagnostics') renderConsole(); else renderProblemCount(); }, 150); }

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
  scheduleLspSync();
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
    if (!historical) { monaco.editor.setModelMarkers(model, 'java-ls', toMarkers(monaco, lsp.diagnosticsFor(source.name), lintHelp)); scheduleSpelling(source.name, 1500); }
    if (!historical) model.onDidChangeContent(event => {
      if (changingModel) return;
      scheduleSpelling(source.name);
      // The recording start point follows its line as lines are added or removed above it.
      if (project.startAt?.file === source.name) project.startAt.line = Math.min(shiftLine(project.startAt.line, event.changes), model!.getLineCount());
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
  $('#reset-doc').hidden = !canReset();
  $('#reset-doc').title = example ? 'Reset this example to its original code, input and tests' : 'Reset this project to how it was when you created it';
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
  const marks = breakpoints.get(from); breakpoints.delete(from); if (marks) breakpoints.set(to, marks); if (project.startAt?.file === from) project.startAt.file = to;
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
  const start = usableStart(project.startAt, project.files);
  if (start && start.file === activeFile && !traceSource) marks.push({ range: new monaco.Range(start.line, 1, start.line, 1), options: { isWholeLine: true, className: 'start-at-line', linesDecorationsClassName: 'start-at-marker', hoverMessage: { value: `Recording starts at ${describeStart(start)}. Lines before it run without being recorded. Right-click to change or remove it.` } } });
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
// Recording start points, from the editor's right-click menu.
editor.addAction({ id: 'tracelab.start-here', label: 'Start recording here', contextMenuGroupId: '0_tracelab', contextMenuOrder: 1,
  run: ed => { if (traceSource) { toast('Switch back to your code to set a start point.'); return; } setStartAt({ file: activeFile, line: ed.getPosition()?.lineNumber ?? 1 }); } });
editor.addAction({ id: 'tracelab.start-here-when', label: 'Start recording here when…', contextMenuGroupId: '0_tracelab', contextMenuOrder: 2,
  run: ed => { if (traceSource) { toast('Switch back to your code to set a start point.'); return; } startAtDialog(activeFile, ed.getPosition()?.lineNumber ?? 1); } });
editor.addAction({ id: 'tracelab.start-clear', label: 'Record from the start of main', contextMenuGroupId: '0_tracelab', contextMenuOrder: 3, run: () => clearStartAt() });
// Monaco binds Shift+F10 to its context menu; in TraceLab it steps back over, as everywhere else on the page.
editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F10, () => navigate('back-over'));

// ---------- Memory rendering ----------

/** `grids` are 2D arrays drawn as grids above the heap (with a note for their cards); their row arrays get no cards of their own. */
type RenderContext = { heap: Map<string, HeapObject>; previousHeap: Map<string, HeapObject>; cursors: Map<string, Cursor[]>; targets: Map<string, Cursor>; topFrame?: string; grids?: Map<string, string>; gridRows?: Set<string> };
function refColor(id = '') { return ['green', 'blue', 'orange', 'violet'][Number(id.replace(/\D/g, '')) % 4]; }
function inlineText(object: HeapObject): string { return object.kind === 'string' ? `“${object.text ?? ''}”${object.truncated ? '…' : ''}` : object.kind === 'value' ? object.text ?? '' : boxedValue(object) ?? ''; }

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
  // Rows of a grid are drawn in the grid, unless a variable such as `row` holds one.
  if (ctx.gridRows?.has(object.id) && !refs.length) return '';
  const grid = ctx.grids?.get(object.id);
  let body = '';
  if (grid) body = `<p class="object-note">${esc(grid)}</p>`;
  else if (object.kind === 'string' && indexed && (object.text?.length ?? 0) <= 64) body = renderCells(object, previous, ctx);
  else if (object.kind === 'string') body = `<div class="string-value ${previous && previous.text !== object.text ? 'changed' : ''}">“${esc(object.text)}”</div>`;
  else if (object.kind === 'value') body = `<div class="string-value ${previous && previous.text !== object.text ? 'changed' : ''}">${esc(object.text)}</div>`;
  else if (object.kind === 'map') body = `<div class="map-entries">${object.entries?.map(e => {
    const before = previous?.entries?.find(p => JSON.stringify(p.key) === JSON.stringify(e.key));
    return `<div class="map-entry ${previous && !before ? 'fresh' : ''}">${renderValue(e.key, undefined, ctx)}<span class="map-arrow">→</span>${renderValue(e.value, before?.value, ctx)}</div>`;
  }).join('') || '<span class="empty-array">Empty map</span>'}</div>`;
  else if (object.elements) body = renderCells(object, previous, ctx);
  else if (object.fields) body = `<div class="object-fields">${renderVariables(object.fields, previous?.fields, ctx)}</div>`;
  else body = `<p class="object-note">${esc(object.message ?? 'No visible fields.')}</p>`;
  const note = object.message && object.kind !== 'opaque' && object.kind !== 'unavailable' ? `<p class="object-note">${esc(object.message)}</p>` : '';
  const caption = grid ? '' : object.length !== undefined ? `<div class="array-caption">${object.kind === 'string' || object.kind === 'array' ? 'length' : 'size'} ${object.length}${object.truncated ? ` · first ${object.elements?.length ?? object.entries?.length ?? 0} shown` : ''}</div>` : object.truncated ? '<div class="array-caption">Preview truncated</div>' : '';
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

// ---------- Structure views: recursion, graphs, grids, trees and linked lists ----------

/** Views the user folded, and the one shown large over the debugger. Kept across steps. */
const collapsedViews = new Set<string>();
let expandedView: string | null = null;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clipLabel = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const swatch = (cls: string, label: string) => `<span><i class="swatch ${cls}"></i>${esc(label)}</span>`;

/** A foldable, horizontally scrolling view with a button to show it larger. */
function structureView(key: string, iconName: string, title: string, caption: string, body: string, legend = ''): string {
  const expanded = expandedView === key;
  const states = currentStates();
  const bar = expanded ? `<div class="structure-stepbar"><button type="button" class="icon-btn" data-step-go="-1" aria-label="Previous step" ${step === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>Step <strong>${step + 1}</strong> of ${states.length}</span><button type="button" class="icon-btn" data-step-go="1" aria-label="Next step" ${step >= states.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button><span class="muted">F10 steps over, F11 steps into</span></div>` : '';
  return `<details class="structure-view ${expanded ? 'expanded' : ''}" data-structure="${esc(key)}" ${collapsedViews.has(key) && !expanded ? '' : 'open'}><summary>${icon(iconName)}<strong>${esc(title)}</strong><span class="structure-caption" title="${esc(caption.replace(/<[^>]+>/g, ''))}">${caption}</span><button type="button" class="icon-btn structure-expand" data-expand="${esc(key)}" title="${expanded ? 'Back to the debugger (Esc)' : 'Show larger'}" aria-label="${expanded ? 'Close the large view' : `Show ${esc(title)} larger`}">${icon(expanded ? 'minimize-2' : 'maximize-2')}</button></summary>${bar}<div class="structure-scroll" data-scroll="${esc(key)}">${body}</div>${legend ? `<div class="structure-legend">${legend}</div>` : ''}</details>`;
}

/** Recursive calls as a tree: top-down, or left to right when the calls form a long chain. */
function renderCallTree(t: CallTree): string {
  const width = Math.min(150, Math.max(58, ...t.nodes.map(n => Math.max(n.label.length, (n.result?.length ?? 0) + 2) * 7.4 + 20)));
  const sideways = t.rows > 4 && t.rows > t.columns * 1.5;
  const PAD = 16, H = 40, X = sideways ? width + 26 : width + 12, Y = sideways ? H + 12 : H + 30;
  const at = (n: CallTree['nodes'][number]) => sideways ? { left: PAD + n.depth * X, top: PAD + n.x * Y } : { left: PAD + n.x * X, top: PAD + n.depth * Y };
  const position = new Map(t.nodes.map(n => [n.id, at(n)]));
  const w = PAD * 2 + (sideways ? (t.rows - 1) * X : (t.columns - 1) * X) + width, h = PAD * 2 + (sideways ? (t.columns - 1) * Y : (t.rows - 1) * Y) + H;
  const lines = t.nodes.filter(n => n.parent && position.has(n.parent)).map(n => {
    const a = position.get(n.parent!)!, b = position.get(n.id)!;
    return sideways ? `<line x1="${a.left + width}" y1="${a.top + H / 2}" x2="${b.left}" y2="${b.top + H / 2}"/>` : `<line x1="${a.left + width / 2}" y1="${a.top + H}" x2="${b.left + width / 2}" y2="${b.top}"/>`;
  }).join('');
  const label = { current: 'running now', active: 'waiting for a call it made', done: 'returned' };
  const nodes = t.nodes.map(n => {
    const p = position.get(n.id)!;
    return `<button class="call-node ${n.state} ${n.state === 'current' ? 'is-current' : ''}" data-goto-step="${n.step}" style="left:${p.left}px;top:${p.top}px;width:${width}px;height:${H}px" title="${esc(`${n.label}: ${label[n.state]}${n.result ? `, result ${n.result}` : ''}. Click to go to the step where this call starts.`)}"><span>${esc(clipLabel(n.label, 22))}</span>${n.state === 'done' && n.result !== undefined ? `<small>${n.result ? `→ ${esc(clipLabel(n.result, 16))}` : 'done'}</small>` : ''}</button>`;
  }).join('');
  return `<div class="tree-canvas" style="width:${w}px;height:${h}px"><svg class="tree-lines" width="${w}" height="${h}" aria-hidden="true">${lines}</svg>${nodes}</div>`;
}

/** A graph in layers, one column per distance from the start, with edges bent around nodes they would cross. */
function renderGraph(g: GraphView): string {
  const R = 18, X = 96, Y = 64, PAD = 28;
  const center = new Map(g.nodes.map(n => [n.key, { x: PAD + R + n.x * X, y: PAD + 14 + R + n.y * Y }]));
  const layer = new Map(g.nodes.map(n => [n.key, n.x]));
  const width = PAD * 2 + R * 2 + (g.columns - 1) * X, height = PAD * 2 + 14 + R * 2 + (g.rows - 1) * Y + 14;
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const lines = g.edges.map(e => {
    const a = center.get(e.from), b = center.get(e.to);
    if (!a || !b) return '';
    const cls = [e.tree ? 'tree' : '', e.path ? 'path' : '', e.active ? 'active' : ''].join(' ');
    const label = e.label !== undefined ? e.label : '';
    if (e.from === e.to) return `<path class="${cls}" d="M ${a.x - 7} ${a.y - R + 2} C ${a.x - 26} ${a.y - R - 34}, ${a.x + 26} ${a.y - R - 34}, ${a.x + 7} ${a.y - R + 2}" ${g.directed ? 'marker-end="url(#graph-arrow)"' : ''}/>`;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    // Edges between neighboring columns are straight; longer ones bend so they don't run through other nodes.
    const bend = Math.abs((layer.get(e.from) ?? 0) - (layer.get(e.to) ?? 0)) === 1 ? 0 : Math.min(46, len * 0.22);
    const cx = (a.x + b.x) / 2 - (dy / (len || 1)) * bend, cy = (a.y + b.y) / 2 + (dx / (len || 1)) * bend;
    const [ux, uy] = unit(cx - a.x, cy - a.y), [vx, vy] = unit(b.x - cx, b.y - cy);
    const start = [a.x + ux * R, a.y + uy * R], end = [b.x - vx * (R + (g.directed ? 3 : 0)), b.y - vy * (R + (g.directed ? 3 : 0))];
    const mid = [(start[0] + 2 * cx + end[0]) / 4, (start[1] + 2 * cy + end[1]) / 4];
    return `<path class="${cls}" d="M ${start[0].toFixed(1)} ${start[1].toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}" ${g.directed ? 'marker-end="url(#graph-arrow)"' : ''}><title>${esc(`${g.nodes.find(n => n.key === e.from)?.label} ${g.directed ? '→' : '–'} ${g.nodes.find(n => n.key === e.to)?.label}${label ? ` (${label})` : ''}`)}</title></path>${label ? `<text x="${mid[0].toFixed(1)}" y="${(mid[1] - 4).toFixed(1)}">${esc(clipLabel(label, 6))}</text>` : ''}`;
  }).join('');
  const queueWord = g.sources.queueKind ?? 'queue';
  const nodes = g.nodes.map(n => {
    const c = center.get(n.key)!;
    const state = [n.current ? 'current node' : '', n.visited ? 'visited' : 'not visited yet', n.queued ? (n.queued === 1 ? `next out of ${g.sources.queue}` : `waiting in ${g.sources.queue}`) : '', n.onPath ? 'on the path of calls' : '', n.badge !== undefined ? `${g.sources.badge} = ${n.badge}` : ''].filter(Boolean).join(', ');
    const tag = n.ref ? 'button' : 'div';
    return `<${tag} class="graph-node ${n.visited ? 'visited' : ''} ${n.queued ? 'queued' : ''} ${n.current ? 'current is-current' : ''} ${n.onPath ? 'on-path' : ''}" style="left:${c.x - R}px;top:${c.y - R}px" ${n.ref ? `data-ref="${esc(n.ref)}"` : 'role="img"'} ${n.ref ? 'title' : 'aria-label'}="${esc(`Node ${n.label}: ${state}`)}" ${n.ref ? '' : `title="${esc(`Node ${n.label}: ${state}`)}"`}>${esc(clipLabel(n.label, 5))}${n.names.length ? `<span class="node-names">${esc(n.names.join(', '))}</span>` : ''}${n.queued && n.queued < 99 ? `<span class="node-order" title="${esc(`${n.queued === 1 ? 'Leaves' : 'Position in'} the ${queueWord}`)}">${n.queued}</span>` : ''}${n.badge !== undefined ? `<span class="node-badge">${esc(clipLabel(n.badge, 6))}</span>` : ''}</${tag}>`;
  }).join('');
  const marker = g.directed ? '<defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>' : '';
  return `<div class="tree-canvas graph-canvas" style="width:${width}px;height:${height}px"><svg class="tree-lines graph-lines" width="${width}" height="${height}" aria-hidden="true">${marker}${lines}</svg>${nodes}</div>`;
}

function renderGrid(g: GridView): string {
  const tags = (marks: string[]) => marks.length ? `<span class="grid-tag">${esc(marks.join(', '))}</span>` : '';
  const head = `<tr><th scope="col"><span class="sr-only">Row</span></th>${g.colMarks.map((m, x) => `<th scope="col" class="${m.length ? 'marked' : ''}">${x}${tags(m)}</th>`).join('')}</tr>`;
  const body = g.cells.map((row, y) => `<tr class="${g.rowMarks[y].length ? 'in-row' : ''}"><th scope="row" class="${g.rowMarks[y].length ? 'marked' : ''}">${y}${tags(g.rowMarks[y])}</th>${row.map((c, x) => `<td class="${c.tone} ${c.changed ? 'changed' : ''} ${g.colMarks[x].length ? 'in-col' : ''} ${c.marks.length ? 'pointed is-current' : ''}" title="${esc(`${g.name}[${y}][${x}] = ${c.full}${c.order ? ` · ${c.order === 1 ? 'next out of' : 'waiting in'} ${g.queue}` : ''}`)}">${esc(c.text)}${c.order ? `<span class="grid-order">${c.order}</span>` : ''}</td>`).join('')}</tr>`).join('');
  return `<table class="grid-view"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** Every structure view for a step, above the stack and heap. */
function renderStructures(snapshot: TraceEvent, previous: TraceEvent | undefined, grids: GridView[]): string {
  const parts: string[] = [];
  const calls = run ? recursionTree(currentStates(), step) : null;
  if (calls) {
    const name = displayMethod(calls.method).split('.').at(-1)!;
    const done = calls.nodes.filter(n => n.state === 'done').length;
    parts.push(structureView('calls', 'list-tree', `Calls to ${name}`, `${plural(calls.calls, 'call')} so far, ${done} returned${calls.hidden ? ` · ${calls.hidden} older calls hidden` : ''}`, renderCallTree(calls),
      `${swatch('call-current', 'Running now')}${swatch('call-active', 'Waiting for a call it made')}${swatch('call-done', 'Returned, with its result')}<span>Click a call to go to its first step.</span>`));
  }
  for (const g of graphViews(snapshot, previous)) {
    const start = g.nodes.find(n => n.x === 0);
    const s = g.sources;
    const legend = [s.visited ? swatch('graph-visited', `Visited (${s.visited})`) : '', s.queue ? swatch('graph-queued', g.nodes.some(n => n.queued) ? `Waiting in ${s.queue}${s.queue === s.queueKind ? '' : ` (${s.queueKind})`}; 1 leaves next` : `${s.queue} is empty`) : '', g.nodes.some(n => n.current) ? swatch('graph-current', 'Current node') : '',
      s.path ? swatch('graph-path', `Path of ${s.path} calls`) : '', s.tree ? swatch('graph-tree', `Parent links (${s.tree})`) : '', g.edges.some(e => e.active) ? swatch('graph-active', 'Edge being checked') : '', s.badge ? `<span><b class="node-badge static">n</b>${esc(s.badge)}</span>` : ''].join('');
    parts.push(structureView(g.key, 'network', `Graph ${g.name}`, `${plural(g.nodes.length, 'node')}, ${plural(g.edges.length, 'edge')}${g.directed ? ', directed' : ''} · ${g.kind} · columns by distance from ${esc(start?.label ?? '?')}`, renderGraph(g), legend));
  }
  for (const g of grids) {
    parts.push(structureView(g.key, 'grid-3x3', `Grid ${g.name}`, `${simpleType(g.type)} · ${g.rows} rows × ${g.cols} columns${g.overlay ? ` · colored by ${esc(g.overlay)}` : ''}${g.queue ? ` · cells in ${esc(g.queue)} numbered` : ''}${g.truncated ? ' · part not captured' : ''}`, renderGrid(g)));
  }
  const X = 52, Y = 60, PAD = 16;
  for (const view of treeViews(snapshot, previous)) {
    const position = new Map(view.nodes.map(n => [n.id, { left: PAD + n.x * X, top: PAD + 14 + n.depth * Y }]));
    const width = PAD * 2 + Math.max(1, view.columns) * X, height = PAD * 2 + 14 + view.rows * Y;
    const lines = view.edges.map(e => { const a = position.get(e.from)!, b = position.get(e.to)!; return `<line x1="${a.left + 17}" y1="${a.top + 17}" x2="${b.left + 17}" y2="${b.top + 17}"><title>${esc(e.label)}</title></line>`; }).join('');
    const nodes = view.nodes.map(n => { const p = position.get(n.id)!; return `<button class="tree-node ${refColor(n.id)} ${n.isNew ? 'new' : ''} ${n.changed ? 'changed' : ''} ${n.refs.length ? 'is-current' : ''}" style="left:${p.left}px;top:${p.top}px" data-ref="${esc(n.id)}" title="${esc(view.type)} @${esc(n.id)}${n.refs.length ? ` · ${n.refs.join(', ')}` : ''}. Click to show its fields.">${esc(clipLabel(n.label, 5))}${n.refs.length ? `<span class="tree-ref">${esc(n.refs.join(', '))}</span>` : ''}</button>`; }).join('');
    parts.push(structureView(`tree:${view.type}`, 'git-fork', `Tree of ${view.type}`, `${plural(view.nodes.length, 'node')}, left to right in order${view.missing ? ` · ${view.missing} not captured` : ''}`, `<div class="tree-canvas" style="width:${width}px;height:${height}px"><svg class="tree-lines" width="${width}" height="${height}" aria-hidden="true">${lines}</svg>${nodes}</div>`));
  }
  for (const view of chainViews(snapshot, previous)) {
    const rows = view.chains.map(chain => `<div class="chain-row">${chain.nodes.map((n, i) => `${i ? `<span class="chain-link" aria-hidden="true">${view.doubly ? '⇄' : '→'}</span>` : ''}<button class="chain-node ${refColor(n.id)} ${n.isNew ? 'new' : ''} ${n.changed ? 'changed' : ''} ${n.refs.length ? 'is-current' : ''}" data-ref="${esc(n.id)}" title="${esc(`${view.type} @${n.id}${n.refs.length ? ` · ${n.refs.join(', ')}` : ''}. Click to show its fields.`)}">${esc(clipLabel(n.label, 8))}${n.refs.length ? `<span class="chain-ref">${esc(n.refs.join(', '))}</span>` : ''}</button>`).join('')}<span class="chain-link" aria-hidden="true">→</span><span class="chain-end">${chain.cycleTo ? `↺ back to @${esc(chain.cycleTo)}` : chain.more ? '… not captured' : 'null'}</span></div>`).join('');
    const count = view.chains.reduce((n, c) => n + c.nodes.length, 0);
    parts.push(structureView(view.key, 'link', `Linked ${view.type}s`, `${plural(count, 'node')}${view.chains.length > 1 ? ` in ${view.chains.length} chains` : ''}${view.doubly ? ', linked both ways' : ''}`, rows));
  }
  if (expandedView && !parts.some(p => p.includes(`data-structure="${esc(expandedView!)}"`))) expandedView = null;
  return `${expandedView ? '<div class="structure-backdrop" data-expand-close></div>' : ''}${parts.join('')}`;
}

/** Keeps each view's scroll position across steps, then brings the current node into view. */
function restoreStructureScroll(saved: Map<string, [number, number]>) {
  for (const box of document.querySelectorAll<HTMLElement>('#memory-canvas [data-scroll]')) {
    const [left, top] = saved.get(box.dataset.scroll!) ?? [0, 0];
    box.scrollLeft = left; box.scrollTop = top;
    const item = box.querySelector<HTMLElement>('.is-current');
    if (!item) continue;
    const b = box.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.left < b.left + 8 || r.right > b.right - 8) box.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
    if (r.top < b.top + 8 || r.bottom > b.bottom - 8) box.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
  }
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
  'bad-start': ['Start condition error', 'error'],
};

function renderEmptyDebugger(reason: string | undefined) {
  const start = run?.request.startAt;
  if (running) return `<div class="empty-state"><span class="empty-icon spin">${icon('loader-circle')}</span><h3>${start ? 'Running until the start point…' : 'Recording your program…'}</h3><p>${start ? `The program runs without recording until ${esc(describeStart(start))}, then TraceLab records every line from there.` : 'TraceLab compiles your code with javac, runs it on a real JVM, and records every line it executes.'}</p></div>`;
  const end = run?.events.findLast(e => e.kind === 'terminated');
  if (reason === 'bad-start') return `<div class="empty-state"><span class="empty-icon error">${icon('flag-triangle-right')}</span><h3>The start condition can’t be read</h3><p>${esc(end?.message ?? '')}</p><div class="empty-actions"><button class="btn btn-primary" data-action="start-at">${icon('pencil')}Edit the start point</button><button class="btn btn-secondary" data-action="clear-start">Record from the start</button></div></div>`;
  if (end?.start && !end.start.reached) return `<div class="empty-state"><span class="empty-icon">${icon('flag-triangle-right')}</span><h3>Recording never started</h3><p>${esc(end.start.message ?? '')} The program ran to the end; see its output below.</p><div class="empty-actions"><button class="btn btn-primary" data-action="start-at">${icon('pencil')}Edit the start point</button><button class="btn btn-secondary" data-action="clear-start">Record from the start</button></div></div>`;
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
    // A boolean grid that colors another grid (visited[][] over maze[][]) isn't drawn twice.
    const allGrids = gridViews(snapshot, previous, ctx.cursors);
    const grids = allGrids.filter(g => !allGrids.some(other => other.overlay === g.name));
    ctx.grids = new Map(allGrids.map(g => [g.id, grids.includes(g) ? `Drawn as the grid “${g.name}” above, with ${g.rows} rows.` : `Shown as the colors of the grid “${allGrids.find(o => o.overlay === g.name)!.name}” above.`]));
    ctx.gridRows = new Set(allGrids.flatMap(g => ctx.heap.get(g.id)?.elements?.map(e => e.ref!) ?? []));
    const heapCards = snapshot.heap?.map(o => renderHeap(o, previous?.heap?.find(p => p.id === o.id), !!previous && !ctx.previousHeap.has(o.id), ctx, snapshot)).join('') ?? '';
    const message = event?.exception ? exceptionMessage(run!, event) : '';
    const scrolled = new Map([...canvas.querySelectorAll<HTMLElement>('[data-scroll]')].map(el => [el.dataset.scroll!, [el.scrollLeft, el.scrollTop] as [number, number]]));
    canvas.innerHTML = `${event?.exception ? `<div class="exception-card">${icon('bug')}<div><strong>${esc(event.exception.type.split('.').at(-1))}</strong>${message ? `<p>${esc(message)}</p>` : ''}</div></div>` : ''}
      ${renderStory(states)}
      ${renderStructures(snapshot, previous, grids)}
      <div class="memory-columns" id="memory-columns"><svg class="arrow-layer" aria-hidden="true"></svg>
        <div class="stack-column"><div class="section-label">Call stack <span>${snapshot.frames?.length ?? 0} frame${snapshot.frames?.length === 1 ? '' : 's'}</span></div>
          <div class="frames">${snapshot.frames?.map((frame, i) => renderFrame(frame, i, previous, event, ctx)).join('')}
          ${snapshot.statics?.length ? `<details class="frame statics"><summary><span class="frame-name">Static fields</span></summary><div class="frame-variables">${renderVariables(snapshot.statics, previous?.statics, ctx, true)}</div></details>` : ''}</div></div>
        <div class="heap-column"><div class="section-label">Heap <span>${ui.inline ? 'strings and boxed values shown inline' : 'all objects'}</span></div>
          <div class="heap">${heapCards || '<div class="no-vars">No reachable objects at this step.</div>'}</div></div>
      </div>
      ${snapshot.heapTruncated || snapshot.framesTruncated ? '<div class="trace-notice">Capture limits reached at this step. Some frames or objects are not shown.</div>' : ''}
      ${run?.request.startAt && step === 0 && !event?.exception ? `<div class="trace-notice info">${icon('flag-triangle-right')}Recording started here, at ${esc(describeStart({ ...run.request.startAt, line: run.events.at(-1)?.start?.line ?? run.request.startAt.line }))}. The lines before it ran without being recorded.</div>` : ''}
      <div class="memory-legend"><span><i class="swatch changed"></i>Changed</span><span><i class="swatch new"></i>New</span><span>${icon('arrow-up-right')}Reference</span></div>`;
    canvas.scrollTop = scroll;
    restoreStructureScroll(scrolled);
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

/**
 * Problems to list: javac's diagnostics from the last run (while the code still matches it, or always without the
 * language server), then the language server's findings as you type. Live errors that javac also reported are skipped.
 */
function problemList() {
  const runDiagnostics = !dirtyTrace() || !lsp.ready ? run?.events.filter(e => e.kind === 'diagnostic') ?? [] : [];
  const hasRunErrors = runDiagnostics.some(d => d.severity === 'error');
  const live = lsp.ready ? project.files.flatMap(f => lsp.diagnosticsFor(f.name).filter(d => (d.severity ?? 1) <= 2 && !(hasRunErrors && (d.severity ?? 1) === 1)).map(d => ({ file: f.name, d }))) : [];
  return { runDiagnostics, live };
}
function renderProblemCount() {
  const { runDiagnostics, live } = problemList();
  $('#problem-count').textContent = String(runDiagnostics.length + live.length);
  $('#problem-count').classList.toggle('error', runDiagnostics.some(d => d.severity === 'error') || live.some(x => (x.d.severity ?? 1) === 1));
  $('#problem-count').classList.toggle('warning', !$('#problem-count').classList.contains('error') && live.length > 0);
}

function renderConsole() {
  document.querySelectorAll<HTMLButtonElement>('.console-tabs [data-console]').forEach(b => { b.classList.toggle('active', b.dataset.console === consoleTab); b.setAttribute('aria-selected', String(b.dataset.console === consoleTab)); });
  const { runDiagnostics: diagnostics, live } = problemList();
  renderProblemCount();
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
    const fromRun = diagnostics.map(d => {
      const issue = d.severity === 'error' ? help.get(`${d.file}:${d.line}:${errorKey(d.message)}`) : undefined;
      const first = issue && !shown.has(issue);
      if (issue) shown.add(issue);
      const extra = issue && first ? `<div class="diagnostic-help"><span>${icon('lightbulb')}${esc(issue.title)}</span>${issue.fixes[0] && !fixesFolded() ? renderFix(issue.fixes[0], true) : ''}</div>` : '';
      return `<div class="diagnostic-item"><button class="diagnostic ${d.severity}" data-diagnostic="${esc(d.file)}" data-line="${d.line ?? 1}">${icon(d.severity === 'error' ? 'circle-x' : 'info')}<span><strong>${esc(d.message)}</strong><small>${esc(d.file)} · line ${d.line}, column ${d.column}</small></span></button>${extra}</div>`;
    }).join('');
    const asYouType = live.map(({ file, d }) => {
      const severity = (d.severity ?? 1) === 1 ? 'error' : 'warning';
      const help = lintHelp(d.message);
      return `<div class="diagnostic-item"><button class="diagnostic ${severity}" data-diagnostic="${esc(file)}" data-line="${d.range.start.line + 1}">${icon(severity === 'error' ? 'circle-x' : 'triangle-alert')}<span><strong>${esc(d.message)}</strong><small>${esc(file)} · line ${d.range.start.line + 1}, column ${d.range.start.character + 1}</small></span></button>${help ? `<div class="diagnostic-help"><span>${icon('lightbulb')}${esc(help)}</span></div>` : ''}</div>`;
    }).join('');
    el.innerHTML = fromRun || asYouType
      ? `${fromRun && asYouType ? '<h4 class="problems-head">From the last run</h4>' : ''}${fromRun}${fromRun && asYouType ? '<h4 class="problems-head">As you type</h4>' : ''}${asYouType}`
      : `<div class="console-empty">${lsp.ready ? 'No problems found as you type.' : 'No problems in the last run.'}</div>`;
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
  $('#progress-card').innerHTML = entries.length ? `<div class="card-title">${icon('trophy')}<h3>Concepts practiced</h3><button id="reset-progress" class="link-btn" title="Clear practice history in this browser">Reset</button></div><div class="concept-chips">${entries.map(([concept, p]) => hasPractice(concept)
    ? `<button class="concept-chip" data-practice="${esc(concept)}" title="${p.answered} answered · ${p.firstTry} correct on the first try. Click to practice.">${esc(CONCEPTS[concept])}<b>${p.firstTry}/${p.answered}</b></button>`
    : `<span class="concept-chip" title="${p.answered} answered · ${p.firstTry} correct on the first try">${esc(CONCEPTS[concept])}<b>${p.firstTry}/${p.answered}</b></span>`).join('')}</div>` : '';
  icons();
}

function renderCoach() {
  const el = $('#coach-content');
  if (practice) { el.innerHTML = renderPracticeCard(); renderStages(); icons(); return; }
  const q = questions[questionIndex];
  const demo = demoFor(project.example);
  const mismatchCard = runVerdict();
  if (!q) {
    const brief = demo && demo.category !== 'tour' && !run
      ? `<div class="brief"><span class="chip ${({ runtime: 'danger', output: 'warning', hang: 'violet', compile: 'info', tour: 'accent' } as const)[demo.category]}">${esc(categoryLabel(demo.category))}</span><h3>${esc(project.name)}</h3><p>${esc(demo.summary)}</p><dl><dt>Symptom</dt><dd>${esc(demo.symptom)}</dd><dt>Look at</dt><dd><code>${esc(demo.snippet)}</code></dd></dl><p class="muted">Run the program. The Tutor will ask about what actually happened, then help you choose a fix.</p><button class="btn btn-primary btn-block" data-run>${icon('play')}Run program</button></div>`
      : mismatchCard && run && !running ? ''
      : `<div class="empty-coach">${icon('lightbulb')}<h3>${run ? (running ? 'Recording…' : 'No questions for this run') : 'Questions appear after you run'}</h3><p>${run ? 'TraceLab asks only about things it can confirm from the recorded run, such as exceptions, values that changed, references and return values. Step through the trace and compare it with your tests.' : 'Run your program and the Tutor will ask about what it actually did: predict a value, explain an error, then choose a fix and test it.'}</p>${!run ? `<button class="btn btn-secondary" data-action="gallery">${icon('layout-grid')}Try an example</button>` : ''}</div>`;
    const help = compileHelpCard();
    el.innerHTML = `${mismatchCard}${help || brief}${supportActions()}${renderHelpPanel()}`;
    renderStages(); icons();
    return;
  }
  const answer = questionAnswers[q.id];
  const correct = answer === q.correct;
  const label = { predict: 'Predict', explain: 'Explain', repair: 'Fix' }[q.kind];
  const editCta = correct && q.kind === 'repair' && q.focus ? `<button id="edit-focus" class="btn btn-secondary btn-block">${icon('wrench')}Edit ${esc(q.focus.file)}, line ${q.focus.line}</button>` : '';
  const inspect = q.step >= 0 || q.focus ? `<button id="go-question" class="link-btn">${icon('microscope')}${q.step >= 0 ? 'Show this moment' : 'Show the line'}${q.focus ? ` · line ${q.focus.line}` : ''}</button>` : '';
  el.innerHTML = `${mismatchCard}<article class="question-card ${q.kind}"><header class="question-top"><span class="question-type">${label}</span><span class="question-count">${questionIndex + 1} of ${questions.length}</span></header><h3>${esc(q.title)}</h3><p class="question-context">${rich(q.context)}</p>${inspect}<h4>${rich(q.prompt)}</h4><div class="answer-options" role="group" aria-label="Answers">${q.options.map((option, index) => `<button class="answer-option ${answer === index ? (correct ? 'correct' : 'incorrect') : ''}" data-answer="${index}" aria-pressed="${answer === index}"><span class="option-key">${String.fromCharCode(65 + index)}</span><span>${rich(option)}</span>${answer === index ? icon(correct ? 'circle-check' : 'circle-x') : ''}</button>`).join('')}</div>${answer !== undefined ? `<div class="answer-feedback ${correct ? 'correct' : ''}" role="status"><strong>${correct ? 'Correct — that matches the recorded run.' : 'Not quite.'}</strong><p>${correct ? rich(q.explanation) : 'Compare your answer with the recorded values. Try again, or reveal a hint.'}</p>${editCta}</div>` : ''}<footer class="question-footer"><button id="hint" class="link-btn" ${hintsShown >= q.hints.length ? 'disabled' : ''}>${icon('lightbulb')}${hintsShown < q.hints.length ? `Hint (${hintsShown + 1} of ${q.hints.length})` : 'No more hints'}</button>${questions.length > 1 ? `<button id="next-question" class="link-btn">${questionIndex === questions.length - 1 ? 'First question' : 'Next question'}${icon('arrow-right')}</button>` : ''}</footer>${q.hints.slice(0, hintsShown).map(h => `<div class="hint">${rich(h)}</div>`).join('')}${supportActions(q)}</article>${compileHelpCard()}${renderHelpPanel()}`;
  renderStages(); icons();
}

/** Tests the student owns: everything except tests that came with a template. */
const ownChecks = () => project.checks.filter(c => !isStarterCheck(c));
/** Test failures from the last Run tests, if those results still match the code. */
function failedChecks(): { result: (typeof checkResults)[number]; check: TestCase }[] {
  if (!checksFresh()) return [];
  return checkResults.filter(r => r.status === 'failed').map(r => ({ result: r, check: project.checks[r.index] })).filter(f => !!f.check);
}
/** Whether the last run, its tests or the Tutor show something actually wrong. */
function somethingWrong(): boolean {
  if (!run || running || dirtyTrace()) return false;
  const end = run.events.at(-1)?.stopReason;
  if (end && end !== 'completed' && end !== 'compiled') return true;
  const mismatch = failingCheck(run, project.checks);
  return (!!mismatch && !mismatch.starter) || failedChecks().some(f => !isStarterCheck(f.check)) || questions.some(q => q.kind === 'repair');
}

/**
 * The Tutor's verdict on a finished run, so it never implies a bug the run doesn't show: an output test that
 * fails, a starter test that may simply be out of date, or a clean run, with or without tests to back it up.
 */
function runVerdict(): string {
  if (!run || running || dirtyTrace() || run.events.at(-1)?.stopReason !== 'completed') return '';
  const mismatch = failingCheck(run, project.checks);
  const shown = (text: string) => `<code>${esc(JSON.stringify(text))}</code>`;
  if (mismatch && !mismatch.starter) {
    return `<div class="callout warning">${icon('target')}<div><strong>Output doesn’t match “${esc(mismatch.check.name)}”</strong><p>This run used that test’s input. The test expects ${shown(normalizeOutput(mismatch.check.expectedOutput))}; the program printed ${shown(mismatch.actual)}. ${esc(originNote(mismatch.check))}</p><div class="callout-actions"><button class="btn btn-ghost btn-compact" data-action="edit-tests">${icon('pencil')}Edit tests</button></div></div></div>`;
  }
  const starterFailures = [...(mismatch?.starter ? [mismatch.check] : []), ...failedChecks().map(f => f.check).filter(isStarterCheck)].filter((c, i, all) => all.indexOf(c) === i);
  const starterNote = starterFailures.length ? `<div class="callout info">${icon('info')}<div><strong>${starterFailures.length === 1 ? `The starter test “${esc(starterFailures[0].name)}” doesn’t match` : `${starterFailures.length} starter tests don’t match`}</strong><p>${esc(originNote(starterFailures[0]))}${mismatch?.starter ? ` It expects ${shown(normalizeOutput(mismatch.check.expectedOutput))}; your program printed ${shown(mismatch.actual)}.` : ''}</p><div class="callout-actions"><button class="btn btn-ghost btn-compact" data-remove-starters>${icon('trash-2')}Remove ${starterFailures.length === 1 ? 'it' : 'them'}</button><button class="btn btn-ghost btn-compact" data-action="edit-tests">${icon('pencil')}Edit tests</button></div></div></div>` : '';
  const own = ownChecks();
  const failed = failedChecks().filter(f => !isStarterCheck(f.check));
  const printed = normalizeOutput(output(run, 'stdout'));
  const what = printed ? ` and printed ${printed.split('\n').length === 1 ? `${shown(printed.length > 60 ? `${printed.slice(0, 57)}…` : printed)}` : `${printed.split('\n').length} lines`}` : '';
  const neutral = questions.length ? '<p class="muted">The questions below are about how the program works. They don’t mean something is wrong.</p>' : '';
  if (failed.length) return `${starterNote}<div class="callout warning">${icon('circle-x')}<div><strong>${failed.length} of ${checkResults.length} tests fail</strong><p>The program itself ran without errors. See the Tests card below for what each failing test expected, and use Debug this test to record it. ${esc(originNote(failed[0].check))}</p></div></div>`;
  if (!own.length) return `${starterNote}<div class="callout subtle verdict">${icon('circle-check')}<div><strong>No errors in this run</strong><p>The program finished${what}. ${starterFailures.length ? 'No other tests' : 'No tests'} say what it should print or return, so TraceLab can’t tell whether the result is what you intended: that part is up to you, or to a test.</p><div class="callout-actions">${renderSaveOffer() ? `<button class="btn btn-secondary btn-compact" data-save-run-test>${icon('save')}Save this output as a test</button>` : ''}<button class="btn btn-ghost btn-compact" data-action="generate-tests">${icon('wand-sparkles')}Generate tests</button><button class="btn btn-ghost btn-compact" data-action="add-test">${icon('list-plus')}Write a test</button></div>${neutral}</div></div>`;
  if (allChecksPassed()) return `${starterNote}<div class="callout success verdict">${icon('circle-check')}<div><strong>No problems found</strong><p>The program finished without errors, and all ${checkResults.length} test${checkResults.length === 1 ? '' : 's'} pass. Tests check the cases they describe, not every possible input.</p>${neutral}</div></div>`;
  return `${starterNote}<div class="callout subtle verdict">${icon('circle-check')}<div><strong>No errors in this run</strong><p>The program finished${what}. Run the tests to check it against what it should do.</p><div class="callout-actions"><button class="btn btn-secondary btn-compact" data-action="run-tests">${icon('play')}Run tests</button></div>${neutral}</div></div>`;
}

// ---------- Need help and practice ----------

let helpOpen = false;
/** The concept to practice for a question, or for what the run did when there is no question. */
function practiceConcept(q?: Question): string | null {
  if (q && (hasPractice(q.concept) || assist.configured)) return q.concept;
  if (!run) return null;
  const thrown = currentStates().find(e => e.exception && !e.exception.caught)?.exception?.type ?? '';
  const byType: [RegExp, string][] = [[/ArrayIndexOutOfBounds/, 'array-bounds'], [/StringIndexOutOfBounds/, 'string-bounds'], [/NullPointer/, 'null-reference'], [/Arithmetic/, 'division-by-zero'], [/NumberFormat|InputMismatch/, 'parsing-input'], [/ConcurrentModification/, 'concurrent-modification'], [/IndexOutOfBounds/, 'array-bounds']];
  const reason = run.events.at(-1)?.stopReason;
  const known = byType.find(([re]) => re.test(thrown))?.[1] ?? (reason === 'step-limit' ? 'loop-termination' : reason === 'compile-error' ? 'compile-errors' : null);
  // Other exceptions have no built-in problems; the assistant can write one.
  return known ?? (thrown && assist.configured ? `exception:${thrown.split('.').at(-1)}` : null);
}
const conceptLabel = (concept: string) => CONCEPTS[concept] ?? (concept.startsWith('exception:') ? `${concept.slice(10)}: when Java throws it` : concept);
/** Need help, Practice and Ask, under a question or after a run that went wrong. */
function supportActions(q?: Question): string {
  if (!run || running) return '';
  const end = run.events.at(-1)?.stopReason;
  // Need help explains a failure, so it appears only when the run, a test or a repair question shows one.
  const wentWrong = somethingWrong();
  const concept = practiceConcept(q);
  if (!wentWrong && !concept) return '';
  return `<div class="support-actions">${wentWrong && end !== 'compile-error' ? `<button class="btn btn-ghost btn-compact" id="need-help" aria-expanded="${helpOpen}">${icon('circle-help')}${helpOpen ? 'Hide help' : 'Need help?'}</button>` : ''}${concept ? `<button class="btn btn-ghost btn-compact" data-practice="${esc(concept)}" title="A similar problem, checked by running it on the JVM">${icon('dumbbell')}Practice this</button>` : ''}</div>`;
}

function renderHelpPanel(): string {
  if (!helpOpen || !run || running || dirtyTrace()) return '';
  const view = buildHelp(run, { question: questions[questionIndex], step, checks: project.checks });
  const visual = (v: HelpVisual): string => {
    if (v.kind === 'table') return `<figure class="help-figure"><figcaption><strong>${esc(v.title)}</strong><span>${esc(v.caption)}</span></figcaption><div class="help-scroll"><table class="help-table"><thead><tr>${v.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${v.rows.map(r => `<tr class="${r.mark ?? ''}" data-goto-step="${r.step}" tabindex="0" title="Go to step ${r.step + 1}">${r.cells.map((c, i) => `<td class="${r.changed[i] ? 'changed' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${v.hidden ? `<p class="help-more">${v.hidden} earlier or later rows not shown.</p>` : ''}</figure>`;
    if (v.kind === 'calls') return `<figure class="help-figure"><figcaption><strong>${esc(v.title)}</strong><span>${esc(v.caption)}</span></figcaption><ol class="help-calls">${v.calls.map(c => `<li style="--depth:${c.depth}" class="${c.failed ? 'failed' : ''}"><button class="link-btn" data-goto-step="${c.step}">${esc(c.label)}</button><span>${esc(c.result)}</span></li>`).join('')}</ol>${v.hidden ? `<p class="help-more">${v.hidden} more calls not shown.</p>` : ''}</figure>`;
    if (v.kind === 'cells') return `<figure class="help-figure"><figcaption><strong>${esc(v.title)}</strong><span>${esc(v.caption)}</span></figcaption><div class="help-cells">${v.cells.map(c => `<span class="help-cell ${c.reads ? 'read' : ''} ${c.outside ? 'outside' : ''}" title="${c.outside ? 'Outside the valid range' : `Index ${c.index}`}${c.reads ? `, read ${c.reads} time${c.reads === 1 ? '' : 's'}` : ''}"><small>${c.index}</small><b>${esc(c.outside ? '✕' : c.value)}</b>${c.reads ? `<em>×${c.reads}</em>` : ''}</span>`).join('')}</div></figure>`;
    return `<figure class="help-figure"><figcaption><strong>${esc(v.title)}</strong><span>${esc(v.caption)}</span></figcaption><div class="help-scroll"><table class="help-table diff"><thead><tr><th>#</th><th>Expected</th><th>Printed</th></tr></thead><tbody>${v.lines.map((l, i) => `<tr class="${l.same ? '' : 'error'}"><td>${i + 1}</td><td>${esc(l.expected ?? '(nothing)')}</td><td>${esc(l.actual ?? '(nothing)')}</td></tr>`).join('')}</tbody></table></div></figure>`;
  };
  return `<section class="help-panel" aria-label="Help"><div class="card-title">${icon('circle-help')}<h3>${esc(view.title)}</h3><button class="link-btn" id="close-help">Close</button></div>
    <ol class="help-story">${view.story.map(s => `<li>${esc(s)}</li>`).join('')}</ol>${view.visuals.map(visual).join('')}
    ${view.tips.length ? `<h4 class="help-subhead">Things to check</h4><ul class="help-tips">${view.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <p class="help-note">${icon('shield-check')}Everything here comes from the recorded run, not from a guess.</p>
    <button class="btn btn-secondary btn-compact" data-ask="${esc('Explain step by step why this happened, using the recorded values. Then tell me what to check, without giving me the full fix.')}">${icon('messages-square')}Still stuck? Ask the assistant</button></section>`;
}

type PracticeState = { concept: string; seed: number; source: 'generator' | 'ai'; status: 'loading' | 'ready' | 'error'; item?: PracticeItem; html?: string; options: string[]; correct: number; answer?: number; attempts: number; recorded: boolean; error?: string };
let practice: PracticeState | null = null;
const runPractice = (code: string) => quietRun({ files: [{ name: 'Main.java', content: code }], mainClass: 'Main', stdin: '', maxSteps: 100, timeoutMs: 3000, mode: 'run' });

/** One completion from the assistant, without streaming it into the chat. */
async function aiComplete(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const { id } = await api<{ id: string }>('/assist/chat', { method: 'POST', body: JSON.stringify({ messages, maxTokens }) });
  for (let i = 0; i < 480; i++) {
    await new Promise(r => setTimeout(r, 250));
    const page = await api<{ status: string; text: string; error: string }>(`/assist/chat/${id}`);
    if (page.status === 'done') return page.text;
    if (page.status !== 'running') throw new Error(page.error || 'The assistant failed.');
  }
  await api(`/assist/chat/${id}`, { method: 'DELETE' }).catch(() => {});
  throw new Error('The assistant took too long.');
}
/**
 * A problem written by the assistant. The model's answer is never used: the program is checked against an
 * allowlist of APIs, run on the JVM, and the options are built around what Java actually printed.
 */
async function aiPractice(concept: string, seed: number) {
  let problem: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await aiComplete(aiPracticeMessages(concept, conceptLabel(concept), seed + attempt, problem) as ChatMessage[], 2048);
    const item = parseAiPractice(reply, concept);
    if (typeof item === 'string') { problem = item; continue; }
    const outcome = practiceOutcome(await runPractice(item.code));
    if (outcome.kind === 'other') { problem = outcome.reason === 'timeout' ? 'It didn’t finish within 3 seconds.' : `It stopped early (${outcome.reason}).`; continue; }
    if (outcome.kind === 'compile-error' && !['compile-errors', 'types'].includes(concept)) { problem = `javac rejected it at line ${outcome.line}: ${outcome.message}`; continue; }
    const { options, correct } = practiceOptions(item, outcome, seed);
    if (options.length < 3) { problem = 'Its wrong answers were the same as the real output.'; continue; }
    return { item, options, correct };
  }
  throw new Error(`The assistant couldn’t write a problem that runs (${problem ?? 'no reply'}). Try again.`);
}
async function startPractice(concept: string, useAi = false) {
  if (running || checking || genTask) { toast('Wait for the current run to finish, then try again.'); return; }
  if (!runnerOnline) { toast('The Java runner isn’t connected. Start it with npm start, then try again.', 'error'); return; }
  const source = useAi || !hasPractice(concept) ? 'ai' : 'generator';
  if (source === 'ai' && !assist.configured) { assistantSetupDialog(); return; }
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  practice = { concept, seed, source, status: 'loading', options: [], correct: -1, attempts: 0, recorded: false };
  if (!layout.coach) setLayout({ coach: true });
  renderCoach();
  const task = (async () => {
    await settleFixChecks();
    if (source === 'ai') { const made = await aiPractice(concept, seed); return { ...made, html: await monaco.editor.colorize(made.item.code, 'java', { tabSize: 4 }) }; }
    // The answer is whatever the JVM does with the program; a problem that doesn't finish is replaced.
    for (let attempt = 0; attempt < 4; attempt++) {
      const item = practiceFor(concept, seed + attempt * 7919);
      const outcome = practiceOutcome(await runPractice(item.code));
      if (outcome.kind === 'other') continue;
      const { options, correct } = practiceOptions(item, outcome, seed + attempt);
      return { item, options, correct, html: await monaco.editor.colorize(item.code, 'java', { tabSize: 4 }) };
    }
    throw new Error('Couldn’t make a practice problem that finishes. Try again.');
  })();
  genTask = task;
  try {
    const ready = await task;
    if (practice?.seed !== seed) return;
    practice = { ...practice, ...ready, status: 'ready' };
  } catch (error) {
    if (practice?.seed === seed) practice = { ...practice, status: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally { genTask = null; }
  renderCoach();
}
function answerPractice(index: number) {
  if (!practice || practice.status !== 'ready' || practice.answer === practice.correct) return;
  practice.answer = index; practice.attempts++;
  if (index === practice.correct && !practice.recorded) { practice.recorded = true; if (practice.concept in CONCEPTS) { progress = recordSolved(progress, practice.concept, practice.attempts === 1); renderProgress(); } }
  renderCoach();
}
// ---------- AI assistant (optional) ----------

let assist: AssistStatus = { configured: false };
type ChatTurn = ChatMessage & { error?: boolean; pending?: boolean };
const chat: { turns: ChatTurn[]; busy: boolean; jobId: string | null } = { turns: [], busy: false, jobId: null };
async function loadAssistStatus() { try { assist = await api<AssistStatus>('/assist/config'); } catch { assist = { configured: false }; } renderAssistant(); }
const assistHost = () => { try { return new URL(assist.url ?? '').host; } catch { return assist.url ?? ''; } };
function assistContext(): string {
  const q = questions[questionIndex];
  const problems = [...problemList().runDiagnostics.map(d => ({ file: d.file ?? '', line: d.line ?? 0, message: d.message ?? '' })), ...problemList().live.map(x => ({ file: x.file, line: x.d.range.start.line + 1, message: x.d.message }))];
  return contextMessage({ project, activeFile, run, step, dirty: dirtyTrace(), question: q, questionSolved: !!q && solvedQuestions.has(q.id), tests: checkResults.map(r => ({ name: r.name, status: r.status, detail: r.detail })), problems });
}
function quickPrompts(): [string, string][] {
  const end = run?.events.at(-1)?.stopReason;
  const prompts: [string, string][] = [];
  if (end === 'compile-error') prompts.push(['Explain this compile error', 'Explain the first compile error in plain words and what I should change. Don’t rewrite the whole program.']);
  else if (end === 'exception' || end === 'step-limit' || end === 'timeout') prompts.push(['Why did this happen?', 'Explain step by step why this happened, using the recorded values. Then tell me what to check, without giving me the full fix.']);
  prompts.push(['Give me a hint', 'Give me one small hint for what to look at next. Don’t give the answer.']);
  prompts.push(['Explain the current line', `Explain what line ${currentSnapshot()?.location?.line ?? editor.getPosition()?.lineNumber ?? 1} of ${currentSnapshot()?.location?.file ?? activeFile} does, with the values it has at this step.`]);
  if (run && end === 'completed') prompts.push(['Is the output right?', 'Walk me through how the program produced its output, and point out anything that looks unintended.']);
  return prompts;
}
function renderAssistant() {
  const section = $('#assistant');
  $('#toggle-assist').setAttribute('aria-expanded', String(!section.hidden));
  $('#assist-model').textContent = assist.configured ? `${assist.model} · ${assist.local ? 'on this computer' : assistHost()}` : '';
  $('#assist-log').innerHTML = chat.turns.length ? chat.turns.map(t => t.role === 'user'
    ? `<div class="assist-turn user"><p>${esc(t.content)}</p></div>`
    : `<div class="assist-turn assistant ${t.error ? 'error' : ''}"><span class="assist-label">${icon(t.error ? 'triangle-alert' : 'sparkles')}${t.error ? 'Assistant error' : 'AI answer · may be wrong'}</span>${t.error ? `<p>${esc(t.content)}</p>` : renderMarkdown(t.content) || (t.pending ? `<p class="muted">${icon('loader-circle', 'spin')}Thinking…</p>` : '')}</div>`).join('')
    : `<p class="assist-empty">Ask about this program: why a value changed, what an error means, or what to try next. The assistant sees your code, the recorded run and the current step.</p>`;
  $('#assist-quick').innerHTML = chat.busy ? '' : quickPrompts().map(([label, prompt]) => `<button type="button" class="chip-btn" data-assist-prompt="${esc(prompt)}">${esc(label)}</button>`).join('');
  $<HTMLButtonElement>('#assist-send').disabled = chat.busy;
  $('#assist-stop').hidden = !chat.busy;
  $('#assist-note').innerHTML = assist.local ? `${icon('shield-check')}Runs on this computer; your code isn’t sent anywhere.` : `${icon('info')}Your code and run details are sent to ${esc(assistHost())}. Values in the recording are real; explanations can be wrong.`;
  const log = $('#assist-log'); log.scrollTop = log.scrollHeight;
  icons();
}
/** Opens the assistant, or its setup when it isn't configured, and optionally asks a question right away. */
function openAssistant(prompt?: string) {
  if (!assist.configured) { assistantSetupDialog(prompt); return; }
  if (!layout.coach) setLayout({ coach: true });
  $('#assistant').hidden = false;
  renderAssistant();
  $('#assistant').scrollIntoView({ block: 'nearest' });
  if (prompt) askAssistant(prompt); else $<HTMLTextAreaElement>('#assist-input').focus();
}
async function askAssistant(text: string) {
  if (chat.busy || !text.trim()) return;
  const history = chat.turns.filter(t => !t.error && !t.pending).map(({ role, content }) => ({ role, content }));
  chat.turns.push({ role: 'user', content: text.trim() });
  const answer: ChatTurn = { role: 'assistant', content: '', pending: true };
  chat.turns.push(answer);
  chat.busy = true; renderAssistant();
  try {
    const { id } = await api<{ id: string }>('/assist/chat', { method: 'POST', body: JSON.stringify({ messages: buildMessages(assistContext(), history, text.trim()) }) });
    chat.jobId = id;
    for (;;) {
      await new Promise(r => setTimeout(r, 200));
      const page = await api<{ status: string; text: string; error: string }>(`/assist/chat/${id}`);
      answer.content = page.text;
      if (page.status !== 'running') {
        if (page.status === 'error') { answer.error = true; answer.content = page.error || 'The assistant failed.'; }
        break;
      }
      renderAssistant();
    }
  } catch (error) { answer.error = true; answer.content = error instanceof Error ? error.message : String(error); }
  finally { answer.pending = false; chat.busy = false; chat.jobId = null; renderAssistant(); }
}
function assistantSetupDialog(then?: string) {
  const current = PROVIDERS.find(p => p.id === assist.provider) ?? PROVIDERS[0];
  const radios = PROVIDERS.map(p => `<label class="template-card"><input type="radio" name="assist-provider" value="${p.id}" ${p.id === current.id ? 'checked' : ''} /><span><strong>${esc(p.name)}</strong><small>${esc(p.note)}</small></span></label>`).join('');
  openDialog('Set up the AI assistant', `<p class="dialog-note">The assistant is optional: everything else in TraceLab works without it. It answers questions about your program using the code and the recorded run. TraceLab can’t provide a model itself, so choose one below. Free options: Ollama runs models on this computer; Google Gemini and others have free tiers that need an API key.</p>
    <fieldset class="template-grid assist-providers"><legend>Where the model runs</legend>${radios}</fieldset>
    <label class="dialog-label">Server address<input id="assist-url" value="${esc(assist.url ?? current.url)}" spellcheck="false" autocomplete="off" /><small>OpenAI-compatible base URL, ending before /chat/completions.</small></label>
    <label class="dialog-label">Model<input id="assist-model-input" list="assist-models" value="${esc(assist.model ?? current.model)}" spellcheck="false" autocomplete="off" /><datalist id="assist-models"></datalist></label>
    <label class="dialog-label">API key<input id="assist-key" type="password" value="" autocomplete="off" placeholder="${assist.hasKey ? 'Saved. Leave empty to keep it.' : 'Not needed for Ollama'}" /><small>Stored on this computer in .local/ai.json, and never sent back to the browser.</small></label>
    <div class="assist-setup-actions"><button type="button" class="btn btn-secondary btn-compact" id="assist-list">${icon('list-checks')}List models</button><button type="button" class="btn btn-secondary btn-compact" id="assist-test">${icon('play')}Test</button>${assist.configured ? `<button type="button" class="btn btn-ghost btn-compact" id="assist-off">${icon('x')}Turn off</button>` : ''}<span id="assist-setup-status" class="assist-setup-status" role="status"></span></div>`, () => {
    // Saving is async; the dialog closes after it succeeds.
    throw new Error('__save__');
  }, 'Save', { wide: true });
  const body = $('#dialog-body');
  const status = (html: string) => { $('#assist-setup-status').innerHTML = html; icons(); };
  const values = () => ({ provider: document.querySelector<HTMLInputElement>('input[name="assist-provider"]:checked')?.value ?? 'custom', url: $<HTMLInputElement>('#assist-url').value.trim(), model: $<HTMLInputElement>('#assist-model-input').value.trim(), key: $<HTMLInputElement>('#assist-key').value || undefined });
  const saveConfig = async () => { assist = await api<AssistStatus>('/assist/config', { method: 'POST', body: JSON.stringify(values()) }); renderAssistant(); };
  body.addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'assist-provider') return;
    const preset = PROVIDERS.find(p => p.id === input.value)!;
    if (preset.url) $<HTMLInputElement>('#assist-url').value = preset.url;
    $<HTMLInputElement>('#assist-model-input').value = preset.model;
  });
  body.addEventListener('click', async e => {
    const button = (e.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    try {
      if (button.id === 'assist-list') {
        status(`${icon('loader-circle', 'spin')}Asking the server…`);
        await saveConfig();
        const { models } = await api<{ models: string[] }>('/assist/models', { method: 'POST', body: '{}' });
        $('#assist-models').innerHTML = models.map(m => `<option value="${esc(m)}"></option>`).join('');
        status(models.length ? `${icon('circle-check')}${models.length} model${models.length === 1 ? '' : 's'} available. Pick one in the Model field.` : `${icon('triangle-alert')}The server lists no models.${values().provider === 'ollama' ? ' Run ollama pull qwen2.5-coder:7b first.' : ''}`);
      } else if (button.id === 'assist-test') {
        status(`${icon('loader-circle', 'spin')}Sending a test message…`);
        await saveConfig();
        const { id } = await api<{ id: string }>('/assist/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 64 }) });
        let page = { status: 'running', text: '', error: '' };
        for (let i = 0; i < 300 && page.status === 'running'; i++) { await new Promise(r => setTimeout(r, 200)); page = await api(`/assist/chat/${id}`); }
        status(page.status === 'done' ? `${icon('circle-check')}It works. The model answered: “${esc(page.text.slice(0, 60))}”` : `${icon('circle-x')}${esc(page.error || 'No answer.')}`);
      } else if (button.id === 'assist-off') {
        assist = await api<AssistStatus>('/assist/config', { method: 'DELETE' });
        renderAssistant(); $('#assistant').hidden = true; $<HTMLDialogElement>('#dialog').close(); toast('The assistant is off. Its settings were removed.');
      }
    } catch (error) { status(`${icon('circle-x')}${esc(error instanceof Error ? error.message : String(error))}`); }
  });
  // Replace the synchronous submit with an async save.
  $<HTMLFormElement>('#dialog-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await saveConfig();
      $<HTMLDialogElement>('#dialog').close();
      toast(`Assistant ready: ${assist.model}${assist.local ? ' on this computer' : ` via ${assistHost()}`}.`, 'success');
      openAssistant(then);
    } catch (error) { $('#dialog-error').textContent = error instanceof Error ? error.message : String(error); }
  };
}

function renderPracticeCard(): string {
  const p = practice!;
  const label = conceptLabel(p.concept);
  const ai = p.source === 'ai';
  const head = `<header class="question-top"><span class="question-type practice">Practice</span><button class="link-btn" id="practice-close">${icon('arrow-left')}Back</button></header>`;
  const source = ai ? `<p class="practice-source">${icon('sparkles')}Written by AI · answer checked on the JVM</p>` : '';
  const again = (text: string) => `<button class="${text ? 'link-btn' : 'btn btn-secondary'}" data-practice="${esc(p.concept)}" ${ai ? `data-practice-ai="1"` : ''}>${icon('rotate-ccw')}${text || 'Try again'}</button>`;
  if (p.status === 'loading') return `<article class="question-card practice-card">${head}<p class="gen-progress">${icon('loader-circle', 'spin')}<span>${ai ? `Asking the assistant for a ${esc(label.toLowerCase())} problem, then running it on the JVM to find the real answer…` : `Writing a ${esc(label.toLowerCase())} problem and running it on the JVM…`}</span></p></article>`;
  if (p.status === 'error') return `<article class="question-card practice-card">${head}<div class="callout warning">${icon('triangle-alert')}<span>${esc(p.error)}</span></div>${again('')}</article>`;
  const item = p.item!;
  const solved = p.answer === p.correct;
  const revealed = solved || p.attempts >= 2;
  const option = (text: string) => text.includes('\n') ? `<code class="multi">${esc(text)}</code>` : /^It /.test(text) ? esc(text) : `<code>${esc(text)}</code>`;
  return `<article class="question-card practice-card"><span class="sr-only" aria-live="polite">${solved ? 'Correct' : ''}</span>${head}<h3>${esc(item.title)} <small class="muted">· ${esc(label)}</small></h3>${source}
    <pre class="practice-code">${p.html}</pre><h4>${esc(item.prompt)}</h4>
    <div class="answer-options" role="group" aria-label="Answers">${p.options.map((o, i) => {
      const state = p.answer === i ? (i === p.correct ? 'correct' : 'incorrect') : revealed && i === p.correct ? 'correct' : '';
      return `<button class="answer-option ${state}" data-practice-answer="${i}" aria-pressed="${p.answer === i}"><span class="option-key">${String.fromCharCode(65 + i)}</span><span>${option(o)}</span>${state ? icon(state === 'correct' ? 'circle-check' : 'circle-x') : ''}</button>`;
    }).join('')}</div>
    ${p.answer !== undefined ? `<div class="answer-feedback ${solved ? 'correct' : ''}" role="status"><strong>${solved ? 'Correct.' : revealed ? 'Here’s what Java did.' : 'Not quite. Try again.'}</strong><p>${esc(item.why)}</p><p class="muted">${icon('shield-check')}The answer comes from running this program on the JVM.</p></div>` : ''}
    ${revealed ? `<button class="link-btn" data-ask="${esc(`This practice program's real result (from running it) is ${JSON.stringify(p.options[p.correct])}. Explain why, step by step:\n\n\`\`\`java\n${item.code}\`\`\``)}">${icon('messages-square')}Ask the assistant why</button>` : ''}
    <footer class="question-footer">${again('Another one')}${!ai && assist.configured ? `<button class="link-btn" data-practice="${esc(p.concept)}" data-practice-ai="1" title="The assistant writes the program; TraceLab runs it to get the real answer">${icon('sparkles')}Ask AI for a different one</button>` : ''}${ai && hasPractice(p.concept) ? `<button class="link-btn" data-practice="${esc(p.concept)}">${icon('dumbbell')}A built-in one</button>` : ''}<button class="link-btn" id="practice-open">${icon('external-link')}Open as a project to trace it</button></footer></article>`;
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
  const tag = (index: number) => {
    const check = project.checks[index];
    if (!check) return '';
    const [label, title] = isStarterCheck(check) ? ['starter', 'Came with the project template'] : check.origin === 'generated' ? ['generated', 'Recorded what the code returned when the test was generated'] : check.origin === 'ai' ? ['AI', 'Expected value suggested by the AI assistant'] : ['', ''];
    return label ? `<span class="test-origin" title="${esc(title)}">${label}</span>` : '';
  };
  // A failing test that the student didn't write says who might be wrong: the code, or the test.
  const note = (r: (typeof checkResults)[number]) => {
    const check = project.checks[r.index];
    return r.status === 'failed' && check && (check.origin || isStarterCheck(check)) ? `<small class="test-origin-note">${esc(originNote(check))}</small>` : '';
  };
  $('#check-results').innerHTML = `${stale ? '<div class="callout subtle">The code or tests changed since these results. Run the tests again.</div>' : ''}${checkResults.map(r => `<div class="check-result ${r.status}">${icon(r.status === 'passed' ? 'circle-check' : r.status === 'failed' ? 'circle-x' : 'loader-circle', r.status === 'running' ? 'spin' : '')}<div><span>${esc(r.name)}${tag(r.index)}</span>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}${note(r)}${r.status === 'failed' && !stale && !running && !checking ? `<button class="link-btn trace-case" data-trace-check="${r.index}">${icon('microscope')}Debug this test</button>` : ''}</div></div>`).join('')}${allChecksPassed() ? `<div class="callout success">${icon('circle-check')}<span>All ${checkResults.length} tests pass.</span></div>` : ''}`;
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
  const fixBlock = !issue.fixes.length ? `<p class="fix-none">No automatic fix for this one; the explanation describes what to change. <button class="link-btn" data-ask="${esc(`Help me understand this compile error at ${issue.file} line ${issue.line}: ${issue.message.split('\n')[0]}. What should I change? Don't rewrite the whole program.`)}">Ask the assistant</button></p>`
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
      if (page.status === 'finished') return expandEvents(page.events);
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
function requestFor(stdin = project.stdin): RunRequest { return { files: structuredClone(project.files), mainClass: project.mainClass, stdin, maxSteps: project.maxSteps, timeoutMs: 15000 }; }
/** The request for Run: like requestFor, plus the recording start point if one is set. */
function traceRequest(): RunRequest {
  const start = usableStart(project.startAt, project.files);
  return start ? { ...requestFor(), startAt: { file: start.file, line: start.line, condition: start.condition ?? '', hit: start.hit ?? 1 } } : requestFor();
}
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
    events.push(...expandEvents(page.events));
    const value: Run = { id: page.id, status: page.status, request: page.request, events };
    onUpdate?.(value);
    if (page.status === 'finished' && events.length >= page.total) { currentRunId = null; return value; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await api(`/runs/${created.id}`, { method: 'DELETE' }).catch(() => {});
  throw new Error('The runner did not finish in time, so the run was stopped.');
}

function resetQuestions() { questions = []; questionIndex = 0; questionAnswers = {}; questionAttempts = {}; solvedQuestions = new Set(); hintsShown = 0; helpOpen = false; practice = null; }

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
    run = await collect(override ?? traceRequest(), value => {
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
function renderSaveOffer(): boolean {
  return !!run && run.status === 'finished' && run.events.at(-1)?.stopReason === 'completed' && !dirtyTrace()
    && !run.request.files.some(f => f.name.endsWith('TraceLabCall__.java'))
    && !project.checks.some(c => !isCallTest(c) && !isStarterCheck(c) && normalizeOutput(c.stdin) === normalizeOutput(run!.request.stdin));
}
function renderSaveRunTest() { $('#save-run-test').hidden = !renderSaveOffer(); }
/** Removes the template's tests that fail (or all of them, after confirmation elsewhere). */
function removeStarterTests() {
  const failing = new Set([...failedChecks().map(f => f.check), ...(run ? [failingCheck(run, project.checks)?.check] : [])].filter((c): c is TestCase => !!c && isStarterCheck(c)));
  if (!failing.size) return;
  project.checks = project.checks.filter(c => !failing.has(c));
  checkResults = []; save(); renderFiles(); renderConsole(); renderCheckResults(); renderCoach(); renderSaveRunTest(); setBusy();
  toast(`Removed ${failing.size === 1 ? 'the starter test' : `${failing.size} starter tests`}. Add your own with Add test or Generate tests.`, 'success');
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
  expandedView = null; collapsedViews.clear();
  save(); selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); renderSaveRunTest(); setBusy(); renderStartChip();
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
/** What Reset goes back to: the example's original, or the project as it was created (null if unknown). */
let originalCache: { key: string; value: Project | null } | null = null;
function startingPoint(): Project | null {
  const key = `${doc.kind}:${doc.id}`;
  if (originalCache?.key !== key) originalCache = { key, value: doc.kind === 'example' ? examples[exampleIndex(doc.id)] ?? null : library.original(doc.id) };
  return originalCache.value;
}
const codeKey = (p: Project) => JSON.stringify([p.files, p.mainClass, p.stdin, p.checks, p.maxSteps, p.startAt ?? null]);
/** Whether the open document differs from its starting point. */
function canReset(): boolean { const start = startingPoint(); return !!start && codeKey(start) !== codeKey(project); }
async function resetDoc() {
  if (running || checking) { toast('Stop the current run before resetting.'); return; }
  if (doc.kind === 'example') { await resetExample(doc.id); return; }
  if (!startingPoint()) { toast('This project was created before Reset was available, so there is no starting version to go back to.', 'error'); return; }
  if (!(await confirmDialog(`Reset “${project.name}”?`, 'The code, input and tests go back to how they were when you created this project. Your changes are discarded. Export the project first if you might want them.', 'Reset project', true))) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
  const reset = library.resetProject(doc.id);
  if (!reset) { toast('Couldn’t reset this project.', 'error'); return; }
  showDoc(doc, reset);
  toast(`“${project.name}” is back to its starting code. Ctrl+Z won’t undo this.`);
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
    const marks = breakpoints.get(oldName); breakpoints.delete(oldName); if (marks) breakpoints.set(name, marks); if (project.startAt?.file === oldName) project.startAt.file = name;
    save(); selectFile(name, false);
  }, 'Rename');
  setTimeout(() => { const input = $<HTMLInputElement>('#rename-name'); input.focus(); input.setSelectionRange(input.value.lastIndexOf('/') + 1, input.value.lastIndexOf('.java')); });
}

async function deleteFile(name: string) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  if (project.files.length === 1) { toast('A project needs at least one Java file.'); return; }
  if (!(await confirmDialog(`Delete ${name}?`, 'The file is removed from this project. This cannot be undone unless you exported the project.', 'Delete', true))) return;
  project.files = project.files.filter(f => f.name !== name);
  if (project.startAt?.file === name) { delete project.startAt; renderStartChip(); }
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
  openDialog('Project settings', `<label class="dialog-label">Project name<input id="setting-name" value="${esc(project.name)}" maxlength="120" /></label><label class="dialog-label">Main class<select id="setting-main">${options.map(m => `<option value="${esc(m)}" ${m === project.mainClass ? 'selected' : ''}>${esc(m)}${mains.includes(m) ? '' : ' (no main method found)'}</option>`).join('')}</select><small>${mains.length ? `Run starts in this class’s <code>main</code> method. ${mains.length} class${mains.length === 1 ? ' has' : 'es have'} one.` : 'No class has a <code>public static void main(String[] args)</code> method yet.'}</small></label><label class="dialog-label">Step limit<input id="setting-steps" type="number" min="10" max="2000" value="${project.maxSteps}" /><small>Recording stops after this many line steps (10–2,000). The steps recorded so far stay available.</small></label><div class="dialog-label">Recording start<span class="dialog-inline">${project.startAt ? `From ${esc(describeStart(project.startAt))}` : 'From the start of main'}<button type="button" class="btn btn-secondary btn-compact" data-action="start-at">${icon('flag-triangle-right')}Change…</button></span><small>To record a long program from the interesting part, start recording at a line, optionally when a condition is true. You can also right-click a line in the editor.</small></div><p class="dialog-note">Runs use Java 21 with a 15-second time limit. Each step captures up to 48 frames, 160 objects and 64 elements per array or collection.</p>`, () => {
    const mainClass = $<HTMLSelectElement>('#setting-main').value;
    const maxSteps = Number($<HTMLInputElement>('#setting-steps').value);
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(mainClass)) throw new Error('Choose a main class.');
    if (!Number.isInteger(maxSteps) || maxSteps < 10 || maxSteps > 2000) throw new Error('Choose a step limit from 10 to 2,000.');
    project.mainClass = mainClass; project.maxSteps = maxSteps; project.name = $<HTMLInputElement>('#setting-name').value.trim() || 'Untitled project';
    save(); renderFiles(); renderSourceBanner(); renderCheckResults();
  });
}

// ---------- Recording start point ----------

function setStartAt(start: NonNullable<Project['startAt']>) {
  project.startAt = { file: start.file, line: start.line, ...(start.condition ? { condition: start.condition } : {}), ...(start.hit && start.hit > 1 ? { hit: start.hit } : {}) };
  save(); updateDecorations(); renderStartChip();
  toast(`The next run records from ${describeStart(project.startAt)}. Earlier lines run without being recorded.`, 'success');
}
function clearStartAt() {
  if (!project.startAt) { toast('Runs already record from the start of main.'); return; }
  delete project.startAt;
  save(); updateDecorations(); renderStartChip();
  toast('Runs record from the start of main again.');
}
function renderStartChip() {
  const chip = $('#start-chip');
  const start = usableStart(project.startAt, project.files);
  chip.hidden = !start;
  chip.innerHTML = start ? `<button type="button" class="start-chip-main" data-action="start-at" title="Recording starts at ${esc(describeStart(start))}. Click to change it.">${icon('flag-triangle-right')}<span>From ${esc(start.file.split('/').at(-1))}:${start.line}${start.condition ? ` when ${esc(clipLabel(start.condition, 24))}` : ''}${(start.hit ?? 1) > 1 ? ` · #${start.hit}` : ''}</span></button><button type="button" class="start-chip-clear" data-action="clear-start" title="Record from the start of main" aria-label="Remove the start point">${icon('x')}</button>` : '';
  icons();
}
function startAtDialog(file = project.startAt?.file ?? activeFile, line = project.startAt?.file === file && project.startAt ? project.startAt.line : editor.getPosition()?.lineNumber ?? 1) {
  const current = project.startAt?.file === file && project.startAt.line === line ? project.startAt : undefined;
  openDialog('Start recording at a line', `<p class="dialog-note">A long program can use up the step budget before it reaches the part you care about. With a start point, the program runs normally until this line is about to run, and recording starts there. Variables and objects that exist at that moment are all shown.</p>
    <div class="dialog-row"><label class="dialog-label">File<select id="start-file">${project.files.map(f => `<option value="${esc(f.name)}" ${f.name === file ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <label class="dialog-label">Line<input id="start-line" type="number" min="1" value="${line}" /></label></div>
    <label class="dialog-label">Only when (optional)<input id="start-condition" value="${esc(current?.condition ?? '')}" placeholder="i == 50 && total > 100" maxlength="200" spellcheck="false" autocomplete="off" /><small id="start-condition-help">Use variables visible on that line, fields, array elements, <code>.length</code>, <code>.size()</code>, numbers, <code>'c'</code>, <code>"text"</code>, <code>true</code>, <code>false</code> and <code>null</code>, with <code>== != &lt; &lt;= &gt; &gt;= && || !</code>. Strings compare by text.</small></label>
    <label class="dialog-label">Start the<input id="start-hit" type="number" min="1" max="1000000" value="${current?.hit ?? 1}" /><small>…time the line runs with the condition true. 1 is the first time.</small></label>
    ${project.startAt ? `<p class="dialog-note">Now: recording starts at ${esc(describeStart(project.startAt))}. <button type="button" class="link-btn" data-action="clear-start">Record from the start of main instead</button></p>` : ''}`, () => {
    const chosen = $<HTMLSelectElement>('#start-file').value;
    const lineNumber = Number($<HTMLInputElement>('#start-line').value);
    const condition = $<HTMLInputElement>('#start-condition').value.trim();
    const hit = Number($<HTMLInputElement>('#start-hit').value);
    const lines = project.files.find(f => f.name === chosen)?.content.split('\n').length ?? 0;
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines) throw new Error(`Choose a line from 1 to ${lines}.`);
    const problem = checkCondition(condition);
    if (problem) throw new Error(`The condition can’t be read: ${problem}`);
    if (!Number.isInteger(hit) || hit < 1 || hit > 1_000_000) throw new Error('Choose a number from 1 to 1,000,000.');
    setStartAt({ file: chosen, line: lineNumber, condition, hit });
    if (activeFile !== chosen) selectFile(chosen, false);
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
  }, 'Save');
  const input = $<HTMLInputElement>('#start-condition');
  input.addEventListener('input', () => {
    const problem = checkCondition(input.value);
    input.setAttribute('aria-invalid', String(!!problem));
    $('#dialog-error').textContent = problem ? `The condition can’t be read: ${problem}` : '';
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
        <label>Call<input data-field="call" value="${esc(test.call ?? '')}" placeholder="sum(new int[]{1, 2})" spellcheck="false" maxlength="500" /><small>A call (<code>sum(xs)</code>, <code>new Counter().next()</code>), statements ending in the value to check (<code>Counter c = new Counter(); c.add(2); c.value()</code>), or statements ending in <code>;</code> to check what they print (<code>Shapes.square(2);</code>)</small></label>
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
    const built: TestCase[] = drafts.map(t => t.kind === 'call'
      ? { name: t.name.trim(), kind: 'call', target: t.target, call: t.call!.trim(), stdin: t.stdin ?? '', expectedOutput: t.expectedOutput.trim() }
      : { name: t.name.trim(), stdin: t.stdin, expectedOutput: t.expectedOutput });
    // A test keeps its origin (template, generated, AI) only while it is unchanged; an edited test is the student's.
    const same = (a: TestCase, b: TestCase) => a.name === b.name && a.stdin === b.stdin && a.expectedOutput.trim() === b.expectedOutput.trim() && (a.kind ?? 'output') === (b.kind ?? 'output') && (a.call ?? '') === (b.call ?? '') && (a.target ?? '') === (b.target ?? '');
    const checks: TestCase[] = built.map((c, i) => { const origin = drafts[i].origin; return origin && project.checks.some(o => o.origin === origin && same(o, c)) ? { ...c, origin } : c; });
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

/**
 * A row in Generate tests. `sampled` rows expect what the code returns now; `ai` rows expect what the assistant
 * says the code should do, next to what the code actually returned.
 */
type GenRow = {
  key: string; check: TestCase; label: string; expected: string; status: CaseResult['status'] | 'output'; detail?: string; checked: boolean;
  source: 'sampled' | 'ai'; actual?: string; aiExpected?: string; why?: string; printed?: boolean;
};

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
  const hasMain = mainClasses(project.files).includes(project.mainClass);
  const withOutput = hasMain && !project.checks.some(c => !isCallTest(c) && !isStarterCheck(c) && normalizeOutput(c.stdin) === normalizeOutput(project.stdin));
  const noHarnessSlot = project.files.length >= 20;
  if (noHarnessSlot) plan.cases = [];
  const files = structuredClone(project.files);
  const forDoc = `${doc.kind}:${doc.id}`;
  const rows: GenRow[] = [];
  let aiState: 'idle' | 'asking' | 'done' | 'error' = 'idle', aiMessage = '';
  const skippedNote = () => plan.skipped.length ? `<details class="gen-skipped"><summary>${plan.skipped.length} method${plan.skipped.length === 1 ? '' : 's'} skipped by the sampler${aiState === 'done' ? '' : assist.configured ? ' (the AI can cover them)' : ''}</summary><ul>${plan.skipped.map(s => `<li><code>${esc(s.className)}.${esc(s.method)}</code>: ${esc(s.reason)}</li>`).join('')}</ul></details>` : '';
  const total = plan.cases.length + (withOutput ? 1 : 0);
  openDialog('Generate tests', `<div id="gen-body"><p class="gen-progress">${icon('loader-circle', 'spin')}<span id="gen-status">Trying ${plan.cases.length} sample call${plan.cases.length === 1 ? '' : 's'}${withOutput ? ' and your program’s output' : ''} on a plain JVM…</span></p></div>`, () => {
    const chosen = rows.filter(r => r.checked);
    if (!chosen.length) throw new Error('Select at least one test to add.');
    if (chosen.length > room) throw new Error(`Only ${room} more test${room === 1 ? '' : 's'} fit (a project can have 20). Clear some checkboxes.`);
    if (`${doc.kind}:${doc.id}` !== forDoc) throw new Error('The open project changed. Generate the tests again.');
    const checks = chosen.map(r => {
      const expectedOutput = isCallTest(r.check) ? r.expected.trim() : r.expected;
      const matches = (value?: string) => value !== undefined && (isCallTest(r.check) ? valuesMatch(value, expectedOutput) : normalizeOutput(value) === normalizeOutput(expectedOutput));
      // The origin follows the expected value the student kept: the AI's, the code's, or their own.
      const origin = r.source === 'ai' && matches(r.aiExpected) ? 'ai' as const : matches(r.source === 'ai' ? r.actual : r.check.expectedOutput) ? 'generated' as const : undefined;
      const { origin: _old, ...rest } = r.check;
      return origin ? { ...rest, expectedOutput, origin } : { ...rest, expectedOutput };
    });
    const empty = checks.find(c => isCallTest(c) && !c.expectedOutput);
    if (empty) throw new Error(`Enter an expected value for ${empty.call}.`);
    if (!validateProject({ ...project, checks: [...project.checks, ...checks] })) throw new Error('One of the tests is too long. Outputs are limited to 32 KiB.');
    project.checks = [...project.checks, ...checks]; save(); renderFiles(); renderConsole(); renderCheckResults(); renderCoach(); renderSaveRunTest(); setBusy();
    toast(`Added ${checks.length} test${checks.length === 1 ? '' : 's'}. Run tests to check them against your code.`, 'success');
  }, 'Add selected tests', { wide: true });
  const submit = $<HTMLButtonElement>('#dialog-submit');
  submit.disabled = true;
  const open = () => $<HTMLDialogElement>('#dialog').open && !!document.getElementById('gen-body');

  const rowHtml = (r: GenRow, i: number) => {
    const usable = r.status === 'value' || r.status === 'throws' || r.status === 'output';
    let note = '';
    if (r.source === 'ai') {
      const agrees = r.actual !== undefined && (isCallTest(r.check) ? valuesMatch(r.aiExpected ?? '', r.actual) : normalizeOutput(r.aiExpected ?? '') === normalizeOutput(r.actual));
      note = r.actual === undefined ? `<small class="gen-note">${esc(r.detail ?? 'Didn’t run')}</small>`
        : agrees ? `<small class="gen-note ok">${icon('circle-check')}Your code agrees.</small>`
          : `<small class="gen-note warn">${icon('triangle-alert')}Your code ${isCallTest(r.check) ? 'returns' : 'prints'} <code>${esc(r.actual.length > 80 ? `${r.actual.slice(0, 77)}…` : r.actual)}</code>. Either the code has a bug or the AI is wrong: decide which before adding. <button type="button" class="link-btn" data-gen-use="${i}">Expect what the code ${isCallTest(r.check) ? 'returns' : 'prints'}</button></small>`;
      if (r.why) note = `<small class="gen-why">${esc(r.why)}</small>${note}`;
    } else if (r.status === 'throws') note = '<small class="gen-note warn">Threw an exception. Keep it only if that’s the intended behavior.</small>';
    else if (!usable) note = `<small class="gen-note">${esc(r.detail ?? '')}</small>`;
    const field = !isCallTest(r.check)
      ? `<textarea data-gen-expected="${i}" rows="3" spellcheck="false" aria-label="Expected output">${esc(r.expected)}</textarea>`
      : usable ? `<input data-gen-expected="${i}" value="${esc(r.expected)}" spellcheck="false" aria-label="Expected value for ${esc(r.label)}" />` : '';
    const what = !isCallTest(r.check) ? `<strong>${esc(r.check.name)}</strong><small>${r.check.stdin ? `Input: <code>${esc(JSON.stringify(r.check.stdin))}</code>` : 'No input'}</small>` : `<code>${esc(r.label)}</code>${r.printed ? '<small>Checks what it prints</small>' : ''}`;
    return `<tr class="${usable ? '' : 'unusable'}"><td><input type="checkbox" data-gen="${i}" ${r.checked ? 'checked' : ''} ${usable ? '' : 'disabled'} aria-label="Add ${esc(r.label || r.check.name)}" /></td><td>${r.source === 'ai' ? '<span class="test-origin">AI</span>' : ''}${what}</td><td>${field}${note}</td></tr>`;
  };
  const aiPanel = () => {
    if (aiState === 'asking') return `<p class="gen-progress">${icon('loader-circle', 'spin')}<span id="gen-ai-status">${esc(aiMessage || 'Asking the AI what each method should do…')}</span></p>`;
    if (aiState === 'error') return `<div class="callout warning">${icon('triangle-alert')}<div><strong>The AI’s tests couldn’t be used</strong><p>${esc(aiMessage)}</p><div class="callout-actions"><button type="button" class="btn btn-ghost btn-compact" data-gen-ai>${icon('rotate-ccw')}Try again</button></div></div></div>`;
    if (aiState === 'done') return aiMessage ? `<p class="dialog-note">${esc(aiMessage)}</p>` : '';
    return assist.configured
      ? `<div class="gen-ai"><div><strong>${icon('sparkles')}More tests from the AI</strong><p>The sampler only tries fixed arguments and records what the code returns now. The AI reads the code and suggests what each method <em>should</em> do, including instance and void methods and edge cases. TraceLab runs every suggestion and shows where your code disagrees. Your code is sent to ${esc(assist.local ? 'the model on this computer' : assistHost())}.</p></div><button type="button" class="btn btn-secondary btn-compact" data-gen-ai>${icon('sparkles')}Ask the AI</button></div>`
      : `<p class="dialog-note">${icon('sparkles')}With the AI assistant set up, TraceLab can also ask it for tests of the methods the sampler skips, with expected values for what the code should do. <button type="button" class="link-btn" data-gen-setup>Set up the assistant</button></p>`;
  };
  const render = () => {
    if (!open()) return;
    const usable = rows.some(r => r.source === 'sampled');
    $('#gen-body').innerHTML = `${usable ? `<div class="callout warning">${icon('triangle-alert')}<div><strong>Check every expected value before adding</strong><p>Sampled values are what your code returns <em>right now</em>. If the code has a bug, the test will expect the wrong answer. AI values are what the AI thinks is right, which can also be wrong. Change any value that isn’t what the method should return.</p></div></div>` : ''}
      ${rows.length ? `<table class="gen-table"><thead><tr><th><span class="sr-only">Add</span></th><th>Call or input</th><th>Expected value</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>` : `<p class="dialog-note">${noHarnessSlot ? 'Method tests need one free file slot, and this project already has 20 files.' : total ? 'None of the sample calls produced a result.' : 'The sampler has nothing new to try: it covers public methods that take numbers, booleans, characters, Strings, arrays or lists, on objects it can build, plus one output test for the current input.'}</p>`}
      ${aiPanel()}<p class="dialog-note" id="gen-count"></p>${skippedNote()}`;
    count(); icons();
  };
  const count = () => { const n = rows.filter(r => r.checked).length; const el = document.getElementById('gen-count'); if (el) el.textContent = `${n} selected · ${room} more test${room === 1 ? '' : 's'} fit in this project`; submit.disabled = n === 0; };
  const body = $('#gen-body');
  body.addEventListener('change', e => { const el = e.target as HTMLInputElement; if (el.dataset.gen !== undefined) { rows[Number(el.dataset.gen)].checked = el.checked; count(); } });
  body.addEventListener('input', e => { const el = e.target as HTMLInputElement; if (el.dataset.genExpected !== undefined) rows[Number(el.dataset.genExpected)].expected = el.value; });
  body.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.genUse !== undefined) { const r = rows[Number(button.dataset.genUse)]; r.expected = r.actual ?? r.expected; r.checked = true; render(); }
    if (button.dataset.genAi !== undefined) askAiForTests();
    if (button.dataset.genSetup !== undefined) assistantSetupDialog();
  });

  /** The AI's suggestions, each run on the JVM: method calls in one batch per package, output tests one at a time. */
  async function askAiForTests() {
    if (aiState === 'asking' || genTask) return;
    aiState = 'asking'; aiMessage = ''; render();
    const task = (async () => {
      const messages = aiTestMessages(files, project.checks, plan, { hasMain, mainClass: project.mainClass }) as ChatMessage[];
      let parsed = parseAiTests(await aiComplete(messages, 3000), files);
      // One retry with the problem stated: models sometimes wrap or cut off the JSON.
      if (typeof parsed === 'string') parsed = parseAiTests(await aiComplete([...messages, { role: 'user', content: `${parsed} Reply again with only the JSON object {"tests": [...]}, at most 12 tests.` }], 3000), files);
      if (typeof parsed === 'string') throw new Error(`${parsed} Try again.`);
      const seen = new Set([...project.checks.map(c => isCallTest(c) ? `${c.target}|${c.call}` : `stdin|${normalizeOutput(c.stdin)}`), ...rows.map(r => isCallTest(r.check) ? `${r.check.target}|${r.check.call}` : `stdin|${normalizeOutput(r.check.stdin)}`)]);
      const fresh = parsed.tests.filter(t => { const key = t.kind === 'call' ? `${t.target}|${t.call}` : `stdin|${normalizeOutput(t.stdin)}`; if (seen.has(key)) return false; seen.add(key); return true; });
      const calls = noHarnessSlot ? [] : fresh.filter((t): t is Extract<AiTest, { kind: 'call' }> => t.kind === 'call');
      const outputs = hasMain ? fresh.filter((t): t is Extract<AiTest, { kind: 'output' }> => t.kind === 'output').slice(0, 6) : [];
      const status = (text: string) => { aiMessage = text; const el = document.getElementById('gen-ai-status'); if (el) el.textContent = text; };
      status(`Running ${calls.length + outputs.length} suggested test${calls.length + outputs.length === 1 ? '' : 's'} on the JVM to compare them with your code…`);
      const base: RunRequest = { ...requestFor(''), files, mode: 'run', timeoutMs: GEN_TIMEOUT };
      const cases = calls.map((t, id) => ({ id, expression: qualifyCall(t.call, t.target, files), target: t.target, call: t.call }));
      const results = cases.length ? await runBatches(base, groupBy(cases, c => packageOf(c.target)), { label: c => c.call }) : new Map<number, CaseResult>();
      const made: GenRow[] = cases.map((c, id) => {
        const t = calls[id], r = results.get(id);
        const ran = r && (r.status === 'value' || r.status === 'throws');
        const check: TestCase = { name: t.call.length <= 120 ? t.call : `${t.call.slice(0, 117)}…`, kind: 'call', target: t.target, call: t.call, stdin: '', expectedOutput: t.expected };
        const agrees = ran && valuesMatch(t.expected, r!.value);
        return { key: `ai-${rows.length + id}`, check, label: t.call, expected: t.expected, status: ran ? (r!.status === 'throws' && !/^throws\b/i.test(t.expected) ? 'throws' : 'value') : (r?.status ?? 'unfinished'), detail: r?.detail, checked: !!agrees, source: 'ai', actual: ran ? r!.value : undefined, aiExpected: t.expected, why: t.why, printed: /;\s*$/.test(t.call) };
      });
      for (const t of outputs) {
        const request: RunRequest = { ...requestFor(t.stdin), files, mode: 'run', timeoutMs: GEN_TIMEOUT };
        const events = await quietRun(request);
        const finished = { id: '', status: 'finished', request, events } as Run;
        const done = events.at(-1)?.stopReason === 'completed';
        const actual = done ? normalizeOutput(output(finished, 'stdout')) : undefined;
        made.push({ key: `ai-out-${made.length}`, check: { name: t.name, stdin: t.stdin, expectedOutput: t.expected }, label: '', expected: t.expected, status: 'output', checked: actual !== undefined && normalizeOutput(t.expected) === actual, source: 'ai', actual, aiExpected: t.expected, why: t.why, detail: done ? undefined : `The program didn’t finish with this input (${events.at(-1)?.stopReason ?? 'no result'})` });
      }
      const disagree = made.filter(m => m.actual !== undefined && !m.checked).length;
      const broken = made.filter(m => m.actual === undefined).length;
      return { made, summary: `The AI suggested ${parsed.tests.length} test${parsed.tests.length === 1 ? '' : 's'}${parsed.dropped ? ` (${parsed.dropped} unreadable, dropped)` : ''}${fresh.length < parsed.tests.length ? `, ${parsed.tests.length - fresh.length} already covered` : ''}. ${disagree ? `${disagree} disagree with your code: each is either a bug or a wrong guess, so they start unselected. ` : made.length ? 'Your code agrees with the ones that ran. ' : ''}${broken ? `${broken} didn’t run (shown greyed out).` : ''}`.trim() };
    })();
    genTask = task;
    try {
      const { made, summary } = await task;
      let budget = room - rows.filter(r => r.checked).length;
      for (const r of made) { if (r.checked && budget > 0) budget--; else r.checked = false; }
      rows.push(...made);
      aiState = 'done'; aiMessage = summary;
    } catch (error) {
      aiState = 'error'; aiMessage = error instanceof ProjectCompileError ? 'The project doesn’t compile, so the suggestions can’t be checked. Fix the errors first.' : error instanceof Error ? error.message : String(error);
    } finally { genTask = null; }
    render();
  }

  if (!total) { render(); return; }
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
        if (stdout) outputRow = { key: 'output', check: { name: project.stdin.trim() ? 'Output for the current input' : 'Program output', stdin: project.stdin, expectedOutput: stdout, origin: 'generated' }, label: '', expected: stdout, status: 'output', checked: true, source: 'sampled' };
      }
    }
    return { results, outputRow };
  })();
  genTask = task;
  try {
    const { results, outputRow } = await task;
    // A void method that printed nothing has nothing to check here: its effect is on state, which the AI can test.
    const silent = new Set<string>();
    for (const c of plan.cases) if (c.printed) {
      const all = plan.cases.filter(d => d.target === c.target && d.method === c.method);
      if (all.every(d => results.get(d.id)?.status === 'value' && results.get(d.id)?.value === '""')) silent.add(`${c.target}|${c.method}`);
    }
    for (const key of silent) { const [target, method] = key.split('|'); plan.skipped.push({ className: target.split('.').at(-1)!, method, reason: `returns nothing and printed nothing, so it changes the object: test it with statements that call it and then check a value, such as ${target.split('.').at(-1)} x = new ${target.split('.').at(-1)}(…); x.${method}(…); x.someGetter()` }); }
    rows.push(...plan.cases.filter(c => !silent.has(`${c.target}|${c.method}`)).map(c => {
      const r = results.get(c.id) ?? { id: c.id, status: 'unfinished' as const, value: '', detail: 'wasn’t run' };
      return { key: String(c.id), check: caseToCheck(c, r.value), label: `${c.className}.${c.call}`.replace(`${c.className}.new ${c.className}`, `new ${c.className}`), expected: r.value, status: r.status, detail: r.detail, checked: r.status === 'value', source: 'sampled' as const, printed: c.printed };
    }));
    if (outputRow) rows.unshift(outputRow);
    // Pre-select returned values (not exceptions) up to the project's test limit.
    let budget = room;
    for (const r of rows) { if (r.checked && budget > 0) budget--; else r.checked = false; }
  } catch (error) {
    if (!open()) return;
    $('#gen-body').innerHTML = `<div class="callout warning">${icon('triangle-alert')}<div><strong>Couldn’t generate tests</strong><p>${esc(error instanceof Error ? error.message : String(error))}</p></div></div>${skippedNote()}`;
    icons(); return;
  } finally { genTask = null; }
  render();
}

function languageServerDialog() {
  const features = 'Completions that know types and members (with automatic imports), parameter hints, hover information, go to definition (F12), find references (Shift+F12), rename across files (F2), refactorings such as extract variable or method (Ctrl+Shift+R), quick fixes (Ctrl+.), organize imports (Shift+Alt+O), formatting (Shift+Alt+F), and errors and warnings as you type.';
  const body = lsp.state === 'unavailable'
    ? `<p class="dialog-note">TraceLab is using basic editing: snippets, keywords and names from your files. ${esc(lsp.reason)}</p><p class="dialog-note">With the Eclipse Java language server you also get: ${features}</p><p class="dialog-note">Then restart TraceLab with <code>npm start</code>.</p>`
    : `<p class="dialog-note"><strong>Status:</strong> ${esc({ off: 'Not started', starting: 'Starting (this takes 5–20 seconds)', ready: lsp.progress || 'Ready', stopped: `Stopped. ${lsp.reason}`, unavailable: '' }[lsp.state])}</p><p class="dialog-note">${features}</p><p class="dialog-note">The language server is Eclipse JDT LS, running on this computer next to the runner. It reads a copy of the open project in <code>.local/lsp</code>.</p>`;
  const toggles = `<fieldset class="editor-toggles"><legend>Editor</legend><label><input type="checkbox" id="setting-spelling" ${ui.spelling ? 'checked' : ''} /> Check spelling in comments, text and names</label><label><input type="checkbox" id="setting-hints" ${ui.hints ? 'checked' : ''} /> Show parameter names next to literal arguments, like <code>max(a: 3, b: 5)</code></label></fieldset>`;
  const restart = lsp.state === 'stopped' || lsp.state === 'off';
  openDialog('Editor settings', `<h3 class="dialog-subhead">Java language server</h3>${body}${toggles}`, () => {
    ui.spelling = $<HTMLInputElement>('#setting-spelling').checked; ui.hints = $<HTMLInputElement>('#setting-hints').checked; saveUi();
    editor.updateOptions({ inlayHints: { enabled: ui.hints ? 'on' : 'off' } });
    recheckSpelling();
    if (restart && lsp.state !== 'unavailable') { connectLanguageServer(); renderLspStatus(); }
  }, restart && lsp.state !== 'unavailable' ? 'Save and start the server' : 'Save');
}

function shortcutsDialog() {
  const rows: [string, string][] = [['Ctrl + Enter', 'Run and record'], ['F10', 'Step over'], ['F11 or Alt + →', 'Step into'], ['Shift + F11', 'Step out'], ['Shift + F10', 'Step back over'], ['Alt + ←', 'Step back'], ['Ctrl + S', 'Save to this browser'], ['Ctrl + Space', 'Code completion'], ['Ctrl + .', 'Quick fix'], ['F2', 'Rename symbol'], ['F12', 'Go to definition'], ['Shift + F12', 'Find references'], ['Ctrl + Shift + R', 'Refactor'], ['Shift + Alt + O', 'Organize imports'], ['Shift + Alt + F', 'Format document'], ['Ctrl + Shift + O', 'Go to symbol'], ['Ctrl + F', 'Find in file'], ['F1', 'Editor command palette']];
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
  else if (action === 'reset-doc') {
    if (!canReset()) toast(startingPoint() ? 'Nothing to reset: this is already the starting code.' : 'This project was created before Reset was available, so there is no starting version to go back to.');
    else resetDoc();
  }
  else if (action === 'language-server') languageServerDialog();
  else if (action === 'new-file') newFile();
  else if (action === 'show-tutor') { setLayout({ coach: true }); document.querySelector('.compile-help')?.scrollIntoView({ block: 'nearest' }); }
  else if (action === 'edit-tests') testsDialog();
  else if (action === 'add-test') testsDialog({ name: `Test ${project.checks.length + 1}`, kind: 'output', stdin: '', expectedOutput: '' });
  else if (action === 'run-tests') verify();
  else if (action === 'start-at') startAtDialog();
  else if (action === 'clear-start') { const d = $<HTMLDialogElement>('#dialog'); if (d.open) d.close(); clearStartAt(); }
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
$('#toggle-assist').onclick = () => { if ($('#assistant').hidden) openAssistant(); else { $('#assistant').hidden = true; renderAssistant(); } };
$('#assist-close').onclick = () => { $('#assistant').hidden = true; renderAssistant(); };
$('#assist-new').onclick = () => { if (!chat.busy) { chat.turns = []; renderAssistant(); } };
$('#assist-settings').onclick = () => assistantSetupDialog();
$('#assist-stop').onclick = () => { if (chat.jobId) api(`/assist/chat/${chat.jobId}`, { method: 'DELETE' }).catch(() => {}); };
$<HTMLFormElement>('#assist-form').onsubmit = e => { e.preventDefault(); const input = $<HTMLTextAreaElement>('#assist-input'); const text = input.value; if (!text.trim() || chat.busy) return; input.value = ''; askAssistant(text); };
$('#assist-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $<HTMLFormElement>('#assist-form').requestSubmit(); } });
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

/** Jumps to a recorded step from the help panel, showing the recorded source if the code changed. */
function gotoRecordedStep(index: number) {
  stopPlayback(); traceSource = dirtyTrace(); selectFile(activeFile, traceSource);
  goTo(index);
}
// Structure views: show one larger, step from inside it, and remember which ones are folded.
$('#memory-canvas').addEventListener('click', e => {
  const el = e.target as Element;
  const expand = el.closest<HTMLElement>('[data-expand]');
  if (expand) { e.preventDefault(); expandedView = expandedView === expand.dataset.expand ? null : expand.dataset.expand!; renderTrace(); return; }
  if (el.closest('[data-expand-close]')) { expandedView = null; renderTrace(); return; }
  const go = el.closest<HTMLElement>('[data-step-go]');
  if (go) { stopPlayback(); goTo(step + Number(go.dataset.stepGo)); }
});
$('#memory-canvas').addEventListener('toggle', e => {
  const view = e.target as HTMLDetailsElement;
  const key = view.dataset?.structure;
  if (!key || view.classList.contains('expanded')) return;
  if (view.open) collapsedViews.delete(key); else collapsedViews.add(key);
}, true);
// Help-table rows are focusable rows, not buttons.
$('#coach-content').addEventListener('click', e => {
  const row = (e.target as Element).closest<HTMLElement>('tr[data-goto-step]');
  if (row) gotoRecordedStep(Number(row.dataset.gotoStep));
});
$('#coach-content').addEventListener('keydown', e => {
  const row = (e.target as Element).closest<HTMLElement>('tr[data-goto-step]');
  if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); gotoRecordedStep(Number(row.dataset.gotoStep)); }
});

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
  if (target.id === 'need-help') { helpOpen = !helpOpen; renderCoach(); if (helpOpen) document.querySelector('.help-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  if (target.id === 'close-help') { helpOpen = false; renderCoach(); }
  if (target.dataset.practice) startPractice(target.dataset.practice, !!target.dataset.practiceAi);
  if (target.dataset.saveRunTest !== undefined) saveRunAsTest();
  if (target.dataset.removeStarters !== undefined) removeStarterTests();
  if (target.dataset.assistPrompt) askAssistant(target.dataset.assistPrompt);
  if (target.dataset.ask) openAssistant(target.dataset.ask);
  if (target.dataset.practiceAnswer !== undefined) answerPractice(Number(target.dataset.practiceAnswer));
  if (target.id === 'practice-close') { practice = null; renderCoach(); }
  if (target.id === 'practice-open' && practice?.item) {
    const { project: created } = projectFromSources(`Practice: ${practice.item.title}`, [{ path: '', text: practice.item.code }]);
    if (createAndOpen(created)) toast('Opened the practice program as a project. Press Run to trace it.', 'success');
  }
  if (target.dataset.gotoStep !== undefined && target.tagName === 'BUTTON') gotoRecordedStep(Number(target.dataset.gotoStep));
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
  if (e.key === 'Escape') { closeMenu(); closeProjectMenu(); if (expandedView && !(e.target as HTMLElement).closest?.('dialog')) { expandedView = null; renderTrace(); } }
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
    const health = await api<{ ok: boolean; workerReady: boolean; languageServer?: string }>('/health');
    const wasOnline = runnerOnline;
    runnerOnline = health.workerReady;
    if (health.languageServer) connectLanguageServer();
    if (runnerOnline && !wasOnline) loadAssistStatus();
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
selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); renderProgress(); setBusy(); renderStartChip(); save(); icons();
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
