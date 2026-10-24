import CodeEditor from "../editor/CodeEditor";
import VisualizationPanel from "../visualization/VisualizationPanel";
import TutorPanel from "../tutor/TutorPanel";
import AlertPanel, { type Alert } from "../alerts/AlertPanel";
import type { Language } from "../../types";

export interface WorkspaceProps {
  code: string;
  language: Language;
  alerts: Alert[];
  tutorQuestion?: string;
  running?: boolean;
  onCodeChange: (value: string) => void;
  onLanguageChange: (language: Language) => void;
  onRun?: () => void;
}

/**
 * Top-level CodeTutor layout: editor on the left half, visualizer + tutor +
 * problems on the right half.
 */
export default function Workspace({
  code,
  language,
  alerts,
  tutorQuestion,
  running,
  onCodeChange,
  onLanguageChange,
  onRun,
}: WorkspaceProps) {
  return (
    <div className="workspace">
      <section className="workspace__left">
        <CodeEditor
          value={code}
          language={language}
          onChange={onCodeChange}
          onLanguageChange={onLanguageChange}
          onRun={onRun}
          running={running}
        />
      </section>

      <section className="workspace__right">
        <VisualizationPanel code={code} language={language} />
        <TutorPanel question={tutorQuestion} />
        <AlertPanel alerts={alerts} />
      </section>
    </div>
  );
}
