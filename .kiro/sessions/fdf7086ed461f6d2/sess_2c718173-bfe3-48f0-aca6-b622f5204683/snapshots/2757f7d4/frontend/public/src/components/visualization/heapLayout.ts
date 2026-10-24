// Horizontal layered (BFS) layout for heap objects.
//
// The heap is a directed graph: objects (structs/arrays) with pointer fields
// that reference other objects. We lay it out left-to-right:
//   - depth (distance from a root) -> column (x), increasing rightward
//   - siblings within a depth       -> stacked vertically (y)
// Roots are heap objects pointed to by stack variables; unreachable objects
// (e.g. leaked mallocs) are laid out as their own trees after the reachable
// ones so nothing is hidden.
//
// This renders trees as trees (root left, children fanning right), linked
// lists as left-to-right chains, and cycles/graphs honestly: a back-edge is
// just an arrow returning to an earlier node. It never duplicates or drops a
// node — a shared child is placed once and both parents point at it.

import {
  type ProgramState,
  type HeapObject,
  isArray,
  isStruct,
  isRef,
} from "./trace";

export interface NodeLayout {
  id: string;
  /** Top-left position within the layout canvas, in px. */
  x: number;
  y: number;
  depth: number;
}

export interface HeapLayout {
  nodes: Map<string, NodeLayout>;
  /** Total canvas size needed to fit every node. */
  width: number;
  height: number;
}

// Spacing between columns (depth) and rows (siblings). These are generous so
// boxes of varying size don't collide; the stage scrolls if it overflows.
const COL_GAP = 190; // horizontal distance between depth levels
const ROW_GAP = 130; // vertical distance between stacked nodes
const PAD = 16;

/** The heap-object ids a given object points at, in field/cell order. */
function childIdsOf(obj: HeapObject): string[] {
  const ids: string[] = [];
  if (isArray(obj)) {
    for (const el of obj.elements) {
      if (isRef(el) && el.target && el.target.kind === "heap") {
        ids.push(el.target.id);
      }
    }
  } else if (isStruct(obj)) {
    for (const f of obj.fields) {
      if (isRef(f.value) && f.value.target && f.value.target.kind === "heap") {
        ids.push(f.value.target.id);
      }
    }
  }
  return ids;
}

/** Heap objects referenced directly by a stack variable (the layout roots). */
function rootIds(state: ProgramState): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const frame of state.stack) {
    for (const v of frame.variables) {
      if (isRef(v.value) && v.value.target && v.value.target.kind === "heap") {
        const id = v.value.target.id;
        if (!seen.has(id)) {
          seen.add(id);
          roots.push(id);
        }
      }
    }
  }
  return roots;
}

/**
 * Compute positions for every heap object via BFS from the roots. Each node's
 * depth is its shortest distance from a root; nodes are packed into vertical
 * "slots" per depth so siblings don't overlap. Returns absolute positions and
 * the canvas size.
 */
export function layoutHeap(state: ProgramState): HeapLayout {
  const heap = state.heap;
  const allIds = Object.keys(heap);
  const nodes = new Map<string, NodeLayout>();

  // Assign a depth to every node via BFS. CRITICAL ordering: we must fully
  // explore from the real stack roots FIRST (so children get their correct
  // depth), and only THEN seed any still-unvisited objects (unreachable /
  // leaked) as fresh depth-0 roots. Seeding everything up front would wrongly
  // pin every object at depth 0 (a flat column, not a tree).
  const depth = new Map<string, number>();
  const byDepth = new Map<number, string[]>();
  const queue: string[] = [];
  let head = 0;

  const enqueueRoot = (id: string) => {
    if (!depth.has(id) && heap[id]) {
      depth.set(id, 0);
      queue.push(id);
    }
  };

  // Drain the queue with BFS, recording first-reach order per depth.
  const drain = () => {
    while (head < queue.length) {
      const id = queue[head++];
      const d = depth.get(id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);

      const obj = heap[id];
      if (!obj) continue;
      for (const childId of childIdsOf(obj)) {
        if (!depth.has(childId) && heap[childId]) {
          depth.set(childId, d + 1);
          queue.push(childId);
        }
      }
    }
  };

  // 1) Explore from the real roots to completion.
  rootIds(state).forEach(enqueueRoot);
  drain();

  // 2) Any object still unvisited is unreachable from a stack root; seed it as
  //    its own depth-0 root (stable order) and explore its subgraph too.
  for (const id of allIds) {
    if (!depth.has(id)) {
      enqueueRoot(id);
      drain();
    }
  }

  // Place nodes: x by depth, y by order within the depth column. We vertically
  // center each column so the whole diagram reads as balanced.
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  let maxRows = 0;
  for (const d of depths) maxRows = Math.max(maxRows, byDepth.get(d)!.length);
  const canvasHeight = Math.max(1, maxRows) * ROW_GAP;

  for (const d of depths) {
    const column = byDepth.get(d)!;
    const colHeight = column.length * ROW_GAP;
    const yStart = (canvasHeight - colHeight) / 2;
    column.forEach((id, i) => {
      nodes.set(id, {
        id,
        depth: d,
        x: PAD + d * COL_GAP,
        y: PAD + yStart + i * ROW_GAP,
      });
    });
  }

  const width = PAD * 2 + (depths.length > 0 ? (Math.max(...depths) + 1) * COL_GAP : 0);
  const height = PAD * 2 + canvasHeight;

  return { nodes, width, height };
}
