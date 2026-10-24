import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";
import {
  type Language,
  LANGUAGE_LABELS,
  MONACO_LANGUAGE_ID,
} from "../../types";

/** A compile error to mark in the editor (1-based line). */
export interface EditorMarker {
  line: number;
  message: string;
}

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
  /**
   * Compile errors to flag with red squiggles. Only errors with a known line
   * belong here (runtime errors are intentionally not line-marked).
   */
  markers?: EditorMarker[];
}

const LANGUAGES: Language[] = ["java", "python", "c"];

const MARKER_OWNER = "codetutor";

/**
 * The left half of CodeTutor: a Monaco-based code editor with a language
 * selector and a run button. Kept presentational and controlled so the parent
 * owns the source + language state and can feed it to the visualizer/tutor.
 *
 * Compile errors are surfaced as red squiggles (Monaco markers) on their line,
 * so the tutor's "this line" questions are visually anchored in the code.
 */
export default function CodeEditor({
  value,
  language,
  onChange,
  onLanguageChange,
  onRun,
  running = false,
  markers = [],
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    editorInstance.focus();
    applyMarkers();
  };

  /** Push the current markers into Monaco, or clear them when there are none. */
  const applyMarkers = () => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorInstance || !monaco) return;
    const model = editorInstance.getModel();
    if (!model) return;

    const monacoMarkers: editor.IMarkerData[] = markers.map((m) => {
      const lineNumber = Math.min(Math.max(1, m.line), model.getLineCount());
      const maxCol = model.getLineMaxColumn(lineNumber);
      return {
        severity: monaco.MarkerSeverity.Error,
        message: m.message,
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: maxCol,
      };
    });

    monaco.editor.setModelMarkers(model, MARKER_OWNER, monacoMarkers);

    // Reveal the first error so it's visible in a long program.
    if (monacoMarkers.length > 0) {
      editorInstance.revealLineInCenterIfOutsideViewport(
        monacoMarkers[0].startLineNumber
      );
    }
  };

  // Re-apply whenever the marker set changes (and the editor is mounted).
  useEffect(() => {
    applyMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

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
