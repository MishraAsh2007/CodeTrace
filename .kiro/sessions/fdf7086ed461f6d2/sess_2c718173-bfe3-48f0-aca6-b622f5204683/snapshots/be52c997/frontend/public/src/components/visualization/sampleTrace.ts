import type {
  ExecutionTrace,
  HeapObject,
  ProgramState,
  Value,
} from "./trace";

// A hand-built sample trace used to develop and demo the visualizer before the
// Rust backend emits real traces. It models a small program:
//
//   int[] values = {4, 5, 6};
//   Node[] nodes = {o1, o2, o3};
//   int x = 3;
//   for (int i = 0; i < values.length - 1; i++) {
//       if (values[i] > values[i + 1]) { swap(values, i, i + 1); }
//   }
//
// It exercises: a primitive variable (value semantics), an int array (value
// cells), an array of object references (reference semantics), the heap/stack
// split, and changing state across loop iterations.

const prim = (display: string, typeName?: string): Value => ({
  kind: "primitive",
  display,
  typeName,
});

const ref = (target: string | null): Value => ({ kind: "ref", target });

/** Build the heap for a given ordering of the int array cells. */
function makeHeap(cells: number[]): Record<string, HeapObject> {
  return {
    arr_values: {
      kind: "array",
      id: "arr_values",
      elementType: "int",
      elements: cells.map((n) => prim(String(n), "int")),
    },
    arr_nodes: {
      kind: "array",
      id: "arr_nodes",
      elementType: "Node",
      elements: [ref("o1"), ref("o2"), ref("o3")],
    },
    o1: {
      kind: "struct",
      id: "o1",
      typeName: "Node",
      fields: [{ name: "data", value: prim("4", "int") }],
    },
    o2: {
      kind: "struct",
      id: "o2",
      typeName: "Node",
      fields: [{ name: "data", value: prim("5", "int") }],
    },
    o3: {
      kind: "struct",
      id: "o3",
      typeName: "Node",
      fields: [{ name: "data", value: prim("6", "int") }],
    },
  };
}

function frame(i: number | null, cells: number[]): ProgramState["stack"] {
  const vars = [
    {
      name: "values",
      declaredType: "int[]",
      value: ref("arr_values"),
    },
    {
      name: "nodes",
      declaredType: "Node[]",
      value: ref("arr_nodes"),
    },
    { name: "x", declaredType: "int", value: prim("3", "int") },
  ];
  if (i !== null) {
    vars.push({ name: "i", declaredType: "int", value: prim(String(i), "int") });
  }
  void cells;
  return [
    {
      id: "frame_main",
      functionName: "main",
      isActive: true,
      variables: vars,
    },
  ];
}

export const SAMPLE_TRACE: ExecutionTrace = {
  states: [
    {
      step: 0,
      line: 1,
      note: "Declared values = [4, 5, 6], x = 3.",
      stack: frame(null, [4, 5, 6]),
      heap: makeHeap([4, 5, 6]),
    },
    {
      step: 1,
      line: 5,
      note: "Enter loop, i = 0. Compare values[0]=4 and values[1]=5.",
      stack: frame(0, [4, 5, 6]),
      heap: makeHeap([4, 5, 6]),
    },
    {
      step: 2,
      line: 5,
      note: "4 < 5, no swap. i = 1. Compare values[1]=5 and values[2]=6.",
      stack: frame(1, [4, 5, 6]),
      heap: makeHeap([4, 5, 6]),
    },
    {
      step: 3,
      line: 6,
      note: "5 < 6, no swap. Array already sorted; loop ends.",
      stack: frame(2, [4, 5, 6]),
      heap: makeHeap([4, 5, 6]),
    },
  ],
};
