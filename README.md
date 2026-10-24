# CodeTrace

CodeTrace is an interactive learning and debugging platform that helps users understand how programs execute by visualizing memory, stack frames, pointers, and control flow in real time. Instead of reading raw output, learners can step through code line by line, inspect values, watch objects change over time, and diagnose common bugs with guided explanations.

The repository contains multiple versions of the same core idea across different languages and implementations:

- Python visualizer for tracing Python execution and teaching debugging concepts
- C-based execution and tracing implementation
- Java browser IDE and debugger experience (TraceLab)
- Shared cross-language concepts for memory visualization, tutoring, and program analysis

## Why this project matters

CodeTrace turns debugging into a visual teaching tool. It is designed for:

- students learning how code actually runs
- beginners who need to understand variables, scope, references, and heap memory
- debugging exercises that benefit from state-by-state explanations
- interactive programming tutoring with quizzes and guided hints

## Core features

Across the different branches, the application includes the following capabilities:

- Step-by-step execution tracing
- Breakpoints and runtime pauses
- Memory and call-stack visualization
- Heap/object diagrams with pointer arrows
- Variable inspection and frame tracking
- Error detection and suggested fixes
- Built-in quiz and tutoring logic
- Optional AI-powered explanations and guidance
- Browser-based IDE experience for interactive learning

## Repository layout

This repository is organized as a multi-branch project:

- `main` — shared project overview and integration point
- `python` — Python visualizer with Monaco-based editor and Rust backend
- `C_ver` — C branch with backend/frontend implementation and tracing logic
- `Java` — Java IDE version (TraceLab) with debugger, tutoring, and JDK-based execution

## Python branch overview

The Python implementation is a Monaco-based Python IDE that traces code execution step by step and visualizes memory as frames, objects, and pointers. It includes:

- frontend in React + TypeScript + Vite
- Rust server for API and runtime management
- Python tracer layer based on OnlinePythonTutor-style logging
- built-in quiz system and Kiro-like tutor
- optional AI assistance through browser-based providers (Gemini, OpenAI, Anthropic)

Typical workflow:

1. Write or paste Python code
2. Set breakpoints
3. Run the program
4. Step through execution and inspect state changes
5. Ask the tutor to explain the current step or diagnose the bug

## C branch overview

The C branch focuses on a backend/frontend model for executing and tracing C programs. It includes:

- C parser and AST logic
- interpreter/trace support
- frontend visualization for stepping through execution
- debugging concepts centered around memory, variables, and execution flow

This branch demonstrates how the same educational tracing model can be adapted to a lower-level language with explicit memory manipulation and pointer behavior.

## Java branch overview

The Java implementation is a browser-based Java IDE called TraceLab. It is more advanced and includes:

- Java compiler and JVM-based recording debugger
- stack and heap inspection
- real program execution with JDI/JVM integration
- test generation and evaluation
- compile error explanations and fix suggestions
- tutor-driven learning loops with concept practice
- AI assistant integration for code explanations

This version is especially strong for teaching Java concepts such as arrays, references, recursion, object graphs, and bug diagnosis.

## Example workflow

A typical CodeTrace session works like this:

1. User writes code in the editor
2. Program runs with tracing enabled
3. Execution pauses at points of interest
4. The UI highlights the active line and current state
5. Heap, stack, and pointer diagrams update
6. Learner inspects values and asks for help
7. Tutor explains the bug, suggests a fix, or asks a quiz question

## Tech stack

The repository spans multiple tech stacks, depending on the branch:

- Frontend: TypeScript, React, Vite, Monaco Editor
- Backend: Rust (Axum/Tokio), Node-based tooling
- Language runtimes: Python, Java, C
- AI integration: provider-based API access from the browser
- Tracing: custom execution logging and visual memory encoding

## Run instructions

Depending on the branch you want to run:

### Python version

```powershell
.un.cmd
```

Then open:

- http://localhost:8000

### Java version

```sh
npm ci
npm run build
npm start
```

Then open:

- http://127.0.0.1:4317

### C / Rust-based implementations

Use the branch-specific setup from that branch's README and project configuration, typically involving Rust + frontend build commands.

## Project purpose

CodeTrace is best understood as an educational execution visualizer: a system that does not just run code, but shows what the code is doing internally. The project helps learners understand:

- variable values over time
- function call behavior
- heap and stack relationships
- pointer aliasing and references
- runtime errors and their root causes
- how to fix mistakes by understanding the program state

## Summary

CodeTrace is a family of teaching-focused debugging tools designed to make code execution understandable. Across Python, C, and Java, the project demonstrates a consistent philosophy: show execution visually, explain it clearly, and turn debugging into a guided learning experience.

This repository is not just a code runner; it is a visual debugger, tutor, and concept explainer built for learning how programs behave from the inside out.
