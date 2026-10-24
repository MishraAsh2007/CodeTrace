import { useState } from "react";
import Workspace from "./components/layout/Workspace";
import type { Alert } from "./components/alerts/AlertPanel";
import type { ExecutionTrace } from "./components/visualization/trace";
import { runProgram } from "./api";
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
  const [tutorQuestion] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<ExecutionTrace | undefined>(undefined);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [hasRun, setHasRun] = useState(false);

  const handleLanguageChange = (next: Language) => {
    setLanguage(next);
    setCode(STARTER_CODE[next]);
    // Reset run artifacts when switching languages.
    setTrace(undefined);
    setAlerts([]);
    setConsoleOutput("");
    setHasRun(false);
  };

  const handleRun = async () => {
    setRunning(true);
    setAlerts([]);
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
          tutorQuestion={tutorQuestion}
          running={running}
          trace={trace}
          consoleOutput={consoleOutput}
          hasRun={hasRun}
          onCodeChange={setCode}
          onLanguageChange={handleLanguageChange}
          onRun={handleRun}
        />
      </main>
    </div>
  );
}
