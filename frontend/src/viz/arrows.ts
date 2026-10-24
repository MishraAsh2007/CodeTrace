// arrows.ts: the pointer arrows in the memory diagram.
//
// Each arrow runs from a pointer dot to the card it points at, and never behind a card it isn't
// connected to:
//   1. If a straight line or a smooth curve from the dot's card to the target is clear of every other
//      card, that is drawn (the common case: a node pointing at its neighbour).
//   2. Otherwise the arrow is routed on a small grid around all the cards (A*). Each bend costs extra so
//      routes stay simple, hugging a card costs extra so lines run down the middle of the gaps, and
//      sharing a lane with an arrow headed somewhere else costs extra so parallel arrows stay apart.
// Corners are rounded, every arrow keeps its glow, and hovering a dot highlights its arrow and target.
//
// Colours: every heap object gets a colour from its id (stable across steps). The arrows into an object,
// the pointer dots that point at it, and its "#id" label all use that colour, so you can match a dot to
// its arrow to its object at a glance, and two variables with the same colour are aliases.

/** Distinct on the dark background, warm and cool alternating so consecutive objects contrast. */
export const ARROW_COLORS = ["#7c8cff", "#fb923c", "#34d399", "#f472b6", "#38bdf8", "#facc15", "#c084fc", "#a3e635"];

/** The colour for heap object `id` (pg_logger ids are small increasing integers). */
export function colorFor(id: string): string {
  let n = Number(id);
  if (!Number.isInteger(n)) n = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  return ARROW_COLORS[Math.abs(n) % ARROW_COLORS.length];
}

interface Pt {
  x: number;
  y: number;
}
interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Directions of travel: east, south, west, north. */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const isHorizontal = (d: Dir) => d === 0 || d === 2;
const reverse = (d: Dir) => ((d + 2) % 4) as Dir;

const CELL = 6; // routing grid, px
const PAD = 6; // clearance kept around every card
const TAG_PAD = 3; // clearance around the spotlight name tags above a card
const TURN = 6; // cost of one bend, in cells
const NEAR = 0.7; // cost of a cell right next to a card
const TITLE = 3; // cost of a cell over a column title
const SHARED = 2.5; // cost of a cell another arrow (to a different card) already uses
const HALO = 1; // cost of a cell right beside another arrow's lane, so parallel lanes keep a gap
const PORT_BUSY = 40; // cost of leaving/entering a card where another arrow already starts or ends
const RADIUS = 8; // corner rounding, px
const HEAD_LEN = 10; // arrowhead length, px
const HEAD_HALF = 4.6; // arrowhead half-width, px
const MAX_EXPANSIONS = 80_000; // safety net for huge diagrams; falls back to a plain curve

interface Card {
  el: HTMLElement;
  box: Box;
  tags: Box | null;
  /** Heights where this card's own arrows leave through its right / left edge. */
  exitsRight: number[];
  exitsLeft: number[];
}

/** Arrows ending on a side keep at least this far from an arrow leaving through that side. */
const EXIT_GAP = 12;

interface Arrow {
  dot: HTMLElement;
  from: number; // index into cards
  to: number;
  at: Pt; // centre of the dot
  seq: boolean; // dot sits in a list/tuple cell: leave from the bottom, not the side
  cls: "" | "hot" | "dim";
  color: string;
}

/** A drawn arrow: its SVG path, plus where and which way it ends (for the arrowhead). */
interface Shape {
  d: string;
  tip: Pt;
  dir: Dir;
}

interface Port {
  cell: number;
  dir: Dir; // direction of travel through the port
  at: Pt; // exact point on the card edge
  bias: number; // extra cost, so the natural side wins ties
}

// ---------------------------------------------------------------------------
// Measuring (offset-based, so the spotlight's scale-in animation doesn't skew the routes)
// ---------------------------------------------------------------------------

function boxOf(el: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent && parent !== root) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
    node = parent;
  }
  return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
}

const grow = (b: Box, p: number): Box => ({ l: b.l - p, t: b.t - p, r: b.r + p, b: b.b + p });
const inside = (p: Pt, b: Box) => p.x >= b.l && p.x <= b.r && p.y >= b.t && p.y <= b.b;
const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const fmt = (n: number) => String(Math.round(n * 10) / 10);

// ---------------------------------------------------------------------------
// Grid router
// ---------------------------------------------------------------------------

class Grid {
  readonly cols: number;
  readonly rows: number;
  /** Extra cost of entering each cell; Infinity = inside a card. */
  readonly cost: Float32Array;
  /** 0 = free, otherwise (target number + 1) of the arrow using it, or -1 if several. */
  readonly used: Int32Array;
  /** Same encoding, for the cells right beside a lane. */
  readonly halo: Int32Array;
  private g: Float64Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private search = 0;

  constructor(width: number, height: number) {
    this.cols = Math.max(1, Math.ceil(width / CELL));
    this.rows = Math.max(1, Math.ceil(height / CELL));
    const n = this.cols * this.rows;
    this.cost = new Float32Array(n);
    this.used = new Int32Array(n);
    this.halo = new Int32Array(n);
    this.g = new Float64Array(n * 4);
    this.parent = new Int32Array(n * 4);
    this.stamp = new Uint32Array(n * 4);
  }

  col = (x: number) => Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
  row = (y: number) => Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
  index = (c: number, r: number) => (c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c);
  center = (i: number): Pt => ({ x: ((i % this.cols) + 0.5) * CELL, y: (Math.floor(i / this.cols) + 0.5) * CELL });

  /** Column/row ranges whose cell centres fall inside the box. */
  private span(b: Box) {
    return {
      c0: Math.max(0, Math.ceil(b.l / CELL - 0.5)),
      c1: Math.min(this.cols - 1, Math.floor(b.r / CELL - 0.5)),
      r0: Math.max(0, Math.ceil(b.t / CELL - 0.5)),
      r1: Math.min(this.rows - 1, Math.floor(b.b / CELL - 0.5)),
    };
  }

  fill(b: Box, value: number) {
    const { c0, c1, r0, r1 } = this.span(b);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (value === Infinity || this.cost[i] !== Infinity) this.cost[i] = Math.max(this.cost[i], value);
      }
  }

  /** Cells right next to a card cost a little more, so routes keep to the middle of the gaps. */
  markNear() {
    const { cols, rows, cost } = this;
    const near = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (cost[i] !== Infinity) continue;
        if (c > 0) near[i - 1] = 1;
        if (c < cols - 1) near[i + 1] = 1;
        if (r > 0) near[i - cols] = 1;
        if (r < rows - 1) near[i + cols] = 1;
      }
    for (let i = 0; i < near.length; i++) if (near[i] && cost[i] !== Infinity) cost[i] += NEAR;
  }

  /**
   * For a target port: one more cell out from the card, when it's free, so the last straight leg is
   * long enough for the arrowhead to sit on it instead of on the final bend.
   */
  outward(cell: number, dir: Dir): number {
    if (cell < 0) return cell;
    const out = this.index((cell % this.cols) - DX[dir], Math.floor(cell / this.cols) - DY[dir]);
    return out >= 0 && this.cost[out] !== Infinity ? out : cell;
  }

  /** The first free cell just outside `b` on the given side, level with `along`. */
  beside(b: Box, side: Dir, along: number): number {
    const o = grow(b, PAD);
    switch (side) {
      case 0:
        return this.index(Math.floor(o.r / CELL - 0.5) + 1, this.row(along));
      case 2:
        return this.index(Math.ceil(o.l / CELL - 0.5) - 1, this.row(along));
      case 1:
        return this.index(this.col(along), Math.floor(o.b / CELL - 0.5) + 1);
      default:
        return this.index(this.col(along), Math.ceil(o.t / CELL - 0.5) - 1);
    }
  }

  /** Cheapest grid path from any start port to any goal port. Returns cell indices, or null. */
  route(starts: Port[], allGoals: Port[], tid: number): { cells: number[]; start: Port; goal: Port } | null {
    const { cols, cost, used, halo } = this;
    const goals = allGoals.filter((p) => p.cell >= 0 && cost[p.cell] !== Infinity);
    if (!goals.length) return null;
    const stamp = ++this.search;
    const heapKey: number[] = [];
    const heapVal: number[] = [];
    const push = (key: number, val: number) => {
      let i = heapKey.length;
      heapKey.push(key);
      heapVal.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= key) break;
        heapKey[i] = heapKey[p];
        heapVal[i] = heapVal[p];
        i = p;
      }
      heapKey[i] = key;
      heapVal[i] = val;
    };
    const pop = (): [number, number] => {
      const top: [number, number] = [heapKey[0], heapVal[0]];
      const key = heapKey.pop()!;
      const val = heapVal.pop()!;
      const n = heapKey.length;
      if (n) {
        let i = 0;
        for (;;) {
          let m = 2 * i + 1;
          if (m >= n) break;
          if (m + 1 < n && heapKey[m + 1] < heapKey[m]) m++;
          if (heapKey[m] >= key) break;
          heapKey[i] = heapKey[m];
          heapVal[i] = heapVal[m];
          i = m;
        }
        heapKey[i] = key;
        heapVal[i] = val;
      }
      return top;
    };

    const goalCells = goals.map((p) => [p.cell % cols, Math.floor(p.cell / cols)] as const);
    const h = (cell: number) => {
      const c = cell % cols;
      const r = Math.floor(cell / cols);
      let best = Infinity;
      for (const [gc, gr] of goalCells) best = Math.min(best, Math.abs(c - gc) + Math.abs(r - gr));
      return best;
    };
    const setG = (s: number, g: number, parent: number) => {
      this.stamp[s] = stamp;
      this.g[s] = g;
      this.parent[s] = parent;
    };
    const gOf = (s: number) => (this.stamp[s] === stamp ? this.g[s] : Infinity);

    // A port where another arrow already starts or ends would make two arrows meet at one point
    // on the card edge, which reads like one line passing through. Prefer a free side.
    const busy = (cell: number) => {
      const u = used[cell];
      const n = halo[cell];
      return (u !== 0 && u !== tid) || (n !== 0 && n !== tid) ? PORT_BUSY : 0;
    };
    const startOf = new Map<number, Port>();
    for (const p of starts) {
      if (p.cell < 0 || cost[p.cell] === Infinity) continue;
      const s = p.cell * 4 + p.dir;
      const g0 = p.bias + busy(p.cell);
      if (g0 < gOf(s)) {
        setG(s, g0, -1);
        startOf.set(s, p);
        push(g0 + h(p.cell), s);
      }
    }
    const goalCost = goals.map((p) => p.bias + busy(p.cell));
    // Reaching a goal port is a pseudo-state (-1 - goal index) so the cheapest finish wins.
    const finish = goals.map(() => ({ total: Infinity, state: -1 }));

    let expansions = 0;
    while (heapKey.length) {
      const [key, s] = pop();
      if (s < 0) {
        const gi = -1 - s;
        if (key > finish[gi].total) continue;
        const cells: number[] = [];
        let st = finish[gi].state;
        let first = st;
        while (st >= 0) {
          cells.push(st >> 2);
          first = st;
          st = this.parent[st];
        }
        cells.reverse();
        return { cells, start: startOf.get(first)!, goal: goals[gi] };
      }
      const g = gOf(s);
      const cell = s >> 2;
      const dir = (s & 3) as Dir;
      if (key - h(cell) - 1e-3 * h(cell) > g + 1e-6) continue; // stale entry
      if (++expansions > MAX_EXPANSIONS) return null;

      goals.forEach((p, gi) => {
        if (p.cell !== cell || dir === reverse(p.dir)) return;
        const total = g + (dir === p.dir ? 0 : TURN) + goalCost[gi];
        if (total < finish[gi].total) {
          finish[gi] = { total, state: s };
          push(total, -1 - gi);
        }
      });

      const c = cell % cols;
      const r = Math.floor(cell / cols);
      for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
        if (nd === reverse(dir)) continue;
        const next = this.index(c + DX[nd], r + DY[nd]);
        if (next < 0) continue;
        const base = cost[next];
        if (base === Infinity) continue;
        const u = used[next];
        const near = halo[next];
        const step = 1 + base + (nd === dir ? 0 : TURN) + (u !== 0 && u !== tid ? SHARED : 0) + (near !== 0 && near !== tid ? HALO : 0);
        const ns = next * 4 + nd;
        const ng = g + step;
        if (ng < gOf(ns)) {
          setG(ns, ng, s);
          const hn = h(next);
          push(ng + hn + 1e-3 * hn, ns); // slight tie-break toward the goal
        }
      }
    }
    return null;
  }

  /** Remember which cells a drawn arrow covers, so later arrows keep their distance. */
  claim(points: Pt[], tid: number) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2)));
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const y = a.y + ((b.y - a.y) * k) / n;
        const c = Math.floor(x / CELL);
        const r = Math.floor(y / CELL);
        mark(this.used, this.index(c, r), tid);
        for (let d = 0; d < 4; d++) mark(this.halo, this.index(c + DX[d], r + DY[d]), tid);
      }
    }
  }
}

/** Records that arrow `tid` uses cell `i`; -1 once arrows to different cards share it. */
function mark(layer: Int32Array, i: number, tid: number) {
  if (i < 0) return;
  const u = layer[i];
  layer[i] = u === 0 || u === tid ? tid : -1;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

function sourcePorts(grid: Grid, a: Arrow, src: Box): Port[] {
  if (a.seq) {
    return [
      { cell: grid.beside(src, 1, a.at.x), dir: 1, at: { x: a.at.x, y: src.b }, bias: 0 },
      // Leaving through the top crosses the card's own header, so it's a last resort.
      { cell: grid.beside(src, 3, a.at.x), dir: 3, at: { x: a.at.x, y: src.t }, bias: 14 },
    ];
  }
  return [
    { cell: grid.beside(src, 0, a.at.y), dir: 0, at: { x: src.r, y: a.at.y }, bias: 0 },
    { cell: grid.beside(src, 2, a.at.y), dir: 2, at: { x: src.l, y: a.at.y }, bias: 2 },
  ];
}

/** The height closest to `y` within [lo, hi] that keeps EXIT_GAP from every height in `avoid`. */
function freeY(y: number, lo: number, hi: number, avoid: number[]): number {
  const ok = (v: number) => v >= lo - 0.01 && v <= hi + 0.01 && avoid.every((a) => Math.abs(a - v) >= EXIT_GAP);
  if (ok(y)) return y;
  const options = [lo, hi, ...avoid.flatMap((a) => [a - EXIT_GAP, a + EXIT_GAP])].filter(ok);
  return options.length ? options.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best)) : y;
}

/** Where an arrow may end on the target card, level with the source when possible (straight lines). */
function targetPorts(grid: Grid | null, from: Pt, card: Card): Port[] {
  const t = card.box;
  const y = clamp(from.y, t.t + 14, t.b - 12);
  // Don't end an arrow right where one of this card's own arrows leaves; they'd look like one line.
  const yLeft = freeY(y, t.t + 14, t.b - 12, card.exitsLeft);
  const yRight = freeY(y, t.t + 14, t.b - 12, card.exitsRight);
  let topX = clamp(from.x, t.l + 16, t.r - 16);
  if (card.tags) topX = Math.max(topX, card.tags.r + 8);
  // Bottom entries start from the middle, so an arrow in from the top and one in from the bottom
  // never line up and look like a single line running through the card.
  const botX = clamp(from.x, (t.l + t.r) / 2, t.r - 16);
  // `side` is where the port is on the card; travel through it is the opposite way.
  const cell = (side: Dir, along: number) => (grid ? grid.outward(grid.beside(t, side, along), reverse(side)) : -1);
  const ports: Port[] = [
    { cell: cell(2, yLeft), dir: 0, at: { x: t.l - 1, y: yLeft }, bias: 0 },
    { cell: cell(0, yRight), dir: 2, at: { x: t.r + 1, y: yRight }, bias: 2 },
    { cell: cell(1, botX), dir: 3, at: { x: botX, y: t.b + 1 }, bias: 2 },
  ];
  if (topX <= t.r - 10) ports.splice(1, 0, { cell: cell(3, topX), dir: 1, at: { x: topX, y: t.t - 1 }, bias: 1 });
  return ports;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A smooth curve (or a straight line) from the card edge to the target, if it is clear of other cards. */
function tryCurve(a: Arrow, cards: Card[]): (Shape & { points: Pt[] }) | null {
  const src = cards[a.from].box;
  const tgt = cards[a.to];
  if (a.from === a.to) return null;
  const ports = targetPorts(null, a.at, tgt);
  const left = ports.find((p) => p.dir === 0)!;
  const right = ports.find((p) => p.dir === 2)!;
  const top = ports.find((p) => p.dir === 1);
  const t = tgt.box;
  const tries: { from: Pt; out: Dir; to: Port }[] = [];
  if (a.seq) {
    const from = { x: a.at.x, y: src.b + 1 };
    if (top && top.at.y >= src.b + 14) tries.push({ from, out: 1, to: top });
    if (left.at.y >= src.b + 10 && t.l >= a.at.x + 14) tries.push({ from, out: 1, to: left });
  } else {
    if (t.l >= src.r + 14) tries.push({ from: { x: src.r + 1, y: a.at.y }, out: 0, to: left });
    if (t.r <= src.l - 14) tries.push({ from: { x: src.l - 1, y: a.at.y }, out: 2, to: right });
  }

  const blockers = cards.flatMap((c, i) => [
    ...(i === a.from || i === a.to ? [] : [grow(c.box, PAD - 1)]),
    ...(c.tags ? [grow(c.tags, TAG_PAD - 1)] : []),
  ]);
  for (const { from, out, to } of tries) {
    const p0 = from;
    const p3 = to.at;
    const span = isHorizontal(out) ? Math.abs(p3.x - p0.x) : Math.abs(p3.y - p0.y);
    let pts: Pt[];
    let d: string;
    const aligned = isHorizontal(out) === isHorizontal(to.dir) && (isHorizontal(out) ? Math.abs(p3.y - p0.y) : Math.abs(p3.x - p0.x)) < 1.5;
    if (aligned) {
      pts = [p0, p3];
      d = `M${fmt(a.at.x)},${fmt(a.at.y)} L${fmt(p3.x)},${fmt(p3.y)}`;
    } else {
      const k1 = Math.min(Math.max(18, span * 0.5), 140);
      const endSpan = isHorizontal(to.dir) ? Math.abs(p3.x - p0.x) : Math.abs(p3.y - p0.y);
      const k2 = Math.min(Math.max(18, endSpan * 0.5), 140, Math.max(12, endSpan * 0.9));
      const p1 = { x: p0.x + DX[out] * k1, y: p0.y + DY[out] * k1 };
      const p2 = { x: p3.x - DX[to.dir] * k2, y: p3.y - DY[to.dir] * k2 };
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const n = Math.max(12, Math.ceil(len / 4));
      pts = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const u = 1 - s;
        pts.push({
          x: u * u * u * p0.x + 3 * u * u * s * p1.x + 3 * u * s * s * p2.x + s * s * s * p3.x,
          y: u * u * u * p0.y + 3 * u * u * s * p1.y + 3 * u * s * s * p2.y + s * s * s * p3.y,
        });
      }
      d = `M${fmt(a.at.x)},${fmt(a.at.y)} L${fmt(p0.x)},${fmt(p0.y)} C${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p3.x)},${fmt(p3.y)}`;
    }
    const sample = aligned ? lineSamples(p0, p3) : pts;
    if (sample.every((p) => !blockers.some((b) => inside(p, b)))) return { d, points: pts, tip: p3, dir: to.dir };
  }
  return null;
}

function lineSamples(a: Pt, b: Pt): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Turns a grid route into corner points that start at the dot and end exactly on the target edge. */
function cornerPoints(grid: Grid, a: Arrow, cells: number[], start: Port, goal: Port): Pt[] {
  // Corners of the grid path (cell centres where the direction changes).
  const centres = cells.map(grid.center);
  const corners: Pt[] = [centres[0]];
  for (let i = 1; i < centres.length - 1; i++) {
    const p = centres[i - 1];
    const q = centres[i];
    const r = centres[i + 1];
    if ((p.x === q.x) !== (q.x === r.x)) corners.push(q);
  }
  if (centres.length > 1) corners.push(centres[centres.length - 1]);

  const dirOf = (p: Pt, q: Pt): Dir => (Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? (q.x >= p.x ? 0 : 2) : q.y >= p.y ? 1 : 3);
  const pts: Pt[] = [{ ...a.at }];
  corners.forEach((c, i) => {
    // The first/last grid point is a corner only if the route turns there.
    if (i === 0 && (corners.length === 1 ? start.dir === goal.dir : dirOf(c, corners[1]) === start.dir)) return;
    if (i === corners.length - 1 && i > 0 && dirOf(corners[i - 1], c) === goal.dir) return;
    pts.push({ ...c });
  });
  pts.push({ ...goal.at });

  // Snap the first and last legs onto the exact dot / target coordinates.
  const n = pts.length;
  if (n > 2) {
    if (isHorizontal(start.dir)) pts[1].y = pts[0].y;
    else pts[1].x = pts[0].x;
    if (isHorizontal(goal.dir)) pts[n - 2].y = pts[n - 1].y;
    else pts[n - 2].x = pts[n - 1].x;
  } else {
    // One straight leg that is a few px off: add a gentle S-bend halfway along it.
    const [p, q] = pts;
    if (isHorizontal(start.dir) && Math.abs(p.y - q.y) > 0.5) {
      const mx = (start.at.x + q.x) / 2;
      pts.splice(1, 0, { x: mx, y: p.y }, { x: mx, y: q.y });
    } else if (!isHorizontal(start.dir) && Math.abs(p.x - q.x) > 0.5) {
      const my = (start.at.y + q.y) / 2;
      pts.splice(1, 0, { x: p.x, y: my }, { x: q.x, y: my });
    }
  }
  return tidy(pts);
}

/** Drops repeated and collinear points left over from snapping. */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last;
      const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5);
      if (collinear) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** An orthogonal polyline with rounded corners. */
function roundedPath(pts: Pt[]): string {
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const lin = Math.hypot(b.x - a.x, b.y - a.y);
    const lout = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(RADIUS, lin / 2, lout / 2);
    if (r < 0.5) {
      d += ` L${fmt(b.x)},${fmt(b.y)}`;
      continue;
    }
    const p1 = { x: b.x + ((a.x - b.x) / lin) * r, y: b.y + ((a.y - b.y) / lin) * r };
    const p2 = { x: b.x + ((c.x - b.x) / lout) * r, y: b.y + ((c.y - b.y) / lout) * r };
    d += ` L${fmt(p1.x)},${fmt(p1.y)} Q${fmt(b.x)},${fmt(b.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  const end = pts[pts.length - 1];
  return d + ` L${fmt(end.x)},${fmt(end.y)}`;
}

/** Last resort (no route found): the old direct curve. */
function directCurve(a: Arrow, t: Box): Shape {
  const { x: x1, y: y1 } = a.at;
  if (t.l > x1 + 8) {
    const x2 = t.l - 1;
    const y2 = t.t + 16;
    const dx = Math.max(28, (x2 - x1) * 0.5);
    return { d: `M${fmt(x1)},${fmt(y1)} C${fmt(x1 + dx)},${fmt(y1)} ${fmt(x2 - dx)},${fmt(y2)} ${fmt(x2)},${fmt(y2)}`, tip: { x: x2, y: y2 }, dir: 0 };
  }
  const x2 = t.l + 22;
  const y2 = t.t - 1;
  const lift = Math.min(y1, y2) - 40;
  return { d: `M${fmt(x1)},${fmt(y1)} C${fmt(x1 + 50)},${fmt(lift)} ${fmt(x2)},${fmt(lift)} ${fmt(x2)},${fmt(y2)}`, tip: { x: x2, y: y2 }, dir: 1 };
}

/** A filled arrowhead with its point at `tip`, facing the direction of travel. */
function headPath(tip: Pt, dir: Dir): string {
  const dx = DX[dir];
  const dy = DY[dir];
  const bx = tip.x - dx * HEAD_LEN;
  const by = tip.y - dy * HEAD_LEN;
  const px = -dy * HEAD_HALF; // perpendicular
  const py = dx * HEAD_HALF;
  const nx = bx + dx * 2.4; // small notch in the back, so it reads as an arrowhead, not a triangle
  const ny = by + dy * 2.4;
  return `M${fmt(tip.x)},${fmt(tip.y)} L${fmt(bx + px)},${fmt(by + py)} L${fmt(nx)},${fmt(ny)} L${fmt(bx - px)},${fmt(by - py)} Z`;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const lastDrawn = new WeakMap<SVGSVGElement, string>();

/** Measures the cards and pointer dots in `canvas` and draws every arrow into `svg`. */
export function drawArrows(canvas: HTMLElement, svg: SVGSVGElement) {
  const spotlight = canvas.classList.contains("spotlight");
  const cardEls = [...canvas.querySelectorAll<HTMLElement>(".card")];
  const cardIndex = new Map<Element, number>();
  const cards: Card[] = cardEls.map((el, i) => {
    cardIndex.set(el, i);
    const tagsEl = el.querySelector<HTMLElement>(":scope > .tags");
    return { el, box: boxOf(el, canvas), tags: tagsEl && tagsEl.childElementCount ? boxOf(tagsEl, canvas) : null, exitsRight: [], exitsLeft: [] };
  });
  const byId = new Map<string, number>();
  cards.forEach((c, i) => {
    if (c.el.classList.contains("obj") && c.el.dataset.id !== undefined) byId.set(c.el.dataset.id, i);
  });

  const arrows: Arrow[] = [];
  canvas.querySelectorAll<HTMLElement>(".ptr[data-ref]").forEach((dot) => {
    const to = byId.get(dot.dataset.ref!);
    const srcEl = dot.closest(".card");
    const from = srcEl ? cardIndex.get(srcEl) : undefined;
    delete dot.dataset.arrow;
    if (to === undefined || from === undefined) return;
    const b = boxOf(dot, canvas);
    const cls = spotlight ? (dot.closest(".frame.is-current, .obj.spot") ? "hot" : "dim") : "";
    const color = colorFor(dot.dataset.ref!);
    arrows.push({ dot, from, to, at: { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 }, seq: !!dot.closest(".seq"), cls, color });
  });
  arrows.forEach((a, i) => (a.dot.dataset.arrow = String(i)));
  // Which edge each arrow will most likely leave through: back-pointers (target to the left) leave
  // left, list cells leave from the bottom, everything else leaves right.
  for (const a of arrows) {
    if (a.seq) continue;
    const src = cards[a.from];
    if (a.from !== a.to && cards[a.to].box.r <= src.box.l - 14) src.exitsLeft.push(a.at.y);
    else src.exitsRight.push(a.at.y);
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const signature = JSON.stringify([
    width,
    height,
    cards.map((c) => [c.box, c.tags]),
    arrows.map((a) => [a.from, a.to, Math.round(a.at.x), Math.round(a.at.y), a.seq, a.cls, a.color]),
  ]);
  if (lastDrawn.get(svg) === signature) return;
  lastDrawn.set(svg, signature);
  clearFocus(canvas, svg);

  const shapes: Shape[] = new Array(arrows.length);
  let grid: Grid | null = null;
  const tidOf = (a: Arrow) => a.to + 1;

  // Pass 1: arrows that can be a clear straight line or curve.
  const routed: number[] = [];
  const claims: { points: Pt[]; tid: number }[] = [];
  arrows.forEach((a, i) => {
    const curve = tryCurve(a, cards);
    if (curve) {
      shapes[i] = curve;
      claims.push({ points: curve.points, tid: tidOf(a) });
    } else routed.push(i);
  });

  // Pass 2: route the rest around the cards, shortest first so they get the direct lanes.
  if (routed.length) {
    grid = new Grid(width, height);
    for (const c of cards) {
      grid.fill(grow(c.box, PAD), Infinity);
      if (c.tags) grid.fill(grow(c.tags, TAG_PAD), Infinity);
    }
    canvas.querySelectorAll<HTMLElement>(".viz-col-title").forEach((el) => grid!.fill(boxOf(el, canvas), TITLE));
    grid.markNear();
    for (const c of claims) grid.claim(c.points, c.tid);

    const dist = (a: Arrow) => {
      const t = cards[a.to].box;
      return Math.abs(t.l - a.at.x) + Math.abs(t.t - a.at.y);
    };
    routed.sort((i, j) => dist(arrows[i]) - dist(arrows[j]));
    for (const i of routed) {
      const a = arrows[i];
      let starts = sourcePorts(grid, a, cards[a.from].box);
      let goals = targetPorts(grid, a.at, cards[a.to]);
      if (a.from === a.to) {
        // A node pointing at itself: one clean loop out the side and back in over the top.
        starts = starts.slice(0, 1);
        goals = goals.filter((p) => p.dir === 1 || p.dir === 0);
      }
      const found = grid.route(starts, goals, tidOf(a));
      if (!found) {
        shapes[i] = directCurve(a, cards[a.to].box);
        continue;
      }
      const pts = cornerPoints(grid, a, found.cells, found.start, found.goal);
      shapes[i] = { d: roundedPath(pts), tip: found.goal.at, dir: found.goal.dir };
      grid.claim(pts.slice(1), tidOf(a));
    }
  }

  // Lines first (dim ones underneath, highlighted ones on top), then every arrowhead in a layer above
  // all the lines, so a crossing line can never hide where an arrow ends.
  const order = arrows.map((_, i) => i).sort((i, j) => rank(arrows[i].cls) - rank(arrows[j].cls));
  const group = (kind: string, i: number, body: string) => {
    const a = arrows[i];
    return `<g class="${kind}${a.cls ? " " + a.cls : ""}" data-i="${i}" style="--c:${a.color}">${body}</g>`;
  };
  const lines = order.map((i) => group("arrow", i, `<path class="casing" d="${shapes[i].d}"/><path class="line" d="${shapes[i].d}"/>`));
  const heads = order.map((i) => group("arrow-head", i, `<path class="head" d="${headPath(shapes[i].tip, shapes[i].dir)}"/>`));
  svg.innerHTML = `<g class="lines">${lines.join("")}</g><g class="heads">${heads.join("")}</g>`;
}

const rank = (cls: Arrow["cls"]) => (cls === "dim" ? 0 : cls === "hot" ? 2 : 1);

function clearFocus(canvas: HTMLElement, svg: SVGSVGElement) {
  svg.classList.remove("has-focus");
  svg.querySelectorAll(".focus").forEach((g) => g.classList.remove("focus"));
  canvas.querySelectorAll(".arrow-target, .ptr.is-focus").forEach((el) => el.classList.remove("arrow-target", "is-focus"));
}

/** Highlights the arrow that starts at `dot` (and the card it points at); null clears the highlight. */
export function focusArrow(canvas: HTMLElement, svg: SVGSVGElement, dot: HTMLElement | null) {
  clearFocus(canvas, svg);
  const i = dot?.dataset.arrow;
  if (!dot || i === undefined) return;
  const parts = svg.querySelectorAll<SVGGElement>(`g[data-i="${i}"]`);
  if (!parts.length) return;
  parts.forEach((g) => {
    g.classList.add("focus");
    g.parentNode?.appendChild(g); // draw it above the others in its layer
  });
  svg.classList.add("has-focus");
  dot.classList.add("is-focus");
  canvas.querySelector(`.obj[data-id="${CSS.escape(dot.dataset.ref ?? "")}"]`)?.classList.add("arrow-target");
}
