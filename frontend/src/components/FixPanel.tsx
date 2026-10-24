import { useState } from "react";
import type { FixSuggestion } from "../quiz/questionBank";
import { Rich } from "./Rich";

interface Props {
  fix: FixSuggestion;
  /** Resets when a new run happens, so the panel starts collapsed each time. */
  runId: number;
  onApplyFix: (patched: string) => void;
  onAskAI: () => void;
  aiReady: boolean;
}

/**
 * Shown under the output whenever a run ends in an error. Instead of just the error text, the student
 * gets two actions: "View Suggested Fix" (a before/after diff built from their own code, with an Apply
 * button) and "Ask AI" (sends the error to the tutor). When the bank has no automatic repair for this
 * error, the fix button is hidden and the reason + Ask AI are offered instead.
 */
export function FixPanel({ fix, runId, onApplyFix, onAskAI, aiReady }: Props) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  // Collapse again on the next run.
  if (applied !== null && applied !== runId) {
    setApplied(null);
    setOpen(false);
  }
  const diff = fix.diff;

  return (
    <div className="fix-panel" role="group" aria-label="Suggested fix for the error">
      <div className="fix-head">
        <span className="fix-icon" aria-hidden="true">
          ⚠
        </span>
        <div className="fix-headline">
          <strong>{fix.error}</strong>
          {fix.errorLine ? <span className="fix-where"> · line {fix.errorLine}</span> : null}
        </div>
      </div>

      {fix.reason && (
        <p className="fix-reason">
          <Rich text={fix.reason} />
        </p>
      )}

      <div className="fix-actions">
        {diff && (
          <button className="btn btn-primary small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide suggested fix" : "View suggested fix"}
          </button>
        )}
        <button className="btn btn-kiro small" onClick={onAskAI} title={aiReady ? "Ask the AI tutor about this error" : "Set up an AI provider to ask about this error"}>
          <span aria-hidden="true">✦</span> Ask AI
        </button>
      </div>

      {open && diff && (
        <div className="fix-diff">
          <div className="fix-diff-cols">
            <div className="fix-diff-col">
              <span className="fix-diff-tag before">Your code</span>
              {diff.before.map((line, i) => (
                <pre key={i} className="fix-line before">
                  <span className="fix-lineno">{diff.lines[i] ?? ""}</span>
                  {line || " "}
                </pre>
              ))}
            </div>
            <div className="fix-diff-col">
              <span className="fix-diff-tag after">Suggested</span>
              {diff.after.map((line, i) => (
                <pre key={i} className="fix-line after">
                  <span className="fix-lineno">{diff.lines[i] ?? ""}</span>
                  {line || " "}
                </pre>
              ))}
            </div>
          </div>
          <div className="fix-diff-actions">
            <button
              className="btn btn-primary small"
              disabled={applied === runId}
              onClick={() => {
                onApplyFix(diff.patched);
                setApplied(runId);
              }}
            >
              {applied === runId ? "✓ Applied — run again" : "Apply fix"}
            </button>
            <span className="fix-note">This is a suggestion from your code. Review it, then run again.</span>
          </div>
        </div>
      )}
    </div>
  );
}
