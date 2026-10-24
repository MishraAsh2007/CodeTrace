import type { Stepper } from "./useStepper";

export interface VizControlsProps {
  stepper: Stepper;
  /** 1-based source line for the current state, if known. */
  line?: number;
  /** Clears the current run (trace, console, problems, tutor). */
  onReset?: () => void;
}

// Speed = how long each state stays on screen. 1x is a deliberate 1.5s so a
// learner can track the highlighted change before the next step.
const SPEEDS = [
  { label: "0.5x", ms: 3000 },
  { label: "1x", ms: 1500 },
  { label: "2x", ms: 750 },
  { label: "4x", ms: 375 },
];

/**
 * Debugger-style playback controls: restart, step back, step into/over/out,
 * play/pause auto-play, a scrub slider, and a speed selector.
 */
export default function VizControls({ stepper, line, onReset }: VizControlsProps) {
  const {
    step,
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
  } = stepper;

  return (
    <div className="viz-controls">
      <div className="viz-controls__row">
        <button
          type="button"
          title="Restart"
          onClick={restart}
          disabled={atStart && !playing}
        >
          ⏮
        </button>
        <button
          type="button"
          title="Step back"
          onClick={stepBack}
          disabled={atStart}
        >
          ◀
        </button>
        <button
          type="button"
          className="viz-controls__play"
          title={playing ? "Pause" : "Play"}
          onClick={togglePlay}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          type="button"
          title="Step into (one step, enter calls)"
          onClick={stepInto}
          disabled={atEnd}
        >
          ↓ Into
        </button>
        <button
          type="button"
          title="Step over (run calls on this line to completion)"
          onClick={stepOver}
          disabled={atEnd}
        >
          ⤼ Over
        </button>
        <button
          type="button"
          title="Step out (run until the current function returns)"
          onClick={stepOut}
          disabled={atEnd}
        >
          ↑ Out
        </button>

        <label className="viz-controls__speed">
          Speed
          <select
            value={speedMs}
            onChange={(e) => setSpeedMs(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="viz-controls__row">
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={step}
          onChange={(e) => goTo(Number(e.target.value))}
        />
        <span className="viz-controls__step">
          Step {total === 0 ? 0 : step + 1} / {total}
          {line !== undefined ? ` · line ${line}` : ""}
        </span>
      </div>
    </div>
  );
}
