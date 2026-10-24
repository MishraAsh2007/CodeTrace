import { useState } from "react";
import Workspace from "./components/layout/Workspace";
import type { Alert } from "./components/alerts/AlertPanel";
import { type Language, STARTER_CODE } from "./types";

export default function App() {
  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState<string>(STARTER_CODE.python);
  const [alerts] = useState<Alert[]>([]);
  const [tutorQuestion] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);

  const handleLanguageChange = (next: Language) => {
    setLanguage(next);
    // Swap in the starter snippet for the new language.
    setCode(STARTER_CODE[next]);
  };

  const handleRun = () => {
    // Placeholder: this will call the Rust backend to analyze/run the code.
    setRunning(true);
    window.setTimeout(() => setRunning(false), 400);
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
          onCodeChange={setCode}
          onLanguageChange={handleLanguageChange}
          onRun={handleRun}
        />
      </main>
    </div>
  );
}
