// The Rust server only runs code now (tracing). AI calls go from the browser straight to the provider
// the user picked in ⚙ AI settings (src/tutor), with their own key.
import type { Health, RunResult } from "./types";

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(
      path,
      body === undefined
        ? {}
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
  } catch {
    throw new Error("Can't reach the backend. Is the server still running?");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const text = Array.isArray(detail)
      ? detail.map((d) => (d as { msg?: string }).msg ?? String(d)).join("; ")
      : typeof detail === "string"
        ? detail
        : "";
    throw new Error(text || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  runCode: (code: string, stdin: string[]) => request<RunResult>("/api/run-code", { code, stdin }),
};
