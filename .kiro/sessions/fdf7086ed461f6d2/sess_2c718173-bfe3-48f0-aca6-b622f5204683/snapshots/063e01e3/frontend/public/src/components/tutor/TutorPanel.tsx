export interface TutorPanelProps {
  /** The latest guiding question/hint from the tutor, if any. */
  question?: string;
}

/**
 * The tutor surface: when CodeTutor detects a likely logic error, it poses a
 * question here that nudges the learner toward the correct solution.
 *
 * Placeholder for now — renders whatever question it is given.
 */
export default function TutorPanel({ question }: TutorPanelProps) {
  return (
    <div className="panel tutor-panel">
      <h2 className="panel__title">Tutor</h2>
      {question ? (
        <p className="tutor-panel__question">{question}</p>
      ) : (
        <p className="panel__hint">
          Run your code and I'll ask guiding questions when something looks off.
        </p>
      )}
    </div>
  );
}
