import type { PointerFact } from "../viz/model";
import { Rich } from "./Rich";

export type NarrationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error"; text: string };

interface Props {
  line: number;
  frameName: string;
  stepNumber: number;
  stepCount: number;
  lineText: string;
  exception: string | undefined;
  facts: PointerFact[];
  narration: NarrationState;
  kiroReady: boolean;
  onClose: () => void;
  onQuiz: () => void;
  onNarrate: () => void;
}

export function HereCard(p: Props) {
  const { narration } = p;
  return (
    <div className="here-card" aria-live="polite">
      <div className="here-head">
        <span className="here-title">
          <span className="pulse-dot" aria-hidden="true" /> You are here
        </span>
        <button className="icon-btn small" aria-label="Close spotlight" onClick={p.onClose}>
          ✕
        </button>
      </div>
      <div className="here-where">
        Line <b>{p.line}</b> in <code>{p.frameName}</code> · step {p.stepNumber} of {p.stepCount}
        <br />
        <code>{p.lineText}</code>
        {p.exception && (
          <>
            <br />
            <span className="err-text">✖ {p.exception}</span>
          </>
        )}
      </div>
      <ul className="here-pointers">
        {p.facts.length ? (
          p.facts.map((f, i) => (
            <li key={i} className={f.alert ? "alert" : undefined}>
              {f.alert && "⚠ "}
              {f.parts.map((part, j) =>
                part.code !== undefined ? (
                  <code key={j}>{part.code}</code>
                ) : part.dim !== undefined ? (
                  <span key={j} className="dim">
                    {part.dim}
                  </span>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </li>
          ))
        ) : (
          <li className="dim">No pointers in this frame yet.</li>
        )}
      </ul>
      <div className={narration.status === "done" ? "here-narration" : "here-narration dim"}>
        {narration.status === "done" && (
          <>
            <span className="by">Kiro:</span> <Rich text={narration.text} />
          </>
        )}
        {narration.status === "loading" && (
          <>
            <span className="by">Kiro</span> is reading this step…
          </>
        )}
        {narration.status === "error" && narration.text}

      </div>
      <div className="here-actions">
        <button className="btn btn-kiro small" onClick={p.onQuiz}>
          ✦ Quiz me on this
        </button>
        {p.kiroReady && (narration.status === "idle" || narration.status === "error") && (
          <button className="btn btn-ghost small" onClick={p.onNarrate} title="Uses one call to the AI provider chosen in AI settings">
            ✦ Explain with AI
          </button>
        )}
      </div>
    </div>
  );
}
