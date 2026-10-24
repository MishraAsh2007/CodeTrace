import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionTrace } from "./trace";

export interface Stepper {
  /** Current step index (clamped to the trace). */
  step: number;
  /** Total number of states. */
  total: number;
  /** True while auto-play is running. */
  playing: boolean;
  /** Delay between auto-play steps, in ms. */
  speedMs: number;

  atStart: boolean;
  atEnd: boolean;

  /** Jump to an arbitrary step (used by the slider). */
  goTo: (step: number) => void;
  /** Step into: advance exactly one execution step (descends into calls). */
  stepInto: () => void;
  /** Step over: run any call on this line to completion, stop at same depth. */
  stepOver: () => void;
  /** Step out: run until we return to a shallower call-stack depth. */
  stepOut: () => void;
  /** Step back one state. */
  stepBack: () => void;
  /** Restart at the first state. */
  restart: () => void;
  /** Toggle auto-play. */
  togglePlay: () => void;
  setSpeedMs: (ms: number) => void;
}

/**
 * Owns playback position over an execution trace and implements the debugger
 * stepping semantics using each state's `depth`:
 *   - step into = next index
 *   - step over = next index whose depth <= current depth
 *   - step out  = next index whose depth <  current depth
 * Depth is optional in the trace; when absent, over/out behave like into.
 */
export function useStepper(trace: ExecutionTrace): Stepper {
  const states = trace.states;
  const total = states.length;

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Default to 1x (1.5s per state) so learners can follow each change.
  const [speedMs, setSpeedMs] = useState(1500);

  // Keep step in range if the trace shrinks (e.g. a new run).
  const clamped = Math.min(step, Math.max(0, total - 1));
  const atStart = clamped <= 0;
  const atEnd = clamped >= total - 1;

  const depthAt = useCallback(
    (i: number) => states[i]?.depth ?? 1,
    [states]
  );

  const goTo = useCallback(
    (next: number) => {
      setStep(Math.min(Math.max(0, next), Math.max(0, total - 1)));
    },
    [total]
  );

  const stepInto = useCallback(() => {
    setStep((s) => Math.min(s + 1, total - 1));
  }, [total]);

  const stepBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const stepOver = useCallback(() => {
    setStep((s) => {
      const curDepth = depthAt(s);
      for (let i = s + 1; i < total; i++) {
        if (depthAt(i) <= curDepth) return i;
      }
      return total - 1;
    });
  }, [depthAt, total]);

  const stepOut = useCallback(() => {
    setStep((s) => {
      const curDepth = depthAt(s);
      for (let i = s + 1; i < total; i++) {
        if (depthAt(i) < curDepth) return i;
      }
      return total - 1;
    });
  }, [depthAt, total]);

  const restart = useCallback(() => {
    setPlaying(false);
    setStep(0);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      // If starting playback from the end, restart from the top.
      if (!p && step >= total - 1) setStep(0);
      return !p;
    });
  }, [step, total]);

  // Auto-play timer: advance one step each tick; stop at the end.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (!playing) return;
    if (clamped >= total - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      setStep((s) => {
        const next = Math.min(s + 1, total - 1);
        if (next >= total - 1) setPlaying(false);
        return next;
      });
    }, speedMs);
    return () => window.clearTimeout(id);
  }, [playing, clamped, total, speedMs]);

  return {
    step: clamped,
    total,
    playing,
    speedMs,
    atStart,
    atEnd,
    goTo,
    stepInto,
    stepOver,
    stepOut,
    stepBack,
    restart,
    togglePlay,
    setSpeedMs,
  };
}
