import type { Question } from "../quiz/questionBank";
import { Rich } from "./Rich";

export interface QuizState {
  question: Question;
  number: number;
  total: number;
  picked: number[];
  solved: boolean;
  hintsShown: number;
}

interface Props {
  quiz: QuizState;
  isLatest: boolean;
  busy: boolean;
  onPick: (option: number) => void;
  onNext: () => void;
}

const LETTERS = "ABCD";

export function QuizCard({ quiz, isLatest, busy, onPick, onNext }: Props) {
  const { question: q, picked, solved } = quiz;
  const wrong = picked.filter((p) => p !== q.correct);
  const hints = q.hints.slice(0, Math.max(quiz.hintsShown, Math.min(wrong.length, q.hints.length)));
  const hasMore = quiz.number < quiz.total;

  return (
    <div className="quiz-card">
      <div className="quiz-head">
        <span className="quiz-badge" title="From the built-in question bank, no AI call">
          ⚡ Quick check · {q.topicLabel}
        </span>
        <span className="quiz-count">
          {quiz.number} of {quiz.total}
        </span>
      </div>
      <div className="quiz-title">{q.title}</div>
      <p className="quiz-context">
        <Rich text={q.context} />
      </p>
      <p className="quiz-prompt">
        <Rich text={q.prompt} />
      </p>
      <div className="quiz-options" role="group" aria-label="Answer choices">
        {q.options.map((option, i) => {
          const state = picked.includes(i) ? (i === q.correct ? "is-correct" : "is-wrong") : solved && i === q.correct ? "is-correct" : "";
          return (
            <button key={i} className={`quiz-option ${state}`} disabled={solved || picked.includes(i)} onClick={() => onPick(i)}>
              <span className="opt-letter" aria-hidden="true">
                {LETTERS[i]}
              </span>
              <span>
                <Rich text={option} />
              </span>
            </button>
          );
        })}
      </div>
      {!solved && wrong.length > 0 && <div className="quiz-feedback wrong">Not quite. Look again at the diagram.</div>}
      {!solved && hints.length > 0 && (
        <ul className="quiz-hints">
          {hints.map((h, i) => (
            <li key={i}>
              <span aria-hidden="true">💡 </span>
              <Rich text={h} />
            </li>
          ))}
        </ul>
      )}
      {solved && (
        <div className="quiz-feedback right">
          <strong>{wrong.length ? "Got it." : "Correct!"}</strong> <Rich text={q.explanation} />
        </div>
      )}
      {solved && isLatest && (
        <div className="quiz-actions">
          <button className={hasMore ? "btn btn-ghost small" : "btn btn-kiro small"} disabled={busy} onClick={onNext}>
            {hasMore ? "Next question →" : "✦ Ask AI for a harder one"}
          </button>
        </div>
      )}
    </div>
  );
}
