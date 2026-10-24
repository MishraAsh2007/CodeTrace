export type AlertSeverity = "error" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  message: string;
  /** Optional 1-based line number the alert refers to. */
  line?: number;
}

export interface AlertPanelProps {
  alerts: Alert[];
}

/**
 * Surfaces problems detected in the user's code (compile errors, and
 * especially the logic errors CodeTutor is built to catch).
 *
 * Placeholder rendering for now.
 */
export default function AlertPanel({ alerts }: AlertPanelProps) {
  if (alerts.length === 0) {
    return (
      <div className="panel alert-panel">
        <h2 className="panel__title">Problems</h2>
        <p className="panel__hint">No problems detected.</p>
      </div>
    );
  }

  return (
    <div className="panel alert-panel">
      <h2 className="panel__title">Problems</h2>
      <ul className="alert-panel__list">
        {alerts.map((alert) => (
          <li key={alert.id} className={`alert alert--${alert.severity}`}>
            {alert.line !== undefined && (
              <span className="alert__line">Line {alert.line}</span>
            )}
            <span className="alert__message">{alert.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
