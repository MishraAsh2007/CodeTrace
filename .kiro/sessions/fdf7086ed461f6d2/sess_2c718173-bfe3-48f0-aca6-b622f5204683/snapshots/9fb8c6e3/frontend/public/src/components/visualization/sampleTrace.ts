import type {
  ExecutionTrace,
  HeapObject,
  ProgramState,
  StackFrame,
  Value,
} from "./trace";

// A hand-built sample trace used to develop and demo the visualizer before the
// Rust backend streams real traces. It models a small program that:
//
//   1. builds a 3-node singly linked list (structs chained by `next`),
//   2. keeps an int array and a primitive, and
//   3. calls a helper sum(head) that recurses/iterates one frame deeper.
//
// It exercises every visualization feature:
//   - primitive variables (value semantics)                -> inline boxes
//   - an int array (value cells)                           -> array object
//   - struct nodes with a `next` pointer                   -> linked-list arrows
//   - a reference variable (head) pointing into the heap   -> reference arrow
//   - two call-stack depths (main -> sum)                  -> step into/over/out
//   - changing state across steps                          -> auto-play / scrub

const prim = (display: string, typeName = "int"): Value => ({
  kind: "primitive",
  display,
  typeName,
});

/** A heap reference (to an object id), or a null pointer. */
const ref = (heapId: string | null): Value => ({
  kind: "ref",
  target: heapId === null ? null : { kind: "heap", id: heapId },
});

/** A stack reference (to a variable slot in a given frame). */
const stackRef = (frameId: string, name: string): Value => ({
  kind: "ref",
  target: { kind: "stack", frameId, name },
});

/** Three linked-list nodes: n0 -> n1 -> n2 -> null. */
function listHeap(): Record<string, HeapObject> {
  return {
    n0: {
      kind: "struct",
      id: "n0",
      typeName: "Node",
      fields: [
        { name: "data", value: prim("4") },
        { name: "next", value: ref("n1") },
      ],
    },
    n1: {
      kind: "struct",
      id: "n1",
      typeName: "Node",
      fields: [
        { name: "data", value: prim("5") },
        { name: "next", value: ref("n2") },
      ],
    },
    n2: {
      kind: "struct",
      id: "n2",
      typeName: "Node",
      fields: [
        { name: "data", value: prim("6") },
        { name: "next", value: ref(null) },
      ],
    },
    arr_values: {
      kind: "array",
      id: "arr_values",
      elementType: "int",
      elements: [prim("4"), prim("5"), prim("6")],
    },
  };
}

function mainFrame(vars: { name: string; value: Value; declaredType?: string }[]): StackFrame {
  return {
    id: "frame_main",
    functionName: "main",
    isActive: false,
    variables: vars,
  };
}

function sumFrame(
  vars: { name: string; value: Value; declaredType?: string }[]
): StackFrame {
  return {
    id: "frame_sum",
    functionName: "sum",
    isActive: true,
    variables: vars,
  };
}

const headVar = { name: "head", declaredType: "Node*", value: ref("n0") };
const valuesVar = { name: "values", declaredType: "int[]", value: ref("arr_values") };

// Convenience to tag the top (active) frame.
function activeMain(frame: StackFrame): StackFrame {
  return { ...frame, isActive: true };
}

// A short pointer-chain intro (mirrors int guy; int* p = &guy; int** pp = &p)
// to demo stack-to-stack pointer arrows. Note these refs target the SAME
// frame id ("frame_main") their variables live in.
const guyVar = { name: "guy", declaredType: "int", value: prim("0") };
const knowsGuyVar = {
  name: "knowsGuy",
  declaredType: "int*",
  value: stackRef("frame_main", "guy"),
};
const knowsKnowsGuyVar = {
  name: "knowsKnowsGuy",
  declaredType: "int**",
  value: stackRef("frame_main", "knowsGuy"),
};

const states: ProgramState[] = [
  {
    step: 0,
    line: 1,
    depth: 1,
    note: "int guy = 0; knowsGuy = &guy; knowsKnowsGuy = &knowsGuy. Follow the arrows: knowsKnowsGuy → knowsGuy → guy (0).",
    stack: [
      activeMain(mainFrame([guyVar, knowsGuyVar, knowsKnowsGuyVar])),
    ],
    heap: {},
  },
  {
    step: 1,
    line: 10,
    depth: 1,
    note: "Built list head -> 4 -> 5 -> 6, values = [4,5,6].",
    stack: [activeMain(mainFrame([headVar, valuesVar]))],
    heap: listHeap(),
  },
  {
    step: 2,
    line: 11,
    depth: 1,
    note: "total = 0 before calling sum(head).",
    stack: [activeMain(mainFrame([headVar, valuesVar, { name: "total", value: prim("0") }]))],
    heap: listHeap(),
  },
  // --- step INTO sum() : depth goes 1 -> 2 ---
  {
    step: 3,
    line: 2,
    depth: 2,
    note: "Entered sum(node). node -> n0 (data 4), acc = 0.",
    stack: [
      mainFrame([headVar, valuesVar, { name: "total", value: prim("0") }]),
      sumFrame([
        { name: "node", declaredType: "Node*", value: ref("n0") },
        { name: "acc", value: prim("0") },
      ]),
    ],
    heap: listHeap(),
  },
  {
    step: 3,
    line: 3,
    depth: 2,
    note: "acc += node->data (4). node advances to n1.",
    stack: [
      mainFrame([headVar, valuesVar, { name: "total", value: prim("0") }]),
      sumFrame([
        { name: "node", declaredType: "Node*", value: ref("n1") },
        { name: "acc", value: prim("4") },
      ]),
    ],
    heap: listHeap(),
  },
  {
    step: 4,
    line: 3,
    depth: 2,
    note: "acc += node->data (5). node advances to n2.",
    stack: [
      mainFrame([headVar, valuesVar, { name: "total", value: prim("0") }]),
      sumFrame([
        { name: "node", declaredType: "Node*", value: ref("n2") },
        { name: "acc", value: prim("9") },
      ]),
    ],
    heap: listHeap(),
  },
  {
    step: 5,
    line: 3,
    depth: 2,
    note: "acc += node->data (6). node advances to null; loop ends.",
    stack: [
      mainFrame([headVar, valuesVar, { name: "total", value: prim("0") }]),
      sumFrame([
        { name: "node", declaredType: "Node*", value: ref(null) },
        { name: "acc", value: prim("15") },
      ]),
    ],
    heap: listHeap(),
  },
  // --- step OUT : depth goes 2 -> 1, return value lands in total ---
  {
    step: 6,
    line: 11,
    depth: 1,
    note: "sum returned 15. total = 15.",
    stack: [activeMain(mainFrame([headVar, valuesVar, { name: "total", value: prim("15") }]))],
    heap: listHeap(),
    stdout: "total = 15\n",
  },
];

export const SAMPLE_TRACE: ExecutionTrace = { states };
