import type { Cursor } from './cursors.ts';
import type { Frame, HeapObject, TraceEvent, TraceValue } from './types';

// Local copies of narrate.ts helpers: learning.ts imports this module, and narrate.ts imports learning.ts.
const heapIndex = (state?: TraceEvent) => new Map((state?.heap ?? []).map(o => [o.id, o]));
const boxedValue = (o?: HeapObject) => o?.kind === 'object' && /^java\.lang\.(Integer|Long|Short|Byte|Double|Float|Boolean|Character)$/.test(o.type) ? o.fields?.[0]?.value.value : undefined;

/**
 * Pictures of data structures found in a recorded step, all laid out to grow sideways (the views scroll
 * horizontally): binary trees in order, graphs in layers by distance from the start, recursion as a call
 * tree, 2D arrays as grids and linked lists as chains. Everything comes from recorded values; names and
 * shapes are only used to decide which picture fits.
 */

const simple = (type: string) => type.replace(/^.*[.$]/, '');
const leaf = (name: string) => name.split('.').at(-1)!;
const BOXED_INT = /^java\.lang\.(Integer|Long|Short|Byte)$/;

/** An integer from a primitive or a boxed number. */
function intOf(v: TraceValue | undefined, heap: Map<string, HeapObject>): number | undefined {
  if (!v) return undefined;
  if (v.kind === 'primitive') return /^(int|long|short|byte)$/.test(v.type ?? '') && /^-?\d+$/.test(v.value ?? '') ? Number(v.value) : undefined;
  if (v.kind !== 'reference') return undefined;
  const o = heap.get(v.ref!);
  const text = o && BOXED_INT.test(o.type) ? boxedValue(o) : undefined;
  return text !== undefined && /^-?\d+$/.test(text) ? Number(text) : undefined;
}
/** Text of a simple value: a primitive, String, boxed number or library value such as a LocalDate. */
function textOf(v: TraceValue | undefined, heap: Map<string, HeapObject>): string | undefined {
  if (!v || v.kind === 'null') return undefined;
  if (v.kind === 'primitive') return v.value;
  const o = heap.get(v.ref!);
  if (!o) return undefined;
  if (o.kind === 'string' || o.kind === 'value') return o.text;
  return boxedValue(o);
}
const isTrue = (v?: TraceValue) => v?.kind === 'primitive' && v.value === 'true';

/** The value shown inside a node: its first field that isn't a reference to another node or a collection. */
function nodeLabel(object: HeapObject, heap: Map<string, HeapObject>): string {
  for (const f of object.fields ?? []) {
    if (f.type === object.type) continue;
    const text = textOf(f.value, heap);
    if (text !== undefined) return text;
  }
  return '•';
}

/** Variables visible at a step, newest frame first, then fields of `this`, then statics. */
type Named = { name: string; value: TraceValue; frame: number };
function namedValues(snapshot: TraceEvent, heap: Map<string, HeapObject>): Named[] {
  const out: Named[] = [];
  snapshot.frames?.forEach((f, i) => {
    for (const v of f.locals) {
      if (v.name !== 'this') { out.push({ name: v.name, value: v.value, frame: i }); continue; }
      for (const field of heap.get(v.value.ref ?? '')?.fields ?? []) out.push({ name: leaf(field.name), value: field.value, frame: i });
    }
  });
  for (const s of snapshot.statics ?? []) out.push({ name: leaf(s.name), value: s.value, frame: -1 });
  return out;
}
/** Each heap object once, under the first name that refers to it. */
function namedObjects(named: Named[], heap: Map<string, HeapObject>): { name: string; object: HeapObject }[] {
  const seen = new Set<string>();
  const out: { name: string; object: HeapObject }[] = [];
  for (const n of named) {
    const object = n.value.kind === 'reference' ? heap.get(n.value.ref!) : undefined;
    if (!object || seen.has(object.id)) continue;
    seen.add(object.id); out.push({ name: n.name, object });
  }
  return out;
}

// ---------- Binary trees ----------

export type TreeNode = { id: string; label: string; x: number; depth: number; refs: string[]; changed: boolean; isNew: boolean };
export type TreeEdge = { from: string; to: string; label: string };
export type TreeView = { type: string; nodes: TreeNode[]; edges: TreeEdge[]; columns: number; rows: number; missing: number };

/** Two self-typed fields named like next/prev make a doubly linked list, not a tree. */
const LINK_NAMES = /^(next|prev|previous|succ|pred|before|after|link|forward|back|backward)$/i;

/** Objects of a class with two or more fields of its own type (left/right, or a fixed set of children), laid out in order. */
export function treeViews(snapshot: TraceEvent, previous?: TraceEvent): TreeView[] {
  const heap = heapIndex(snapshot);
  const before = heapIndex(previous);
  const byType = new Map<string, HeapObject[]>();
  for (const o of snapshot.heap ?? []) if (o.kind === 'object' && o.fields) byType.set(o.type, [...(byType.get(o.type) ?? []), o]);
  const views: TreeView[] = [];
  for (const [type, objects] of byType) {
    const selfFields = (o: HeapObject) => (o.fields ?? []).filter(f => f.type === type);
    if (objects.length < 2 || Math.max(...objects.map(o => selfFields(o).length)) < 2) continue;
    if (selfFields(objects[0]).every(f => LINK_NAMES.test(leaf(f.name)))) continue;
    const children = new Map<string, { id: string; edge: string }[]>();
    const parents = new Set<string>();
    let missing = 0;
    for (const o of objects) {
      const list: { id: string; edge: string }[] = [];
      for (const f of selfFields(o)) {
        if (f.value.kind !== 'reference') continue;
        if (heap.get(f.value.ref!)?.type === type) { list.push({ id: f.value.ref!, edge: leaf(f.name) }); parents.add(f.value.ref!); }
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
      const fields = selfFields(object).map(f => leaf(f.name));
      const firstHalf = Math.ceil(fields.length / 2);
      const left = kids.filter(k => fields.indexOf(k.edge) < firstHalf), right = kids.filter(k => fields.indexOf(k.edge) >= firstHalf);
      for (const k of left) { edges.push({ from: id, to: k.id, label: k.edge }); place(k.id, depth + 1); }
      const old = before.get(id);
      nodes.push({ id, label: nodeLabel(object, heap), x: column++, depth, refs: refs.get(id) ?? [], isNew: !!previous && !old, changed: !!old && JSON.stringify(old.fields) !== JSON.stringify(object.fields) });
      for (const k of right) { edges.push({ from: id, to: k.id, label: k.edge }); place(k.id, depth + 1); }
    };
    for (const root of roots) place(root.id, 0);
    for (const o of objects) place(o.id, 0);
    views.push({ type: simple(type), nodes, edges, columns: column, rows: Math.max(...nodes.map(n => n.depth)) + 1, missing });
  }
  return views;
}

// ---------- Graphs ----------

export type GraphNode = {
  key: string; label: string;
  /** Heap object for graphs of objects, so the node can link to its card. */
  ref?: string;
  x: number; y: number;
  visited: boolean;
  /** Position in the queue or stack in removal order (1 = removed next), or 0. */
  queued: number;
  current: boolean;
  /** On the chain of recursive calls that led to the current node. */
  onPath: boolean;
  names: string[];
  badge?: string;
};
export type GraphEdge = { from: string; to: string; label?: string; tree: boolean; active: boolean; path: boolean };
export type GraphView = {
  key: string; name: string; kind: 'adjacency list' | 'adjacency matrix' | 'edge list' | 'map' | 'objects';
  directed: boolean; nodes: GraphNode[]; edges: GraphEdge[]; columns: number; rows: number;
  /** What the colors came from, e.g. { visited: 'dist', queue: 'queue' }. */
  sources: { visited?: string; queue?: string; badge?: string; tree?: string; path?: string; queueKind?: 'queue' | 'stack' | 'priority queue' };
};

const GRAPH_NAME = /adj|graph|neighbo|edge|link|conn|^g$|^gr$|succ|^nbrs?$|vert/i;
const GRID_NAME = /grid|board|maze|matrix|cells|image|pixel|dp|memo|table|map|field|world|screen|mat$/i;
const VISITED_NAME = /visit|seen|mark|done|discover|explor|used|closed/i;
const DIST_NAME = /dist|depth|level|order|time|cost|step/i;
const PARENT_NAME = /^(parent|prev|pred|from|came|cameFrom|parents)/i;
const COLOR_NAME = /color|colour|state|status/i;
const QUEUE_NAME = /queue|^q$|^qu$|frontier|stack|^st$|^stk$|deque|todo|work|open|pending|tovisit|bag|fringe|^pq$|heap/i;
const QUEUE_TYPES = /^java\.util\.(ArrayDeque|LinkedList|PriorityQueue|Stack|concurrent\.\w*Queue\w*)$/;
const CURRENT_NAMES = ['node', 'u', 'cur', 'curr', 'current', 'vertex', 'at', 'here', 'top', 'front', 'head', 'city', 'room', 'cell', 'word', 'state', 'person', 'page'];
const NEIGHBOR_NAMES = ['next', 'v', 'w', 'nb', 'nbr', 'nei', 'neighbor', 'neighbour', 'child', 'to', 'adj', 'other', 'neigh', 'friend', 'dest'];
const START_NAMES = ['start', 'source', 'src', 's', 'root', 'origin', 'begin', 'from'];
const TARGET_NAMES = ['target', 'goal', 'end', 'dst', 't', 'finish'];

type RawGraph = { key: string; name: string; kind: GraphView['kind']; keys: string[]; labels: Map<string, string>; refs?: Map<string, string>; out: Map<string, { to: string; label?: string }[]>; index?: boolean; objectType?: string };

/** Lists or arrays of integer lists, `int[][]` adjacency matrices and edge lists, all over node numbers 0 to n − 1. */
function indexGraph(name: string, o: HeapObject, heap: Map<string, HeapObject>): RawGraph | null {
  if (!(o.kind === 'array' || o.kind === 'list') || !o.elements || o.truncated || o.elements.length < 2 || o.elements.length > 64) return null;
  const rows: HeapObject[] = [];
  for (const e of o.elements) {
    if (e.kind === 'null') { rows.push({ id: '', type: '', kind: 'list', elements: [] }); continue; }
    const row = e.kind === 'reference' ? heap.get(e.ref!) : undefined;
    if (!row || !(row.kind === 'array' || row.kind === 'list' || row.kind === 'set') || !row.elements || row.truncated) return null;
    rows.push(row);
  }
  const n = rows.length;
  const nameHint = GRAPH_NAME.test(name) && !GRID_NAME.test(name.replace(/adj\w*/i, ''));
  // An array of lists (List<Integer>[]) is almost always an adjacency list.
  const arrayOfLists = o.kind === 'array' && rows.some(r => r.kind === 'list' || r.kind === 'set');
  const booleans = rows.every(r => r.elements!.every(e => e.kind === 'primitive' && e.type === 'boolean'));
  const ints = booleans ? null : rows.map(r => r.elements!.map(e => intOf(e, heap)));
  if (ints?.some(r => r.some(v => v === undefined))) return null;
  const keys = Array.from({ length: n }, (_, i) => String(i));
  const labels = new Map(keys.map(k => [k, k]));
  const out = new Map<string, { to: string; label?: string }[]>(keys.map(k => [k, []]));
  const square = rows.every(r => r.elements!.length === n);
  if (nameHint && square && (booleans || ints!.every(r => r.every(v => v === 0 || v === 1))) && /adj|graph|matrix|conn|link|edge|^g$/i.test(name)) {
    rows.forEach((r, i) => r.elements!.forEach((e, j) => { if (booleans ? isTrue(e) : intOf(e, heap) === 1) out.get(String(i))!.push({ to: String(j) }); }));
    return { key: `graph:${o.id}`, name, kind: 'adjacency matrix', keys, labels, out, index: true };
  }
  if (!ints) return null;
  if (/edge/i.test(name) && rows.every(r => r.elements!.length === 2 || r.elements!.length === 3)) {
    const all = ints.flat() as number[];
    const pairs = ints.map(r => r.slice(0, 2) as number[]);
    const nodes = pairs.flat();
    const size = Math.max(...nodes) + 1;
    if (Math.min(...nodes) < 0 || size > 64 || !all.length) return null;
    const edgeKeys = Array.from({ length: size }, (_, i) => String(i));
    const edgeOut = new Map<string, { to: string; label?: string }[]>(edgeKeys.map(k => [k, []]));
    ints.forEach(r => edgeOut.get(String(r[0]))!.push({ to: String(r[1]), label: r.length === 3 ? String(r[2]) : undefined }));
    return { key: `graph:${o.id}`, name, kind: 'edge list', keys: edgeKeys, labels: new Map(edgeKeys.map(k => [k, k])), out: edgeOut, index: true };
  }
  if (!(nameHint || arrayOfLists)) return null;
  if (!ints.every(r => r.every(v => v! >= 0 && v! < n)) || !ints.some(r => r.length)) return null;
  ints.forEach((r, i) => r.forEach(v => out.get(String(i))!.push({ to: String(v) })));
  return { key: `graph:${o.id}`, name, kind: 'adjacency list', keys, labels, out, index: true };
}

/** Maps from a node to a list or set of nodes (Map<String, List<String>>), or to a map of neighbor → weight. */
function mapGraph(name: string, o: HeapObject, heap: Map<string, HeapObject>): RawGraph | null {
  if (o.kind !== 'map' || !o.entries || o.entries.length < 2 || o.entries.length > 64 || o.truncated) return null;
  const out = new Map<string, { to: string; label?: string }[]>();
  const labels = new Map<string, string>();
  for (const e of o.entries) {
    const key = textOf(e.key, heap);
    const target = e.value.kind === 'reference' ? heap.get(e.value.ref!) : undefined;
    if (key === undefined || !target) return null;
    labels.set(key, key);
    const list: { to: string; label?: string }[] = [];
    if (target.kind === 'map' && target.entries) {
      for (const inner of target.entries) {
        const to = textOf(inner.key, heap);
        if (to === undefined) return null;
        list.push({ to, label: textOf(inner.value, heap) });
      }
    } else if ((target.kind === 'list' || target.kind === 'set' || target.kind === 'array') && target.elements) {
      for (const element of target.elements) {
        const to = textOf(element, heap);
        if (to === undefined) return null;
        list.push({ to });
      }
    } else return null;
    out.set(key, list);
  }
  const targets = [...new Set([...out.values()].flat().map(e => e.to))];
  if (!targets.length) return null;
  // Groups such as anagrams map to values that are never keys; a graph's neighbors mostly are nodes too.
  if (!GRAPH_NAME.test(name) && targets.filter(t => out.has(t)).length * 2 < targets.length) return null;
  for (const t of targets) if (!labels.has(t)) { labels.set(t, t); out.set(t, []); }
  return { key: `graph:${o.id}`, name, kind: 'map', keys: [...labels.keys()], labels, out };
}

/** Objects of a user class whose collection field (List<Node> neighbors, Node[] children) holds objects of the same class. */
function objectGraphs(heap: Map<string, HeapObject>, all: HeapObject[]): RawGraph[] {
  const byType = new Map<string, HeapObject[]>();
  for (const o of all) if (o.kind === 'object' && o.fields && !/^java\./.test(o.type)) byType.set(o.type, [...(byType.get(o.type) ?? []), o]);
  const graphs: RawGraph[] = [];
  for (const [type, objects] of byType) {
    if (objects.length < 2) continue;
    const out = new Map<string, { to: string; label?: string }[]>();
    let viaCollection = false;
    for (const o of objects) {
      const list: { to: string; label?: string }[] = [];
      for (const f of o.fields ?? []) {
        if (f.value.kind !== 'reference') continue;
        const target = heap.get(f.value.ref!);
        if (!target) continue;
        if (target.type === type) { list.push({ to: target.id }); continue; }
        if ((target.kind === 'list' || target.kind === 'set' || target.kind === 'array') && target.elements?.length) {
          const members = target.elements.filter(e => e.kind === 'reference' && heap.get(e.ref!)?.type === type);
          if (members.length && members.length === target.elements.length) { viaCollection = true; for (const m of members) list.push({ to: m.ref! }); }
        }
      }
      out.set(o.id, list);
    }
    if (!viaCollection) continue;
    const labels = new Map(objects.map(o => [o.id, nodeLabel(o, heap)]));
    graphs.push({ key: `graph:${type}`, name: simple(type), kind: 'objects', keys: objects.map(o => o.id), labels, refs: new Map(objects.map(o => [o.id, o.id])), out, objectType: type });
  }
  return graphs;
}

/** Layers by breadth-first distance from the start (one column each), rows ordered to reduce crossings. */
function layout(keys: string[], out: Map<string, { to: string }[]>, root: string | undefined): Map<string, { x: number; y: number }> {
  const near = new Map<string, string[]>(keys.map(k => [k, []]));
  for (const [from, list] of out) for (const e of list) { if (!near.has(e.to) || !near.has(from)) continue; near.get(from)!.push(e.to); near.get(e.to)!.push(from); }
  const layerOf = new Map<string, number>();
  const components: string[][][] = [];
  const order = root && near.has(root) ? [root, ...keys.filter(k => k !== root)] : keys;
  for (const start of order) {
    if (layerOf.has(start)) continue;
    const layers: string[][] = [[start]];
    layerOf.set(start, 0);
    for (let d = 0; layers[d]?.length; d++) {
      const next: string[] = [];
      for (const k of layers[d]) for (const m of near.get(k)!) if (!layerOf.has(m)) { layerOf.set(m, d + 1); next.push(m); }
      if (next.length) layers.push(next);
    }
    components.push(layers);
  }
  const position = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const layers of components) {
    const rowOf = new Map<string, number>();
    layers[0].forEach((k, i) => rowOf.set(k, i));
    for (let d = 1; d < layers.length; d++) {
      const score = (k: string) => { const prev = near.get(k)!.filter(m => layerOf.get(m) === d - 1 && rowOf.has(m)).map(m => rowOf.get(m)!); return prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0; };
      layers[d] = layers[d].map((k, i) => ({ k, s: score(k), i })).sort((a, b) => a.s - b.s || a.i - b.i).map(e => e.k);
      layers[d].forEach((k, i) => rowOf.set(k, i));
    }
    const height = Math.max(...layers.map(l => l.length));
    layers.forEach((layer, d) => layer.forEach((k, i) => position.set(k, { x: d, y: top + i + (height - layer.length) / 2 })));
    top += height;
  }
  return position;
}

/** Graphs in a step, colored by the visited arrays or sets, queues and stacks, and recursive calls recorded with them. */
export function graphViews(snapshot: TraceEvent, previous?: TraceEvent): GraphView[] {
  const heap = heapIndex(snapshot);
  const named = namedValues(snapshot, heap);
  const objects = namedObjects(named, heap);
  const raw: RawGraph[] = [];
  const used = new Set<string>();
  for (const { name, object } of objects) {
    const g = indexGraph(name, object, heap) ?? mapGraph(name, object, heap);
    if (g) { raw.push(g); used.add(object.id); }
  }
  raw.push(...objectGraphs(heap, snapshot.heap ?? []));
  // The same graph stored twice (an edge list and the adjacency list built from it) is drawn once.
  const canonical = (g: RawGraph) => [...new Set([...g.out].flatMap(([from, list]) => list.map(e => [g.labels.get(from), g.labels.get(e.to)].sort().join('-'))))].sort().join(',');
  // Edge lists go last so the adjacency structure the search reads (and its coloring) is the one kept.
  raw.sort((a, b) => Number(a.kind === 'edge list') - Number(b.kind === 'edge list'));
  const unique = raw.filter((g, i) => !raw.slice(0, i).some(h => canonical(h) === canonical(g)));
  return unique.map(g => colorGraph(g, snapshot, previous, named, heap, objects.filter(o => !used.has(o.object.id) || o.object.id === g.key.slice(6))));
}

function colorGraph(g: RawGraph, snapshot: TraceEvent, _previous: TraceEvent | undefined, named: Named[], heap: Map<string, HeapObject>, objects: { name: string; object: HeapObject }[]): GraphView {
  const sources: GraphView['sources'] = {};
  const has = (k: string | undefined): k is string => k !== undefined && g.out.has(k);
  /** The node a value names: a number for numbered graphs, text for maps, the object for object graphs. */
  const nodeOf = (v: TraceValue | undefined): string | undefined => {
    if (!v) return undefined;
    if (g.kind === 'objects') return v.kind === 'reference' && g.out.has(v.ref!) ? v.ref : undefined;
    const k = g.index ? intOf(v, heap)?.toString() : textOf(v, heap);
    return has(k) ? k : undefined;
  };
  const visited = new Set<string>(), badges = new Map<string, string>(), treeEdges = new Set<string>();
  const n = g.keys.length;
  // Arrays indexed by node number: visited flags, distances, parents, colors.
  if (g.index) {
    for (const { name, object } of objects) {
      if (object.kind !== 'array' || !object.elements || object.length !== n || `graph:${object.id}` === g.key) continue;
      const values = object.elements;
      if (values.every(v => v.kind === 'primitive' && v.type === 'boolean')) {
        if (sources.visited && !VISITED_NAME.test(name)) continue;
        sources.visited = name; visited.clear();
        values.forEach((v, i) => { if (isTrue(v)) visited.add(String(i)); });
        continue;
      }
      const ints = values.map(v => intOf(v, heap));
      if (ints.some(v => v === undefined)) continue;
      // Unreached nodes hold -1 or Integer.MAX_VALUE. With neither left (and not a fresh all-zero array), every node was reached.
      const sentinel = ints.includes(-1) ? -1 : ints.includes(2147483647) ? 2147483647 : ints.every(v => v === 0) ? 0 : NaN;
      if (PARENT_NAME.test(name) && !sources.tree) {
        sources.tree = name;
        ints.forEach((p, i) => { if (p !== sentinel && p !== i && p! >= 0 && p! < n) { treeEdges.add(`${p}-${i}`); visited.add(String(i)); } });
      } else if (DIST_NAME.test(name) && !sources.badge) {
        sources.badge = name;
        ints.forEach((d, i) => { if (d !== sentinel) { badges.set(String(i), String(d)); if (sentinel !== undefined && !sources.visited) visited.add(String(i)); } });
        if (sentinel !== undefined && !sources.visited) sources.visited = name;
      } else if (COLOR_NAME.test(name) && !sources.visited) {
        sources.visited = name;
        ints.forEach((c, i) => { if (c! > 0) visited.add(String(i)); });
      }
    }
  }
  // Sets of visited nodes, maps of distances or parents, and boolean fields on node objects.
  for (const { name, object } of objects) {
    if (object.kind === 'set' && object.elements && VISITED_NAME.test(name) && !sources.visited) {
      const members = object.elements.map(nodeOf);
      if (members.some(m => m !== undefined)) { sources.visited = name; for (const m of members) if (m) visited.add(m); }
    } else if (object.kind === 'map' && object.entries && `graph:${object.id}` !== g.key) {
      const pairs = object.entries.map(e => [nodeOf(e.key), e.value] as const);
      if (!pairs.length || pairs.some(([k]) => k === undefined)) continue;
      if (PARENT_NAME.test(name) && !sources.tree) { sources.tree = name; for (const [k, v] of pairs) { const p = nodeOf(v); if (p && p !== k) treeEdges.add(`${p}-${k}`); visited.add(k!); } }
      else if ((DIST_NAME.test(name) || VISITED_NAME.test(name)) && !sources.badge) { sources.badge = name; for (const [k, v] of pairs) { const t = textOf(v, heap); if (t !== undefined) badges.set(k!, t === '2147483647' ? '∞' : t); visited.add(k!); } if (!sources.visited) sources.visited = name; }
    }
  }
  if (g.kind === 'objects') {
    for (const key of g.keys) {
      const flag = heap.get(key)?.fields?.find(f => VISITED_NAME.test(leaf(f.name)) && f.value.kind === 'primitive' && f.value.type === 'boolean');
      if (flag) { sources.visited ??= leaf(flag.name); if (isTrue(flag.value)) visited.add(key); }
    }
  }
  // The queue or stack holding nodes still to visit.
  const queued = new Map<string, number>();
  const queues = objects.filter(({ name, object }) => (object.kind === 'list' || object.kind === 'set') && object.elements?.length !== undefined
    && (QUEUE_TYPES.test(object.type) || QUEUE_NAME.test(name)) && !g.key.endsWith(object.id) && object.elements.every(e => nodeOf(e) !== undefined));
  const queue = queues.find(q => QUEUE_NAME.test(q.name)) ?? queues[0];
  if (queue) {
    const { object } = queue;
    const isStack = object.type === 'java.util.Stack';
    sources.queue = queue.name;
    sources.queueKind = object.type === 'java.util.PriorityQueue' ? 'priority queue' : isStack || /stack|^st/i.test(queue.name) ? 'stack' : 'queue';
    const order = isStack ? [...object.elements!].reverse() : object.elements!;
    order.forEach((e, i) => { const k = nodeOf(e)!; if (!queued.has(k)) queued.set(k, object.type === 'java.util.PriorityQueue' && i > 0 ? 99 : i + 1); });
  }
  // Recursive search: one method calling itself with a node each time draws the path back to the start.
  const frames = snapshot.frames ?? [];
  const top = frames[0];
  let path: string[] = [];
  for (const f of [...frames].reverse()) {
    if (f.method !== top?.method) continue;
    const arg = f.locals.find(v => v.argument && nodeOf(v.value) !== undefined);
    if (arg) path.push(nodeOf(arg.value)!);
  }
  const recursive = path.length > 1;
  const locals = top?.locals ?? [];
  const tagged = (names: string[]) => locals.filter(v => names.includes(v.name)).map(v => ({ name: v.name, key: nodeOf(v.value) })).filter(t => t.key !== undefined);
  const currentLocal = tagged(CURRENT_NAMES)[0]?.key;
  const current = recursive ? path.at(-1) : currentLocal ?? path.at(-1);
  if (recursive) sources.path = displayCall(top!); else path = [];
  const neighbor = tagged(NEIGHBOR_NAMES).find(t => t.key !== current)?.key;
  const names = new Map<string, string[]>();
  for (const t of tagged([...CURRENT_NAMES, ...NEIGHBOR_NAMES, ...START_NAMES, ...TARGET_NAMES])) names.set(t.key!, [...(names.get(t.key!) ?? []), t.name]);
  if (g.kind === 'objects') for (const v of locals) if (v.value.kind === 'reference' && g.out.has(v.value.ref!) && v.name !== 'this' && !names.get(v.value.ref!)?.includes(v.name)) names.set(v.value.ref!, [...(names.get(v.value.ref!) ?? []), v.name]);
  // Start the layers at the search's start: a start-like variable, the first call of the search, or distance 0.
  const startNamed = named.find(v => START_NAMES.includes(v.name) && nodeOf(v.value) !== undefined);
  const root = (startNamed ? nodeOf(startNamed.value) : undefined) ?? path[0] ?? [...badges].find(([, d]) => d === '0')?.[0] ?? g.keys[0];
  const directedEdges = [...g.out].flatMap(([from, list]) => list.map(e => ({ from, ...e })));
  const pair = (a: string, b: string) => `${a}-${b}`;
  const set = new Set(directedEdges.map(e => pair(e.from, e.to)));
  // Edge lists name each edge once, so they read as undirected unless the name says otherwise.
  const directed = g.kind === 'edge list' ? /direct|arc/i.test(g.name)
    : directedEdges.some(e => !set.has(pair(e.to, e.from))) || directedEdges.some(e => e.label !== undefined && directedEdges.find(f => f.from === e.to && f.to === e.from)?.label !== e.label);
  const edges: GraphEdge[] = [];
  const drawn = new Set<string>();
  const onPath = new Set(path.slice(0, -1).map((k, i) => pair(k, path[i + 1])));
  for (const e of directedEdges) {
    const forward = pair(e.from, e.to), backward = pair(e.to, e.from);
    if (!directed && drawn.has(backward)) continue;
    if (drawn.has(forward)) continue;
    drawn.add(forward);
    const either = (s: Set<string>) => s.has(forward) || (!directed && s.has(backward));
    edges.push({ from: e.from, to: e.to, label: e.label, tree: either(treeEdges), path: either(onPath), active: !!current && !!neighbor && (forward === pair(current, neighbor) || (!directed && backward === pair(current, neighbor))) });
  }
  const position = layout(g.keys, g.out, root);
  const nodes: GraphNode[] = g.keys.map(key => ({
    key, label: g.labels.get(key) ?? key, ref: g.refs?.get(key), ...position.get(key)!,
    visited: visited.has(key), queued: queued.get(key) ?? 0, current: key === current, onPath: path.includes(key) && key !== current,
    names: names.get(key) ?? [], badge: badges.get(key),
  }));
  return { key: g.key, name: g.name, kind: g.kind, directed, nodes, edges, columns: Math.max(...nodes.map(n => n.x)) + 1, rows: Math.ceil(Math.max(...nodes.map(n => n.y)) + 1), sources };
}
const displayCall = (frame: Frame) => `${frame.method.split('.').at(-1)}()`;

// ---------- Recursion ----------

export type CallNode = { id: string; label: string; method: string; parent: string | null; x: number; depth: number; state: 'current' | 'active' | 'done'; result?: string; step: number };
export type CallTree = { method: string; nodes: CallNode[]; columns: number; rows: number; hidden: number; calls: number };

/** A short argument: numbers and text as is, a node object by its value, other objects by parameter name. */
function argText(name: string, v: TraceValue, heap: Map<string, HeapObject>): string {
  if (v.kind === 'null') return 'null';
  const text = textOf(v, heap);
  if (text !== undefined) {
    const o = v.kind === 'reference' ? heap.get(v.ref!) : undefined;
    const quoted = o?.kind === 'string' ? `"${text.length > 8 ? `${text.slice(0, 7)}…` : text}"` : text;
    return v.kind === 'primitive' && v.type === 'char' ? `'${text}'` : quoted;
  }
  const o = heap.get(v.ref ?? '');
  if (o?.kind === 'object' && o.fields && !/^java\./.test(o.type)) return name ? `${name}=${nodeLabel(o, heap)}` : nodeLabel(o, heap);
  return name || simple(o?.type ?? 'object');
}

/**
 * The calls made so far by recursive methods, as a tree: each call under the call that made it, with its
 * arguments and, once it returns, its result. Only calls up to `step` are shown, so the tree grows as you step.
 */
export function recursionTree(states: TraceEvent[], step: number, limit = 200): CallTree | null {
  type Seen = { id: string; method: string; parent: string | null; step: number; label: string };
  const seen = new Map<string, Seen>();
  const results = new Map<string, string>();
  let last: TraceEvent | undefined;
  for (let i = 0; i <= Math.min(step, states.length - 1); i++) {
    const s = states[i];
    if (!s.frames) continue;
    const heap = heapIndex(s);
    s.frames.forEach((f, k) => {
      if (seen.has(f.id) || f.id.startsWith('depth-') || /\.<(cl)?init>$/.test(f.method)) return;
      const args = f.locals.filter(v => v.argument);
      seen.set(f.id, { id: f.id, method: f.method, parent: s.frames![k + 1]?.id ?? null, step: i, label: `${f.method.split('.').at(-1)}(${args.map(a => argText(a.name, a.value, heap)).join(', ')})` });
    });
    for (const r of s.returns ?? []) if (r.frameId) results.set(r.frameId, r.void ? '' : argText('', r.value!, heap));
    last = s;
  }
  if (!last) return null;
  const recursive = new Set<string>();
  for (const call of seen.values()) {
    for (let p = call.parent ? seen.get(call.parent) : undefined; p; p = p.parent ? seen.get(p.parent) : undefined) {
      if (p.method === call.method) { recursive.add(call.method); break; }
    }
  }
  if (!recursive.size) return null;
  // Calls inside a recursive call (including helpers such as merge), rooted at the outermost recursive call.
  const inside = (call: Seen): boolean => { for (let p: Seen | undefined = call; p; p = p.parent ? seen.get(p.parent) : undefined) if (recursive.has(p.method)) return true; return false; };
  let members = [...seen.values()].filter(inside);
  const total = members.length;
  let hidden = 0;
  if (members.length > limit) {
    // Keep the newest calls and everything above them.
    const keep = new Set<string>();
    for (const call of [...members].sort((a, b) => b.step - a.step)) {
      if (keep.size >= limit) break;
      for (let p: Seen | undefined = call; p && !keep.has(p.id) && inside(p); p = p.parent ? seen.get(p.parent) : undefined) keep.add(p.id);
    }
    hidden = members.length - keep.size;
    members = members.filter(m => keep.has(m.id));
  }
  const ids = new Set(members.map(m => m.id));
  const active = new Set(last.frames!.map(f => f.id));
  const children = new Map<string, Seen[]>();
  const roots: Seen[] = [];
  for (const m of members) {
    if (m.parent && ids.has(m.parent)) children.set(m.parent, [...(children.get(m.parent) ?? []), m]);
    else roots.push(m);
  }
  const nodes: CallNode[] = [];
  let column = 0, rows = 0;
  const place = (call: Seen, depth: number): number => {
    const kids = children.get(call.id) ?? [];
    const xs = kids.map(k => place(k, depth + 1));
    const x = xs.length ? (xs[0] + xs.at(-1)!) / 2 : column++;
    const state = call.id === last!.frames![0].id ? 'current' : active.has(call.id) ? 'active' : 'done';
    nodes.push({ id: call.id, label: call.label, method: call.method, parent: call.parent && ids.has(call.parent) ? call.parent : null, x, depth, state, result: results.get(call.id), step: call.step });
    rows = Math.max(rows, depth + 1);
    return x;
  };
  for (const root of roots) place(root, 0);
  return { method: [...recursive][0], nodes, columns: column, rows, hidden, calls: total };
}

// ---------- Grids ----------

export type GridCell = { text: string; full: string; changed: boolean; tone: '' | 'true' | 'visited' | 'queued' | 'wall'; order?: number; marks: string[] };
export type GridView = { key: string; id: string; name: string; type: string; rows: number; cols: number; cells: GridCell[][]; rowMarks: string[][]; colMarks: string[][]; overlay?: string; queue?: string; truncated: boolean };

function cellText(v: TraceValue | undefined, heap: Map<string, HeapObject>): string {
  const text = textOf(v, heap) ?? (v?.kind === 'null' ? 'null' : '·');
  if (text === '2147483647' || text === '9223372036854775807') return '∞';
  if (text === '-2147483648') return '−∞';
  return text;
}

/** Rectangular 2D arrays (int[][], char[][], boolean[][], String[][]) as grids, with index markers from the current line. */
export function gridViews(snapshot: TraceEvent, previous: TraceEvent | undefined, cursors: Map<string, Cursor[]>, skip: Set<string> = new Set()): GridView[] {
  const heap = heapIndex(snapshot), before = heapIndex(previous);
  const objects = namedObjects(namedValues(snapshot, heap), heap);
  const rowsOf = (o: HeapObject): HeapObject[] | null => {
    if (o.kind !== 'array' || !o.elements || o.elements.length < 2 || !o.type.endsWith('[][]')) return null;
    const rows = o.elements.map(e => e.kind === 'reference' ? heap.get(e.ref!) : undefined);
    if (rows.some(r => !r || r.kind !== 'array' || !r.elements?.length)) return null;
    const width = rows[0]!.elements!.length;
    return rows.every(r => r!.elements!.length === width) ? rows as HeapObject[] : null;
  };
  // Edge lists and adjacency structures are drawn as graphs instead.
  const grids = objects.map(({ name, object }) => ({ name, object, rows: rowsOf(object) })).filter(g => g.rows && !skip.has(g.object.id) && !/edge|adj|graph|neighbo/i.test(g.name));
  const isBoolean = (rows: HeapObject[]) => rows[0].elements![0]?.type === 'boolean';
  // A queue or stack of {row, col} pairs marks the cells waiting to be visited, on the largest grid they fit.
  const queue = objects.map(({ name: qName, object: q }) => {
    if (!(q.kind === 'list' || q.kind === 'set') || !q.elements?.length) return null;
    const cells = q.elements.map(e => {
      const p = e.kind === 'reference' ? heap.get(e.ref!) : undefined;
      const nums = p?.kind === 'array' ? p.elements?.map(x => intOf(x, heap)) : p?.kind === 'object' ? p.fields?.map(f => intOf(f.value, heap)).filter(x => x !== undefined) : undefined;
      return nums && nums.length >= 2 && nums[0]! >= 0 && nums[1]! >= 0 ? [nums[0]!, nums[1]!] : null;
    });
    return cells.every(Boolean) ? { name: qName, cells: (q.type === 'java.util.Stack' ? [...cells].reverse() : cells) as number[][] } : null;
  }).find(Boolean);
  const queueGrid = queue ? grids.filter(g => !isBoolean(g.rows!) && queue.cells.every(([y, x]) => y < g.rows!.length && x < g.rows![0].elements!.length))
    .sort((a, b) => b.rows!.length * b.rows![0].elements!.length - a.rows!.length * a.rows![0].elements!.length)[0] : undefined;
  return grids.map(({ name, object, rows }) => {
    const r = rows!.length, c = rows![0].elements!.length;
    const booleanGrid = isBoolean(rows!);
    // Another boolean grid of the same size, such as visited[][], colors this one.
    const overlay = booleanGrid ? undefined : grids.find(g => g.object.id !== object.id && g.rows!.length === r && g.rows![0].elements!.length === c && isBoolean(g.rows!));
    const pairs = queueGrid?.object.id === object.id ? queue! : undefined;
    const order = new Map<string, number>();
    pairs?.cells.forEach(([y, x], i) => { if (!order.has(`${y},${x}`)) order.set(`${y},${x}`, i + 1); });
    const rowMarks: string[][] = Array.from({ length: r }, () => []), colMarks: string[][] = Array.from({ length: c }, () => []);
    for (const k of cursors.get(object.id) ?? []) if (k.index >= 0 && k.index < r) rowMarks[k.index].push(k.label);
    const cells = rows!.map((row, y) => row.elements!.map((v, x) => {
      const old = before.get(row.id)?.elements?.[x];
      const full = cellText(v, heap);
      const marks = (cursors.get(row.id) ?? []).filter(k => k.index === x).map(k => k.label);
      const tone: GridCell['tone'] = booleanGrid ? (isTrue(v) ? 'true' : '') : overlay && isTrue(overlay.rows![y].elements![x]) ? 'visited' : order.has(`${y},${x}`) ? 'queued' : full === '#' || (v.type === 'char' && full === '█') ? 'wall' : '';
      return { text: booleanGrid ? (isTrue(v) ? '✓' : '') : full.length > 4 ? `${full.slice(0, 3)}…` : full, full, changed: !!old && JSON.stringify(old) !== JSON.stringify(v), tone: order.has(`${y},${x}`) && tone !== 'wall' ? 'queued' : tone, order: order.get(`${y},${x}`), marks };
    }));
    for (const row of rows!) for (const k of cursors.get(row.id) ?? []) if (k.index >= 0 && k.index < c && !colMarks[k.index].includes(k.label)) colMarks[k.index].push(k.label);
    return { key: `grid:${object.id}`, id: object.id, name, type: object.type, rows: r, cols: c, cells, rowMarks, colMarks, overlay: overlay?.name, queue: pairs?.name, truncated: !!object.truncated || rows!.some(row => row.truncated) };
  });
}

// ---------- Linked lists ----------

export type ChainNode = { id: string; label: string; refs: string[]; changed: boolean; isNew: boolean };
export type ChainView = { key: string; type: string; doubly: boolean; chains: { nodes: ChainNode[]; cycleTo?: string; more: boolean }[] };

/** Objects of a class with one `next`-like field of its own type (and optionally `prev`), drawn as chains of boxes. */
export function chainViews(snapshot: TraceEvent, previous?: TraceEvent): ChainView[] {
  const heap = heapIndex(snapshot), before = heapIndex(previous);
  const byType = new Map<string, HeapObject[]>();
  for (const o of snapshot.heap ?? []) if (o.kind === 'object' && o.fields && !/^java\./.test(o.type)) byType.set(o.type, [...(byType.get(o.type) ?? []), o]);
  const refs = new Map<string, string[]>();
  for (const v of snapshot.frames?.[0]?.locals ?? []) if (v.value.kind === 'reference' && v.name !== 'this') refs.set(v.value.ref!, [...(refs.get(v.value.ref!) ?? []), v.name]);
  for (const s of snapshot.statics ?? []) if (s.value.kind === 'reference') refs.set(s.value.ref!, [...(refs.get(s.value.ref!) ?? []), leaf(s.name)]);
  // Fields of other objects (a LinkedList class's head and tail) name nodes too.
  for (const o of snapshot.heap ?? []) for (const f of o.fields ?? []) if (f.value.kind === 'reference' && heap.get(f.value.ref!)?.type !== o.type && f.type !== o.type) refs.set(f.value.ref!, [...(refs.get(f.value.ref!) ?? []), leaf(f.name)]);
  const views: ChainView[] = [];
  for (const [type, objects] of byType) {
    const self = (objects[0].fields ?? []).filter(f => f.type === type);
    const next = self.find(f => /^(next|link|succ|forward|after|tail|rest)$/i.test(leaf(f.name))) ?? (self.length === 1 ? self[0] : undefined);
    if (!next || self.length > 2 || (self.length === 2 && !self.every(f => LINK_NAMES.test(leaf(f.name))))) continue;
    // A one-node list counts once something points at it; otherwise wait for two nodes.
    if (objects.length < 2 && !objects.some(o => refs.has(o.id))) continue;
    const nextOf = (o: HeapObject) => { const v = o.fields?.find(f => f.name === next.name)?.value; return v?.kind === 'reference' ? v.ref! : null; };
    const incoming = new Set(objects.map(nextOf).filter((id): id is string => !!id));
    const starts = [...objects.filter(o => !incoming.has(o.id)), ...objects];
    const placed = new Set<string>();
    const chains: ChainView['chains'] = [];
    for (const start of starts) {
      if (placed.has(start.id)) continue;
      const nodes: ChainNode[] = [];
      let cycleTo: string | undefined, more = false;
      for (let id: string | null = start.id; id;) {
        if (placed.has(id)) { cycleTo = nodes.some(n => n.id === id) ? id : undefined; break; }
        const o = heap.get(id);
        if (!o || o.type !== type) { more = !!o || id !== null; break; }
        placed.add(id);
        const old = before.get(id);
        nodes.push({ id, label: nodeLabel(o, heap), refs: refs.get(id) ?? [], isNew: !!previous && !old, changed: !!old && JSON.stringify(old.fields) !== JSON.stringify(o.fields) });
        if (nodes.length >= 64) { more = !!nextOf(o); break; }
        id = nextOf(o);
      }
      if (nodes.length) chains.push({ nodes, cycleTo, more });
    }
    views.push({ key: `chain:${type}`, type: simple(type), doubly: self.length === 2, chains });
  }
  return views;
}
