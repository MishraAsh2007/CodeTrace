import { useLayoutEffect, useState } from "react";

export interface Connection {
  from: string;
  to: string;
}

export interface ArrowLayerProps {
  /** Container the arrows are drawn over; coordinates are relative to it. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Map of anchor id -> DOM element, populated by the box components. */
  anchors: Map<string, HTMLElement>;
  /** Source -> target connections to draw. */
  connections: Connection[];
  /** Bump this to force a re-measure (e.g. when the step changes). */
  revision: number;
}

type ArrowMode = "horizontal" | "vertical" | "gutter";

interface Segment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mode: ArrowMode;
  /** For gutter arrows: how far left the curve bows (px, container coords). */
  gutterX?: number;
}

function centerRight(r: DOMRect, c: DOMRect) {
  return { x: r.right - c.left, y: r.top - c.top + r.height / 2 };
}
function centerBottom(r: DOMRect, c: DOMRect) {
  return { x: r.left - c.left + r.width / 2, y: r.bottom - c.top };
}
function centerTop(r: DOMRect, c: DOMRect) {
  return { x: r.left - c.left + r.width / 2, y: r.top - c.top };
}
function centerLeft(r: DOMRect, c: DOMRect) {
  return { x: r.left - c.left, y: r.top - c.top + r.height / 2 };
}

/**
 * SVG overlay that draws arrows between anchored boxes. It measures element
 * rects on layout (and on container resize), so arrows follow the boxes.
 * Variable/array-cell -> object arrows leave from the right or bottom of the
 * source and enter the left or top of the target, whichever reads cleaner.
 */
export default function ArrowLayer({
  containerRef,
  anchors,
  connections,
  revision,
}: ArrowLayerProps) {
  const [segments, setSegments] = useState<Segment[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const c = container.getBoundingClientRect();
      const next: Segment[] = [];
      for (const conn of connections) {
        const fromEl = anchors.get(conn.from);
        const toEl = anchors.get(conn.to);
        if (!fromEl || !toEl) continue;
        const fr = fromEl.getBoundingClientRect();
        const tr = toEl.getBoundingClientRect();

        const fcx = fr.left + fr.width / 2;
        const tcx = tr.left + tr.width / 2;
        const sameColumn =
          Math.abs(fcx - tcx) < Math.max(fr.width, tr.width) * 1.1;

        let mode: ArrowMode;
        if (sameColumn && Math.abs(tr.top - fr.top) > 6) {
          // Boxes stacked in the same column (e.g. stack variables, or a node
          // above/below). Route the arrow out through the left gutter so it
          // doesn't cut across the boxes between them.
          mode = "gutter";
        } else if (
          tr.top - fr.bottom > -4 &&
          Math.abs(tcx - fcx) < Math.max(fr.width, tr.width) * 2
        ) {
          // Target sits below and roughly aligned: array-of-objects "| V".
          mode = "vertical";
        } else {
          // Default: horizontal, source-right to target-left.
          mode = "horizontal";
        }

        let start: { x: number; y: number };
        let end: { x: number; y: number };
        let gutterX: number | undefined;

        if (mode === "gutter") {
          start = centerRight(fr, c);
          end = centerRight(tr, c);
          // Bow out to the right of whichever box reaches furthest right, into
          // the open space before the heap column.
          const rightMost = Math.max(start.x, end.x);
          gutterX = rightMost + 18;
        } else if (mode === "vertical") {
          start = centerBottom(fr, c);
          end = centerTop(tr, c);
        } else {
          start = centerRight(fr, c);
          end = centerLeft(tr, c);
        }

        next.push({
          key: `${conn.from}->${conn.to}`,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          mode,
          gutterX,
        });
      }
      setSegments(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // revision forces re-measure when the step/data changes.
  }, [containerRef, anchors, connections, revision]);

  // Build the SVG path for a segment based on its routing mode.
  const pathFor = (s: Segment): string => {
    if (s.mode === "gutter") {
      const gx = s.gutterX ?? Math.min(s.x1, s.x2) - 18;
      const midY = (s.y1 + s.y2) / 2;
      return `M ${s.x1},${s.y1} C ${gx},${s.y1} ${gx},${midY} ${gx},${midY} C ${gx},${s.y2} ${s.x2},${s.y2} ${s.x2},${s.y2}`;
    }
    if (s.mode === "vertical") {
      const midY = (s.y1 + s.y2) / 2;
      return `M ${s.x1},${s.y1} C ${s.x1},${midY} ${s.x2},${midY} ${s.x2},${s.y2}`;
    }
    const midX = (s.x1 + s.x2) / 2;
    return `M ${s.x1},${s.y1} C ${midX},${s.y1} ${midX},${s.y2} ${s.x2},${s.y2}`;
  };

  const anyHovered = hovered !== null;

  return (
    <svg className="arrow-layer" aria-hidden="true">
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" className="arrow-layer__head" />
        </marker>
        <marker
          id="arrowhead-hover"
          markerWidth="9"
          markerHeight="9"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" className="arrow-layer__head--hover" />
        </marker>
      </defs>
      {segments.map((s) => {
        const d = pathFor(s);
        const isHovered = hovered === s.key;
        // Default arrows are dimmed; when one is hovered the rest fade further
        // so the focused arrow stands out. Classes drive the styling in CSS.
        const cls =
          "arrow-layer__path" +
          (isHovered ? " arrow-layer__path--hover" : "") +
          (anyHovered && !isHovered ? " arrow-layer__path--dim" : "");
        return (
          <g key={s.key}>
            {/* Visible arrow. */}
            <path
              d={d}
              className={cls}
              markerEnd={
                isHovered ? "url(#arrowhead-hover)" : "url(#arrowhead)"
              }
            />
            {/* Invisible fat hit-area so the thin line is easy to hover. */}
            <path
              d={d}
              className="arrow-layer__hit"
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() =>
                setHovered((h) => (h === s.key ? null : h))
              }
            />
          </g>
        );
      })}
    </svg>
  );
}
