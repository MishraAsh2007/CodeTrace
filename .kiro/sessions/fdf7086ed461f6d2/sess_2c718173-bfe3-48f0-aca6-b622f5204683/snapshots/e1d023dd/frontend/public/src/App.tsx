import { useState } from "react";
import Workspace from "./components/layout/Workspace";
import type { Alert } from "./components/alerts/AlertPanel";
import type { ExecutionTrace } from "./components/visualization/trace";
import type { EditorMarker } from "./components/editor/CodeEditor";
import { type ApiError, runProgram } from "./api";
import { type Language, STARTER_CODE } from "./types";

/** Pull the full stdout from a trace (its last state holds the complete run). */
function stdoutOf(trace: ExecutionTrace): string {
  for (let i = trace.states.length - 1; i >= 0; i--) {
    const out = trace.states[i].stdout;
    if (out !== undefined) return out;
  }
  return "";
}

export default function App() {
  const [language, setLanguage] = useState<Language>("c");
  const [code, setCode] = useState<string>(STARTER_CODE.c);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // The error the tutor coaches on (first runtime error of the last run).
  const [tutorError, setTutorError] = useState<ApiError | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<ExecutionTrace | undefined>(undefined);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [hasRun, setHasRun] = useState(false);
  // Compile errors to mark in the editor (red squiggles).
  const [markers, setMarkers] = useState<EditorMarker[]>([]);

  const resetRunArtifacts = () => {
    setTrace(undefined);
    setAlerts([]);
    setTutorError(undefined);
    setConsoleOutput("");
    setMarkers([]);
    setHasRun(false);
  };

  const handleLanguageChange = (next: Language) => {
    setLanguage(next);
    setCode(STARTER_CODE[next]);
    resetRunArtifacts();
  };

  const handleRun = async () => {
    setRunning(true);
    setAlerts([]);
    setTutorError(undefined);
    setMarkers([]);
    try {
      const result = await runProgram(language, code);
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
          onCodeChange={setCode}
          onLanguageChange={handleLanguageChange}
          onRun={handleRun}
        />
      </main>
    </div>
  );
}
