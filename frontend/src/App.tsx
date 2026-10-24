import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { ChatDrawer, type ChatMessage, type QuickKind } from "./components/ChatDrawer";
import { EditorPane, type EditorHandle, type ExecMark } from "./components/EditorPane";
import { FixPanel } from "./components/FixPanel";
import { HereCard, type NarrationState } from "./components/HereCard";
import { MemoryView } from "./components/MemoryView";
import { TutorSettingsPanel } from "./components/TutorSettings";
import { answerFromNotes } from "./quiz/notes";
import { planQuiz, suggestFix, type Question } from "./quiz/questionBank";
import { DEFAULT_SAMPLE, SAMPLES } from "./samples";
import { aiLabel, isAiReady, loadSettings, saveSettings, type TutorSettings } from "./tutor/settings";
import { describeState } from "./tutor/state";
import { Tutor, offlineHint, providerName } from "./tutor/tutor";
import type { Health, RunResult, TraceStep } from "./types";
import { computeSpotlight, pointerFacts } from "./viz/model";

const STORAGE_KEY = "kiro-visualizer:v1";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything an async action needs about the current run, captured at one moment. */
interface Snapshot {
  result: RunResult;
  code: string;
  runId: number;
  index: number;
}

type PillKind = "idle" | "ok" | "paused" | "error" | "busy";

function loadSaved(): { code: string; breakpoints: number[] } | null {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return data && typeof data.code === "string" ? data : null;
  } catch {
    return null;
  }
}

function breakpointHits(result: RunResult | null, lines: number[]): number[] {
  if (!result) return [];
  const set = new Set(lines);
  const hits: number[] = [];
  result.trace.forEach((s, i) => {
    if (s.event === "step_line" && set.has(s.line)) hits.push(i);
  });
  return hits;
}

export default function App() {
  const editor = useRef<EditorHandle>(null);
  const saved = useMemo(loadSaved, []);
  const initial = saved ?? SAMPLES[DEFAULT_SAMPLE];

  const [health, setHealth] = useState<Health | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [ranCode, setRanCode] = useState("");
  const [runId, setRunId] = useState(0);
  const [index, setIndex] = useState(0);
  const [breakpoints, setBreakpoints] = useState<number[]>(initial.breakpoints);
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [stdin, setStdin] = useState("");
  const [tab, setTab] = useState<"output" | "input">("output");
  const [leftPct, setLeftPct] = useState(52);
  const [dragging, setDragging] = useState(false);

  const [spotlightOn, setSpotlightOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const narrations = useRef(new Map<string, string>());
  const [narration, setNarration] = useState<{ key: string; state: NarrationState }>({ key: "", state: { status: "idle" } });

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  /** Which run/step the AI tutor last saw, so follow-ups only send what changed. */
  const chatSession = useRef<{ runId: number | null; index: number | null }>({
    runId: null,
    index: null,
  });
  const msgId = useRef(0);
  /** Built-in questions for the current run; the AI is only used once these run out (or for typed questions). */
  const quizQueue = useRef<{ runId: number; questions: Question[]; next: number; summary: string; summaryShown: boolean } | null>(null);
  /** After an AI rate limit, don't call it again until this time (ms). */
  const aiCooldownUntil = useRef(0);

  // AI tutor: provider, model and the user's own key (⚙ AI settings, stored in this browser only).
  const [tutorSettings, setTutorSettings] = useState<TutorSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tutorRef = useRef(new Tutor(tutorSettings));
  const offlineNoticeShown = useRef(false);

  // ----- derived -----
  const kiroReady = isAiReady(tutorSettings);
  const trace = result?.trace ?? [];
  const hasTrace = trace.length > 0;
  const usable = hasTrace && !dirty;
  const step: TraceStep | null = hasTrace ? trace[Math.min(index, trace.length - 1)] : null;
  const last = trace.length - 1;
  const bpHits = useMemo(() => breakpointHits(result, breakpoints), [result, breakpoints]);
  const spot = useMemo(() => (step ? computeSpotlight(step) : null), [step]);
  const lineText = step ? (ranCode.split("\n")[step.line - 1] ?? "").trim() : "";
  const facts = useMemo(() => (spot ? pointerFacts(lineText, spot) : []), [spot, lineText]);
  const stepKey = `${runId}:${index}`;
  // When a run errors, work out a suggested fix from the user's own code (null when it ran fine).
  const fix = useMemo(() => (result && !dirty ? suggestFix(result, ranCode) : null), [result, ranCode, dirty]);

  // Latest values for async handlers and global shortcuts (avoids stale closures).
  const latest = useRef({ result, ranCode, runId, index, dirty, kiroReady, chatBusy, messages, stepKey, spotlightOn, chatOpen, tutorSettings });
  latest.current = { result, ranCode, runId, index, dirty, kiroReady, chatBusy, messages, stepKey, spotlightOn, chatOpen, tutorSettings };
  const runningRef = useRef(false);

  const snapshot = (): Snapshot | null => {
    const l = latest.current;
    return l.result && l.result.trace.length && !l.dirty
      ? { result: l.result, code: l.ranCode, runId: l.runId, index: l.index }
      : null;
  };

  /** Like snapshot(), but also accepts a run with no steps (a syntax error the quiz can still ask about). */
  const quizSnapshot = (): Snapshot | null => {
    const l = latest.current;
    return l.result && !l.dirty ? { result: l.result, code: l.ranCode, runId: l.runId, index: l.index } : null;
  };

  // ----- boot -----
  useEffect(() => {
    api.health().then(setHealth, () => setHealthFailed(true));
  }, []);

  // ----- persistence -----
  const saveTimer = useRef(0);
  const saveSoon = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const ed = editor.current;
      if (!ed) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: ed.getValue(), breakpoints: ed.getBreakpoints() }));
      } catch {
        /* storage full or disabled */
      }
    }, 300);
  };

  // ----- running and stepping -----
  const run = useCallback(async (): Promise<Snapshot | null> => {
    const ed = editor.current;
    if (!ed || runningRef.current) return null;
    runningRef.current = true;
    setRunning(true);
    setRunError(null);
    const code = ed.getValue();
    const lines = stdin ? stdin.replace(/\r/g, "").split("\n") : [];
    try {
      const res = await api.runCode(code, lines);
      const newRunId = latest.current.runId + 1;
      const bps = ed.getBreakpoints();
      const hits = breakpointHits(res, bps);
      const start = res.trace.length ? (hits[0] ?? res.error_step ?? res.trace.length - 1) : 0;
      narrations.current.clear();
      setResult(res);
      setRanCode(code);
      setRunId(newRunId);
      setIndex(start);
      setBreakpoints(bps);
      setDirty(false);
      setTab(!res.trace.length && res.status === "needs_input" ? "input" : "output");
      return { result: res, code, runId: newRunId, index: start };
    } catch (err) {
      setRunError((err as Error).message);
      return null;
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [stdin]);

  const goTo = (i: number) => {
    const res = latest.current.result;
    if (!res || !res.trace.length || latest.current.dirty) return;
    setIndex(Math.max(0, Math.min(res.trace.length - 1, i)));
  };

  const continueToBreakpoint = () => {
    const l = latest.current;
    if (!l.result || !l.result.trace.length || l.dirty) return;
    const hits = breakpointHits(l.result, editor.current?.getBreakpoints() ?? []);
    const next = hits.find((h) => h > l.index);
    let target = l.result.trace.length - 1;
    if (next !== undefined) target = next;
    else if (l.result.error_step != null && l.result.error_step > l.index) target = l.result.error_step;
    setIndex(target);
  };

  const onCodeChange = (code: string) => {
    saveSoon();
    if (latest.current.result) setDirty(code !== latest.current.ranCode);
  };

  const onBreakpointsChange = (lines: number[]) => {
    setBreakpoints(lines);
    saveSoon();
  };

  const loadSample = (key: string) => {
    const sample = SAMPLES[key];
    const ed = editor.current;
    if (!sample || !ed) return;
    ed.setValue(sample.code);
    ed.setBreakpoints(sample.breakpoints);
    setSpotlightOn(false);
    void run();
  };

  // ----- Visualize -----
  const narrate = async (snap: Snapshot) => {
    const key = `${snap.runId}:${snap.index}`;
    const cached = narrations.current.get(key);
    if (cached) return setNarration({ key, state: { status: "done", text: cached } });
    if (!latest.current.kiroReady) return;
    setNarration({ key, state: { status: "loading" } });
    try {
      const summary = await new Tutor(latest.current.tutorSettings).narrate(
        describeState(snap.code, snap.result.trace[snap.index], snap.index, snap.result.trace.length),
      );
      narrations.current.set(key, summary);
      setNarration((n) => (n.key === key ? { key, state: { status: "done", text: summary } } : n));
    } catch (err) {
      setNarration((n) => (n.key === key ? { key, state: { status: "error", text: (err as Error).message } } : n));
    }
  };

  const visualize = async () => {
    if (runningRef.current) return;
    let snap = snapshot();
    if (!snap) {
      snap = await run();
      if (!snap || !snap.result.trace.length) return;
    }
    if (!reducedMotion) {
      setScanning(true);
      await sleep(1100);
      setScanning(false);
    }
    setSpotlightOn(true);
    setFocusToken((t) => t + 1);
    editor.current?.flashLine(snap.result.trace[snap.index].line);
    // The "You are here" card is built locally. AI narration only runs if the learner asks for it
    // ("Explain with AI"), which saves the provider's quota for the chat.
    const cached = narrations.current.get(`${snap.runId}:${snap.index}`);
    if (cached) setNarration({ key: `${snap.runId}:${snap.index}`, state: { status: "done", text: cached } });
  };

  const narrationForStep: NarrationState = (() => {
    if (narration.key === stepKey) return narration.state;
    const cached = narrations.current.get(stepKey);
    return cached ? { status: "done", text: cached } : { status: "idle" };
  })();

  // ----- Kiro chat -----
  const addMsg = (kind: ChatMessage["kind"], text: string, title?: string, badge?: string) =>
    setMessages((m) => [...m, { id: ++msgId.current, kind, text, title, badge }]);

  const cooldownLeft = () => Math.max(0, Math.ceil((aiCooldownUntil.current - Date.now()) / 1000));

  /** When the AI can't be used right now: offer the next built-in question instead of an error. */
  const fallBackToBank = (why: string) => {
    const snap = quizSnapshot();
    if (snap && !activeQuiz() && showNextQuestion(snap)) {
      addMsg("system", `${why} Here's a quick check from the built-in bank instead.`);
      return;
    }
    addMsg("system", `${why} The quick-check buttons and hints above still work without it.`);
  };

  /**
   * One AI tutor turn (provider, model and key from ⚙ AI settings). `message` null = ask an opening question.
   * `shown` is what appears in the chat if it differs from what the AI gets.
   * Falls back to the built-in quiz or an offline hint when the AI isn't set up, is cooling down, or fails.
   */
  const askKiro = async (message: string | null, shown: string | null = message) => {
    if (latest.current.chatBusy) return;
    const settings = latest.current.tutorSettings;
    let snap = snapshot();
    if (!snap) {
      addMsg("system", "Running your code so Kiro can see its memory…");
      snap = await run();
      if (!snap || !snap.result.trace.length) {
        addMsg("error", "Kiro needs a run with at least one step. Check the Output panel.");
        return;
      }
    }
    if (shown) addMsg("user", shown);

    if (!isAiReady(settings)) {
      if (!message) return fallBackToBank("Kiro's AI isn't set up, and the built-in bank has nothing left for this run.");
      const hint = offlineHint(`Student: "${message}"\n${describeState(snap.code, snap.result.trace[snap.index], snap.index, snap.result.trace.length, false)}`);
      addMsg("kiro", hint, undefined, "offline hint");
      if (!offlineNoticeShown.current) {
        offlineNoticeShown.current = true;
        addMsg("system", "That's an offline hint. To have an AI answer what you type, pick a provider and paste your API key in ⚙ AI settings.");
      }
      return;
    }
    if (cooldownLeft() > 0) {
      return fallBackToBank(`Kiro's AI is resting for about ${cooldownLeft()} more seconds (${providerName(settings)} rate limit).`);
    }

    // Send the full program + state at the start of a conversation or after a re-run, only the state
    // when the learner moved to another step, and nothing extra when nothing changed.
    const session = chatSession.current;
    const tutor = tutorRef.current;
    const stepData = snap.result.trace[snap.index];
    const count = snap.result.trace.length;
    const fresh = !tutor.history.length || session.runId !== snap.runId;
    const stateUpdate = fresh
      ? describeState(snap.code, stepData, snap.index, count, true)
      : session.index !== snap.index
        ? describeState(snap.code, stepData, snap.index, count, false)
        : null;

    setChatBusy(true);
    latest.current.chatBusy = true;
    const id = ++msgId.current;
    let streamed = "";
    const onToken = (chunk: string) => {
      if (!streamed) setMessages((m) => [...m, { id, kind: "kiro", text: "" }]);
      streamed += chunk;
      const text = streamed;
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text } : x)));
    };
    try {
      const res = message ? await tutor.reply(message, stateUpdate, onToken) : await tutor.ask(stateUpdate ?? describeState(snap.code, stepData, snap.index, count), onToken);
      chatSession.current = { runId: snap.runId, index: snap.index };
      if (res.source === "ai") {
        setMessages((m) => (m.some((x) => x.id === id) ? m.map((x) => (x.id === id ? { ...x, text: res.text } : x)) : [...m, { id, kind: "kiro", text: res.text }]));
        return;
      }
      // The AI call failed: drop any partial text and fall back without a scary error.
      setMessages((m) => m.filter((x) => x.id !== id));
      const err = res.error;
      if (err?.kind === "rate") {
        const secs = Math.ceil(err.retryAfter ?? 60);
        aiCooldownUntil.current = Date.now() + secs * 1000;
        latest.current.chatBusy = false;
        return fallBackToBank(`${err.message}, so Kiro's AI is resting for about ${secs} seconds.`);
      }
      if (err?.kind === "auth" || err?.kind === "model") {
        addMsg("error", err.message);
        return;
      }
      latest.current.chatBusy = false;
      if (!message) return fallBackToBank(`Kiro's AI didn't answer (${err?.message ?? "unknown error"}).`);
      addMsg("kiro", res.text, undefined, "offline hint");
      addMsg("system", `Kiro's AI didn't answer (${err?.message ?? "unknown error"}), so that's an offline hint.`);
    } finally {
      setChatBusy(false);
    }
  };

  // ----- built-in quiz (no AI call) -----
  const activeQuiz = () =>
    [...latest.current.messages].reverse().find((m) => m.kind === "quiz" && m.quiz && !m.quiz.solved);

  /** The quiz plan for this run: the whole trace is scanned once and the matching questions queued. */
  const queueFor = (snap: Snapshot) => {
    let queue = quizQueue.current;
    if (!queue || queue.runId !== snap.runId) {
      const plan = planQuiz(snap.result, snap.code);
      queue = { runId: snap.runId, questions: plan.questions, next: 0, summary: plan.summary, summaryShown: false };
      quizQueue.current = queue;
    }
    return queue;
  };

  /** Shows the next built-in question for this run. Returns false when there are none left. */
  const showNextQuestion = (snap: Snapshot): boolean => {
    const queue = queueFor(snap);
    if (queue.next >= queue.questions.length) return false;
    const question = queue.questions[queue.next++];
    const scan: ChatMessage[] = [];
    if (!queue.summaryShown && queue.summary) {
      queue.summaryShown = true;
      const n = queue.questions.length;
      scan.push({ id: ++msgId.current, kind: "scan", text: `${queue.summary} I picked ${n} question${n === 1 ? "" : "s"} about what I found.` });
    }
    setMessages((m) => [
      ...m,
      ...scan,
      {
        id: ++msgId.current,
        kind: "quiz",
        text: "",
        quiz: { question, number: queue.next, total: queue.questions.length, picked: [], solved: false, hintsShown: 0 },
      },
    ]);
    // Jump to the step the question is about, so the diagram matches it, and point at the line in the editor.
    if (question.step >= 0 && question.step < snap.result.trace.length) setIndex(question.step);
    if (question.focusLine) {
      const line = question.focusLine;
      window.setTimeout(() => editor.current?.flashLine(line), 50);
    }
    return true;
  };

  /** Opening move when the chat opens: built-in questions first; the AI only if nothing in the bank fits. */
  const beginTutoring = async () => {
    if (latest.current.chatBusy || activeQuiz()) return;
    let snap = quizSnapshot();
    if (!snap) {
      addMsg("system", "Running your code so Kiro can see its memory…");
      snap = await run();
      if (!snap) {
        addMsg("error", "The run didn't work. Check the Output panel.");
        return;
      }
    }
    if (showNextQuestion(snap)) return;
    if (!snap.result.trace.length) {
      addMsg("system", "Your program didn't produce any steps to look at. Check the Output panel, fix what it says, and run again.");
      return;
    }
    const queue = queueFor(snap);
    addMsg(
      "system",
      queue.questions.length
        ? "That's every built-in question for this run. Asking Kiro's AI for a harder one…"
        : "Nothing in the built-in question bank fits this program, so Kiro's AI is taking this one.",
    );
    await askKiro(null);
  };

  const pickAnswer = (messageId: number, option: number) =>
    setMessages((ms) =>
      ms.map((m) =>
        m.id === messageId && m.quiz && !m.quiz.solved && !m.quiz.picked.includes(option)
          ? { ...m, quiz: { ...m.quiz, picked: [...m.quiz.picked, option], solved: option === m.quiz.question.correct } }
          : m,
      ),
    );

  const nextQuestion = () => {
    const snap = quizSnapshot();
    if (snap && showNextQuestion(snap)) return;
    void askKiro(null); // built-in questions used up: Kiro's AI asks a harder one
  };

  /** Matches a typed answer ("b", "B)", or the option's text) to the open built-in question. */
  const matchTypedAnswer = (text: string): { id: number; option: number } | null => {
    const quiz = activeQuiz();
    if (!quiz?.quiz) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[`'"().,:;!?]/g, " ").replace(/\s+/g, " ").trim();
    const t = norm(text);
    if (!t) return null;
    const options = quiz.quiz.question.options.map(norm);
    // Option text first: when the options are node names like 'b', typing "b" means the node.
    const exact = options.findIndex((o) => o === t);
    if (exact >= 0) return { id: quiz.id, option: exact };
    const letter = t.match(/^(?:option |answer )?([abc])$/);
    if (letter) return { id: quiz.id, option: "abc".indexOf(letter[1]) };
    if (t.length < 2) return null;
    // The typed text names exactly one option (e.g. "current.next" for "`current.next`").
    const containing = options.map((o, i) => [o, i] as const).filter(([o]) => o.startsWith(t) || (t.length >= 4 && o.includes(t)));
    return containing.length === 1 ? { id: quiz.id, option: containing[0][1] } : null;
  };

  const quickReply = (kind: QuickKind, text: string) => {
    const quiz = activeQuiz();
    // Hints for a built-in question are already written; reveal the next one locally.
    if (quiz?.quiz && kind === "found") {
      addMsg("system", "Nice. Pick the option that matches what you found (or type it), and I'll check it.");
      return;
    }
    if (quiz?.quiz && (kind === "hint" || kind === "where")) {
      const q = quiz.quiz;
      const shown = Math.max(q.hintsShown, Math.min(q.picked.length, q.question.hints.length));
      if (shown < q.question.hints.length) {
        setMessages((ms) => ms.map((m) => (m.id === quiz.id && m.quiz ? { ...m, quiz: { ...m.quiz, hintsShown: shown + 1 } } : m)));
        return;
      }
    }
    void sendToKiro(text);
  };

  /**
   * A typed message:
   *   1. an answer to the open built-in question ("b", or the option's text) -> graded right there
   *   2. with an AI provider set up -> the AI tutor answers anything, basic questions included
   *   3. offline, or while the AI is cooling down -> built-in notes for "what is X?", else an offline hint
   */
  const sendToKiro = (text: string) => {
    const typed = matchTypedAnswer(text);
    if (typed) {
      addMsg("user", text);
      pickAnswer(typed.id, typed.option);
      return;
    }
    const aiAvailable = isAiReady(latest.current.tutorSettings) && cooldownLeft() === 0;
    const note = aiAvailable ? null : answerFromNotes(text);
    if (note) {
      addMsg("user", text);
      addMsg("notes", note.text, note.title);
      return;
    }
    const quiz = activeQuiz()?.quiz;
    const message = quiz ? `(About the open quiz question "${quiz.question.prompt.replace(/`/g, "")}") ${text}` : text;
    return askKiro(message, text);
  };

  const saveTutorSettings = (s: TutorSettings) => {
    saveSettings(s);
    setTutorSettings(s);
    tutorRef.current.reload(s);
    tutorRef.current.resetConversation();
    aiCooldownUntil.current = 0;
    setSettingsOpen(false);
    addMsg(
      "system",
      isAiReady(s)
        ? `AI tutor set to ${aiLabel(s)}. The quick-check quiz still comes first; the AI answers what you type.`
        : "AI tutor is offline: you'll get the built-in quiz, notes and offline hints.",
    );
  };

  const openChat = (ask = false) => {
    const wasEmpty = latest.current.messages.length === 0;
    setChatOpen(true);
    if (wasEmpty || ask) void beginTutoring();
  };

  /** Drop the suggested fix into the editor. The user reviews it and runs again. */
  const applyFix = (patched: string) => {
    const ed = editor.current;
    if (!ed) return;
    ed.setValue(patched);
    setDirty(true);
    saveSoon();
    ed.focus();
  };

  /** "Ask AI" on the error: open the chat and have the tutor explain this specific error. */
  const askAboutError = () => {
    const f = fix;
    setChatOpen(true);
    if (!f) return;
    const where = f.errorLine ? ` on line ${f.errorLine}` : "";
    void sendToKiro(`My program stopped with "${f.error}"${where}. Why did that happen, and how do I fix it?`);
  };

  const resetChat = () => {
    chatSession.current = { runId: null, index: null };
    tutorRef.current.resetConversation();
    quizQueue.current = null;
    setMessages([{ id: ++msgId.current, kind: "system", text: "New conversation." }]);
    latest.current.messages = [];
    void beginTutoring();
  };

  // ----- keyboard shortcuts (capture phase so they win over Monaco's own bindings) -----
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const inChat = !!target.closest?.(".chat-drawer");
    const inField = !!target.closest?.("textarea, input, select");
    const inEditor = !!target.closest?.(".monaco-editor");
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const mod = e.ctrlKey || e.metaKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && key === "Enter" && !inChat) {
      handled();
      void run();
    } else if (mod && e.shiftKey && key === "v") {
      handled();
      void visualize();
    } else if (mod && e.shiftKey && key === "k") {
      handled();
      if (latest.current.chatOpen) setChatOpen(false);
      else openChat();
    } else if (key === "F9") {
      handled();
      editor.current?.toggleBreakpointAtCursor();
    } else if (key === "F8") {
      handled();
      continueToBreakpoint();
    } else if (e.altKey && key === "ArrowRight") {
      handled();
      goTo(latest.current.index + 1);
    } else if (e.altKey && key === "ArrowLeft") {
      handled();
      goTo(latest.current.index - 1);
    } else if (key === "Escape" && inChat) {
      handled();
      setChatOpen(false);
    } else if (key === "Escape" && latest.current.spotlightOn && !inEditor) {
      handled();
      setSpotlightOn(false);
    } else if (!inField && key === "Home") {
      handled();
      goTo(0);
    } else if (!inField && key === "End") {
      handled();
      goTo(Infinity);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ----- splitter -----
  const workspaceRef = useRef<HTMLElement>(null);
  const onSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = workspaceRef.current!.getBoundingClientRect();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => setLeftPct(Math.min(75, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      setDragging(false);
      el.removeEventListener("pointermove", move);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
  };

  // ----- view: editor decorations -----
  const exec: ExecMark | null = (() => {
    if (dirty || !result) return null;
    if (step) {
      const isError = step.event === "exception" || index === result.error_step;
      const hints = facts.filter((f) => f.mentioned).slice(0, 3);
      return {
        line: step.line,
        isError,
        hint: hints.length
          ? { text: hints.map((h) => (h.alert ? "⚠ " : "") + h.text).join("  ·  "), alert: hints.some((h) => h.alert) }
          : null,
        marker: isError ? (step.exception_msg ?? result.message) : null,
        reveal: true,
      };
    }
    if (result.error_line) {
      return { line: result.error_line, isError: true, hint: null, marker: result.message ?? "Error", reveal: true };
    }
    return null;
  })();

  // ----- view: status pill -----
  const pill: [PillKind, string] = (() => {
    if (running) return ["busy", "Running…"];
    if (runError) return ["error", "Server error"];
    if (!result) return ["idle", "Not run yet"];
    if (dirty) return ["paused", "Edited · re-run"];
    if (!step) {
      const label = { error: "Error", timeout: "Timed out", crashed: "Crashed", needs_input: "Needs input" }[result.status as string] ?? result.status;
      return [result.status === "needs_input" ? "paused" : "error", label];
    }
    if (step.event === "exception") return ["error", `Exception · line ${step.line}`];
    if (bpHits.includes(index)) return ["paused", `Breakpoint · line ${step.line}`];
    if (index === last) {
      if (result.status === "ok") return ["ok", "Finished"];
      if (result.status === "step_limit") return ["paused", "Step limit reached"];
      if (result.status === "needs_input") return ["paused", "Waiting for input"];
    }
    return ["paused", `Paused · line ${step.line}`];
  })();

  // ----- view: output console -----
  const output: ReactNode = (() => {
    if (runError) return <span className="err">{runError}</span>;
    if (!result) return "Press Run (Ctrl+Enter) to execute your program.";
    if (!step) {
      const isInput = result.status === "needs_input";
      return <span className={isInput ? "note" : "err"}>{result.message ?? result.status}</span>;
    }
    const parts: ReactNode[] = [];
    if (step.stdout) parts.push(step.stdout.replace(/\n$/, ""));
    if (result.status === "error" && result.error_step != null && index >= result.error_step) {
      parts.push(
        <span className="err" key="err">
          {result.message}
          {result.error_line ? ` (line ${result.error_line})` : ""}
        </span>,
      );
    } else if (index === last) {
      if (result.status === "ok") parts.push(<span className="dim" key="n">Program finished.</span>);
      if (result.status === "step_limit") parts.push(<span className="note" key="n">{result.message ?? "Step limit reached."}</span>);
      if (result.status === "needs_input")
        parts.push(
          <span className="note" key="n">
            The program called input({JSON.stringify(result.message ?? "")}) but no input was left. Add a line in the Input tab and run again.
          </span>,
        );
    }
    if (!parts.length) return <span className="dim">(no output yet)</span>;
    return parts.flatMap((p, i) => (i ? ["\n", p] : [p]));
  })();

  const pct = (i: number) => (trace.length > 1 ? (i / (trace.length - 1)) * 100 : 0);
  const backendStatus = healthFailed
    ? { cls: "sb-item off", text: "Backend unreachable" }
    : !health
      ? { cls: "sb-item", text: "Tracer: checking…" }
      : health.tracer_ready
        ? null
        : { cls: "sb-item off", text: "Tracer files missing (pg_logger.py)" };
  const aiStatus = kiroReady
    ? { cls: "sb-item sb-button ok", text: `AI tutor: ${aiLabel(tutorSettings)}` }
    : { cls: "sb-item sb-button off", text: "AI tutor: offline (quiz only), click to set up" };
  const openSettings = () => {
    setChatOpen(true);
    setSettingsOpen(true);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">CodeTrace</span>
          <span className="brand-sub">Python Visualizer</span>
        </div>

        <label className="sample-picker">
          <span className="visually-hidden">Load a sample program</span>
          <select
            id="sample-select"
            value=""
            onChange={(e) => {
              loadSample(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Samples…</option>
            {Object.entries(SAMPLES).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="toolbar" role="toolbar" aria-label="Run and debug">
          <button id="run-btn" className={running ? "btn btn-primary is-busy" : "btn btn-primary"} disabled={running} title="Run (Ctrl+Enter)" onClick={() => void run()}>
            <span aria-hidden="true">▶</span> Run
          </button>
          <div className="step-group" role="group" aria-label="Step through execution">
            <button id="first-btn" className="icon-btn" title="First step (Home)" aria-label="First step" disabled={!usable || index === 0} onClick={() => goTo(0)}>
              ⏮
            </button>
            <button id="prev-btn" className="icon-btn" title="Previous step (Alt+←)" aria-label="Previous step" disabled={!usable || index === 0} onClick={() => goTo(index - 1)}>
              ◀
            </button>
            <button id="next-btn" className="icon-btn" title="Next step (Alt+→)" aria-label="Next step" disabled={!usable || index >= last} onClick={() => goTo(index + 1)}>
              ▶
            </button>
            <button id="continue-btn" className="icon-btn" title="Continue to next breakpoint (F8)" aria-label="Continue to next breakpoint" disabled={!usable || index >= last} onClick={continueToBreakpoint}>
              ⏩
            </button>
            <button id="last-btn" className="icon-btn" title="Last step (End)" aria-label="Last step" disabled={!usable || index >= last} onClick={() => goTo(Infinity)}>
              ⏭
            </button>
          </div>
          <button
            id="visualize-btn"
            className={spotlightOn ? "btn btn-visualize is-active" : "btn btn-visualize"}
            aria-pressed={spotlightOn}
            title="Scan memory and show where you are (Ctrl+Shift+V)"
            onClick={() => (spotlightOn ? setSpotlightOn(false) : void visualize())}
          >
            <span aria-hidden="true">◎</span> Visualize
          </button>
          <button
            id="chat-btn"
            className="btn btn-kiro"
            title="Ask the AI tutor (Ctrl+Shift+K)"
            aria-expanded={chatOpen}
            aria-controls="chat-drawer"
            onClick={() => (chatOpen ? setChatOpen(false) : openChat())}
          >
            <span aria-hidden="true">✦</span> Ask AI
          </button>
        </div>
      </header>

      <main className="workspace" ref={workspaceRef} style={{ ["--left" as string]: `${leftPct}%` }}>
        <div className="editor-column">
          <EditorPane
            ref={editor}
            initialCode={initial.code}
            initialBreakpoints={initial.breakpoints}
            exec={exec}
            dirty={dirty}
            onChange={onCodeChange}
            onBreakpointsChange={onBreakpointsChange}
          />
          <div className="console">
            <div className="console-tabs" role="tablist" aria-label="Console">
              <button role="tab" id="tab-output" className={tab === "output" ? "console-tab is-active" : "console-tab"} aria-selected={tab === "output"} aria-controls="output" onClick={() => setTab("output")}>
                Output
              </button>
              <button role="tab" id="tab-input" className={tab === "input" ? "console-tab is-active" : "console-tab"} aria-selected={tab === "input"} aria-controls="stdin-wrap" onClick={() => setTab("input")}>
                Input (stdin)
              </button>
              <span className="console-meta">{result ? `${result.step_count} steps · ${result.duration_ms} ms` : ""}</span>
            </div>
            <div id="output" className="console-body" role="tabpanel" aria-labelledby="tab-output" aria-live="polite" hidden={tab !== "output"}>
              <pre className="console-text">{output}</pre>
              {fix && <FixPanel fix={fix} runId={runId} onApplyFix={applyFix} onAskAI={askAboutError} aiReady={kiroReady} />}
            </div>
            <div id="stdin-wrap" className="console-body" role="tabpanel" aria-labelledby="tab-input" hidden={tab !== "input"}>
              <label htmlFor="stdin" className="visually-hidden">
                Program input, one line per input() call
              </label>
              <textarea id="stdin" spellCheck={false} placeholder="One line per input() call…" value={stdin} onChange={(e) => setStdin(e.target.value)} />
            </div>
          </div>
        </div>

        <div
          className={dragging ? "splitter is-dragging" : "splitter"}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          tabIndex={0}
          onPointerDown={onSplitterDown}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setLeftPct((p) => Math.min(75, Math.max(25, p + (e.key === "ArrowLeft" ? -2 : 2))));
          }}
        />

        <section className="pane viz-pane" aria-label="Memory visualizer">
          <div className="pane-header">
            <span className="tab-title">Memory</span>
            <span id="run-status" className="status-pill" data-kind={pill[0]}>
              {pill[1]}
            </span>
            <span id="step-label" className="pane-hint">
              {step ? `Step ${index + 1} of ${trace.length}` : ""}
            </span>
          </div>

          <div className="timeline">
            <label htmlFor="step-slider" className="visually-hidden">
              Execution step
            </label>
            <input type="range" id="step-slider" min={0} max={Math.max(0, last)} value={step ? index : 0} disabled={!usable} onChange={(e) => goTo(Number(e.target.value))} />
            <div className="timeline-marks" aria-hidden="true">
              {hasTrace && bpHits.map((i) => <span key={i} className="mark bp" style={{ left: `${pct(i)}%` }} />)}
              {hasTrace && result?.error_step != null && <span className="mark err" style={{ left: `${pct(result.error_step)}%` }} />}
            </div>
          </div>

          {spotlightOn && usable && step && spot && (
            <HereCard
              line={step.line}
              frameName={spot.frameName}
              stepNumber={index + 1}
              stepCount={trace.length}
              lineText={lineText}
              exception={step.exception_msg}
              facts={facts}
              narration={narrationForStep}
              kiroReady={kiroReady}
              onClose={() => setSpotlightOn(false)}
              onQuiz={() => openChat(true)}
              onNarrate={() => {
                const snap = snapshot();
                if (snap) void narrate(snap);
              }}
            />
          )}

          <div className="viz-scroll">
            {step ? (
              <MemoryView step={step} prevStep={index > 0 ? trace[index - 1] : null} spotlight={spotlightOn && usable ? spot : null} focusToken={focusToken} />
            ) : (
              <div className="viz-canvas">
                <div className="viz-empty">
                  {result ? (
                    <>
                      <p className="viz-empty-title">Nothing to show yet</p>
                      <p>{result.message}</p>
                    </>
                  ) : (
                    <>
                      <p className="viz-empty-title">Your program's memory shows up here</p>
                      <p>
                        Run the code, step through it, then press <kbd>Visualize</kbd> to see exactly where you are.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {scanning && (
          <div className="scan-overlay" aria-hidden="true">
            <div className="scan-line" />
            <div className="scan-chip">Scanning memory…</div>
          </div>
        )}
      </main>

      <ChatDrawer
        open={chatOpen}
        messages={messages}
        busy={chatBusy}
        contextLabel={usable && step ? `Looking at step ${index + 1} · line ${step.line}` : "Socratic tutor"}
        onSend={(text) => void sendToKiro(text)}
        onQuick={quickReply}
        onPick={pickAnswer}
        onNext={nextQuestion}
        onClose={() => setChatOpen(false)}
        onReset={resetChat}
        aiLabel={kiroReady ? aiLabel(tutorSettings) : "AI offline"}
        aiReady={kiroReady}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        settingsPanel={
          settingsOpen ? <TutorSettingsPanel settings={tutorSettings} onSave={saveTutorSettings} onClose={() => setSettingsOpen(false)} /> : null
        }
      />

      <footer className="statusbar">
        <button className={aiStatus.cls} onClick={openSettings} title="AI tutor settings">
          {aiStatus.text}
        </button>
        {backendStatus && <span className={backendStatus.cls}>{backendStatus.text}</span>}
        <span className="sb-item">{step && spot ? `Line ${step.line} · ${spot.frameName}` : ""}</span>
        <span className="sb-spacer" />
        <span className="sb-item sb-keys">Ctrl+Enter run · F9 breakpoint · Alt+←/→ step · F8 continue</span>
      </footer>
    </>
  );
}
