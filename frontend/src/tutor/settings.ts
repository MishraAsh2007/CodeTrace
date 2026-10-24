// settings.ts: which AI provider/model the tutor uses, and the user's own API key.
// Stored in this browser only (localStorage, or sessionStorage if "remember" is off). The key is sent
// straight to the chosen provider; it never goes to the CodeTrace server or into a file.

export type ProviderId = "offline" | "gemini" | "openai" | "anthropic";

export interface TutorSettings {
  provider: ProviderId;
  /** Empty = the provider's default model. */
  model: string;
  apiKey: string;
  /** Keep the key after the browser closes (localStorage) or only for this session. */
  remember: boolean;
}

export interface ProviderInfo {
  label: string;
  short: string;
  defaultModel: string;
  models: string[];
  keyUrl?: string;
  keyHint?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  offline: {
    label: "Offline: built-in quiz and hints only (no key)",
    short: "Offline",
    defaultModel: "",
    models: [],
  },
  gemini: {
    label: "Google Gemini",
    short: "Gemini",
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-argon"],
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyHint: "AIza… or a Google AI Studio key",
  },
  openai: {
    label: "OpenAI",
    short: "OpenAI",
    defaultModel: "gpt-6-luna",
    models: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-4.1-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
  },
  anthropic: {
    label: "Anthropic Claude",
    short: "Claude",
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
  },
};

const LS_KEY = "visualpy.ai";

function defaults(): TutorSettings {
  return { provider: "offline", model: "", apiKey: "", remember: true };
}

function parse(raw: string | null): Partial<TutorSettings> | null {
  try {
    const v = JSON.parse(raw ?? "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function loadSettings(): TutorSettings {
  const local = parse(localStorage.getItem(LS_KEY));
  const session = parse(sessionStorage.getItem(LS_KEY));
  const merged = { ...defaults(), ...(local ?? {}), ...(session ?? {}) };
  if (!(merged.provider in PROVIDERS)) merged.provider = "offline";
  return {
    provider: merged.provider as ProviderId,
    model: String(merged.model ?? ""),
    apiKey: String(merged.apiKey ?? ""),
    remember: merged.remember !== false,
  };
}

export function saveSettings(s: TutorSettings) {
  const { apiKey, ...rest } = s;
  if (s.remember) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
    sessionStorage.removeItem(LS_KEY);
  } else {
    // Provider/model persist; the key only lives until the tab is closed.
    localStorage.setItem(LS_KEY, JSON.stringify({ ...rest, apiKey: "" }));
    sessionStorage.setItem(LS_KEY, JSON.stringify({ apiKey }));
  }
}

export const modelOf = (s: TutorSettings) => s.model.trim() || PROVIDERS[s.provider].defaultModel;

export const isAiReady = (s: TutorSettings) => s.provider !== "offline" && s.apiKey.trim().length > 0;

export const aiLabel = (s: TutorSettings) =>
  s.provider === "offline" ? "Offline" : `${PROVIDERS[s.provider].short} · ${modelOf(s)}`;
