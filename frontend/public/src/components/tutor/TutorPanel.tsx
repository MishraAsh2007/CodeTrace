import { useEffect, useMemo, useState } from "react";
import type { ApiError } from "../../api";
import { hintsForError } from "./tutorHints";

export interface TutorPanelProps {
  /**
   * The error the tutor should coach on (typically the first runtime error
   * from the last run). When undefined, the tutor is idle.
   */
  error?: ApiError;
}

/**
 * The tutor surface. When a run produces a runtime error, the tutor poses a
 * Socratic question pointing at the cause, then lets the learner reveal
 * progressive follow-up hints that lead toward the fix — rather than handing
 * over the answer immediately.
 */
export default function TutorPanel({ error }: TutorPanelProps) {
  const content = useMemo(
    () => (error ? hintsForError(error) : null),
    [error]
  );

  // How many hints are currently revealed (always at least the first).
  const [revealed, setRevealed] = useState(1);

  // Reset the reveal count whenever the coached error changes.
  useEffect(() => {
    setRevealed(1);
  }, [error, content]);

  if (!content) {
    return (
      <div className="panel tutor-panel">
        <h2 className="panel__title">Tutor</h2>
        <p className="panel__hint">
          Run your code and I'll ask guiding questions when something goes
          wrong.
        </p>
      </div>
    );
  }

  const shown = content.hints.slice(0, revealed);
  const moreAvailable = revealed < content.hints.length;

  return (
    <div className="panel tutor-panel">
      <h2 className="panel__title">Tutor</h2>
      <p className="tutor-panel__title">{content.title}</p>

      <ol className="tutor-panel__hints">
        {shown.map((hint, i) => (
          <li key={i} className="tutor-panel__hint-item">
            <span className="tutor-panel__hint-label">{hint.label}</span>
            <p className="tutor-panel__question">{hint.text}</p>
          </li>
        ))}
      </ol>

      {moreAvailable ? (
        <button
          type="button"
          className="tutor-panel__more"
          onClick={() => setRevealed((r) => r + 1)}
        >
          Show another hint ({content.hints.length - revealed} left)
        </button>
      ) : (
        <p className="tutor-panel__done">
          That's all my hints — try the fix, then run again.
        </p>
      )}
    </div>
  );
}
