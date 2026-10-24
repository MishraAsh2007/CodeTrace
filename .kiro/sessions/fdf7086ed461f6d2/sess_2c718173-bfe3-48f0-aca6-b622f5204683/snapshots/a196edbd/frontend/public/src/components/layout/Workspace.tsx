import CodeEditor from "../editor/CodeEditor";
import VisualizationPanel from "../visualization/VisualizationPanel";
import TutorPanel from "../tutor/TutorPanel";
import AlertPanel, { type Alert } from "../alerts/AlertPanel";
import ConsolePanel from "../console/ConsolePanel";
import type { Language } from "../../types";
import type { ExecutionTrace } from "../visualization/trace";
import type { ApiError } from "../../api";
import type { EditorMarker } from "../editor/CodeEditor";

export interface WorkspaceProps {
  code: string;
  language: Language;
  alerts: Alert[];
  /** Error the tutor coaches on, if any. */
  tutorError?: ApiError;
  running?: boolean;
  /** Compile errors to red-squiggle in the editor. */
  markers?: EditorMarker[];
  /** Trace to visualize (falls back to the sample when undefined). */
  trace?: ExecutionTrace;
  /** Program stdout from the last run. */
  consoleOutput: string;
  /** Whether a run has completed at least once. */
  hasRun: boolean;
  onCodeChange: (value: string) => void;
  onLanguageChange: (language: Language) => void;
  onRun?: () => void;
}

/**
 * Top-level CodeTutor layout.
 *   Left column:  code editor (top) + console (bottom).
 *   Right column: visualizer + tutor + problems.
 */
export default function Workspace({
  code,
  language,
  alerts,
  tutorError,
  running,
  trace,
  consoleOutput,
  hasRun,
  markers,
  onCodeChange,
  onLanguageChange,
  onRun,
}: WorkspaceProps) {
  return (
    <div className="workspace">
      <section className="workspace__left">
        <div className="workspace__editor">
          <CodeEditor
            value={code}
            language={language}
            onChange={onCodeChange}
            onLanguageChange={onLanguageChange}
            onRun={onRun}
            running={running}
          />
        </div>
        <div className="workspace__console">
          <ConsolePanel
            output={consoleOutput}
            running={running}
            hasRun={hasRun}
          />
        </div>
      </section>

      <section className="workspace__right">
        <VisualizationPanel code={code} language={language} trace={trace} />
        <TutorPanel error={tutorError} />
        <AlertPanel alerts={alerts} />
      </section>
    </div>
  );
}
