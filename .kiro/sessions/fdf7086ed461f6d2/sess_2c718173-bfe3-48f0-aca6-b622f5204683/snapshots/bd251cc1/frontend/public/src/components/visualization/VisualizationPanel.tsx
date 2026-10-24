import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Language } from "../../types";
import { useStepper } from "./useStepper";
import VizControls from "./VizControls";
import { changedCells } from "./diff";
import {
  type ExecutionTrace,
  type ProgramState,
  isArray,
  isRef,
  isStruct,
} from "./trace";
import { SAMPLE_TRACE } from "./sampleTrace";
import StackFrameView, { variableAnchorId } from "./StackFrameView";
import HeapObjectView, {
  cellAnchorId,
  fieldAnchorId,
  objectAnchorId,
} from "./HeapObjectView";
import ArrowLayer, { type Connection } from "./ArrowLayer";

export interface VisualizationPanelProps {
  /** Source currently in the editor (unused until the backend wires up). */
  code: string;
  /** Active language. */
  language: Language;
  /**
   * Execution trace to visualize. Defaults to a built-in sample so the panel
   * is demoable before the Rust backend emits real traces.
   */
  trace?: ExecutionTrace;
}

/** Derive all arrows (source anchor -> target object) for one state. */
function connectionsFor(state: ProgramState): Connection[] {
  const conns: Connection[] = [];

  // Reference variables in each stack frame -> their heap object.
  for (const frame of state.stack) {
    for (const v of frame.variables) {
      if (isRef(v.value) && v.value.target) {
        conns.push({
          from: variableAnchorId(frame.id, v.name),
          to: objectAnchorId(v.value.target),
        });
      }
    }
  }

  for (const obj of Object.values(state.heap)) {
    // Reference cells inside array objects -> the objects they point at
    // (e.g. an array of node pointers).
    if (isArray(obj)) {
      obj.elements.forEach((el, i) => {
        if (isRef(el) && el.target) {
          conns.push({
            from: cellAnchorId(obj.id, i),
            to: objectAnchorId(el.target),
          });
        }
      });
    }

    // Reference fields inside struct objects -> the objects they point at
    // (e.g. a linked-list node's `next` field chaining to the next node).
    if (isStruct(obj)) {
      for (const field of obj.fields) {
        if (isRef(field.value) && field.value.target) {
          conns.push({
            from: fieldAnchorId(obj.id, field.name),
            to: objectAnchorId(field.value.target),
          });
        }
      }
    }
  }

  return conns;
}

/**
 * The right half of CodeTutor: a box/arrow visualizer. It renders one program
 * state (stack frames + heap objects), drawing arrows for reference semantics,
 * and lets you scrub through the trace to watch state change per loop
 * iteration.
 */
export default function VisualizationPanel({
  language,
  trace,
}: VisualizationPanelProps) {
  // A real run trace jumps to its final state (see useStepper); the sample
  // fallback opens at the start.
  const isRealTrace = trace !== undefined;
  const effectiveTrace = trace ?? SAMPLE_TRACE;
  const stepper = useStepper(effectiveTrace, isRealTrace);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorsRef = useRef<Map<string, HTMLElement>>(new Map());
  // Bump to force the arrow layer to re-measure after each render.
  const [revision, setRevision] = useState(0);

  const clampedStep = stepper.step;
  const state = effectiveTrace.states[clampedStep];

  const registerAnchor = (id: string, el: HTMLElement | null) => {
    if (el) anchorsRef.current.set(id, el);
    else anchorsRef.current.delete(id);
  };

  const connections = useMemo(
    () => (state ? connectionsFor(state) : []),
    [state]
  );

  // Which cells changed from the previous step -> flashed to draw the eye.
  const changedKeys = useMemo(
    () =>
      state
        ? changedCells(trace.states[clampedStep - 1], state)
        : new Set<string>(),
    [trace.states, clampedStep, state]
  );

  // After the DOM for this step commits (and anchors re-register), bump the
  // revision so the arrow layer re-measures box positions.
  useLayoutEffect(() => {
    setRevision((r) => r + 1);
  }, [clampedStep]);

  if (!state) {
    return (
      <div className="panel visualization-panel">
        <h2 className="panel__title">Visualizer</h2>
        <p className="panel__hint">No trace to visualize yet.</p>
      </div>
    );
  }

  const heapObjects = Object.values(state.heap);

  return (
    <div className="panel visualization-panel">
      <div className="visualization-panel__header">
        <h2 className="panel__title">Visualizer</h2>
        <span className="panel__meta">{language.toUpperCase()}</span>
      </div>

      <VizControls stepper={stepper} line={state.line} />

      {state.note && <p className="viz-note">{state.note}</p>}

      <div className="viz-stage" ref={containerRef}>
        <ArrowLayer
          containerRef={containerRef}
          anchors={anchorsRef.current}
          connections={connections}
          revision={revision}
        />

        {/* Keyed on the step so changed-cell flash animations replay each
            step. Remounting also re-registers anchors; the layout effect
            above re-measures arrows afterward. */}
        <div className="viz-columns" key={clampedStep}>
          <div className="viz-column">
            <h3 className="viz-column__title">Stack</h3>
            {state.stack.map((frame) => (
              <StackFrameView
                key={frame.id}
                frame={frame}
                registerCellAnchor={registerAnchor}
                changedKeys={changedKeys}
              />
            ))}
          </div>

          <div className="viz-column">
            <h3 className="viz-column__title">Heap</h3>
            <div className="viz-heap">
              {heapObjects.map((obj) => (
                <HeapObjectView
                  key={obj.id}
                  object={obj}
                  registerAnchor={registerAnchor}
                  registerCellAnchor={registerAnchor}
                  changedKeys={changedKeys}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {state.stdout && (
        <pre className="viz-stdout">{state.stdout}</pre>
      )}
    </div>
  );
}
