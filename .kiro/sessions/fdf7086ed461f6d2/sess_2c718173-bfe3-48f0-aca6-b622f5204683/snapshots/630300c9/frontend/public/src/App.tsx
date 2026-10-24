import { useEffect, useState } from "react";
import Workspace from "./components/layout/Workspace";
import type { Alert } from "./components/alerts/AlertPanel";
import type { ExecutionTrace } from "./components/visualization/trace";
import type { EditorMarker } from "./components/editor/CodeEditor";
import { type ApiError, runProgram } from "./api";
import { type Language, STARTER_CODE } from "./types";

// localStorage keys for autosaving the user's work across refreshes.
const LS_CODE_KEY = "codetutor.code";
const LS_LANG_KEY = "codetutor.language";

const KNOWN_LANGUAGES: readonly Language[] = ["java", "python", "c"];

function isLanguage(value: string | null): value is Language {
  return value !== null && (KNOWN_LANGUAGES as readonly string[]).includes(value);
}

/** Read the persisted language, falling back to "c". Never throws. */
function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem(LS_LANG_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // localStorage can throw in some privacy modes; ignore and use the default.
  }
  return "c";
}

/** Read the persisted code for a language, falling back to its starter. */
function loadCode(language: Language): string {
  try {
    const stored = localStorage.getItem(LS_CODE_KEY);
    if (stored !== null) return stored;
  } catch {
    // Ignore privacy-mode failures.
  }
  return STARTER_CODE[language];
}

/** Pull the full stdout from a trace (its last state holds the complete run). */
function stdoutOf(trace: ExecutionTrace): string {
  for (let i = trace.states.length - 1; i >= 0; i--) {
    const out = trace.states[i].stdout;
    if (out !== undefined) return out;
  }
  return "";
}

export default function App() {
  // Initialize from localStorage (lazy) so a refresh restores the user's work.
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [code, setCode] = useState<string>(() => loadCode(loadLanguage()));
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // The error the tutor coaches on (first runtime error of the last run).
  const [tutorError, setTutorError] = useState<ApiError | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<ExecutionTrace | undefined>(undefined);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [hasRun, setHasRun] = useState(false);
  // Compile errors to mark in the editor (red squiggles).
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  // Input the program receives on stdin (for scanf/getchar), typed by the user.
  const [stdin, setStdin] = useState<string>("");
  // Which right-side panels are visible (toggled from the header).
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [showTutor, setShowTutor] = useState(true);

  // Autosave code + language so a browser refresh restores the user's work.
  useEffect(() => {
    try {
      localStorage.setItem(LS_CODE_KEY, code);
      localStorage.setItem(LS_LANG_KEY, language);
    } catch {
      // Ignore privacy-mode failures; autosave is best-effort.
    }
  }, [code, language]);

  const resetRunArtifacts = () => {
    setTrace(undefined);
    setAlerts([]);
    setTutorError(undefined);
    setConsoleOutput("");
    setMarkers([]);
    setHasRun(false);
  };

  // Reset clears the trace/console/problems/tutor but intentionally keeps
  // hasRun = true, so the visualizer shows the empty "run a program" prompt
  // rather than resurrecting the one-time sample demo.
  const handleReset = () => {
    setTrace(undefined);
    setAlerts([]);
    setTutorError(undefined);
    setConsoleOutput("");
    setMarkers([]);
    setHasRun(true);
  };

  const handleLanguageChange = (next: Language) => {
    setLanguage(next);
    // Switching language loads its starter; the autosave effect persists both.
    setCode(STARTER_CODE[next]);
    resetRunArtifacts();
  };

  const handleRun = async () => {
    setRunning(true);
    setAlerts([]);
    setTutorError(undefined);
    setMarkers([]);
    try {
      const result = await runProgram(language, code, stdin);
      if (result.ok) {
        setTrace(result.trace);
        setConsoleOutput(stdoutOf(result.trace));
      } else {
        // Keep the previous trace; surface problems and clear console.
        setConsoleOutput("");
        setAlerts(
          result.errors.map((e, i) => ({
            id: `err-${i}`,
            severity: e.severity,
            message:
              e.stage && e.stage !== "runtime"
                ? `[${e.stage}] ${e.message}`
                : e.message,
            line: e.line,
          }))
        );
        // The tutor coaches the first coachable error (compile or runtime).
        // Compilation stops at the first error, so the first one is the most
        // relevant to address. TutorPanel stays quiet if it has no hints for
        // the error's kind (e.g. the unsupported-language notice).
        const coachable = result.errors.find(
          (e) => e.stage === "lex" || e.stage === "parse" || e.stage === "runtime"
        );
        setTutorError(coachable);

        // Red-squiggle only compile errors that carry a line. Runtime errors
        // are intentionally not line-marked (they're about design, not a spot).
        setMarkers(
          result.errors
            .filter(
              (e) =>
                (e.stage === "lex" || e.stage === "parse") &&
                e.line !== undefined
            )
            .map((e) => ({ line: e.line as number, message: e.message }))
        );
      }
    } finally {
      setRunning(false);
      setHasRun(true);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__brand">CodeTutor</h1>
        <p className="app__tagline">
          Write code, watch it come to life, and learn as you go.
        </p>

        <div className="app__toggles">
          <button
            type="button"
            className={`app__toggle${showVisualizer ? " app__toggle--on" : ""}`}
            aria-pressed={showVisualizer}
            onClick={() => setShowVisualizer((v) => !v)}
          >
            Visualizer
          </button>
          <button
            type="button"
            className={`app__toggle${showTutor ? " app__toggle--on" : ""}`}
            aria-pressed={showTutor}
            onClick={() => setShowTutor((v) => !v)}
          >
            Tutor
          </button>
        </div>
      </header>

      <main className="app__main">
        <Workspace
          code={code}
          language={language}
          alerts={alerts}
          tutorError={tutorError}
          running={running}
          trace={trace}
          consoleOutput={consoleOutput}
          hasRun={hasRun}
          markers={markers}
          showVisualizer={showVisualizer}
          showTutor={showTutor}
          onCodeChange={setCode}
          onLanguageChange={handleLanguageChange}
          onRun={handleRun}
          onReset={handleReset}
        />
      </main>
    </div>
  );
}
