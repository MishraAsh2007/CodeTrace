import { type StackFrame, isRef } from "./trace";
import ValueCell from "./ValueCell";
import { cellKeyVar } from "./diff";

export interface StackFrameViewProps {
  frame: StackFrame;
  registerCellAnchor: (id: string, el: HTMLElement | null) => void;
  /** Change-keys that should flash this step (see diff.ts). */
  changedKeys: Set<string>;
}

/** Anchor id for a variable slot that holds a reference. */
export function variableAnchorId(frameId: string, varName: string): string {
  return `var:${frameId}:${varName}`;
}

/**
 * One stack frame: a titled box with a row per variable. Primitive variables
 * read like `x -> [ 3 ]`; reference variables like `values -> [•]` with an
 * arrow (drawn by the overlay) to the heap object.
 */
export default function StackFrameView({
  frame,
  registerCellAnchor,
}: StackFrameViewProps) {
  return (
    <div className={`frame${frame.isActive ? " frame--active" : ""}`}>
      <div className="frame__title">{frame.functionName}</div>
      <div className="frame__vars">
        {frame.variables.map((v) => (
          <div className="var-row" key={v.name}>
            <span className="var-row__name" title={v.declaredType}>
              {v.name}
            </span>
            <span className="var-row__arrow">→</span>
            <ValueCell
              value={v.value}
              registerAnchor={registerCellAnchor}
              anchorId={
                isRef(v.value)
                  ? variableAnchorId(frame.id, v.name)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
