export interface ConsolePanelProps {
  /** Program output captured from the last run (stdout). */
  output: string;
  /** True while a run is in flight. */
  running?: boolean;
  /** True once at least one run has completed (controls the empty message). */
  hasRun?: boolean;
  /** Current stdin the program will receive on the next run. */
  stdin: string;
  /** Update the stdin buffer as the user types. */
  onStdinChange: (value: string) => void;
}

/**
 * A terminal-style console shown below the editor (bottom-left). It has two
 * parts: an editable Input box (the stdin fed to the program on the next run,
 * for scanf/getchar) and the Output area showing the last run's stdout.
 */
export default function ConsolePanel({
  output,
  running = false,
  hasRun = false,
  stdin,
  onStdinChange,
}: ConsolePanelProps) {
  return (
    <div className="console">
      <div className="console__tabs">
        <span className="console__tab console__tab--active">Console</span>
        {running && <span className="console__status">running…</span>}
      </div>

      <div className="console__input">
        <label className="console__input-label" htmlFor="stdin-input">
          Input (stdin)
        </label>
        <textarea
          id="stdin-input"
          className="console__input-area"
          value={stdin}
          onChange={(e) => onStdinChange(e.target.value)}
          placeholder="Type input for scanf/getchar here, one value per line or space-separated…"
          spellCheck={false}
          rows={2}
        />
      </div>

      <div className="console__body">
        {output ? (
          <pre className="console__output">{output}</pre>
        ) : (
          <p className="console__empty">
            {running
              ? "Running your program…"
              : hasRun
              ? "Program produced no output."
              : "Run your program to see its output here."}
          </p>
        )}
      </div>
    </div>
  );
}
