// app.js: wires the Monaco editor, the step debugger, the memory view, and Kiro together.
import {
  renderMemory, drawArrows, computeSpotlight, applySpotlight, scrollToSpot, esc,
} from "./viz.js";

const MONACO_VS = "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs";
const STORAGE_KEY = "kiro-visualizer:v1";

const SAMPLES = {
  linked_list: {
    breakpoints: [20],
    code: `class Node:
    def __init__(self, val):
        self.val = val
        self.next = None


def build_list(values):
    head = Node(values[0])
    current = head
    for v in values[1:]:
        current.next = Node(v)
        current = current.next
    return head


def sum_of_pairs(head):
    total = 0
    current = head
    while current is not None:
        total += current.val + current.next.val
        current = current.next
    return total


head = build_list([1, 2, 3])
print("sum:", sum_of_pairs(head))
`,
  },
  bst: {
    breakpoints: [22],
    code: `class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None


def insert(root, val):
    if root is None:
        return TreeNode(val)
    if val < root.val:
        insert(root.left, val)
    else:
        root.right = insert(root.right, val)
    return root


root = None
for v in [8, 3, 10, 1, 6, 14]:
    root = insert(root, v)

print("smallest:", root.left.left.val)
`,
  },
  reverse: {
    breakpoints: [12],
    code: `class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next


def reverse(head):
    prev = None
    current = head
    while current is not None:
        nxt = current.next
        current.next = prev
        prev = current
        current = nxt
    return prev


head = Node(1, Node(2, Node(3, Node(4))))
head = reverse(head)
print([head.val, head.next.val, head.next.next.val])
`,
  },
  recursion: {
    breakpoints: [3],
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print(factorial(4))
`,
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $("workspace"), editor: $("editor"), splitter: $("splitter"),
  runBtn: $("run-btn"), firstBtn: $("first-btn"), prevBtn: $("prev-btn"), nextBtn: $("next-btn"),
  continueBtn: $("continue-btn"), lastBtn: $("last-btn"), visualizeBtn: $("visualize-btn"), chatBtn: $("chat-btn"),
  sample: $("sample-select"), dirtyBadge: $("dirty-badge"),
  output: $("output"), stdinWrap: $("stdin-wrap"), stdin: $("stdin"), tabOutput: $("tab-output"), tabInput: $("tab-input"),
  runMeta: $("run-meta"), runStatus: $("run-status"), stepLabel: $("step-label"),
  slider: $("step-slider"), marks: $("timeline-marks"), vizScroll: $("viz-scroll"), canvas: $("viz-canvas"),
  hereCard: $("here-card"), hereClose: $("here-close"), hereWhere: $("here-where"), herePointers: $("here-pointers"),
  hereNarration: $("here-narration"), hereChat: $("here-chat"), hereNarrate: $("here-narrate"),
  scan: $("scan-overlay"),
  chat: $("chat-drawer"), chatLog: $("chat-log"), chatForm: $("chat-form"), chatInput: $("chat-input"),
  chatSend: $("chat-send"), chatReset: $("chat-reset"), chatClose: $("chat-close"), chatContext: $("chat-context"),
  chatQuick: $("chat-quick"), sbKiro: $("sb-kiro"), sbPosition: $("sb-position"),
};

const state = {
  result: null,        // last /api/run-code response
  code: "",            // code that produced `result`
  runId: 0,
  index: 0,
  bpHits: [],          // trace indices that land on a breakpoint
  dirty: false,        // editor changed since the last run
  running: false,
  spotlight: false,    // Visualize mode on
  narrations: new Map(),
  kiroReady: false,
  chat: { interactionId: null, runId: null, index: null, busy: false },
};

let monaco, editor, execDecos, bpDecos, hoverDecos;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasTrace = () => !!(state.result && state.result.trace.length);
const currentStep = () => state.result.trace[state.index];

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

main();

async function main() {
  bindUI();
  checkHealth();
  try {
    monaco = await loadMonaco();
  } catch (err) {
    els.output.innerHTML = `<span class="err">Couldn't load the Monaco editor from the CDN (${esc(err && err.message || err)}). Check your internet connection and reload.</span>`;
    return;
  }
  createEditor();
}

function loadMonaco() {
  return new Promise((resolve, reject) => {
    if (!window.require) return reject(new Error("Monaco loader script missing"));
    window.require.config({ paths: { vs: MONACO_VS } });
    window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
  });
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the backend. Is the server still running?");
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join("; ");
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

async function checkHealth() {
  try {
    const h = await api("/api/health");
    state.kiroReady = !!h.kiro_configured;
    els.sbKiro.className = "sb-item " + (h.kiro_configured ? "ok" : "off");
    els.sbKiro.textContent = h.kiro_configured
      ? `Kiro ready · ${h.model}`
      : "Kiro offline: add GEMINI_API_KEY to .env and restart";
    if (!h.tracer_ready) {
      els.output.innerHTML = '<span class="err">pg_logger.py / pg_encoder.py are missing next to tracer.py.</span>';
    }
  } catch {
    els.sbKiro.className = "sb-item off";
    els.sbKiro.textContent = "Backend unreachable";
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function createEditor() {
  monaco.editor.defineTheme("kiro-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7394", fontStyle: "italic" },
      { token: "keyword", foreground: "c792ea" },
      { token: "string", foreground: "a5e28b" },
      { token: "number", foreground: "f0b37e" },
    ],
    colors: {
      "editor.background": "#131722",
      "editorGutter.background": "#131722",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#3d4458",
      "editorLineNumber.activeForeground": "#a3abc2",
      "editorCursor.foreground": "#b48cff",
      "editor.selectionBackground": "#7c8cff40",
    },
  });

  const saved = loadSaved();
  const sample = SAMPLES.linked_list;
  editor = monaco.editor.create(els.editor, {
    value: saved ? saved.code : sample.code,
    language: "python",
    theme: "kiro-dark",
    automaticLayout: true,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 21,
    glyphMargin: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderLineHighlight: "all",
    padding: { top: 12 },
    tabSize: 4,
    insertSpaces: true,
    bracketPairColorization: { enabled: true },
    fixedOverflowWidgets: true,
  });

  execDecos = editor.createDecorationsCollection();
  bpDecos = editor.createDecorationsCollection();
  hoverDecos = editor.createDecorationsCollection();
  setBreakpoints(saved ? saved.breakpoints : sample.breakpoints);

  const GLYPH = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
  editor.onMouseDown((e) => {
    if (e.target.type === GLYPH && e.target.position) toggleBreakpoint(e.target.position.lineNumber);
  });
  editor.onMouseMove((e) => {
    if (e.target.type === GLYPH && e.target.position) {
      const line = e.target.position.lineNumber;
      hoverDecos.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "bp-hover-glyph" } }]);
    } else {
      hoverDecos.clear();
    }
  });
  editor.onMouseLeave(() => hoverDecos.clear());
  editor.onDidChangeModelContent(onCodeChanged);
  editor.onDidChangeCursorPosition(() => {});
  updateButtons();
  editor.focus();
}

function breakpointLines() {
  return [...new Set(bpDecos.getRanges().map((r) => r.startLineNumber))].sort((a, b) => a - b);
}

function setBreakpoints(lines) {
  const max = editor.getModel().getLineCount();
  bpDecos.set([...new Set(lines)].filter((l) => l >= 1 && l <= max).map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      glyphMarginClassName: "bp-glyph",
      glyphMarginHoverMessage: { value: "Breakpoint (click to remove)" },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  })));
  onBreakpointsChanged();
}

function toggleBreakpoint(line) {
  const lines = new Set(breakpointLines());
  if (lines.has(line)) lines.delete(line); else lines.add(line);
  setBreakpoints([...lines]);
}

function onBreakpointsChanged() {
  saveSoon();
  if (hasTrace()) {
    computeBpHits();
    renderTimelineMarks();
    updateButtons();
  }
}

function onCodeChanged() {
  saveSoon();
  if (!state.result) return;
  const dirty = editor.getValue() !== state.code;
  if (dirty === state.dirty) return;
  state.dirty = dirty;
  els.dirtyBadge.hidden = !dirty;
  if (dirty) {
    execDecos.clear();
    monaco.editor.setModelMarkers(editor.getModel(), "kiro", []);
    setPill("paused", "Edited · re-run");
    updateButtons();
  } else if (hasTrace()) {
    goTo(state.index);
  }
}

function decorateEditor(step, index, spot) {
  const model = editor.getModel();
  const line = step.line;
  const decos = [];
  const markers = [];
  if (line >= 1 && line <= model.getLineCount()) {
    const isError = step.event === "exception" || index === state.result.error_step;
    const endCol = model.getLineMaxColumn(line);
    decos.push({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: isError ? "error-line-bg" : "current-line-bg",
        glyphMarginClassName: isError ? "error-glyph" : "current-glyph",
      },
    });
    const hints = pointerFacts(model.getLineContent(line), spot).filter((f) => f.mentioned).slice(0, 3);
    if (hints.length) {
      decos.push({
        range: new monaco.Range(line, endCol, line, endCol),
        options: {
          showIfCollapsed: true, // required for injected text on an empty range
          after: {
            content: "   " + hints.map((h) => (h.alert ? "⚠ " : "") + h.text).join("  ·  "),
            inlineClassName: hints.some((h) => h.alert) ? "inline-hint-alert" : "inline-hint",
          },
        },
      });
    }
    if (isError && (step.exception_msg || state.result.message)) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: step.exception_msg || state.result.message,
        startLineNumber: line,
        startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
        endLineNumber: line,
        endColumn: endCol,
      });
    }
    editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Smooth);
  }
  execDecos.set(decos);
  monaco.editor.setModelMarkers(model, "kiro", markers);
}

function flashLine(line) {
  if (!line) return;
  const flash = editor.createDecorationsCollection([{
    range: new monaco.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: "line-flash" },
  }]);
  setTimeout(() => flash.clear(), 2600);
}

// ---------------------------------------------------------------------------
// Running and stepping
// ---------------------------------------------------------------------------

async function run() {
  if (!editor || state.running) return false;
  state.running = true;
  setBusy(els.runBtn, true);
  setPill("busy", "Running…");
  const code = editor.getValue();
  const stdin = els.stdin.value ? els.stdin.value.replace(/\r/g, "").split("\n") : [];

  let res;
  try {
    res = await api("/api/run-code", { code, stdin });
  } catch (err) {
    setPill("error", "Server error");
    els.output.innerHTML = `<span class="err">${esc(err.message)}</span>`;
    return false;
  } finally {
    state.running = false;
    setBusy(els.runBtn, false);
  }

  state.result = res;
  state.code = code;
  state.runId += 1;
  state.dirty = false;
  state.narrations.clear();
  els.dirtyBadge.hidden = true;
  els.runMeta.textContent = `${res.step_count} steps · ${res.duration_ms} ms`;
  showTab("output");

  if (!res.trace.length) {
    showNoTrace(res);
    return true;
  }
  computeBpHits();
  renderTimelineMarks();
  els.slider.max = String(res.trace.length - 1);
  const last = res.trace.length - 1;
  goTo(state.bpHits.length ? state.bpHits[0] : res.error_step ?? last);
  return true;
}

function showNoTrace(res) {
  execDecos.clear();
  const model = editor.getModel();
  const markers = [];
  if (res.error_line && res.error_line <= model.getLineCount()) {
    execDecos.set([{
      range: new monaco.Range(res.error_line, 1, res.error_line, 1),
      options: { isWholeLine: true, className: "error-line-bg", glyphMarginClassName: "error-glyph" },
    }]);
    markers.push({
      severity: monaco.MarkerSeverity.Error, message: res.message || "Error",
      startLineNumber: res.error_line, startColumn: 1,
      endLineNumber: res.error_line, endColumn: model.getLineMaxColumn(res.error_line),
    });
  }
  monaco.editor.setModelMarkers(model, "kiro", markers);
  const label = { error: "Error", timeout: "Timed out", crashed: "Crashed", needs_input: "Needs input" }[res.status] || res.status;
  setPill(res.status === "needs_input" ? "paused" : "error", label);
  els.output.innerHTML = `<span class="${res.status === "needs_input" ? "note" : "err"}">${esc(res.message || label)}</span>`;
  if (res.status === "needs_input") showTab("input");
  els.canvas.innerHTML = `<div class="viz-empty"><p class="viz-empty-title">Nothing to show yet</p><p>${esc(res.message || "")}</p></div>`;
  els.stepLabel.textContent = "";
  els.marks.innerHTML = "";
  els.hereCard.hidden = true;
  updateButtons();
}

function computeBpHits() {
  const bps = new Set(breakpointLines());
  state.bpHits = [];
  state.result.trace.forEach((s, i) => {
    if (s.event === "step_line" && bps.has(s.line)) state.bpHits.push(i);
  });
}

function renderTimelineMarks() {
  const n = state.result.trace.length;
  const pct = (i) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const marks = state.bpHits.map((i) => `<span class="mark bp" style="left:${pct(i)}%"></span>`);
  if (state.result.error_step != null) marks.push(`<span class="mark err" style="left:${pct(state.result.error_step)}%"></span>`);
  els.marks.innerHTML = marks.join("");
}

function goTo(i) {
  if (!hasTrace()) return;
  const trace = state.result.trace;
  i = Math.max(0, Math.min(trace.length - 1, i));
  state.index = i;
  const step = trace[i];

  renderMemory(els.canvas, step, i > 0 ? trace[i - 1] : null);
  const spot = computeSpotlight(step);
  if (state.spotlight) applySpotlight(els.canvas, spot);
  drawArrows(els.canvas);
  if (state.spotlight && !reducedMotion) setTimeout(() => drawArrows(els.canvas), 550);

  els.slider.value = String(i);
  els.stepLabel.textContent = `Step ${i + 1} of ${trace.length}`;
  els.sbPosition.textContent = `Line ${step.line} · ${spot.frameName}`;
  decorateEditor(step, i, spot);
  renderOutput(step, i);
  updatePill(step, i);
  updateButtons();
  if (state.spotlight) renderHereCard(step, i, spot);
  updateChatContext();
}

function step(delta) {
  if (hasTrace() && !state.dirty) goTo(state.index + delta);
}

function continueToBreakpoint() {
  if (!hasTrace() || state.dirty) return;
  const res = state.result;
  const nextBp = state.bpHits.find((h) => h > state.index);
  let target = res.trace.length - 1;
  if (nextBp !== undefined) target = nextBp;
  else if (res.error_step != null && res.error_step > state.index) target = res.error_step;
  goTo(target);
}

function renderOutput(stepData, i) {
  const res = state.result;
  const parts = [];
  if (stepData.stdout) parts.push(esc(stepData.stdout.replace(/\n$/, "")));
  const last = i === res.trace.length - 1;
  if (res.status === "error" && res.error_step != null && i >= res.error_step) {
    parts.push(`<span class="err">${esc(res.message)}${res.error_line ? ` (line ${res.error_line})` : ""}</span>`);
  } else if (last) {
    const notes = {
      ok: '<span class="dim">Program finished.</span>',
      step_limit: `<span class="note">${esc(res.message || "Step limit reached.")}</span>`,
      needs_input: `<span class="note">The program called input(${esc(JSON.stringify(res.message || ""))}) but no input was left. Add a line in the Input tab and run again.</span>`,
    };
    if (notes[res.status]) parts.push(notes[res.status]);
  }
  els.output.innerHTML = parts.length ? parts.join("\n") : '<span class="dim">(no output yet)</span>';
}

function updatePill(stepData, i) {
  const res = state.result;
  const last = i === res.trace.length - 1;
  if (stepData.event === "exception") return setPill("error", `Exception · line ${stepData.line}`);
  if (state.bpHits.includes(i)) return setPill("paused", `Breakpoint · line ${stepData.line}`);
  if (last) {
    if (res.status === "ok") return setPill("ok", "Finished");
    if (res.status === "step_limit") return setPill("paused", "Step limit reached");
    if (res.status === "needs_input") return setPill("paused", "Waiting for input");
  }
  setPill("paused", `Paused · line ${stepData.line}`);
}

function setPill(kind, text) {
  els.runStatus.dataset.kind = kind;
  els.runStatus.textContent = text;
}

function updateButtons() {
  const ok = hasTrace() && !state.dirty;
  const n = ok ? state.result.trace.length : 0;
  const i = state.index;
  els.firstBtn.disabled = els.prevBtn.disabled = !ok || i === 0;
  els.nextBtn.disabled = els.lastBtn.disabled = els.continueBtn.disabled = !ok || i >= n - 1;
  els.slider.disabled = !ok;
}

function setBusy(btn, busy) {
  btn.classList.toggle("is-busy", busy);
  btn.disabled = busy;
}

// ---------------------------------------------------------------------------
// Visualize ("you are here" spotlight)
// ---------------------------------------------------------------------------

function pointerFacts(lineText, spot) {
  const facts = [];
  const mentions = (expr) => new RegExp(`(^|[^\\w.])${expr}\\b`).test(lineText);
  const derefs = (expr) => new RegExp(`(^|[^\\w.])${expr}\\s*[.\\[]`).test(lineText);
  for (const p of spot.pointers) {
    const name = p.name;
    if (p.isNone) {
      const alert = derefs(name);
      facts.push({
        mentioned: mentions(name), alert, text: `${name} is None`,
        html: `<code>${esc(name)}</code> is <code>None</code>${alert ? ", and this line reads through it" : ""}`,
      });
      continue;
    }
    facts.push({
      mentioned: mentions(name), alert: false,
      text: `${name} → ${p.label}${p.preview ? ` (${p.preview})` : ""}`,
      html: `<code>${esc(name)}</code> → ${esc(p.label)}${p.preview ? ` <span class="dim">(${esc(p.preview)})</span>` : ""}`,
    });
    for (const attr of p.nullAttrs) {
      const path = `${name}\\.${attr}`;
      const alert = derefs(path);
      facts.push({
        mentioned: mentions(path), alert, text: `${name}.${attr} is None`,
        html: `<code>${esc(name)}.${esc(attr)}</code> is <code>None</code>${alert ? ", and this line reads through it" : ""}`,
      });
    }
  }
  facts.sort((a, b) => (b.alert - a.alert) || (b.mentioned - a.mentioned));
  return facts;
}

async function visualize() {
  if (!editor || state.running) return;
  if (!hasTrace() || state.dirty) {
    const ok = await run();
    if (!ok || !hasTrace()) return;
  }
  els.visualizeBtn.classList.add("is-active");
  els.visualizeBtn.setAttribute("aria-pressed", "true");
  await playScan();
  state.spotlight = true;
  goTo(state.index);
  scrollToSpot(els.canvas);
  flashLine(currentStep().line);
  narrate();
}

async function playScan() {
  if (reducedMotion) return;
  els.scan.hidden = false;   // display:none -> block restarts the CSS animations
  await sleep(1100);
  els.scan.hidden = true;
}

function closeSpotlight() {
  state.spotlight = false;
  els.hereCard.hidden = true;
  els.visualizeBtn.classList.remove("is-active");
  els.visualizeBtn.setAttribute("aria-pressed", "false");
  if (hasTrace() && !state.dirty) goTo(state.index);
}

function renderHereCard(stepData, i, spot) {
  els.hereCard.hidden = false;
  const lineText = (state.code.split("\n")[stepData.line - 1] || "").trim();
  const exception = stepData.exception_msg
    ? `<br><span class="err-text">✖ ${esc(stepData.exception_msg)}</span>` : "";
  els.hereWhere.innerHTML =
    `Line <b>${stepData.line}</b> in <code>${esc(spot.frameName)}</code> · step ${i + 1} of ${state.result.trace.length}` +
    `<br><code>${esc(lineText)}</code>${exception}`;
  const facts = pointerFacts(lineText, spot);
  els.herePointers.innerHTML = facts.length
    ? facts.map((f) => `<li class="${f.alert ? "alert" : ""}">${f.alert ? "⚠ " : ""}${f.html}</li>`).join("")
    : '<li class="dim">No pointers in this frame yet.</li>';

  const cached = state.narrations.get(`${state.runId}:${i}`);
  if (cached) {
    showNarration(cached);
  } else {
    els.hereNarration.className = "here-narration dim";
    els.hereNarration.textContent = state.kiroReady ? "" : "Add GEMINI_API_KEY to .env for Kiro's narration.";
    els.hereNarrate.hidden = !state.kiroReady;
  }
}

function showNarration(text) {
  els.hereNarrate.hidden = true;
  els.hereNarration.className = "here-narration";
  els.hereNarration.innerHTML = `<span class="by">Kiro:</span> ${formatText(text)}`;
}

async function narrate() {
  if (!state.kiroReady || !hasTrace()) return;
  const key = `${state.runId}:${state.index}`;
  if (state.narrations.has(key)) return showNarration(state.narrations.get(key));
  els.hereNarrate.hidden = true;
  els.hereNarration.className = "here-narration dim";
  els.hereNarration.innerHTML = '<span class="by">Kiro</span> is reading this step…';
  try {
    const { summary } = await api("/api/explain-step", {
      code: state.code, trace_step: currentStep(), step_index: state.index, step_count: state.result.trace.length,
    });
    state.narrations.set(key, summary);
    if (key === `${state.runId}:${state.index}` && state.spotlight) showNarration(summary);
  } catch (err) {
    if (key !== `${state.runId}:${state.index}`) return;
    els.hereNarration.className = "here-narration dim";
    els.hereNarration.textContent = err.message;
    els.hereNarrate.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Kiro chat
// ---------------------------------------------------------------------------

function formatText(text) {
  return esc(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

function addMsg(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  if (kind === "kiro" || kind === "user") div.innerHTML = formatText(text);
  else div.textContent = text;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return div;
}

function addTyping() {
  const div = document.createElement("div");
  div.className = "msg kiro";
  div.setAttribute("aria-label", "Kiro is typing");
  div.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return div;
}

function setChatBusy(busy) {
  state.chat.busy = busy;
  els.chatSend.disabled = busy;
  els.chatQuick.querySelectorAll("button").forEach((b) => { b.disabled = busy; });
}

function openChat({ ask = false } = {}) {
  const wasEmpty = !els.chatLog.childElementCount;
  els.chat.hidden = false;
  els.chatBtn.setAttribute("aria-expanded", "true");
  updateChatContext();
  els.chatInput.focus();
  if (wasEmpty || ask) askKiro(null);
}

function closeChat() {
  els.chat.hidden = true;
  els.chatBtn.setAttribute("aria-expanded", "false");
}

async function askKiro(message) {
  if (state.chat.busy) return;
  if (!state.kiroReady) {
    if (message) addMsg("user", message);
    addMsg("error", "Kiro isn't set up yet. Create a key at aistudio.google.com/app/apikey, put GEMINI_API_KEY=... in .env, and restart the server.");
    return;
  }
  if (!hasTrace() || state.dirty) {
    addMsg("system", "Running your code so Kiro can see its memory…");
    const ok = await run();
    if (!ok || !hasTrace()) {
      addMsg("error", "Kiro needs a run with at least one step. Check the Output panel.");
      return;
    }
  }
  if (message) addMsg("user", message);

  const chat = state.chat;
  let context = "none";
  if (!chat.interactionId || chat.runId !== state.runId) context = "full";
  else if (chat.index !== state.index) context = "state";

  const typing = addTyping();
  setChatBusy(true);
  try {
    const res = await api("/api/ask-kiro", {
      code: state.code,
      trace_step: currentStep(),
      step_index: state.index,
      step_count: state.result.trace.length,
      message,
      interaction_id: chat.interactionId,
      context,
    });
    chat.interactionId = res.interaction_id;
    chat.runId = state.runId;
    chat.index = state.index;
    typing.remove();
    if (res.restarted) addMsg("system", "Started a fresh conversation.");
    addMsg("kiro", res.reply);
  } catch (err) {
    typing.remove();
    addMsg("error", err.message);
  } finally {
    setChatBusy(false);
  }
}

function updateChatContext() {
  els.chatContext.textContent = hasTrace() && !state.dirty
    ? `Looking at step ${state.index + 1} · line ${currentStep().line}`
    : "Socratic tutor";
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function showTab(which) {
  const out = which === "output";
  els.output.hidden = !out;
  els.stdinWrap.hidden = out;
  els.tabOutput.classList.toggle("is-active", out);
  els.tabInput.classList.toggle("is-active", !out);
  els.tabOutput.setAttribute("aria-selected", String(out));
  els.tabInput.setAttribute("aria-selected", String(!out));
}

function loadSample(key) {
  const sample = SAMPLES[key];
  if (!sample || !editor) return;
  const model = editor.getModel();
  editor.pushUndoStop();
  editor.executeEdits("sample", [{ range: model.getFullModelRange(), text: sample.code }]);
  editor.pushUndoStop();
  setBreakpoints(sample.breakpoints);
  closeSpotlight();
  run();
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: editor.getValue(), breakpoints: breakpointLines() }));
    } catch { /* storage full or disabled */ }
  }, 300);
}

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return data && typeof data.code === "string" ? data : null;
  } catch {
    return null;
  }
}

function bindUI() {
  els.runBtn.addEventListener("click", run);
  els.firstBtn.addEventListener("click", () => goTo(0));
  els.prevBtn.addEventListener("click", () => step(-1));
  els.nextBtn.addEventListener("click", () => step(1));
  els.lastBtn.addEventListener("click", () => goTo(Infinity));
  els.continueBtn.addEventListener("click", continueToBreakpoint);
  els.slider.addEventListener("input", () => goTo(Number(els.slider.value)));
  els.visualizeBtn.addEventListener("click", () => (state.spotlight ? closeSpotlight() : visualize()));
  els.chatBtn.addEventListener("click", () => (els.chat.hidden ? openChat() : closeChat()));
  els.sample.addEventListener("change", () => {
    loadSample(els.sample.value);
    els.sample.value = "";
  });
  els.tabOutput.addEventListener("click", () => showTab("output"));
  els.tabInput.addEventListener("click", () => showTab("input"));

  els.hereClose.addEventListener("click", closeSpotlight);
  els.hereChat.addEventListener("click", () => openChat({ ask: true }));
  els.hereNarrate.addEventListener("click", narrate);

  els.chatClose.addEventListener("click", closeChat);
  els.chatReset.addEventListener("click", () => {
    els.chatLog.innerHTML = "";
    state.chat.interactionId = null;
    addMsg("system", "New conversation.");
    askKiro(null);
  });
  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || state.chat.busy) return;
    els.chatInput.value = "";
    askKiro(text);
  });
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
  els.chatQuick.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick]");
    if (btn) askKiro(btn.dataset.quick);
  });

  bindSplitter();
  bindShortcuts();

  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => drawArrows(els.canvas));
  }).observe(els.vizScroll);
}

function bindSplitter() {
  let pct = 52;
  const apply = () => els.workspace.style.setProperty("--left", `${pct}%`);
  els.splitter.addEventListener("pointerdown", (e) => {
    const rect = els.workspace.getBoundingClientRect();
    els.splitter.setPointerCapture(e.pointerId);
    els.splitter.classList.add("is-dragging");
    const move = (ev) => {
      pct = Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
      apply();
    };
    const up = () => {
      els.splitter.classList.remove("is-dragging");
      els.splitter.removeEventListener("pointermove", move);
      drawArrows(els.canvas);
    };
    els.splitter.addEventListener("pointermove", move);
    els.splitter.addEventListener("pointerup", up, { once: true });
  });
  els.splitter.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    pct = Math.min(75, Math.max(25, pct + (e.key === "ArrowLeft" ? -2 : 2)));
    apply();
  });
}

function bindShortcuts() {
  // Capture phase so these win over Monaco's own bindings (e.g. Ctrl+Shift+K = delete line).
  window.addEventListener("keydown", (e) => {
    const inChat = els.chat.contains(e.target);
    const inField = !!(e.target.closest && e.target.closest("textarea, input, select"));
    const inEditor = !!(e.target.closest && e.target.closest(".monaco-editor"));
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if ((e.ctrlKey || e.metaKey) && key === "Enter" && !inChat) { handled(); run(); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "v") { handled(); visualize(); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "k") { handled(); els.chat.hidden ? openChat() : closeChat(); }
    else if (key === "F9" && editor) { handled(); toggleBreakpoint(editor.getPosition().lineNumber); }
    else if (key === "F8") { handled(); continueToBreakpoint(); }
    else if (e.altKey && key === "ArrowRight") { handled(); step(1); }
    else if (e.altKey && key === "ArrowLeft") { handled(); step(-1); }
    else if (key === "Escape" && inChat) { handled(); closeChat(); }
    else if (key === "Escape" && state.spotlight && !inEditor) { handled(); closeSpotlight(); }
    else if (!inField && key === "Home") { handled(); goTo(0); }
    else if (!inField && key === "End") { handled(); goTo(Infinity); }
  }, true);
}
