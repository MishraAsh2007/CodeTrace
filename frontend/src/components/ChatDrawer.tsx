import { useEffect, useRef, useState, type ReactNode } from "react";
import { QuizCard, type QuizState } from "./QuizCard";
import { Rich } from "./Rich";

export interface ChatMessage {
  id: number;
  /** kiro = AI tutor reply; scan / notes = built-in (no AI call); quiz = built-in question card. */
  kind: "kiro" | "user" | "system" | "error" | "quiz" | "scan" | "notes";
  text: string;
  title?: string;
  /** Small label on a Kiro message, e.g. "offline hint". */
  badge?: string;
  quiz?: QuizState;
}

export type QuickKind = "hint" | "found" | "where";

interface Props {
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  contextLabel: string;
  aiLabel: string;
  aiReady: boolean;
  settingsPanel: ReactNode;
  onSend: (text: string) => void;
  onQuick: (kind: QuickKind, text: string) => void;
  onPick: (messageId: number, option: number) => void;
  onNext: (messageId: number) => void;
  onClose: () => void;
  onReset: () => void;
  onOpenSettings: () => void;
}

const QUICK_REPLIES: { kind: QuickKind; label: string; text: string }[] = [
  { kind: "hint", label: "Smaller hint", text: "I'm not sure. Can you give me a smaller hint?" },
  { kind: "found", label: "I found it", text: "I think I found the bug." },
  { kind: "where", label: "Where do I look?", text: "What should I look at in the memory diagram?" },
];

export function ChatDrawer(p: Props) {
  const { open, messages, busy, onSend, onQuick, onPick, onNext } = p;
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const latestQuizId = [...messages].reverse().find((m) => m.kind === "quiz")?.id;
  // While the AI streams, its message is already visible; only show the typing dots before the first token.
  const last = messages[messages.length - 1];
  const streaming = busy && last?.kind === "kiro" && !last.badge;

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <aside id="chat-drawer" className="chat-drawer" aria-label="Chat with Kiro" hidden={!open}>
      <div className="chat-head">
        <div className="chat-title">
          <span className="kiro-avatar" aria-hidden="true">
            ✦
          </span>
          <div>
            <div className="chat-name">Kiro</div>
            <div className="chat-sub">{p.contextLabel}</div>
          </div>
        </div>
        <div className="chat-head-actions">
          <button className={p.aiReady ? "ai-chip ok" : "ai-chip off"} onClick={p.onOpenSettings} title="AI tutor settings: provider, model, API key">
            ⚙ {p.aiLabel}
          </button>
          <button className="icon-btn small" title="Start a new conversation" aria-label="Start a new conversation" onClick={p.onReset}>
            ↺
          </button>
          <button className="icon-btn small" title="Close chat (Esc)" aria-label="Close chat" onClick={p.onClose}>
            ✕
          </button>
        </div>
      </div>

      {p.settingsPanel}

      <div ref={logRef} className="chat-log" role="log" aria-live="polite">
        {messages.map((m) =>
          m.kind === "quiz" && m.quiz ? (
            <QuizCard key={m.id} quiz={m.quiz} isLatest={m.id === latestQuizId} busy={busy} onPick={(option) => onPick(m.id, option)} onNext={() => onNext(m.id)} />
          ) : m.kind === "scan" || m.kind === "notes" ? (
            <div key={m.id} className={`msg ${m.kind}`}>
              <div className="msg-tag">{m.kind === "scan" ? "🔍 Program scan" : `📘 ${m.title ?? "Kiro's notes"}`}</div>
              <Rich text={m.text} />
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.kind}${m.badge ? " has-badge" : ""}`}>
              {m.badge && <div className="msg-tag">{m.badge}</div>}
              {m.kind === "kiro" || m.kind === "user" ? <Rich text={m.text} /> : m.text}
            </div>
          ),
        )}
        {busy && !streaming && (
          <div className="msg kiro" aria-label="Kiro is typing">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className="chat-quick">
        {QUICK_REPLIES.map((q) => (
          <button key={q.kind} className="chip" disabled={busy} onClick={() => onQuick(q.kind, q.text)}>
            {q.label}
          </button>
        ))}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="chat-input" className="visually-hidden">
          Message Kiro
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder={p.aiReady ? "Answer the quiz, or ask Kiro anything… (Enter to send)" : "Answer the quiz… (set up AI in ⚙ to ask anything)"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="btn btn-kiro" aria-label="Send message" disabled={busy}>
          Send
        </button>
      </form>
    </aside>
  );
}
