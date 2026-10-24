import { type Value, isRef } from "./trace";

export interface ValueCellProps {
  value: Value;
  /**
   * Registers this cell's DOM node so the arrow layer can draw lines to/from
   * it. A ref cell is an arrow SOURCE; any cell can also be an arrow TARGET
   * (e.g. a plain int that a pointer points at via &x). Keyed by anchorId.
   */
  registerAnchor?: (id: string, el: HTMLElement | null) => void;
  /** Connector id for this cell. */
  anchorId?: string;
  /** When true, the cell flashes to flag that its value changed this step. */
  changed?: boolean;
}

/**
 * A single boxed slot. Primitives show their value inline (value semantics);
 * references show a dot/arrow source that the arrow layer connects to its
 * target (reference semantics). A null reference is drawn as a slashed box.
 *
 * The cell always registers its anchor (when given one) so it can serve as an
 * arrow target even when it's a plain primitive.
 */
export default function ValueCell({
  value,
  registerAnchor,
  anchorId,
  changed = false,
}: ValueCellProps) {
  const changedClass = changed ? " cell--changed" : "";
  const setAnchor = (el: HTMLElement | null) => {
    if (registerAnchor && anchorId) registerAnchor(anchorId, el);
  };

  if (isRef(value)) {
    const isNull = value.target === null;
    return (
      <span
        className={`cell cell--ref${isNull ? " cell--null" : ""}${changedClass}`}
        ref={setAnchor}
      >
        {isNull ? "∅" : <span className="cell__dot" aria-label="reference" />}
      </span>
    );
  }

  return (
    <span
      className={`cell cell--primitive${changedClass}`}
      title={value.typeName}
      ref={setAnchor}
    >
      {value.display}
    </span>
  );
}
