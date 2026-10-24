// Client for the CodeTutor Rust backend.
//
// The backend exposes POST /api/run and responds with either:
//   { ok: true,  trace: ExecutionTrace }
//   { ok: false, errors: ApiError[] }
// (It returns HTTP 200 even for program errors; transport/5xx failures are
// surfaced separately as a synthesized error.)

import type { ExecutionTrace } from "./components/visualization/trace";
import type { Language } from "./types";

/** Base URL of the backend. Overridable via Vite env for deployment. */
const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://127.0.0.1:8080";

/** A problem reported by the backend (mirrors Rust `ApiError`). */
export interface ApiError {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  stage: string;
  /** Machine-readable classification the tutor keys hints off (may be absent
   *  for synthesized network/transport errors). */
  kind?: string;
}

type RawRunResponse =
  | { ok: true; trace: ExecutionTrace }
  | { ok: false; errors: ApiError[] };

/** Normalized result the UI consumes. */
export type RunResult =
  | { ok: true; trace: ExecutionTrace }
  | { ok: false; errors: ApiError[] };

/**
 * Run a program through the backend. Program-level errors come back as
 * `{ ok: false, errors }`; a failure to reach the backend is turned into a
 * single error so the UI always has something to show.
 */
export async function runProgram(
  language: Language,
  code: string,
  stdin: string = ""
): Promise<RunResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, stdin }),
    });
  } catch {
    return {
      ok: false,
      errors: [
        {
          severity: "error",
          message:
            "Could not reach the CodeTutor backend. Is it running on " +
            `${API_BASE}? (start it with 'cargo run' in /backend)`,
          stage: "network",
        },
      ],
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      errors: [
        {
          severity: "error",
          message: `Backend returned HTTP ${res.status} ${res.statusText}.`,
          stage: "http",
        },
      ],
    };
  }

  let data: RawRunResponse;
  try {
    data = (await res.json()) as RawRunResponse;
  } catch {
    return {
      ok: false,
      errors: [
        {
          severity: "error",
          message: "Backend returned a response that was not valid JSON.",
          stage: "decode",
        },
      ],
    };
  }

  return data;
}
