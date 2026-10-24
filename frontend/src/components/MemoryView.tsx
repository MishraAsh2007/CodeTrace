import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { Encoded, HeapObject, TraceStep } from "../types";
import { colorFor, drawArrows, focusArrow } from "../viz/arrows";
import {
  MAX_SEQ_ITEMS,
  buildFrames,
  heapObj,
  instanceAttrs,
  isInline,
  isInstance,
  isRef,
  layoutHeap,
  objLabel,
  orderAttrs,
  pyStr,
  same,
  type FrameView,
  type Spotlight,
} from "../viz/model";

type Heap = Record<string, HeapObject>;

interface Props {
  step: TraceStep;
  prevStep: TraceStep | null;
  spotlight: Spotlight | null;
  /** Bump to scroll the spotlighted node into view. */
  focusToken: number;
}

/** Spotlight lookups derived once per render. */
interface SpotInfo {
  tags: Map<string, string[]>;
  nullAttrs: Map<string, Set<string>>;
  near: Set<string>;
}

function Value({ v, heap, hot }: { v: Encoded; heap: Heap; hot: boolean }) {
  if (v === null) return <span className="v-none">None</span>;
  if (typeof v === "boolean") return <span className="v-bool">{v ? "True" : "False"}</span>;
  if (typeof v === "number") return <span className="v-num">{v}</span>;
  if (typeof v === "string") return <span className="v-str">{pyStr(v)}</span>;
  if (Array.isArray(v)) {
    if (isRef(v)) {
      const obj = heapObj(heap, v);
      if (!obj) return <span className="v-func">?</span>;
      if (obj[0] === "FUNCTION")
        return (
          <span className="v-func" title={`function ${String(obj[1])}`}>
            ƒ {String(obj[1])}
          </span>
        );
      if (obj[0] === "CLASS") return <span className="v-func">class {String(obj[1])}</span>;
      if (obj[0] === "module") return <span className="v-func">module {String(obj[1])}</span>;
      // The dot takes its target's colour, the same as its arrow and the target's #id label.
      const id = String(v[1]);
      return <span className={hot ? "ptr hot" : "ptr"} data-ref={id} style={{ "--c": colorFor(id) } as CSSProperties} title={`${objLabel(obj)} #${id}`} />;
    }
    if (v[0] === "SPECIAL_FLOAT") return <span className="v-num">{String(v[1])}</span>;
    if (v[0] === "IMPORTED_FAUX_PRIMITIVE") return <span className="v-func">{String(v[1])}</span>;
  }
  return <>{JSON.stringify(v)}</>;
}

function FrameCard({ frame, heap, spotlightOn }: { frame: FrameView; heap: Heap; spotlightOn: boolean }) {
  const names = frame.names.filter((n) => n in frame.values);
  return (
    <div className={frame.isCurrent ? "card frame is-current" : "card frame"} data-frame={frame.key}>
      <div className="card-head">{frame.title}</div>
      {names.length ? (
        <table className="vars">
          <tbody>
            {names.map((n) => {
              const v = frame.values[n];
              const changed = frame.prev !== null && !same(frame.prev[n], v);
              return (
                <tr key={n} className={changed ? "changed" : undefined} data-var={n}>
                  <td className="name">{n === "__return__" ? "return" : n}</td>
                  <td className="val">
                    <Value v={v} heap={heap} hot={spotlightOn && frame.isCurrent} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="card-body-text">no variables yet</div>
      )}
    </div>
  );
}

function ObjectBody({ obj, heap, prevObj, nulls, hot }: { obj: HeapObject; heap: Heap; prevObj: HeapObject | null; nulls: Set<string> | undefined; hot: boolean }) {
  const kind = obj[0];
  if (isInstance(obj)) {
    const prevAttrs = prevObj ? Object.fromEntries(instanceAttrs(prevObj)) : null;
    const attrs = orderAttrs(instanceAttrs(obj));
    const pprint = kind === "INSTANCE_PPRINT" ? <div className="card-body-text">{String(obj[2])}</div> : null;
    if (!attrs.length) return pprint ?? <div className="card-body-text">no attributes</div>;
    return (
      <>
        {pprint}
        <table className="vars">
          <tbody>
            {attrs.map(([k, v]) => {
              const cls = [prevAttrs && !same(prevAttrs[k], v) ? "changed" : "", nulls?.has(k) ? "is-null-alert" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <tr key={k} className={cls || undefined} data-attr={k}>
                  <td className="name">{k}</td>
                  <td className="val">
                    <Value v={v} heap={heap} hot={hot} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }
  if (kind === "LIST" || kind === "TUPLE" || kind === "SET") {
    const items = obj.slice(1) as Encoded[];
    if (!items.length) return <div className="card-body-text">empty</div>;
    return (
      <div className="seq">
        {items.slice(0, MAX_SEQ_ITEMS).map((v, i) => (
          <div className="cell" key={i}>
            {kind !== "SET" && <span className="idx">{i}</span>}
            <Value v={v} heap={heap} hot={hot} />
          </div>
        ))}
        {items.length > MAX_SEQ_ITEMS && <div className="more">+{items.length - MAX_SEQ_ITEMS}</div>}
      </div>
    );
  }
  if (kind === "DICT") {
    const pairs = obj.slice(1) as [Encoded, Encoded][];
    if (!pairs.length) return <div className="card-body-text">empty</div>;
    return (
      <table className="vars">
        <tbody>
          {pairs.slice(0, MAX_SEQ_ITEMS).map(([k, v], i) => (
            <tr key={i}>
              <td className="name">
                <Value v={k} heap={heap} hot={hot} />
              </td>
              <td className="val">
                <Value v={v} heap={heap} hot={hot} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <div className="card-body-text">{obj.slice(1).join(" ")}</div>;
}

/**
 * The memory diagram. Memoized: the props only change when the step or spotlight does, so chat
 * streaming and other app updates don't re-measure and re-route the arrows.
 */
export const MemoryView = memo(function MemoryView({ step, prevStep, spotlight, focusToken }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const heap = step.heap || {};

  const frames = useMemo(() => buildFrames(step, prevStep), [step, prevStep]);
  const layout = useMemo(() => layoutHeap(frames, step.heap || {}), [frames, step]);
  const hiddenCount = Object.values(heap).filter((o) => !isInline(o)).length - layout.size;

  const spot = useMemo<SpotInfo | null>(() => {
    if (!spotlight) return null;
    const info: SpotInfo = { tags: new Map(), nullAttrs: new Map(), near: new Set() };
    for (const p of spotlight.pointers) {
      if (!p.id) continue;
      info.tags.set(p.id, [...(info.tags.get(p.id) ?? []), p.name]);
      if (p.nullAttrs.length) info.nullAttrs.set(p.id, new Set([...(info.nullAttrs.get(p.id) ?? []), ...p.nullAttrs]));
      const obj = heap[p.id];
      // Keep what this node points at readable, so you can see where `next` leads.
      if (obj && isInstance(obj)) for (const [, v] of instanceAttrs(obj)) if (isRef(v)) info.near.add(String(v[1]));
    }
    return info;
  }, [spotlight, heap]);

  // Route the arrows after every render. Positions come from layout offsets, so the spotlight's
  // scale-in animation doesn't skew them, and an unchanged diagram is skipped inside drawArrows.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (canvas && svg) drawArrows(canvas, svg);
  });

  // Hovering a pointer dot highlights its arrow and the card it points at.
  const onPointerHover = (e: ReactMouseEvent) => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!canvas || !svg) return;
    const dot = e.target instanceof Element ? e.target.closest<HTMLElement>(".ptr[data-arrow]") : null;
    if (dot !== hovered.current) {
      hovered.current = dot;
      focusArrow(canvas, svg, dot);
    }
  };
  const onPointerLeave = () => {
    if (!hovered.current || !canvasRef.current || !svgRef.current) return;
    hovered.current = null;
    focusArrow(canvasRef.current, svgRef.current, null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = canvas?.parentElement;
    if (!canvas || !scroller) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => svgRef.current && drawArrows(canvas, svgRef.current));
    });
    ro.observe(scroller);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!focusToken) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Prefer the node with a None pointer (usually the bug), then the last highlighted node.
    const alert = canvas.querySelector(".obj.spot .is-null-alert");
    const spots = canvas.querySelectorAll(".obj.spot");
    const target = alert?.closest(".obj") ?? spots[spots.length - 1] ?? canvas.querySelector(".frame.is-current");
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [focusToken]);

  return (
    <div ref={canvasRef} className={spot ? "viz-canvas spotlight" : "viz-canvas"} onMouseOver={onPointerHover} onMouseLeave={onPointerLeave}>
      <svg ref={svgRef} className="arrows" aria-hidden="true" />
      <div className="viz-layout">
        <div>
          <p className="viz-col-title">Frames</p>
          <div className="frames">
            {frames.map((f) => (
              <FrameCard key={f.key} frame={f} heap={heap} spotlightOn={!!spot} />
            ))}
          </div>
        </div>
        <div>
          <p className="viz-col-title">Objects{layout.size ? "" : " (none yet)"}</p>
          <div className="heap">
            {[...layout.entries()].map(([id, at]) => {
              const obj = heap[id];
              const prevRaw = prevStep?.heap?.[id];
              const prevObj = prevRaw && prevRaw[0] === obj[0] ? prevRaw : null;
              const tags = spot?.tags.get(id);
              const cls = ["card", "obj", tags ? "spot" : "", spot?.near.has(id) ? "spot-near" : ""].filter(Boolean).join(" ");
              return (
                <div key={id} className={cls} data-id={id} style={{ gridColumn: at.col + 1, gridRow: at.row + 1, "--c": colorFor(id) } as CSSProperties}>
                  <div className="tags">
                    {tags?.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="card-head">
                    {objLabel(obj)} <span className="cid">#{id}</span>
                    {!isInstance(obj) && (
                      <span className="kind">
                        {obj.length - 1} item{obj.length === 2 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <ObjectBody obj={obj} heap={heap} prevObj={prevObj} nulls={spot?.nullAttrs.get(id)} hot={!!tags} />
                </div>
              );
            })}
          </div>
          {hiddenCount > 0 && <p className="viz-col-title">+{hiddenCount} more objects not shown</p>}
        </div>
      </div>
    </div>
  );
});
