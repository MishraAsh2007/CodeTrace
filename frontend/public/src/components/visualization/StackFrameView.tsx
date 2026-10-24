import type { StackFrame } from "./trace";
import { isRef } from "./trace";
import ValueCell from "./ValueCell";
import { cellKeyVar } from "./diff";

export interface StackFrameViewProps {
  frame: StackFrame;
  registerCellAnchor: (id: string, el: HTMLElement | null) => void;
  /** Change-keys that should flash this step (see diff.ts). */
  changedKeys: Set<string>;
}

/**
 * Anchor id for a variable's value cell (the dot, for a pointer). This is the
 * arrow SOURCE when the variable holds a pointer.
 */
export function variableAnchorId(frameId: string, varName: string): string {
  return `var:${frameId}:${varName}`;
}

/**
 * Anchor id for a variable's whole box. This is the arrow TARGET when another
 * pointer points at this variable (e.g. int* p = &x lands on x's box).
 */
export function variableBoxAnchorId(frameId: string, varName: string): string {
  return `varbox:${frameId}:${varName}`;
}

/**
 * One stack frame: a titled box with one bordered row per variable. Each row
 * reads `name → value` inside its own border. A primitive shows its value; a
 * pointer shows a dot whose arrow (drawn by the overlay) points at a heap
 * object or at another stack variable's box.
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
        {frame.variables.map((v) => {
          const changed = changedKeys.has(cellKeyVar(frame.id, v.name));
          return (
            <div
              className={`var-box${changed ? " var-box--changed" : ""}`}
              key={v.name}
              // The whole box is the target a pointer points AT.
              ref={(el) =>
                registerCellAnchor(variableBoxAnchorId(frame.id, v.name), el)
              }
            >
              <span className="var-box__name" title={v.declaredType}>
                {v.name}
              </span>
              <span className="var-box__arrow">→</span>
              {isRef(v.value) ? (
                // Pointer: a dot that is the arrow SOURCE.
                <ValueCell
                  value={v.value}
                  registerAnchor={registerCellAnchor}
                  anchorId={variableAnchorId(frame.id, v.name)}
                />
              ) : (
                // Primitive: show the value inline, no inner border.
                <span className="var-box__value" title={v.value.typeName}>
                  {v.value.display}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
