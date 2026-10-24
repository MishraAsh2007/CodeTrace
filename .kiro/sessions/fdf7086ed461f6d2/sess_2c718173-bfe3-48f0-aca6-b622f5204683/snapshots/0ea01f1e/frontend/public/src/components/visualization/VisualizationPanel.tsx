import type { Language } from "../../types";

export interface VisualizationPanelProps {
  /** Source currently in the editor (what we would visualize). */
  code: string;
  /** Active language, in case the visualizer renders differently per language. */
  language: Language;
}

/**
 * The right half of CodeTutor: the visualizer. This is where box diagrams,
 * trees, and other illustrations of program behavior will be rendered.
 *
 * Placeholder for now — it echoes basic info so the layout is wired up and
 * ready for the real visualization engine.
 */
export default function VisualizationPanel({
  code,
  language,
}: VisualizationPanelProps) {
  const lineCount = code.split("\n").length;

  return (
    <div className="panel visualization-panel">
      <h2 className="panel__title">Visualizer</h2>
      <p className="panel__hint">
        Box diagrams and trees illustrating your {language} program will appear
        here.
      </p>
      <div className="visualization-panel__placeholder">
        <p>Nothing to visualize yet.</p>
        <p className="panel__meta">{lineCount} line(s) of code</p>
      </div>
    </div>
  );
}
