import { useState } from "react";
import { PROVIDERS, modelOf, type ProviderId, type TutorSettings } from "../tutor/settings";
import { Tutor, TutorError } from "../tutor/tutor";

interface Props {
  settings: TutorSettings;
  onSave: (s: TutorSettings) => void;
  onClose: () => void;
}

type TestState = { status: "idle" } | { status: "busy" } | { status: "ok"; ms: number } | { status: "error"; text: string };

export function TutorSettingsPanel({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<TutorSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const info = PROVIDERS[draft.provider];
  const needsKey = draft.provider !== "offline";
  const update = (patch: Partial<TutorSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTest({ status: "idle" });
  };

  const runTest = async () => {
    setTest({ status: "busy" });
    const t0 = performance.now();
    try {
      await new Tutor(draft).test();
      setTest({ status: "ok", ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setTest({ status: "error", text: e instanceof TutorError ? e.message : String(e) });
    }
  };

  return (
    <div className="ai-settings" role="dialog" aria-label="AI tutor settings">
      <div className="ai-settings-head">
        <span className="ai-settings-title">⚙ AI tutor settings</span>
        <button className="icon-btn small" aria-label="Close settings" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="ai-settings-note">
        The ⚡ quick-check quiz always comes first and works without a key. The AI answers the questions you type.
      </p>

      <label className="field">
        <span>Provider</span>
        <select
          value={draft.provider}
          onChange={(e) => {
            const provider = e.target.value as ProviderId;
            // A new provider starts from its own default model; re-picking the same one keeps the model.
            if (provider !== draft.provider) update({ provider, model: "" });
          }}
        >
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].label}
            </option>
          ))}
        </select>
      </label>

      {needsKey && (
        <>
          <label className="field">
            <span>Model</span>
            <input
              list={`models-${draft.provider}`}
              value={draft.model}
              placeholder={info.defaultModel}
              spellCheck={false}
              onChange={(e) => update({ model: e.target.value })}
            />
            <datalist id={`models-${draft.provider}`}>
              {info.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>
              API key{" "}
              {info.keyUrl && (
                <a href={info.keyUrl} target="_blank" rel="noreferrer">
                  get one
                </a>
              )}
            </span>
            <div className="key-row">
              <input
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                placeholder={info.keyHint}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              <button type="button" className="btn btn-ghost small" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"}>
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="check">
            <input type="checkbox" checked={draft.remember} onChange={(e) => update({ remember: e.target.checked })} />
            Remember the key on this computer
          </label>
          <p className="ai-settings-note small">
            The key is kept only in this browser and sent straight to {info.short}. It never goes to the CodeTrace server or into a file.
          </p>
        </>
      )}

      {test.status !== "idle" && (
        <div className={`ai-test ${test.status}`}>
          {test.status === "busy" && "Testing…"}
          {test.status === "ok" && `✓ Connected to ${info.short} (${modelOf(draft)}) in ${(test.ms / 1000).toFixed(1)}s`}
          {test.status === "error" && `✗ ${test.text}`}
        </div>
      )}

      <div className="ai-settings-actions">
        {needsKey && (
          <button className="btn btn-ghost small" disabled={!draft.apiKey.trim() || test.status === "busy"} onClick={runTest}>
            Test connection
          </button>
        )}
        {needsKey && settings.apiKey && (
          <button className="btn btn-ghost small" onClick={() => update({ apiKey: "" })}>
            Forget key
          </button>
        )}
        <button className="btn btn-kiro small" onClick={() => onSave(draft)}>
          Save
        </button>
      </div>
    </div>
  );
}
