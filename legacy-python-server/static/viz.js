// viz.js: renders one pg_logger step as a memory diagram.
//
// Layout: stack frames on the left, heap objects in a grid on the right.
// Heap objects are placed by a depth-first walk from the variables, so a
// linked list lays out as one horizontal row and a tree fans out sideways.
// Pointers are SVG curves drawn after the DOM is laid out.

const MAX_OBJECTS = 160;
const MAX_SEQ_ITEMS = 30;

// ---------- encoding helpers ----------

const isRef = (v) => Array.isArray(v) && v[0] === "REF";
const INLINE_KINDS = new Set(["FUNCTION", "CLASS", "module"]);

function heapObj(heap, ref) {
  return heap[String(ref[1])];
}

function isInline(obj) {
  return !obj || INLINE_KINDS.has(obj[0]);
}

export function objLabel(obj) {
  if (!obj) return "object";
  switch (obj[0]) {
    case "INSTANCE":
    case "INSTANCE_PPRINT": return obj[1];
    case "LIST": return "list";
    case "TUPLE": return "tuple";
    case "SET": return "set";
    case "DICT": return "dict";
    default: return String(obj[0]).toLowerCase();
  }
}

function instanceAttrs(obj) {
  return obj[0] === "INSTANCE" ? obj.slice(2) : obj.slice(3);
}

function childRefs(obj) {
  const out = [];
  const add = (v) => { if (isRef(v)) out.push(String(v[1])); };
  switch (obj[0]) {
    case "INSTANCE":
    case "INSTANCE_PPRINT":
      for (const [, v] of orderAttrs(instanceAttrs(obj))) add(v);
      break;
    case "LIST": case "TUPLE": case "SET":
      obj.slice(1, MAX_SEQ_ITEMS + 1).forEach(add);
      break;
    case "DICT":
      for (const [k, v] of obj.slice(1, MAX_SEQ_ITEMS + 1)) { add(k); add(v); }
      break;
  }
  return out;
}

// Show data fields (val, key, ...) before pointer fields (next, left, right).
function orderAttrs(attrs) {
  const isLink = ([, v]) => v === null || isRef(v);
  return [...attrs.filter((a) => !isLink(a)), ...attrs.filter(isLink)];
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pyStr(s) {
  const body = s.length > 40 ? s.slice(0, 37) + "…" : s;
  return "'" + body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
}

export function primitiveText(v) {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v) && v[0] === "SPECIAL_FLOAT") return v[1];
  return String(v);
}

function valueHTML(v, heap) {
  if (v === null) return '<span class="v-none">None</span>';
  if (typeof v === "boolean") return `<span class="v-bool">${v ? "True" : "False"}</span>`;
  if (typeof v === "number") return `<span class="v-num">${v}</span>`;
  if (typeof v === "string") return `<span class="v-str">${esc(pyStr(v))}</span>`;
  if (Array.isArray(v)) {
    if (v[0] === "REF") {
      const obj = heapObj(heap, v);
      if (!obj) return '<span class="v-func">?</span>';
      if (obj[0] === "FUNCTION") return `<span class="v-func" title="function ${esc(obj[1])}">ƒ ${esc(obj[1])}</span>`;
      if (obj[0] === "CLASS") return `<span class="v-func">class ${esc(obj[1])}</span>`;
      if (obj[0] === "module") return `<span class="v-func">module ${esc(obj[1])}</span>`;
      return `<span class="ptr" data-ref="${esc(v[1])}" title="${esc(objLabel(obj))} #${esc(v[1])}"></span>`;
    }
    if (v[0] === "SPECIAL_FLOAT") return `<span class="v-num">${esc(v[1])}</span>`;
    if (v[0] === "IMPORTED_FAUX_PRIMITIVE") return `<span class="v-func">${esc(v[1])}</span>`;
  }
  return esc(JSON.stringify(v));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- frames ----------

function buildFrames(step, prevStep) {
  const stack = (step.stack_to_render || []).filter((f) => !f.is_zombie);
  const prevStack = prevStep ? (prevStep.stack_to_render || []) : [];
  const frames = [{
    key: "global",
    title: "Global frame",
    names: step.ordered_globals || [],
    values: step.globals || {},
    prev: prevStep ? prevStep.globals || {} : null,
    isCurrent: !stack.some((f) => f.is_highlighted),
  }];
  for (const f of stack) {
    const before = prevStack.find((p) => p.frame_id === f.frame_id);
    frames.push({
      key: String(f.frame_id),
      title: `${f.func_name}()`,
      names: f.ordered_varnames || [],
      values: f.encoded_locals || {},
      prev: before ? before.encoded_locals || {} : null,
      isCurrent: !!f.is_highlighted,
    });
  }
  return frames;
}

function frameHTML(frame, heap) {
  const rows = frame.names
    .filter((n) => n in frame.values)
    .map((n) => {
      const v = frame.values[n];
      const changed = frame.prev && !same(frame.prev[n], v) ? " changed" : "";
      const label = n === "__return__" ? "return" : n;
      return `<tr class="${changed}" data-var="${esc(n)}"><td class="name">${esc(label)}</td><td class="val">${valueHTML(v, heap)}</td></tr>`;
    });
  const body = rows.length
    ? `<table class="vars">${rows.join("")}</table>`
    : '<div class="card-body-text">no variables yet</div>';
  return `<div class="card frame${frame.isCurrent ? " is-current" : ""}" data-frame="${esc(frame.key)}">
    <div class="card-head">${esc(frame.title)}</div>${body}</div>`;
}

// ---------- heap ----------

function layoutHeap(frames, heap) {
  const pos = new Map();
  const nextFree = [];
  const place = (id, col, minRow) => {
    if (pos.has(id) || pos.size >= MAX_OBJECTS) return;
    const obj = heap[id];
    if (isInline(obj)) return;
    const row = Math.max(nextFree[col] || 0, minRow);
    pos.set(id, { col, row });
    nextFree[col] = row + 1;
    for (const child of childRefs(obj)) place(child, col + 1, row);
  };
  for (const frame of frames) {
    for (const n of frame.names) {
      const v = frame.values[n];
      if (isRef(v)) place(String(v[1]), 0, 0);
    }
  }
  return pos;
}

function objBodyHTML(id, obj, heap, prevObj) {
  const kind = obj[0];
  if (kind === "INSTANCE" || kind === "INSTANCE_PPRINT") {
    const prevAttrs = prevObj ? Object.fromEntries(instanceAttrs(prevObj)) : null;
    const attrs = orderAttrs(instanceAttrs(obj));
    const pprint = kind === "INSTANCE_PPRINT" ? `<div class="card-body-text">${esc(obj[2])}</div>` : "";
    if (!attrs.length) return pprint || '<div class="card-body-text">no attributes</div>';
    const rows = attrs.map(([k, v]) => {
      const changed = prevAttrs && !same(prevAttrs[k], v) ? " changed" : "";
      return `<tr class="${changed}" data-attr="${esc(k)}"><td class="name">${esc(k)}</td><td class="val">${valueHTML(v, heap)}</td></tr>`;
    });
    return pprint + `<table class="vars">${rows.join("")}</table>`;
  }
  if (kind === "LIST" || kind === "TUPLE" || kind === "SET") {
    const items = obj.slice(1);
    if (!items.length) return '<div class="card-body-text">empty</div>';
    const cells = items.slice(0, MAX_SEQ_ITEMS).map((v, i) =>
      `<div class="cell">${kind === "SET" ? "" : `<span class="idx">${i}</span>`}${valueHTML(v, heap)}</div>`);
    if (items.length > MAX_SEQ_ITEMS) cells.push(`<div class="more">+${items.length - MAX_SEQ_ITEMS}</div>`);
    return `<div class="seq">${cells.join("")}</div>`;
  }
  if (kind === "DICT") {
    const pairs = obj.slice(1);
    if (!pairs.length) return '<div class="card-body-text">empty</div>';
    const rows = pairs.slice(0, MAX_SEQ_ITEMS).map(([k, v]) =>
      `<tr><td class="name">${valueHTML(k, heap)}</td><td class="val">${valueHTML(v, heap)}</td></tr>`);
    return `<table class="vars">${rows.join("")}</table>`;
  }
  return `<div class="card-body-text">${esc(obj.slice(1).join(" "))}</div>`;
}

function objHTML(id, obj, at, heap, prevHeap) {
  const prevObj = prevHeap && prevHeap[id] && prevHeap[id][0] === obj[0] ? prevHeap[id] : null;
  const isInstance = obj[0] === "INSTANCE" || obj[0] === "INSTANCE_PPRINT";
  return `<div class="card obj" data-id="${esc(id)}" style="grid-column:${at.col + 1};grid-row:${at.row + 1}">
    <div class="tags"></div>
    <div class="card-head">${esc(objLabel(obj))} <span class="cid">#${esc(id)}</span>${isInstance ? "" : `<span class="kind">${obj.length - 1} item${obj.length === 2 ? "" : "s"}</span>`}</div>
    ${objBodyHTML(id, obj, heap, prevObj)}
  </div>`;
}

// ---------- public API ----------

export function renderMemory(canvas, step, prevStep) {
  const heap = step.heap || {};
  const frames = buildFrames(step, prevStep);
  const layout = layoutHeap(frames, heap);
  const prevHeap = prevStep ? prevStep.heap : null;

  const heapCards = [...layout.entries()].map(([id, at]) => objHTML(id, heap[id], at, heap, prevHeap));
  const hiddenCount = Object.values(heap).filter((o) => !isInline(o)).length - layout.size;

  canvas.innerHTML = `
    <svg class="arrows" aria-hidden="true"></svg>
    <div class="viz-layout">
      <div>
        <p class="viz-col-title">Frames</p>
        <div class="frames">${frames.map((f) => frameHTML(f, heap)).join("")}</div>
      </div>
      <div>
        <p class="viz-col-title">Objects${heapCards.length ? "" : " (none yet)"}</p>
        <div class="heap">${heapCards.join("")}</div>
        ${hiddenCount > 0 ? `<p class="viz-col-title">+${hiddenCount} more objects not shown</p>` : ""}
      </div>
    </div>`;
}

export function drawArrows(canvas) {
  const svg = canvas.querySelector("svg.arrows");
  if (!svg) return;
  const base = canvas.getBoundingClientRect();
  const spotlight = canvas.classList.contains("spotlight");
  const paths = [];

  canvas.querySelectorAll(".ptr[data-ref]").forEach((dot) => {
    const target = canvas.querySelector(`.obj[data-id="${CSS.escape(dot.dataset.ref)}"]`);
    if (!target) return;
    const a = dot.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - base.left;
    const y1 = a.top + a.height / 2 - base.top;
    let d;
    if (b.left - base.left > x1 + 8) {
      const x2 = b.left - base.left - 2;
      const y2 = b.top - base.top + 16;
      const dx = Math.max(28, (x2 - x1) * 0.5);
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    } else {
      // Target is left of (or above) the pointer: a back-edge or cycle. Arc in from above.
      const x2 = b.left - base.left + 22;
      const y2 = b.top - base.top - 2;
      const lift = Math.min(y1, y2) - 40;
      d = `M${x1},${y1} C${x1 + 50},${lift} ${x2},${lift} ${x2},${y2}`;
    }
    let cls = "";
    if (spotlight) {
      cls = dot.closest(".frame.is-current, .obj.spot") ? "hot" : "dim";
      if (cls === "hot") dot.classList.add("hot");
    }
    paths.push(`<path class="${cls}" d="${d}" marker-end="url(#${cls === "hot" ? "ah-hot" : "ah"})"/>`);
  });

  svg.innerHTML = `<defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6474d8"/></marker>
      <marker id="ah-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4fd1c5"/></marker>
    </defs>${paths.join("")}`;
}

// Work out "where you are": the variables in the current frame and what they point at.
export function computeSpotlight(step) {
  const heap = step.heap || {};
  const stack = (step.stack_to_render || []).filter((f) => !f.is_zombie);
  const current = stack.find((f) => f.is_highlighted);
  const names = current ? current.ordered_varnames || [] : step.ordered_globals || [];
  const values = current ? current.encoded_locals || {} : step.globals || {};

  const pointers = [];
  for (const name of names) {
    if (!(name in values) || name === "__return__") continue;
    const v = values[name];
    if (v === null) {
      pointers.push({ name, isNone: true });
      continue;
    }
    if (!isRef(v)) continue;
    const obj = heapObj(heap, v);
    if (isInline(obj)) continue;
    const id = String(v[1]);
    const entry = { name, id, label: `${objLabel(obj)} #${id}`, preview: "", nullAttrs: [] };
    if (obj[0] === "INSTANCE" || obj[0] === "INSTANCE_PPRINT") {
      const attrs = orderAttrs(instanceAttrs(obj));
      entry.preview = attrs.filter(([, val]) => !isRef(val) && val !== null)
        .slice(0, 2).map(([k, val]) => `${k}=${primitiveText(val)}`).join(", ");
      entry.nullAttrs = attrs.filter(([, val]) => val === null).map(([k]) => k);
    } else {
      entry.preview = `${obj.length - 1} item${obj.length === 2 ? "" : "s"}`;
    }
    pointers.push(entry);
  }
  return {
    frameName: current ? `${current.func_name}()` : "global scope",
    pointers,
  };
}

export function applySpotlight(canvas, spot) {
  canvas.classList.add("spotlight");
  for (const p of spot.pointers) {
    if (!p.id) continue;
    const card = canvas.querySelector(`.obj[data-id="${CSS.escape(p.id)}"]`);
    if (!card) continue;
    card.classList.add("spot");
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = p.name;
    card.querySelector(".tags").appendChild(tag);
    for (const attr of p.nullAttrs) {
      const row = card.querySelector(`tr[data-attr="${CSS.escape(attr)}"]`);
      if (row) row.classList.add("is-null-alert");
    }
    // Keep the objects this one points to readable, so you can see where `next` leads.
    card.querySelectorAll(".ptr[data-ref]").forEach((dot) => {
      const near = canvas.querySelector(`.obj[data-id="${CSS.escape(dot.dataset.ref)}"]`);
      if (near) near.classList.add("spot-near");
    });
  }
}

export function clearSpotlight(canvas) {
  canvas.classList.remove("spotlight");
}

export function scrollToSpot(canvas) {
  // Prefer the node with a None pointer (usually the bug), then the last highlighted node.
  const alert = canvas.querySelector(".obj.spot .is-null-alert");
  const spots = canvas.querySelectorAll(".obj.spot");
  const target = (alert && alert.closest(".obj")) || spots[spots.length - 1] || canvas.querySelector(".frame.is-current");
  if (target) target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}
