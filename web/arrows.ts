const COLORS = ['green', 'blue', 'orange', 'violet'];

/**
 * Draws reference arrows from `.ref[data-ref]` chips to their heap cards inside `root`.
 * `root` must be position: relative and contain an `svg.arrow-layer` overlay.
 * Targets to the right get a direct curve; targets in the same column loop around the right edge.
 */
export function drawArrows(root: HTMLElement, enabled: boolean): void {
  const layer = root.querySelector<SVGSVGElement>(':scope > svg.arrow-layer');
  if (!layer) return;
  layer.replaceChildren();
  if (!enabled) return;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  for (const color of COLORS) {
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', `arrowhead-${color}`);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    const head = document.createElementNS(ns, 'path');
    head.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    head.setAttribute('class', `arrowhead ${color}`);
    marker.append(head);
    defs.append(marker);
  }
  layer.append(defs);
  const box = root.getBoundingClientRect();
  let lane = 0;
  root.querySelectorAll<HTMLElement>('.ref[data-ref]').forEach((source, index) => {
    const ref = source.dataset.ref!;
    const card = root.querySelector<HTMLElement>(`#heap-${CSS.escape(ref)}`);
    const anchor = card?.querySelector<HTMLElement>(':scope > summary');
    if (!card || !anchor || source.classList.contains('omitted') || !source.getClientRects().length || !anchor.getClientRects().length) return;
    if (card.contains(source)) return; // Self-references are labelled in the card instead.
    const s = source.getBoundingClientRect(), t = anchor.getBoundingClientRect();
    const sx = s.right - box.left, sy = s.top + s.height / 2 - box.top;
    const ey = t.top + Math.min(t.height / 2, 15) - box.top;
    let d: string;
    if (t.left - box.left > sx + 14) {
      const ex = t.left - box.left - 1, dx = Math.max(18, (ex - sx) / 2);
      d = `M${sx},${sy} C${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`;
    } else {
      const ex = t.right - box.left + 1, cx = Math.max(sx, ex) + 18 + (lane++ % 4) * 5;
      d = `M${sx},${sy} C${cx},${sy} ${cx},${ey} ${ex},${ey}`;
    }
    const color = COLORS.find(c => source.classList.contains(c)) ?? 'green';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `arrow ${color}${source.closest('.frame.current') ? ' primary' : ''}`);
    path.setAttribute('marker-end', `url(#arrowhead-${color})`);
    path.dataset.ref = ref;
    path.dataset.source = String(index);
    source.dataset.arrow = String(index);
    layer.append(path);
  });
}

/** Emphasizes arrows connected to a hovered reference chip or heap card. */
export function focusArrows(root: HTMLElement, target: Element | null): void {
  const layer = root.querySelector<SVGSVGElement>(':scope > svg.arrow-layer');
  if (!layer) return;
  const chip = target?.closest<HTMLElement>('.ref[data-ref]');
  const card = target?.closest<HTMLElement>('.heap-object');
  const ref = card?.id.replace(/^heap-/, '');
  let any = false;
  layer.querySelectorAll<SVGPathElement>('path.arrow').forEach(path => {
    const active = chip ? path.dataset.source === chip.dataset.arrow : !!ref && path.dataset.ref === ref;
    path.classList.toggle('active', active);
    any ||= active;
  });
  layer.classList.toggle('focusing', any);
}
