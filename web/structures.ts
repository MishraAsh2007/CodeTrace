import { boxedValue, heapIndex } from './narrate.ts';
import type { HeapObject, TraceEvent, TraceValue } from './types';

/**
 * Tree views of the heap: objects of a class with two or more fields of its own type (left/right, or a fixed set
 * of children) are drawn as a tree, laid out in order so a binary search tree reads left to right.
 */
export type TreeNode = { id: string; label: string; x: number; depth: number; refs: string[]; changed: boolean; isNew: boolean };
export type TreeEdge = { from: string; to: string; label: string };
export type TreeView = { type: string; nodes: TreeNode[]; edges: TreeEdge[]; columns: number; rows: number; missing: number };

const simple = (type: string) => type.replace(/^.*[.$]/, '');

/** The value shown inside a node: its first field that isn't a reference to another node. */
function label(object: HeapObject, heap: Map<string, HeapObject>): string {
  for (const f of object.fields ?? []) {
    if (f.type === object.type) continue;
    const v: TraceValue = f.value;
    if (v.kind === 'primitive') return v.value ?? '';
    if (v.kind === 'reference') {
      const target = heap.get(v.ref!);
      if (target?.kind === 'string') return target.text ?? '';
      const boxed = boxedValue(target);
      if (boxed !== undefined) return boxed;
    }
  }
  return '•';
}

export function treeViews(snapshot: TraceEvent, previous?: TraceEvent): TreeView[] {
  const heap = heapIndex(snapshot);
  const before = heapIndex(previous);
  const byType = new Map<string, HeapObject[]>();
  for (const o of snapshot.heap ?? []) if (o.kind === 'object' && o.fields) byType.set(o.type, [...(byType.get(o.type) ?? []), o]);
  const views: TreeView[] = [];
  for (const [type, objects] of byType) {
    const selfFields = (o: HeapObject) => (o.fields ?? []).filter(f => f.type === type);
    if (objects.length < 2 || Math.max(...objects.map(o => selfFields(o).length)) < 2) continue;
    const children = new Map<string, { id: string; edge: string }[]>();
    const parents = new Set<string>();
    let missing = 0;
    for (const o of objects) {
      const list: { id: string; edge: string }[] = [];
      for (const f of selfFields(o)) {
        if (f.value.kind !== 'reference') continue;
        if (heap.get(f.value.ref!)?.type === type) { list.push({ id: f.value.ref!, edge: f.name.split('.').at(-1)! }); parents.add(f.value.ref!); }
        else missing++;
      }
      children.set(o.id, list);
    }
    // Names in the current frame pointing at a node, such as root or current.
    const refs = new Map<string, string[]>();
    for (const v of snapshot.frames?.[0]?.locals ?? []) if (v.value.kind === 'reference' && heap.get(v.value.ref!)?.type === type) refs.set(v.value.ref!, [...(refs.get(v.value.ref!) ?? []), v.name]);
    const roots = objects.filter(o => !parents.has(o.id));
    if (!roots.length) roots.push(objects.find(o => refs.has(o.id)) ?? objects[0]);
    const nodes: TreeNode[] = [];
    const edges: TreeEdge[] = [];
    const placed = new Set<string>();
    let column = 0;
    const place = (id: string, depth: number) => {
      if (placed.has(id)) return;
      placed.add(id);
      const object = heap.get(id)!;
      const kids = children.get(id) ?? [];
      // In-order: the first child's subtree, then this node, then the rest.
      const fields = selfFields(object).map(f => f.name.split('.').at(-1)!);
      const firstHalf = Math.ceil(fields.length / 2);
      const left = kids.filter(k => fields.indexOf(k.edge) < firstHalf), right = kids.filter(k => fields.indexOf(k.edge) >= firstHalf);
      for (const k of left) { edges.push({ from: id, to: k.id, label: k.edge }); place(k.id, depth + 1); }
      const old = before.get(id);
      nodes.push({ id, label: label(object, heap), x: column++, depth, refs: refs.get(id) ?? [], isNew: !!previous && !old, changed: !!old && JSON.stringify(old.fields) !== JSON.stringify(object.fields) });
      for (const k of right) { edges.push({ from: id, to: k.id, label: k.edge }); place(k.id, depth + 1); }
    };
    for (const root of roots) place(root.id, 0);
    for (const o of objects) place(o.id, 0);
    views.push({ type: simple(type), nodes, edges, columns: column, rows: Math.max(...nodes.map(n => n.depth)) + 1, missing });
  }
  return views;
}
