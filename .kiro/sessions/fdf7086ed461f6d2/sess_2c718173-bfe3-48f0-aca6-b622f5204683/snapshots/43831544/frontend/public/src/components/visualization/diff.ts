// Computes which boxes changed between two program states, so the visualizer
// can highlight exactly what moved on each step.
//
// Change keys are stable strings that match the keys the cell components use:
//   variable   -> cellKeyVar(frameId, name)
//   array cell -> cellKeyArray(objId, index)
//   struct fld -> cellKeyField(objId, fieldName)

import {
  type HeapObject,
  type ProgramState,
  type Value,
  isArray,
  isStruct,
  refTargetKey,
} from "./trace";

export function cellKeyVar(frameId: string, name: string): string {
  return `var:${frameId}:${name}`;
}
export function cellKeyArray(objId: string, index: number): string {
  return `cell:${objId}:${index}`;
}
export function cellKeyField(objId: string, fieldName: string): string {
  return `field:${objId}:${fieldName}`;
}

/** True if two values differ (by display for primitives, target for refs). */
function valueChanged(a: Value | undefined, b: Value): boolean {
  if (!a) return true; // newly appeared
  if (a.kind !== b.kind) return true;
  if (a.kind === "primitive" && b.kind === "primitive") {
    return a.display !== b.display;
  }
  if (a.kind === "ref" && b.kind === "ref") {
    return refTargetKey(a.target) !== refTargetKey(b.target);
  }
  return false;
}

/** Index a state's variables by change-key for quick lookup. */
function indexVars(state: ProgramState): Map<string, Value> {
  const map = new Map<string, Value>();
  for (const frame of state.stack) {
    for (const v of frame.variables) {
      map.set(cellKeyVar(frame.id, v.name), v.value);
    }
  }
  return map;
}

/** Index a heap object's cells/fields by change-key. */
function indexObject(obj: HeapObject, into: Map<string, Value>) {
  if (isArray(obj)) {
    obj.elements.forEach((el, i) => into.set(cellKeyArray(obj.id, i), el));
  } else if (isStruct(obj)) {
    for (const f of obj.fields) {
      into.set(cellKeyField(obj.id, f.name), f.value);
    }
  }
}

function indexHeap(state: ProgramState): Map<string, Value> {
  const map = new Map<string, Value>();
  for (const obj of Object.values(state.heap)) {
    indexObject(obj, map);
  }
  return map;
}

/**
 * Return the set of change-keys whose value differs from `prev` to `curr`.
 * A missing `prev` (first step) yields an empty set — nothing to highlight yet.
 */
export function changedCells(
  prev: ProgramState | undefined,
  curr: ProgramState
): Set<string> {
  const changed = new Set<string>();
  if (!prev) return changed;

  const prevVars = indexVars(prev);
  for (const [key, value] of indexVars(curr)) {
    if (valueChanged(prevVars.get(key), value)) changed.add(key);
  }

  const prevHeap = indexHeap(prev);
  for (const [key, value] of indexHeap(curr)) {
    if (valueChanged(prevHeap.get(key), value)) changed.add(key);
  }

  return changed;
}
