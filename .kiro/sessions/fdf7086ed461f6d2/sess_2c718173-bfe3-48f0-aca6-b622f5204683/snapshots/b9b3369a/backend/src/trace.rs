//! Serializable execution-trace model.
//!
//! This mirrors the frontend's `frontend/public/src/components/visualization/
//! trace.ts` so the JSON produced here deserializes directly into the
//! visualizer. The tagged `Value` / `HeapObject` enums use serde's internal
//! tagging on a `kind` field to match the TypeScript discriminated unions.

use serde::Serialize;
use std::collections::BTreeMap;

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
    /// A pointer into the heap. `target` is `None` for a null pointer.
    #[serde(rename = "ref")]
    Ref {
        /// Heap object id this reference points at, or null.
        target: Option<String>,
    },
}

impl Value {
    pub fn primitive(display: impl Into<String>, type_name: impl Into<String>) -> Self {
        Value::Primitive {
            display: display.into(),
            type_name: Some(type_name.into()),
        }
    }

    pub fn reference(target: Option<String>) -> Self {
        Value::Ref { target }
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
}

/// The full execution trace: an ordered list of states to scrub through.
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionTrace {
    pub states: Vec<ProgramState>,
}
