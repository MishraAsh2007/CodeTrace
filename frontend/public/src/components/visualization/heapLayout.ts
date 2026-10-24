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
/** Vertical gap between independent structure bands. */
const BAND_GAP = 60;

/**
 * Lay out one connected structure (a "band") starting from `rootId`, via BFS.
 * Positions are relative to the band's own top (y starts at 0). Returns the
 * placed nodes, how many objects it covered, and the band's extent so the
 * caller can stack bands and size the canvas.
 */
function layoutBand(
  heap: ProgramState["heap"],
  rootId: string,
  visited: Set<string>
): { nodes: NodeLayout[]; width: number; height: number } {
  const depth = new Map<string, number>();
  const byDepth = new Map<number, string[]>();
  const queue: string[] = [rootId];
  depth.set(rootId, 0);
  visited.add(rootId);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = depth.get(id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);

    const obj = heap[id];
    if (!obj) continue;
    for (const childId of childIdsOf(obj)) {
      if (!visited.has(childId) && heap[childId]) {
        visited.add(childId);
        depth.set(childId, d + 1);
        queue.push(childId);
      }
    }
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  let maxRows = 0;
  for (const d of depths) maxRows = Math.max(maxRows, byDepth.get(d)!.length);
  const bandHeight = Math.max(1, maxRows) * ROW_GAP;

  const placed: NodeLayout[] = [];
  for (const d of depths) {
    const column = byDepth.get(d)!;
    const colHeight = column.length * ROW_GAP;
    // Center each depth column within the band so it reads balanced.
    const yStart = (bandHeight - colHeight) / 2;
    column.forEach((id, i) => {
      placed.push({ id, depth: d, x: d * COL_GAP, y: yStart + i * ROW_GAP });
    });
  }

  const width = depths.length > 0 ? (Math.max(...depths) + 1) * COL_GAP : COL_GAP;
  return { nodes: placed, width, height: bandHeight };
}

/**
 * Compute positions for every heap object. Each INDEPENDENT structure (the
 * tree, a separate array, another list) is laid out in its own horizontal
 * BAND; bands are stacked top-to-bottom so unrelated structures never overlap
 * — this keeps e.g. a `values[]` array clear of a BST that's also in scope.
 * Within a band, depth increases rightward and siblings stack vertically.
 */
export function layoutHeap(state: ProgramState): HeapLayout {
  const heap = state.heap;
  const nodes = new Map<string, NodeLayout>();
  const visited = new Set<string>();

  // Root order: stack-referenced roots first (stable), then any unreachable
  // objects as their own roots so nothing is hidden. Each becomes a band if it
  // hasn't already been pulled into an earlier band.
  const seeds = [...rootIds(state), ...Object.keys(heap)];

  let bandY = PAD;
  let maxWidth = 0;

  for (const seed of seeds) {
    if (visited.has(seed) || !heap[seed]) continue;
    const band = layoutBand(heap, seed, visited);
    for (const n of band.nodes) {
      nodes.set(n.id, {
        id: n.id,
        depth: n.depth,
        x: PAD + n.x,
        y: bandY + n.y,
      });
    }
    maxWidth = Math.max(maxWidth, band.width);
    bandY += band.height + BAND_GAP;
  }

  const width = PAD * 2 + maxWidth;
  // bandY overshot by one BAND_GAP after the last band; trim it back.
  const height = Math.max(PAD * 2, bandY - BAND_GAP + PAD);

  return { nodes, width, height };
}
