import { useCallback, useRef, useState } from "react";
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
  /** Whether the visualizer panel is shown (header toggle). */
  showVisualizer: boolean;
  /** Whether the tutor panel is shown (header toggle). */
  showTutor: boolean;
  onCodeChange: (value: string) => void;
  onLanguageChange: (language: Language) => void;
  onRun?: () => void;
  /** Clears the current run (trace, console, problems, tutor). */
  onReset?: () => void;
}

/**
 * A thin, draggable vertical divider. On mousedown it tracks mousemove and
 * reports the pointer's X each frame; the parent translates that into a new
 * split ratio. Purely presentational — it owns no ratio state itself.
 */
function Splitter({ onDrag }: { onDrag: (clientX: number) => void }) {
  const draggingRef = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.classList.add("is-col-resizing");

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        onDrag(ev.clientX);
      };
      const onUp = () => {
        draggingRef.current = false;
        document.body.classList.remove("is-col-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onDrag]
  );

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
    />
  );
}

/** Clamp a percentage to a sensible min/max so neither pane disappears. */
function clampPct(pct: number, min = 15, max = 85): number {
  return Math.min(max, Math.max(min, pct));
}

/**
 * Top-level CodeTutor layout.
 *   Left column:  code editor (top) + console (bottom).
 *   Right side:   visualizer and tutor shown side-by-side, with the problems
 *                 list stacked beneath them.
 * Draggable splitters resize left-vs-right and visualizer-vs-tutor. Header
 * toggles show/hide each right-side panel; hiding both collapses the right
 * side so the editor takes the full width.
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
  showVisualizer,
  showTutor,
  onCodeChange,
  onLanguageChange,
  onRun,
  onReset,
}: WorkspaceProps) {
  // Left-vs-right split, as a percentage of the workspace width for the LEFT.
  const [leftPct, setLeftPct] = useState(50);
  // Visualizer-vs-tutor split, as a percentage of the right side for the VIZ.
  const [vizPct, setVizPct] = useState(55);

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);

  const rightVisible = showVisualizer || showTutor;
  // Both panels share the right side only when both are shown.
  const bothRight = showVisualizer && showTutor;

  const dragLeft = useCallback((clientX: number) => {
    const el = workspaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setLeftPct(clampPct(pct));
  }, []);

  const dragViz = useCallback((clientX: number) => {
    const el = rightRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setVizPct(clampPct(pct));
  }, []);

  // When the right side is hidden entirely, the editor fills the width.
  const leftBasis = rightVisible ? `${leftPct}%` : "100%";

  return (
    <div className="workspace" ref={workspaceRef}>
      <section className="workspace__left" style={{ flexBasis: leftBasis }}>
        <div className="workspace__editor">
          <CodeEditor
            value={code}
            language={language}
            onChange={onCodeChange}
            onLanguageChange={onLanguageChange}
            onRun={onRun}
            running={running}
            markers={markers}
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

      {rightVisible && <Splitter onDrag={dragLeft} />}

      {rightVisible && (
        <section className="workspace__right" ref={rightRef}>
          <div className="workspace__panels">
            {showVisualizer && (
              <div
                className="workspace__viz"
                style={{ flexBasis: bothRight ? `${vizPct}%` : "100%" }}
              >
                <VisualizationPanel
                  code={code}
                  language={language}
                  trace={trace}
                  onReset={onReset}
                />
              </div>
            )}

            {bothRight && <Splitter onDrag={dragViz} />}

            {showTutor && (
              <div
                className="workspace__tutor"
                style={{ flexBasis: bothRight ? `${100 - vizPct}%` : "100%" }}
              >
                <TutorPanel error={tutorError} />
              </div>
            )}
          </div>

          <div className="workspace__problems">
            <AlertPanel alerts={alerts} />
          </div>
        </section>
      )}
    </div>
  );
}
