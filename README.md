# CodeTrace

CodeTrace is an interactive learning and debugging platform that helps users understand how programs execute by visualizing memory, stack frames, pointers, and control flow in real time. It is designed to make debugging more understandable for students, beginners, and anyone learning how programs really behave under the hood.

The submission file is in the main branch of the repo as a markdown file 

This repository contains multiple versions of the same core idea across different languages and implementations:

- Python visualizer for tracing Python execution and teaching debugging concepts
- C-based execution and tracing implementation
- Java browser IDE and debugger experience (TraceLab)
- Shared cross-language concepts for memory visualization, tutoring, and program analysis

## Repository layout

This repository is organized as a multi-branch project:

- `main` — project overview and shared documentation
- `python` — Python visualizer with Monaco editor and Rust backend
- `C_ver` — C branch with backend/frontend execution and tracing logic
- `Java` — Java browser IDE version (TraceLab)

## Local setup requirements

Before running CodeTrace locally, install the tools for the branch you want to use:

- Git
- Node.js 20+ for the Python branch, Node.js 24+ for the Java branch
- Python 3.11+ for the Python branch
- Rust + Cargo (`https://rustup.rs`)
- JDK 21+ for the Java branch
- On Windows, the Visual Studio C++ build tools may be required for Rust builds

## Quick start

### 1) Clone the repository

```bash
git clone https://github.com/MishraAsh2007/CodeTrace.git
cd CodeTrace
```

### 2) Switch to the branch you want to run

```bash
git checkout python
# or
git checkout Java
# or
git checkout C_ver
```

## Run the Python version

The Python branch is the easiest one to run locally.

### Windows

```powershell
.
run.cmd
```

Or PowerShell:

```powershell
./run.ps1
```

Then open:

- http://localhost:8000

The script builds the frontend and server, then starts the app.

### macOS / Linux / manual setup

If you want to run it manually instead of using the provided scripts:

```bash
cd frontend
npm install
npm run build

cd ../server
cargo run --release
```

Then open the app in your browser at:

- http://localhost:8000

For frontend hot-reload while developing UI changes:

```bash
cd frontend
npm run dev
```

Then open:

- http://localhost:5173

## Run the Java version

The Java branch is a separate browser-based IDE.

Requirements:

- Node.js 24+
- Rust stable
- JDK 21+

Run:

```bash
npm ci
npm run build
npm start
```

Then open:

- http://127.0.0.1:4317

For frontend hot reload:

```bash
npm run dev
```

Then open:

- http://127.0.0.1:5173

## Run the C version

The C branch is not the main default branch. Switch to `C_ver` and follow the project-specific setup instructions in that branch's README and project configuration files.

## Useful notes

- The Python branch uses a Rust server and a React + TypeScript frontend.
- The Java branch uses a Rust runner with a browser-based Java IDE and JVM-based tracing.
- The C version is designed for lower-level tracing and pointer-heavy debugging concepts.
- If you are developing locally, the `run.cmd`/`run.ps1` scripts in the Python branch are the fastest way to get started.

## Troubleshooting

- If `npm` is not recognized, install Node.js and reopen the terminal.
- If `cargo` is not recognized, install Rust from rustup and reopen the terminal.
- If Python commands fail, verify Python 3.11+ is installed and on your PATH.
- If Java commands fail, confirm JDK 21+ is installed and `JAVA_HOME` is set correctly.
- If the app does not load, confirm the correct branch is checked out and that the required tools are installed.

## Project purpose

CodeTrace is best understood as an educational execution visualizer: a system that does not just run code, but shows what the code is doing internally. The project helps learners understand:

- variable values over time
- function call behavior
- heap and stack relationships
- pointer aliasing and references
- runtime errors and their root causes
- how to fix mistakes by understanding the program state

This repository is not just a code runner; it is a visual debugger, tutor, and concept explainer built for learning how programs behave from the inside out.
