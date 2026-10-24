export interface ConsolePanelProps {
  /** Program output captured from the last run (stdout). */
  output: string;
  /** True while a run is in flight. */
  running?: boolean;
  /** True once at least one run has completed (controls the empty message). */
  hasRun?: boolean;
}

/**
 * A terminal-style console shown below the editor (bottom-left). Displays the
 * program's stdout from the most recent run. Scrolls for long output.
 */
export default function ConsolePanel({
  output,
  running = false,
  hasRun = false,
}: ConsolePanelProps) {
  return (
    <div className="console">
      <div className="console__tabs">
        <span className="console__tab console__tab--active">Console</span>
        {running && <span className="console__status">running…</span>}
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
