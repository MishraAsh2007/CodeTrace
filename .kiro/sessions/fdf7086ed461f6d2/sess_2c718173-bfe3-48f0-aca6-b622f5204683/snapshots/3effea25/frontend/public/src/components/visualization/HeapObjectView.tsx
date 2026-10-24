import { type HeapObject, isArray, isRef } from "./trace";
import ValueCell from "./ValueCell";
import { cellKeyArray, cellKeyField } from "./diff";

export interface HeapObjectViewProps {
  object: HeapObject;
  /** Registers this object's box so arrows can target it. */
  registerAnchor: (id: string, el: HTMLElement | null) => void;
  /** Registers a reference cell inside this object (e.g. array-of-objects). */
  registerCellAnchor: (id: string, el: HTMLElement | null) => void;
  /** Change-keys that should flash this step (see diff.ts). */
  changedKeys: Set<string>;
}

/** The anchor id of an object's own box (arrow targets point here). */
export function objectAnchorId(id: string): string {
  return `obj:${id}`;
}

/** The anchor id of the i-th reference cell inside an array object. */
export function cellAnchorId(objId: string, index: number): string {
  return `cell:${objId}:${index}`;
}

/** The anchor id of a named reference field inside a struct object. */
export function fieldAnchorId(objId: string, fieldName: string): string {
  return `field:${objId}:${fieldName}`;
}

/**
 * Renders one heap object. Arrays show indexed cells in a row; a cell holding a
 * reference becomes the source of a down-arrow to another object. Structs show
 * a titled box with one row per field.
 */
export default function HeapObjectView({
  object,
  registerAnchor,
  registerCellAnchor,
}: HeapObjectViewProps) {
  if (isArray(object)) {
    return (
      <div
        className="heap-object heap-object--array"
        ref={(el) => registerAnchor(objectAnchorId(object.id), el)}
      >
        <div className="heap-object__cells">
          {object.elements.map((el, i) => (
            <div className="array-cell" key={i}>
              <span className="array-cell__index">{i}</span>
              <ValueCell
                value={el}
                registerAnchor={registerCellAnchor}
                anchorId={cellAnchorId(object.id, i)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="heap-object heap-object--struct"
      ref={(el) => registerAnchor(objectAnchorId(object.id), el)}
    >
      <div className="heap-object__title">{object.typeName}</div>
      <div className="heap-object__fields">
        {object.fields.map((field) => (
          <div className="struct-field" key={field.name}>
            <span className="struct-field__name">{field.name}</span>
            <ValueCell
              value={field.value}
              registerAnchor={registerCellAnchor}
              anchorId={
                isRef(field.value)
                  ? fieldAnchorId(object.id, field.name)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
