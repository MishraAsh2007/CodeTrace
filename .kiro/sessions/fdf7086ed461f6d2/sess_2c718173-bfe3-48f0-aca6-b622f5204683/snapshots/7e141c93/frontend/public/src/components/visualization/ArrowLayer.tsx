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

        // Decide orientation: if the target sits mostly below the source,
        // draw a vertical arrow (the array-of-objects "|  V" pattern);
        // otherwise draw a horizontal one ("values -> [ ]").
        const vertical = tr.top - fr.bottom > -4 && Math.abs(
          (tr.left + tr.width / 2) - (fr.left + fr.width / 2)
        ) < Math.max(fr.width, tr.width) * 2;

        const start = vertical ? centerBottom(fr, c) : centerRight(fr, c);
        const end = vertical ? centerTop(tr, c) : centerLeft(tr, c);

        next.push({
          key: `${conn.from}->${conn.to}`,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          vertical,
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
      </defs>
      {segments.map((s) => {
        // Smooth cubic path; control points depend on orientation.
        const d = s.vertical
          ? `M ${s.x1},${s.y1} C ${s.x1},${(s.y1 + s.y2) / 2} ${s.x2},${
              (s.y1 + s.y2) / 2
            } ${s.x2},${s.y2}`
          : `M ${s.x1},${s.y1} C ${(s.x1 + s.x2) / 2},${s.y1} ${
              (s.x1 + s.x2) / 2
            },${s.y2} ${s.x2},${s.y2}`;
        return (
          <path
            key={s.key}
            d={d}
            className="arrow-layer__path"
            markerEnd="url(#arrowhead)"
          />
        );
      })}
    </svg>
  );
}
