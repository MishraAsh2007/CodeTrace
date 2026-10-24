import { readFileSync } from "node:fs";

// Replicate the heapLayout BFS logic to verify tree-shaped positions.
const state = JSON.parse(readFileSync(new URL("./state.json", import.meta.url), "utf8"));

const heap = {};
for (const [k, v] of Object.entries(state.heap)) heap[k] = v;

const isRef = (val) => val && val.kind === "ref";
function childIdsOf(obj) {
  const ids = [];
  if (obj.kind === "array") {
    for (const el of obj.elements)
      if (isRef(el) && el.target && el.target.kind === "heap") ids.push(el.target.id);
  } else if (obj.kind === "struct") {
    for (const f of obj.fields)
      if (isRef(f.value) && f.value.target && f.value.target.kind === "heap")
        ids.push(f.value.target.id);
  }
  return ids;
}
function rootIds(st) {
  const roots = [], seen = new Set();
  for (const frame of st.stack)
    for (const v of frame.variables)
      if (isRef(v.value) && v.value.target && v.value.target.kind === "heap") {
        const id = v.value.target.id;
        if (!seen.has(id)) { seen.add(id); roots.push(id); }
      }
  return roots;
}

const COL_GAP = 190, ROW_GAP = 130, PAD = 16;
const depth = new Map(), queue = [];
const enqueueRoot = (id) => { if (!depth.has(id) && heap[id]) { depth.set(id, 0); queue.push(id); } };
rootIds(state).forEach(enqueueRoot);
for (const id of Object.keys(heap)) enqueueRoot(id);
const byDepth = new Map();
let head = 0;
while (head < queue.length) {
  const id = queue[head++], d = depth.get(id) ?? 0;
  if (!byDepth.has(d)) byDepth.set(d, []);
  byDepth.get(d).push(id);
  for (const c of childIdsOf(heap[id]))
    if (!depth.has(c) && heap[c]) { depth.set(c, d + 1); queue.push(c); }
}

const nodeVal = (id) => {
  const o = heap[id];
  if (o.kind === "struct") {
    const f = o.fields.find((f) => f.name === "value");
    return `${id}(${f ? f.value.display : "?"})`;
  }
  return `${id}[array]`;
};
console.log("roots:", rootIds(state).map(nodeVal).join(", "));
const positions = new Map();
for (const [d, col] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`depth ${d} (x=${PAD + d * COL_GAP}): nodes ${col.map(nodeVal).join(", ")}`);
  col.forEach((id, i) => positions.set(id, { x: PAD + d * COL_GAP, y: PAD + i * ROW_GAP }));
}
const seen = new Set(); let collision = false;
for (const [id, p] of positions) {
  const key = `${p.x},${p.y}`;
  if (seen.has(key)) { collision = true; console.log("COLLISION at", key, "node", nodeVal(id)); }
  seen.add(key);
}
console.log("all", Object.keys(heap).length, "nodes placed:", positions.size === Object.keys(heap).length);
console.log("collisions:", collision ? "YES (bug)" : "none");
