import type { StackFrame } from "./trace";
import ValueCell from "./ValueCell";
import { cellKeyVar } from "./diff";

export interface StackFrameViewProps {
  frame: StackFrame;
  registerCellAnchor: (id: string, el: HTMLElement | null) => void;
  /** Change-keys that should flash this step (see diff.ts). */
  changedKeys: Set<string>;
}

/**
 * Anchor id for a variable slot. Used both as an arrow SOURCE (when the
 * variable holds a pointer) and as an arrow TARGET (when another pointer
 * points at this variable, e.g. int* p = &x).
 */
export function variableAnchorId(frameId: string, varName: string): string {
  return `var:${frameId}:${varName}`;
}

/**
 * One stack frame: a titled box with a row per variable. Primitive variables
 * read like `x -> [ 3 ]`; pointer variables like `p -> [•]` with an arrow
 * (drawn by the overlay) to a heap object or another stack variable.
 */
export default function StackFrameView({
  frame,
  registerCellAnchor,
  changedKeys,
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
            {/* Every variable's box is anchored so a pointer can point AT it,
                not just FROM it. */}
            <ValueCell
              value={v.value}
              registerAnchor={registerCellAnchor}
              anchorId={variableAnchorId(frame.id, v.name)}
              changed={changedKeys.has(cellKeyVar(frame.id, v.name))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
