import { readFileSync } from "node:fs";

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
      if (isRef(f.value) && f.value.target && f.value.target.kind === "heap") ids.push(f.value.target.id);
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

const COL_GAP = 190, ROW_GAP = 130, PAD = 16, BAND_GAP = 60;
function layoutBand(rootId, visited) {
  const depth = new Map(), byDepth = new Map(), queue = [rootId];
  depth.set(rootId, 0); visited.add(rootId);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++], d = depth.get(id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(id);
    for (const c of childIdsOf(heap[id]))
      if (!visited.has(c) && heap[c]) { visited.add(c); depth.set(c, d + 1); queue.push(c); }
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  let maxRows = 0;
  for (const d of depths) maxRows = Math.max(maxRows, byDepth.get(d).length);
  const bandHeight = Math.max(1, maxRows) * ROW_GAP;
  const placed = [];
  for (const d of depths) {
    const col = byDepth.get(d), yStart = (bandHeight - col.length * ROW_GAP) / 2;
    col.forEach((id, i) => placed.push({ id, depth: d, x: d * COL_GAP, y: yStart + i * ROW_GAP }));
  }
  return { nodes: placed, height: bandHeight };
}

const nodes = new Map(), visited = new Set();
const seeds = [...rootIds(state), ...Object.keys(heap)];
let bandY = PAD, bandNum = 0;
for (const seed of seeds) {
  if (visited.has(seed) || !heap[seed]) continue;
  const band = layoutBand(seed, visited);
  const label = heap[seed].kind === "array" ? `${seed}[array]` : `${seed}(tree root)`;
  console.log(`BAND ${bandNum++} from ${label}: yRange ${bandY}..${bandY + band.height}`);
  for (const n of band.nodes) nodes.set(n.id, { x: PAD + n.x, y: bandY + n.y, band: bandNum });
  bandY += band.height + BAND_GAP;
}
console.log("total nodes placed:", nodes.size, "of", Object.keys(heap).length);