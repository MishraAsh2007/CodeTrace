import { useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  type Language,
  LANGUAGE_LABELS,
  MONACO_LANGUAGE_ID,
} from "../../types";

export interface CodeEditorProps {
  /** Current source code (controlled value). */
  value: string;
  /** Active programming language. */
  language: Language;
  /** Called whenever the editor content changes. */
  onChange: (value: string) => void;
  /** Called when the user picks a different language. */
  onLanguageChange: (language: Language) => void;
  /** Called when the user asks to run/analyze the code. */
  onRun?: () => void;
  /** Disables the run button (e.g. while a run is in flight). */
  running?: boolean;
}

const LANGUAGES: Language[] = ["java", "python", "c"];

/**
 * The left half of CodeTutor: a Monaco-based code editor with a language
 * selector and a run button. Kept presentational and controlled so the parent
 * owns the source + language state and can feed it to the visualizer/tutor.
 */
export default function CodeEditor({
  value,
  language,
  onChange,
  onLanguageChange,
  onRun,
  running = false,
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;
    editorInstance.focus();
  };

  return (
    <div className="code-editor">
      <div className="code-editor__toolbar">
        <label className="code-editor__lang">
          <span>Language</span>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="code-editor__run"
          onClick={onRun}
          disabled={running || !onRun}
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>

      <div className="code-editor__surface">
        <Editor
          height="100%"
          theme="vs-dark"
          language={MONACO_LANGUAGE_ID[language]}
          value={value}
          onMount={handleMount}
          onChange={(next) => onChange(next ?? "")}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            smoothScrolling: true,
            renderWhitespace: "selection",
          }}
        />
      </div>
    </div>
  );
}
