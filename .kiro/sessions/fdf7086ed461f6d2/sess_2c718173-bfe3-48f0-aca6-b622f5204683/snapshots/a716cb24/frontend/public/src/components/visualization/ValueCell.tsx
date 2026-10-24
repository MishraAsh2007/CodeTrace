import { type Value, isRef } from "./trace";

export interface ValueCellProps {
  value: Value;
  /**
   * Registers the DOM node for a reference cell so the arrow layer can draw a
   * line from this cell to its heap target. Keyed by a connector id.
   */
  registerAnchor?: (id: string, el: HTMLElement | null) => void;
  /** Connector id used when this cell holds a reference. */
  anchorId?: string;
}

/**
 * A single boxed slot. Primitives show their value inline (value semantics);
 * references show a dot/arrow source that the arrow layer connects to the heap
 * (reference semantics). A null reference is drawn as a slashed empty box.
 */
export default function ValueCell({
  value,
  registerAnchor,
  anchorId,
}: ValueCellProps) {
  if (isRef(value)) {
    const isNull = value.target === null;
    return (
      <span
        className={`cell cell--ref${isNull ? " cell--null" : ""}`}
        ref={(el) => {
          if (registerAnchor && anchorId) registerAnchor(anchorId, el);
        }}
      >
        {isNull ? "∅" : <span className="cell__dot" aria-label="reference" />}
      </span>
    );
  }

  return (
    <span className="cell cell--primitive" title={value.typeName}>
      {value.display}
    </span>
  );
}
