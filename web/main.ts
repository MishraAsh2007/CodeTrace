import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { createIcons, Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2 } from 'lucide';
import { categories, copyExample, demoFor, demos, exampleIndex, examples } from './examples';
import type { DemoCategory } from './examples';
import { checkPassed, exceptionMessage, failingCheck, normalizeOutput, output, questionsFor, sameSource, snapshots, validateProject, valueText } from './learning';
import { boxedValue, describeStep, displayMethod, heapIndex, isInlineValue, returnedCall, simpleType, stepBackOver, stepOut, stepOver } from './narrate';
import type { StoryItem } from './narrate';
import { drawArrows, focusArrows } from './arrows';
import { decodeProject, encodeProject, SHARE_PREFIX } from './share';
import { identifiers, registerJavaCompletions } from './snippets';
import { CONCEPTS, loadProgress, recordSolved, resetProgress } from './progress';
import { applyLayout, attachSplitter, clamp, DEFAULT_CONSOLE, DEFAULT_SPLIT, loadLayout, saveLayout } from './layout';
import type { SidebarView } from './layout';
import { applyTheme, onSystemThemeChange, resolvedTheme, setTheme, themeChoice } from './theme';
import type { ThemeChoice } from './theme';
import { categoryLabel, demoCard, demoName, filterBar, LOGO_SVG, visibleDemos } from './gallery';
import type { Check as TestCase, Frame, HeapObject, Project, Question, Run, RunRequest, TraceEvent, TraceValue, Variable } from './types';
import './tokens.css';
import './style.css';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const iconSet = { Play, Square, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Plus, FileCode2, Download, Upload, Check, X, Terminal, ArrowUpRight, BookOpen, Bug, Lightbulb, Settings2, Pause, RotateCcw, ArrowRight, CircleHelp, Search, Bookmark, CornerDownRight, CornerLeftUp, Undo2, Redo2, Share2, Spline, Type, Pencil, Equal, Flag, Trophy, Wrench, Target, Microscope, PanelLeft, PanelRight, PanelBottom, PanelRightClose, ChevronDown, Files, FlaskConical, Sun, Moon, Monitor, Ellipsis, FilePlus2, ShieldCheck, Keyboard, Info, ListChecks, LayoutGrid, CircleCheck, CircleX, LoaderCircle, ExternalLink, House, History, Trash2 };
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Escapes text and renders `backtick` spans as inline code. */
const rich = (value: unknown): string => esc(value).replace(/`([^`]+)`/g, '<code>$1</code>');
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const icons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.75 } });
const FILE_PATTERN = /^(?:[A-Za-z_$][\w$]*\/)*[A-Za-z_$][\w$]*\.java$/;
const VERSION = '1.0';
const BLANK: Project = { version: 1, name: 'Untitled project', example: '', mainClass: 'Main', stdin: '', maxSteps: 500, checks: [],
  files: [{ name: 'Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, TraceLab!");\n    }\n}\n' }] };

type UiSettings = { arrows: boolean; inline: boolean };
function loadUi(): UiSettings {
  try { const value = JSON.parse(localStorage.getItem('tracelab.ui.v1') ?? '{}'); return { arrows: value.arrows !== false, inline: value.inline !== false }; }
  catch { return { arrows: true, inline: true }; }
}
function saveUi() { try { localStorage.setItem('tracelab.ui.v1', JSON.stringify(ui)); } catch { /* Preferences are optional. */ } }

applyTheme();
let project = copyExample();
let storageFailed = false;
try { const saved = JSON.parse(localStorage.getItem('tracelab.project.v1') ?? 'null'); if (validateProject(saved)) project = saved; } catch { /* An invalid or inaccessible saved project falls back to the first demo. */ }
let activeFile = initialFile(project);
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
const models = new Map<string, monaco.editor.ITextModel>();
const breakpoints = new Map<string, Set<number>>();
let changingModel = false;
let decorations: monaco.editor.IEditorDecorationsCollection;

$('#app').innerHTML = `
  <header class="topbar">
    <a class="logo" href="/" title="TraceLab home">${LOGO_SVG}<span>TraceLab</span></a>
    <span class="topbar-divider" aria-hidden="true"></span>
    <button class="project-switch" id="project-switch" title="Rename project or change run settings"><span id="project-title"></span>${icon('chevron-down')}</button>
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
          <button role="menuitem" data-action="new-project">${icon('file-plus-2')}New project</button>
          <button role="menuitem" data-action="gallery">${icon('layout-grid')}Browse examples…</button>
          <div class="menu-separator" role="separator"></div>
          <button role="menuitem" data-action="import">${icon('upload')}Import project…</button>
          <button role="menuitem" data-action="export">${icon('download')}Export project</button>
          <button role="menuitem" data-action="export-trace">${icon('history')}Export recorded trace</button>
          <div class="menu-separator" role="separator"></div>
          <button role="menuitem" data-action="settings">${icon('settings-2')}Run settings…</button>
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
      <button data-view="examples" class="activity" title="Examples" aria-label="Examples">${icon('flask-conical')}</button>
      <span class="activity-spacer"></span>
      <button data-action="shortcuts" class="activity" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button>
      <button data-action="settings" class="activity" title="Run settings" aria-label="Run settings">${icon('settings-2')}</button>
    </nav>
    <aside class="sidebar" aria-label="Sidebar">
      <section data-view-panel="explorer" class="side-view">
        <div class="side-header"><h2>Explorer</h2><div><button id="new-file" class="icon-btn small" title="New Java file" aria-label="New Java file">${icon('file-plus-2')}</button><button data-action="import" class="icon-btn small" title="Import project" aria-label="Import project">${icon('upload')}</button></div></div>
        <div class="tree-root" id="tree-root">${icon('chevron-down')}<span id="folder-name"></span></div>
        <div id="file-list" class="file-list" role="list"></div>
        <div class="side-footer"><span>${icon('shield-check')} Saved in this browser</span></div>
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
        <section class="tests-card"><div class="card-title">${icon('list-checks')}<h3>Tests</h3><span class="tab-count" id="tests-count"></span><button id="edit-checks" class="link-btn">Edit</button></div><p class="muted">Each test runs your current code in a fresh JVM and compares its output.</p><button id="verify" class="btn btn-secondary btn-block">${icon('play')}Run tests</button><div id="check-results" aria-live="polite"></div></section>
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
  <input type="file" id="import-input" accept="application/json,.json" hidden />
  <dialog id="dialog" aria-labelledby="dialog-title"><form method="dialog" id="dialog-form"><div class="dialog-heading"><h2 id="dialog-title"></h2><button value="cancel" class="icon-btn" aria-label="Close dialog">${icon('x')}</button></div><div id="dialog-body"></div><div class="dialog-error" id="dialog-error" role="alert"></div><div class="dialog-actions" id="dialog-actions"><button value="cancel" class="btn btn-secondary" id="dialog-cancel">Cancel</button><button type="button" id="dialog-submit" class="btn btn-primary">Save</button></div></form></dialog>
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
function save() {
  try { localStorage.setItem('tracelab.project.v1', JSON.stringify(project)); storageFailed = false; }
  catch { storageFailed = true; }
  $('#save-state').textContent = storageFailed ? 'Not saved — export to keep changes' : 'Saved';
  $('#save-state').classList.toggle('warning', storageFailed);
}
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
      if (target) { target.content = model!.getValue(); monaco.editor.setModelMarkers(model!, 'java-compiler', []); save(); renderSourceBanner(); renderCheckResults(); renderStages(); updateDecorations(); }
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

function renderFiles() {
  const available = traceSource && run ? run.request.files : project.files;
  $('#project-title').textContent = project.name;
  document.title = `${project.name} · TraceLab`;
  $('#folder-name').textContent = project.name;
  $('#file-list').innerHTML = project.files.map(f => `<div class="file-row ${f.name === activeFile && !traceSource ? 'active' : ''}" role="listitem"><button data-file="${esc(f.name)}" title="${esc(f.name)}">${icon('file-code-2')}<span>${esc(f.name)}</span></button><button data-rename="${esc(f.name)}" class="file-action" title="Rename" aria-label="Rename ${esc(f.name)}">${icon('pencil')}</button><button data-delete="${esc(f.name)}" class="file-action" title="Delete" aria-label="Delete ${esc(f.name)}">${icon('trash-2')}</button></div>`).join('');
  $('#editor-tabs').innerHTML = available.map(f => `<button class="panel-tab ${f.name === activeFile ? 'active' : ''}" role="tab" aria-selected="${f.name === activeFile}" data-tab="${esc(f.name)}">${icon('file-code-2')}${esc(f.name)}</button>`).join('') + (traceSource ? '<span class="tab-note">Recorded source · read-only</span>' : '');
  $('#example-list').innerHTML = categories.map(c => {
    const items = demos.filter(d => d.category === c.id);
    return `<div class="example-group"><h3>${esc(c.label)}</h3>${items.map(d => `<button class="example-item ${project.example === d.id ? 'active' : ''}" data-open-demo="${esc(d.id)}" title="${esc(d.summary)}"><span class="example-dot ${c.id}"></span><span class="example-text"><span>${esc(demoName(d))}</span><small>${esc(d.symptom)}</small></span></button>`).join('')}</div>`;
  }).join('') + `<button class="btn btn-secondary btn-block" data-action="gallery">${icon('layout-grid')}Open gallery</button>`;
  $('#checks-count').textContent = String(project.checks.length);
  $('#tests-count').textContent = String(project.checks.length);
  icons();
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

// ---------- Memory rendering ----------

type RenderContext = { heap: Map<string, HeapObject>; previousHeap: Map<string, HeapObject> };
function refColor(id = '') { return ['green', 'blue', 'orange', 'violet'][Number(id.replace(/\D/g, '')) % 4]; }
function inlineText(object: HeapObject): string { return object.kind === 'string' ? `“${object.text ?? ''}”${object.truncated ? '…' : ''}` : boxedValue(object) ?? ''; }

function renderValue(value: TraceValue, previous: TraceValue | undefined, ctx: RenderContext) {
  const object = value.kind === 'reference' ? ctx.heap.get(value.ref!) : undefined;
  if (ui.inline && object && isInlineValue(object)) {
    const before = previous?.kind === 'reference' ? ctx.previousHeap.get(previous.ref!) : undefined;
    const changed = previous && (previous.ref !== value.ref || (before && inlineText(before) !== inlineText(object)));
    return `<span class="inline-value ${changed ? 'changed' : ''}" title="${esc(`${simpleType(object.type)} object @${object.id}${changed && previous ? ` · previously ${previous.kind === 'reference' && before ? inlineText(before) : valueText(previous)}` : ''}`)}">${esc(inlineText(object))}<small>@${esc(object.id)}</small></span>`;
  }
  const changed = previous && JSON.stringify(previous) !== JSON.stringify(value);
  if (value.kind === 'reference') return `<button class="ref ${refColor(value.ref)} ${changed ? 'changed' : ''} ${value.omitted ? 'omitted' : ''}" data-ref="${esc(value.ref)}" title="${value.omitted ? 'Not captured: object limit reached' : `Go to ${esc(simpleType(value.type ?? 'object'))} @${esc(value.ref)}`}">${icon('arrow-up-right')}@${esc(value.ref)}${value.omitted ? ' …' : ''}</button>`;
  return `<span class="primitive ${value.kind === 'null' ? 'null' : ''} ${changed ? 'changed' : ''}" ${changed ? `title="Previously ${esc(valueText(previous!))}"` : ''}>${esc(valueText(value))}</span>`;
}
function renderVariables(variables: Variable[], previous: Variable[] | undefined, ctx: RenderContext, qualified = false) {
  return variables.filter(v => !watchFilter || `${v.name} ${v.type} ${valueText(v.value)}`.toLowerCase().includes(watchFilter)).map(v => {
    const prior = previous?.find(p => p.name === v.name);
    const fresh = previous && !prior;
    return `<div class="variable ${fresh ? 'fresh' : ''}"><div class="variable-label"><span class="variable-name">${esc(v.name.split('.').slice(qualified ? -2 : -1).join('.'))}</span><span class="variable-type">${esc(simpleType(v.type))}${v.argument ? ' · param' : ''}</span></div>${renderValue(v.value, prior?.value, ctx)}</div>`;
  }).join('');
}
function renderHeap(object: HeapObject, previous: HeapObject | undefined, isNew: boolean, ctx: RenderContext, snapshot: TraceEvent) {
  if (ui.inline && isInlineValue(object)) return '';
  if (watchFilter && !JSON.stringify(object).toLowerCase().includes(watchFilter)) return '';
  const refs = snapshot.frames?.flatMap(f => f.locals.filter(v => v.value.ref === object.id).map(v => v.name)) ?? [];
  let body = '';
  if (object.kind === 'string') body = `<div class="string-value ${previous && previous.text !== object.text ? 'changed' : ''}">“${esc(object.text)}”</div>`;
  else if (object.kind === 'map') body = `<div class="map-entries">${object.entries?.map(e => {
    const before = previous?.entries?.find(p => JSON.stringify(p.key) === JSON.stringify(e.key));
    return `<div class="map-entry ${previous && !before ? 'fresh' : ''}">${renderValue(e.key, undefined, ctx)}<span class="map-arrow">→</span>${renderValue(e.value, before?.value, ctx)}</div>`;
  }).join('') || '<span class="empty-array">Empty map</span>'}</div>`;
  else if (object.elements) body = `<div class="array-cells ${object.kind}">${object.elements.map((v, i) => `<div class="array-cell">${object.kind === 'set' ? '' : `<span class="array-index">${i}</span>`}${renderValue(v, previous?.elements?.[i], ctx)}</div>`).join('') || `<span class="empty-array">${object.kind === 'array' ? 'Empty · no valid indices' : `Empty ${object.kind}`}</span>`}</div>`;
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
  return `<details class="frame ${index === 0 ? 'current' : ''} ${isNew ? 'new-frame' : ''}" open><summary><span class="frame-name">${index === 0 ? '<span class="frame-active-dot"></span>' : ''}${esc(displayMethod(frame.method))}<span class="method-parens">()</span></span><span class="frame-location">${esc(frame.file)}:${frame.line}</span></summary><div class="frame-variables">${returnNotes}${renderVariables(frame.locals, prior?.locals, ctx) || '<div class="no-vars">No local variables in scope</div>'}${frame.truncated ? '<div class="array-caption">Locals truncated</div>' : ''}</div></details>`;
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
  if (reason === 'compile-error') return `<div class="empty-state"><span class="empty-icon error">${icon('circle-x')}</span><h3>The program didn’t compile</h3><p>Fix the errors listed under Problems, then run again. The Tutor can explain the first error.</p><button class="btn btn-secondary" data-console-open="diagnostics">Show problems</button></div>`;
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
    const ctx: RenderContext = { heap: heapIndex(snapshot), previousHeap: heapIndex(previous) };
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
    el.innerHTML = diagnostics.length ? diagnostics.map(d => `<button class="diagnostic ${d.severity}" data-diagnostic="${esc(d.file)}" data-line="${d.line ?? 1}">${icon(d.severity === 'error' ? 'circle-x' : 'info')}<span><strong>${esc(d.message)}</strong><small>${esc(d.file)} · line ${d.line}, column ${d.column}</small></span></button>`).join('') : '<div class="console-empty">No problems in the last run.</div>';
  } else if (consoleTab === 'checks') {
    el.innerHTML = project.checks.length ? `<table class="test-table"><thead><tr><th>Test</th><th>Input</th><th>Expected output</th></tr></thead><tbody>${project.checks.map(c => `<tr><td>${esc(c.name)}</td><td><code>${esc(JSON.stringify(c.stdin))}</code></td><td><code>${esc(JSON.stringify(c.expectedOutput))}</code></td></tr>`).join('')}</tbody></table>` : '<div class="console-empty">This project has no tests. Add some from the Tutor panel.</div>';
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
    el.innerHTML = `${mismatchCard}${brief}`;
    renderStages(); icons();
    return;
  }
  const answer = questionAnswers[q.id];
  const correct = answer === q.correct;
  const label = { predict: 'Predict', explain: 'Explain', repair: 'Fix' }[q.kind];
  const editCta = correct && q.kind === 'repair' && q.focus ? `<button id="edit-focus" class="btn btn-secondary btn-block">${icon('wrench')}Edit ${esc(q.focus.file)}, line ${q.focus.line}</button>` : '';
  const inspect = q.step >= 0 || q.focus ? `<button id="go-question" class="link-btn">${icon('microscope')}${q.step >= 0 ? 'Show this moment' : 'Show the line'}${q.focus ? ` · line ${q.focus.line}` : ''}</button>` : '';
  el.innerHTML = `${mismatchCard}<article class="question-card ${q.kind}"><header class="question-top"><span class="question-type">${label}</span><span class="question-count">${questionIndex + 1} of ${questions.length}</span></header><h3>${esc(q.title)}</h3><p class="question-context">${rich(q.context)}</p>${inspect}<h4>${rich(q.prompt)}</h4><div class="answer-options" role="group" aria-label="Answers">${q.options.map((option, index) => `<button class="answer-option ${answer === index ? (correct ? 'correct' : 'incorrect') : ''}" data-answer="${index}" aria-pressed="${answer === index}"><span class="option-key">${String.fromCharCode(65 + index)}</span><span>${rich(option)}</span>${answer === index ? icon(correct ? 'circle-check' : 'circle-x') : ''}</button>`).join('')}</div>${answer !== undefined ? `<div class="answer-feedback ${correct ? 'correct' : ''}" role="status"><strong>${correct ? 'Correct — that matches the recorded run.' : 'Not quite.'}</strong><p>${correct ? rich(q.explanation) : 'Compare your answer with the recorded values. Try again, or reveal a hint.'}</p>${editCta}</div>` : ''}<footer class="question-footer"><button id="hint" class="link-btn" ${hintsShown >= q.hints.length ? 'disabled' : ''}>${icon('lightbulb')}${hintsShown < q.hints.length ? `Hint (${hintsShown + 1} of ${q.hints.length})` : 'No more hints'}</button>${questions.length > 1 ? `<button id="next-question" class="link-btn">${questionIndex === questions.length - 1 ? 'First question' : 'Next question'}${icon('arrow-right')}</button>` : ''}</footer>${q.hints.slice(0, hintsShown).map(h => `<div class="hint">${rich(h)}</div>`).join('')}</article>`;
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
}

function renderCheckResults() {
  const stale = checkResults.length && !checksFresh();
  $('#check-results').innerHTML = `${stale ? '<div class="callout subtle">The code or tests changed since these results. Run the tests again.</div>' : ''}${checkResults.map(r => `<div class="check-result ${r.status}">${icon(r.status === 'passed' ? 'circle-check' : r.status === 'failed' ? 'circle-x' : 'loader-circle', r.status === 'running' ? 'spin' : '')}<div><span>${esc(r.name)}</span>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}${r.status === 'failed' && !stale && !running && !checking ? `<button class="link-btn trace-case" data-trace-check="${r.index}">${icon('microscope')}Debug this test</button>` : ''}</div></div>`).join('')}${allChecksPassed() ? `<div class="callout success">${icon('circle-check')}<span>All ${checkResults.length} tests pass.</span></div>` : ''}`;
  renderStages(); icons();
}

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

async function startRun() {
  if (running || checking) return;
  if (!runnerOnline) { toast('The Java runner isn’t connected. Start it with npm start, then try again.', 'error'); checkHealth(); return; }
  stopPlayback(); traceSource = false; selectFile(activeFile, false);
  if (run) previousRun = run;
  run = null; step = 0; resetQuestions();
  running = true; stopRequested = false; setBusy(); renderTrace(); renderCoach();
  try {
    let lastRender = 0;
    run = await collect(requestFor(), value => {
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
  finally { running = false; currentRunId = null; setBusy(); renderTrace(true); renderCoach(); renderSourceBanner(); renderCheckResults(); }
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
  if (!layout.coach) setLayout({ coach: true });
  stopPlayback(); checking = true; checkCancelled = false; stopRequested = false; setBusy();
  checksSource = sourceKey(); checkResults = [];
  const request = requestFor(); const checks = structuredClone(project.checks);
  try {
    for (const [index, test] of checks.entries()) {
      if (checkCancelled) break;
      const result = { name: test.name, index, status: 'running' as 'running' | 'passed' | 'failed', detail: '' };
      checkResults.push(result); renderCheckResults();
      const checked = await collect({ ...request, stdin: test.stdin });
      result.status = checkPassed(checked, test) ? 'passed' : 'failed';
      const reason = checked.events.at(-1)?.stopReason;
      const exception = checked.events.findLast(e => e.exception && !e.exception.caught);
      result.detail = result.status === 'passed' ? 'Output matches'
        : reason === 'exception' && exception ? `${exception.exception!.type.split('.').at(-1)}${exceptionMessage(checked, exception) ? `: ${exceptionMessage(checked, exception)}` : ''}`
        : reason !== 'completed' ? (STOP_LABELS[reason ?? '']?.[0] ?? 'Runner error')
        : `Expected ${JSON.stringify(normalizeOutput(test.expectedOutput))}, got ${JSON.stringify(normalizeOutput(output(checked, 'stdout')))}`;
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
function openDialog(title: string, body: string, onSave: () => void, button = 'Save', options: { cancel?: string | null; danger?: boolean } = {}) {
  $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body; $('#dialog-error').textContent = '';
  $('#dialog-submit').textContent = button;
  $('#dialog-submit').className = `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`;
  $('#dialog-cancel').hidden = options.cancel === null;
  $('#dialog-cancel').textContent = options.cancel ?? 'Cancel';
  $('#dialog-submit').onclick = () => { try { onSave(); $<HTMLDialogElement>('#dialog').close(); } catch (e) { $('#dialog-error').textContent = e instanceof Error ? e.message : String(e); } };
  $<HTMLDialogElement>('#dialog').showModal(); icons();
  $<HTMLElement>('#dialog-body input, #dialog-body textarea')?.focus();
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
function setProject(next: Project) {
  if (running || checking) { toast('Stop the current run before changing projects.'); return; }
  stopPlayback(); project = next; run = null; previousRun = null; step = 0; resetQuestions(); checkResults = []; traceSource = false; breakpoints.clear();
  for (const model of models.values()) model.dispose(); models.clear();
  activeFile = initialFile(project);
  save(); selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); setBusy();
}
/** Opens the file that contains the demo's key line, so the bug is in view. */
function initialFile(value: Project): string {
  const snippet = demoFor(value.example)?.snippet.split('…')[0].trim();
  return (snippet && value.files.find(f => f.content.includes(snippet))?.name) || value.files.find(f => f.name.endsWith('Main.java'))?.name || value.files[0].name;
}
function untouchedExample() { return JSON.stringify(project) === JSON.stringify(examples.find(p => p.example === project.example)) || JSON.stringify(project) === JSON.stringify(BLANK); }
async function replaceProject(next: Project, what: string) {
  if (running || checking) { toast('Stop the current run before changing projects.'); return false; }
  if (!untouchedExample() && !(await confirmDialog(`Open ${what}?`, `This replaces “${project.name}” in your workspace. Export it first if you want to keep your changes.`, 'Replace project'))) return false;
  setProject(next);
  return true;
}
async function openDemo(id: string) {
  const index = exampleIndex(id);
  if (index < 0) { toast('That example does not exist.', 'error'); return; }
  if (project.example === id && untouchedExample()) { closeGallery(); return; }
  if (await replaceProject(copyExample(index), `“${examples[index].name}”`)) { closeGallery(); toast(`Opened “${examples[index].name}”. Press Run to start.`); }
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
    if (await replaceProject(value, `the shared project “${value.name}”`)) toast(`Opened shared project “${value.name}”.`, 'success');
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not open this share link.', 'error'); }
}

function renameFile(oldName: string) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  openDialog('Rename file', `<label class="dialog-label">File name<input id="rename-name" value="${esc(oldName)}" maxlength="180" autocomplete="off" /></label><p class="dialog-note">A public class must match its file name. Update the class declaration and any references after renaming.</p>`, () => {
    const name = $<HTMLInputElement>('#rename-name').value.trim();
    if (name === oldName) return;
    if (!FILE_PATTERN.test(name)) throw new Error('Use a relative Java path, such as Helper.java.');
    if (project.files.some(f => f.name !== oldName && f.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
    const file = project.files.find(f => f.name === oldName)!;
    file.name = name;
    const key = `workspace/${oldName}`; models.get(key)?.dispose(); models.delete(key);
    const marks = breakpoints.get(oldName); breakpoints.delete(oldName); if (marks) breakpoints.set(name, marks);
    save(); selectFile(name, false);
  }, 'Rename');
  setTimeout(() => { const input = $<HTMLInputElement>('#rename-name'); input.focus(); input.setSelectionRange(0, input.value.lastIndexOf('.java')); });
}

async function deleteFile(name: string) {
  if (running || checking) { toast('Wait for the current run to finish.'); return; }
  if (project.files.length === 1) { toast('A project needs at least one Java file.'); return; }
  if (!(await confirmDialog(`Delete ${name}?`, 'The file is removed from this project. This cannot be undone unless you exported the project.', 'Delete', true))) return;
  project.files = project.files.filter(f => f.name !== name);
  const key = `workspace/${name}`; models.get(key)?.dispose(); models.delete(key);
  save(); selectFile(project.files[0].name, false);
}

function newFile() {
  if (running || checking) { toast('Wait for the run to finish before changing files.'); return; }
  openDialog('New Java file', '<label class="dialog-label">File name<input id="file-name" placeholder="Helper.java or util/Helper.java" maxlength="180" autocomplete="off" /></label>', () => {
    const name = $<HTMLInputElement>('#file-name').value.trim();
    if (!FILE_PATTERN.test(name)) throw new Error('Use a relative Java path, such as Helper.java.');
    if (project.files.some(f => f.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
    if (project.files.length >= 20) throw new Error('A project can have up to 20 files.');
    const parts = name.split('/'); const className = parts.pop()!.replace('.java', '');
    project.files.push({ name, content: `${parts.length ? `package ${parts.join('.')};\n\n` : ''}public class ${className} {\n\n}\n` });
    save(); selectFile(name, false);
  }, 'Create');
}

function settingsDialog() {
  openDialog('Project settings', `<label class="dialog-label">Project name<input id="setting-name" value="${esc(project.name)}" maxlength="120" /></label><label class="dialog-label">Main class<input id="setting-main" value="${esc(project.mainClass)}" placeholder="Main or app.Main" /><small>The class whose <code>main</code> method runs.</small></label><label class="dialog-label">Step limit<input id="setting-steps" type="number" min="10" max="2000" value="${project.maxSteps}" /><small>Recording stops after this many line steps (10–2,000). The steps recorded so far stay available.</small></label><p class="dialog-note">Runs use Java 21 with an 8-second time limit. Each step captures up to 24 frames, 64 objects and 32 elements per array or collection.</p>`, () => {
    const mainClass = $<HTMLInputElement>('#setting-main').value.trim();
    const maxSteps = Number($<HTMLInputElement>('#setting-steps').value);
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(mainClass)) throw new Error('Enter a valid Java class name.');
    if (!Number.isInteger(maxSteps) || maxSteps < 10 || maxSteps > 2000) throw new Error('Choose a step limit from 10 to 2,000.');
    project.mainClass = mainClass; project.maxSteps = maxSteps; project.name = $<HTMLInputElement>('#setting-name').value.trim() || 'Untitled project';
    save(); renderFiles(); renderSourceBanner(); renderCheckResults();
  });
}

function testsDialog() {
  openDialog('Edit tests', `<p class="dialog-note">Each test runs your code in a fresh JVM with the given input and compares standard output exactly, ignoring trailing whitespace and line-ending style. Up to 12 tests, as JSON.</p><label class="dialog-label">Tests<textarea id="checks-json" rows="14" spellcheck="false">${esc(JSON.stringify(project.checks, null, 2))}</textarea></label>`, () => {
    let checks: TestCase[];
    try { checks = JSON.parse($<HTMLTextAreaElement>('#checks-json').value); } catch { throw new Error('The tests must be valid JSON.'); }
    if (!validateProject({ ...project, checks })) throw new Error('Use an array of up to 12 objects, each with name, stdin and expectedOutput strings.');
    project.checks = checks; save(); renderFiles(); renderConsole(); renderCheckResults(); renderCoach(); setBusy();
  });
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

async function runAction(action: string) {
  closeMenu();
  if (action === 'new-project') { if (await replaceProject(structuredClone(BLANK), 'a new project')) toast('New project created.'); }
  else if (action === 'gallery') openGallery();
  else if (action === 'import') $<HTMLInputElement>('#import-input').click();
  else if (action === 'export') download(`${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'project'}.tracelab.json`, project);
  else if (action === 'export-trace') { if (run) download(`trace-${run.id}.json`, run); else toast('Run the program first to record a trace.'); }
  else if (action === 'settings') settingsDialog();
  else if (action === 'shortcuts') shortcutsDialog();
  else if (action === 'about') aboutDialog();
}

// ---------- Wiring ----------

$('#run').onclick = () => startRun();
$('#stop').onclick = () => stopRun();
$('#verify').onclick = () => verify();
$('#verify-top').onclick = () => verify();
$('#share').onclick = () => shareProject();
$('#theme').onclick = () => { const order: ThemeChoice[] = ['system', 'light', 'dark']; setTheme(order[(order.indexOf(themeChoice()) + 1) % 3]); renderTheme(); };
$('#project-switch').onclick = () => settingsDialog();
$('#menu-button').onclick = e => { e.stopPropagation(); toggleMenu(); };
$('#new-file').onclick = () => newFile();
$('#edit-checks').onclick = () => testsDialog();
$('#gallery-close').onclick = () => closeGallery();
$('#gallery').addEventListener('click', e => { if (e.target === e.currentTarget) closeGallery(); });
$('#gallery-filters').addEventListener('click', e => { const b = (e.target as Element).closest<HTMLElement>('[data-filter]'); if (b) { galleryFilter = b.dataset.filter as DemoCategory | 'all'; renderGallery(); } });
$('#import-input').onchange = async e => {
  const input = e.target as HTMLInputElement; const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 512 * 1024) throw new Error('Imports are limited to 512 KiB.');
    const value: unknown = JSON.parse(await file.text());
    if (!validateProject(value)) throw new Error('This file is not a TraceLab project export.');
    if (await replaceProject(value, `“${value.name}”`)) toast(`Imported “${value.name}”.`, 'success');
  } catch (e) { toast(e instanceof Error ? e.message : 'Could not import this file.', 'error'); }
  input.value = '';
};
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
  if (!(e.target as Element).closest('.menu-wrap')) closeMenu();
  const target = (e.target as Element).closest<HTMLElement>('button, a[data-action]');
  if (!target) return;
  if (target.dataset.action) { e.preventDefault(); runAction(target.dataset.action); }
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
  if (e.key === 'Escape') closeMenu();
  if (!menu().hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = [...menu().querySelectorAll<HTMLElement>('[role="menuitem"]')];
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

async function openRequestedDemo() {
  const params = new URLSearchParams(location.search);
  const id = params.get('demo');
  if (!id) return;
  params.delete('demo');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  await openDemo(id);
}

renderTheme();
selectFile(activeFile, false); renderTrace(); renderCoach(); renderCheckResults(); renderProgress(); setBusy(); icons();
checkHealth().then(() => { if (!runnerOnline) toast('The Java runner isn’t running. Start it with npm start to run programs.', 'error'); });
setInterval(() => { if (!runnerOnline) checkHealth(); }, 5000);
openRequestedDemo().then(() => openSharedProject());
window.addEventListener('hashchange', () => openSharedProject());
