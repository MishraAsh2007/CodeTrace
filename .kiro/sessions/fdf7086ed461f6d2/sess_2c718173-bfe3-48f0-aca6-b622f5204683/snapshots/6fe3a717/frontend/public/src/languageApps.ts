// External language-app routing.
//
// CodeTrace is three separate apps (one per language), each its own dev server.
// The C app (this one) handles C in-process. Selecting Java or Python in the
// language dropdown navigates the browser to that teammate's app instead.
//
// Ports for the demo (all three run at once):
//   C (this app) : 5175
//   Java app     : 5173
//   Python app   : 8000
//
// URLs are overridable via Vite env vars (VITE_JAVA_APP_URL / VITE_PYTHON_APP_URL)
// so they can be repointed at demo time without a code change.

import type { Language } from "./types";

/**
 * Base URL of the external app for a language, or null if that language is
 * handled in-process (C). Other languages navigate the browser to their app.
 */
export const LANGUAGE_APP_URL: Record<Language, string | null> = {
  c: null, // handled here, no navigation
  java:
    (import.meta.env.VITE_JAVA_APP_URL as string | undefined) ??
    "http://localhost:5173",
  python:
    (import.meta.env.VITE_PYTHON_APP_URL as string | undefined) ??
    "http://localhost:8000",
};

/**
 * Where selecting `lang` should take the user, or null to stay in this app.
 */
export function externalAppUrl(lang: Language): string | null {
  return LANGUAGE_APP_URL[lang];
}
