//! Serializable execution-trace model.
//!
//! This mirrors the frontend's `frontend/public/src/components/visualization/
//! trace.ts` so the JSON produced here deserializes directly into the
//! visualizer. The tagged `Value` / `HeapObject` enums use serde's internal
//! tagging on a `kind` field to match the TypeScript discriminated unions.

use serde::Serialize;
use std::collections::BTreeMap;

/// What a pointer points at. A pointer may target a heap object (array/malloc
/// block) or a stack variable slot (e.g. `&x`). `None` on the Ref means null.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum RefTarget {
    /// Points at a heap object, identified by its heap id.
    #[serde(rename = "heap")]
    Heap { id: String },
    /// Points at a stack variable slot (frame id + variable name).
    #[serde(rename = "stack")]
    Stack {
        #[serde(rename = "frameId")]
        frame_id: String,
        name: String,
    },
}

/// A value stored in a variable slot, array cell, or struct field.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum Value {
    /// Inline, copied-by-value scalar (int, char, double, ...).
    #[serde(rename = "primitive")]
    Primitive {
        /// Display text, e.g. "3", "'a'", "3.14".
        display: String,
        #[serde(rename = "typeName", skip_serializing_if = "Option::is_none")]
        type_name: Option<String>,
    },
    /// A pointer. `target` is `None` for a null pointer.
    #[serde(rename = "ref")]
    Ref {
        /// What this reference points at (heap object or stack slot), or null.
        target: Option<RefTarget>,
    },
}

impl Value {
    pub fn primitive(display: impl Into<String>, type_name: impl Into<String>) -> Self {
        Value::Primitive {
            display: display.into(),
            type_name: Some(type_name.into()),
        }
    }

    pub fn reference(target: Option<RefTarget>) -> Self {
        Value::Ref { target }
    }

    /// Convenience: a reference to a heap object by id.
    pub fn heap_ref(id: impl Into<String>) -> Self {
        Value::Ref {
            target: Some(RefTarget::Heap { id: id.into() }),
        }
    }

    /// Convenience: a reference to a stack variable slot.
    pub fn stack_ref(frame_id: impl Into<String>, name: impl Into<String>) -> Self {
        Value::Ref {
            target: Some(RefTarget::Stack {
                frame_id: frame_id.into(),
                name: name.into(),
            }),
        }
    }
}

/// A named binding inside a stack frame (local or parameter).
#[derive(Debug, Clone, Serialize)]
pub struct Variable {
    pub name: String,
    pub value: Value,
    #[serde(rename = "declaredType", skip_serializing_if = "Option::is_none")]
    pub declared_type: Option<String>,
}

/// One function activation on the call stack.
#[derive(Debug, Clone, Serialize)]
pub struct StackFrame {
    pub id: String,
    #[serde(rename = "functionName")]
    pub function_name: String,
    pub variables: Vec<Variable>,
    #[serde(rename = "isActive", skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    /// TraceLab: the line this frame is running; for callers, the line of the call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

/// TraceLab: a function that returned since the previous state. `value` is None for void functions.
#[derive(Debug, Clone, Serialize)]
pub struct Return {
    pub method: String,
    #[serde(rename = "frameId")]
    pub frame_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

/// Anything that can live in the heap.
///
/// The `Struct` variant is part of the shared trace contract (used by struct /
/// object visualizations) even though the current C subset only emits arrays.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum HeapObject {
    #[serde(rename = "array")]
    Array {
        id: String,
        #[serde(rename = "elementType", skip_serializing_if = "Option::is_none")]
        element_type: Option<String>,
        elements: Vec<Value>,
        /// TraceLab: the array's length; `elements` holds at most the first 64 cells.
        #[serde(skip_serializing_if = "Option::is_none")]
        length: Option<usize>,
    },
    #[serde(rename = "struct")]
    Struct {
        id: String,
        #[serde(rename = "typeName")]
        type_name: String,
        fields: Vec<Variable>,
    },
}

/// One snapshot of the program at a single execution step.
#[derive(Debug, Clone, Serialize)]
pub struct ProgramState {
    pub step: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    /// Call-stack depth at this step (1 = top-level `main`). Used by the
    /// frontend debugger to implement step-over / step-out.
    pub depth: usize,
    pub stack: Vec<StackFrame>,
    /// Heap objects keyed by id. BTreeMap keeps a stable, sorted order.
    pub heap: BTreeMap<String, HeapObject>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    /// TraceLab: functions that returned since the previous state.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub returns: Vec<Return>,
    /// TraceLab: heap ids in display order (reachable objects first, in allocation order).
    #[serde(skip)]
    pub heap_order: Vec<String>,
    /// TraceLab: some heap objects were left out of this state (more than 160).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub heap_truncated: bool,
}

/// The full execution trace: an ordered list of states to scrub through.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionTrace {
    pub states: Vec<ProgramState>,
}
