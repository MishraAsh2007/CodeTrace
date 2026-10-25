# CodeTrace: Hackachusetts Submission

> **One-line promise:** *See how your code actually runs, understand the bug, and prove your fix.*

CodeTrace is a free, browser-based family of interactive learning and debugging tools that visualize program execution — memory, stack frames, pointers, and control flow in real time — across **Python, C, and Java**, with a built-in quiz/tutor loop that lowers the barrier to learning computer science.

---

## 1. Project Name & Promise

- **Project name:** CodeTrace (the Java branch is also named **TraceLab**)
- **One-line promise:** *See how your code actually runs, understand the bug, and prove your fix.*
- **What it is:** A browser-based execution visualizer and debugging tutor. Instead of reading raw output, learners step through code line by line, inspect values, watch objects change over time on stack/heap diagrams with pointer arrows, and diagnose common bugs with guided explanations and quizzes. The same core idea is implemented across multiple language branches (Python, C, Java), sharing concepts for memory visualization, tutoring, and program analysis.

---

## 2. Challenge Track: Civic Services

**Selected track: Civic Services.**

CodeTrace is framed as a civic and educational-equity tool. Computer-science education is unevenly distributed: many learners lack access to configured development environments, capable hardware, or instructor time for one-on-one debugging help. CodeTrace is a **free, browser-based** learning and debugging environment that runs with minimal local setup, lowering the barrier to entry for students, public libraries, community colleges, workforce-retraining programs, and under-resourced schools.

By turning debugging into a guided, self-checking learning loop (predict, explain, repair, verify) and a built-in quiz that works with **no API key**, CodeTrace provides the kind of individualized feedback that is normally scarce. It treats access to foundational CS skills as a **public good**: equitable, no-cost, and available in a browser. That is the civic services angle: expanding equitable access to computer-science education as public infrastructure for digital literacy.

---

## 3. Team Members & Representative

> Maximum of 4 members, including one Representative.

| Role |      Name       | Contact / Handle |
|------|-----------------|------------------|
| C    | Ashutosh Mishra |   MishraAsh2007  |
| Java |  Jash Kotadiya  |   JashKotadiya   |
|Python|  Atharva Kadam  |    Atharvakdm    |
|Python|  Siva Bharadwaj |     Siva2707     | 

Each member essentially build a full end to end functioning website which focused on their language of choice. Ashutosh worked on C; Jash on Java; Atharva and Siva on Python. Each member decided on ways to display the visualization, and the functionality of the assistant. Our goal was to merge our versions in the end, taking the best features of each person's design. 
---

## 4. Project Description: Features & Functionality

CodeTrace is a browser-based execution visualizer with **step-by-step tracing**, **memory and call-stack visualization**, **heap/object diagrams with pointer arrows**, **breakpoints and runtime pauses**, **variable inspection and frame tracking**, **error detection with suggested fixes**, and a **built-in quiz and tutoring engine** with optional AI-powered explanations. It is organized as a multi-branch repository where each branch adapts the same educational tracing model to a different language.

### Repository layout (multi-branch)

| Branch |                   What it is                   |
|--------|------------------------------------------------|
| `main` | Shared project overview and integration point. |
| `python` | Python visualizer: React + TypeScript + Vite frontend, a Rust (axum + tokio) server, and a Python tracer based on OnlinePythonTutor's `pg_logger`. Built-in quiz + Socratic tutor ("Kiro"), optional browser-side AI (Gemini / OpenAI / Anthropic). |
| `C_ver` | C branch: a backend/frontend model for executing and tracing C programs (Rust backend with `Cargo.toml`/`src`, a frontend), centered on memory, variables, pointer behavior, and execution flow for a lower-level language. |
| `Java` | Java IDE in the browser, called **TraceLab**: a JDK 21 compiler + JVM/JDI recording debugger, stack/heap inspection, test generation and evaluation, compile-error explanations and fix suggestions, and a tutor-driven learning loop. |

### The learning loop

1. A learner writes or pastes code and runs it with tracing enabled.
2. Execution pauses at points of interest (a breakpoint, an exception, or a failing test); the UI highlights the active line and current state.
3. **Predict** — e.g. *"The array has length 3 and `i` is 3. What happens at `values[i]`?"*
4. **Explain** — e.g. *"Which loop condition admits an invalid index?"*
5. Progressively stronger hints after each attempt.
6. **Repair** — the learner edits the code (and, in Java, re-runs checks against their own edit).
7. **Verify** — re-run shows the resulting behavior and which checks passed.

Questions are **deterministic** and generated only from values recorded in the actual run, so a question appears only when the trace backs it up. The Python branch's question bank (`frontend/src/quiz/`) covers the error the run hit (None dereferences, index-out-of-range, `KeyError`, `ZeroDivisionError`, wrong list/str/dict methods, `UnboundLocalError`, missing arguments, forgotten `return`, bad `int()`, endless loops/recursion, the BST insert bug, syntax errors), plus DSA (graph traversal, sorting passes, binary search, recursion/memoization), efficiency pitfalls (nested loops, `x in list` in a loop, `list.pop(0)`, string `+=`), and Python basics (mutable default args, `/` vs `//`, slicing). The Java branch adds predict/explain/repair questions for array/string bounds, null fields and `Map.get` misses, division by zero, `NumberFormatException`, `ConcurrentModificationException`, non-terminating loops, runaway recursion, string identity, integer division, pass-by-value, aliasing, return values, and compiler errors.

### Key features (by branch)

**Python branch (`python`):**
- Monaco editor; breakpoints via the gutter or F9; Run with Ctrl+Enter; step via toolbar, timeline slider, Alt+←/→, or F8 to continue.
- **Visualize** (Ctrl+Shift+V) spotlights where you are: which nodes your variables point to and any `None` pointer the current line reads through.
- Memory diagram with routed pointer arrows (`frontend/src/viz/arrows.ts`): A*-routed around cards on a 6 px grid, color-coded per object id so aliases share a color; re-renders a step in ~20 ms.
- **Suggested fix on errors**: a panel under the output explains the error in plain language grounded in real values, offers a before/after diff (one-click **Apply fix**), and **Ask AI**. Repairs come from the same rule bank as the quiz (`frontend/src/quiz/rules/bugs.ts`).
- Built-in quiz works offline with no key; optional AI tutor streams replies, retries on overload, and backs off on rate limits.

**Java branch / TraceLab (`Java`):**
- Real **JDK 21** compilation (`--release 21`) and **JDI** capture; a recording debugger that steps forward and back through stack and heap.
- Stack/heap columns with reference arrows; renderers for arrays (incl. 2D and `char[]`), strings, boxed values, records/enums, and many JDK collections (`ArrayList`, `LinkedList`, `ArrayDeque`, `PriorityQueue`, maps, sets, `List.of`, iterators, `Optional`, `StringBuilder`, `BigInteger`/`BigDecimal`, `java.time`, …).
- Data-structure pictures: call trees for recursion, graphs for adjacency lists/matrices/edge lists, grids for 2D arrays, trees for classes with child fields, and chains for linked lists; changed/new highlighting and index markers (with out-of-range reads drawn as dashed cells past the end).
- Multi-file projects and packages with a package-tree Explorer, rename/move/delete, autosave, import/export (`.java`, folder, `.zip`, or TraceLab `.json`), and share links encoded in the URL fragment.
- **Tests**: program-output tests and method-call tests; a generator samples public/package-private methods; AI-suggested tests are each run on the JVM and compared to what the code does.
- **Compile-error help**: plain-language explanations with checked fixes (each suggested fix is compiled in the background and labelled Compiles / Clears this error / Doesn't clear it), surfaced as Monaco quick fixes.
- **Need help / Practice**: a recorded story of the run, a per-step variable table, and seeded, deterministic practice problems whose answers are computed by running the program on the JVM (never by the AI).
- Optional AI assistant via any OpenAI-compatible endpoint (Ollama local, Gemini, Groq, OpenRouter, LM Studio, …); relayed through a Java helper, with the key kept in `.local/ai.json` and never returned to the browser.
- Debugger controls: step into and step back; frame-aware step over / out / back-over (`F10`, `Shift+F11`, `Shift+F10`); scrubber, autoplay, filter, and replay bookmarks.
- Recording start points: right-click a line to start recording from the n-th time it runs with an optional condition.

**C branch (`C_ver`):**
- A backend/frontend model for executing and tracing C programs (Rust backend, frontend visualization), demonstrating how the same educational tracing model adapts to a lower-level language with explicit memory manipulation and pointer behavior. (This branch is the least developed of the three; its README is a stub.)

### Trace format / extensibility

The trace format is **language-independent**, so the UI and quiz engine can support other runtimes without rework — which is exactly what the three branches demonstrate. In the Java branch the trace contract is a versioned `TraceEvent` type (`schemaVersion` 1, `runId`, `sequence`, a `kind` of `line` | `exception` | `output` | `terminated`, a `location` with file/line/phase, `frames`, `heap`, stdout/stderr deltas, `exception`, and a `stopReason` of `completed` | `exception` | `timeout` | `step-limit` | `cancelled`). See `docs/PROTOCOL.md` in the Java branch.

### Positioning

Python Tutor already visualizes Python/Java/JS/C/C++, so multi-language visualization is **not** the differentiator, and CodeTrace does not claim to have invented prediction exercises. CodeTrace's distinction is **integrating deterministic, run-grounded predict / explain / repair questions and repair verification into an interactive, memory-visualizing IDE** — and doing so consistently across Python, C, and Java on a shared, language-independent trace model.

### Roadmap (still open)

Deeper semantic editor features (e.g. Eclipse JDT LS for Java), expression-level explanations, more language adapters against the same trace contract, a fuller C implementation, and **isolated execution before any public deployment**.

---

## 5. Demonstration Video

- **Video URL (public, under 3 minutes):** `[TODO: public YouTube/Vimeo/etc. link]`

### Suggested 3-minute demo script

Pick one branch to showcase (the Java branch's off-by-one array-sum bug is the most polished end-to-end story; the Python branch best shows the memory-arrow visualization).

**Java (TraceLab):** use a two-file Java project that sums an array with the off-by-one bug `i <= values.length`.

1. Open the project and run it; the JVM throws `ArrayIndexOutOfBoundsException`.
2. Step through the array with the indices and `i` visible; use **Over** at `ArraySum.sum(values)` to show frame-aware stepping, then **step into** it.
3. At the exception, show that `i == length` and highlight the valid index range (hover a reference to isolate its arrow).
4. Ask the learner to **explain** the failed access before revealing a hint.
5. Answer the **repair** question (it quotes line 6 from the recorded source), then **Edit** `ArraySum.java` line 6.
6. Change `<=` to `<`, **Run tests**, and show passing checks for empty, one-element, and ordinary arrays.
7. **Replay** before and after, each with its own source revision.

**Python:** write a small linked-list or BST program, set a breakpoint, Run, then use **Visualize** to show the pointer arrows and the `None` the current line reads through, and **Ask AI** / the built-in quiz to quiz on the paused state; finish by triggering an error to show the **suggested fix** diff with one-click Apply.

**Optional 60-second extensions:**
- *"Walking a chain"*: demonstrate reference arrows.
- *"Same text, different objects"*: `==` vs `equals` (Java), then trace the failing case.
- *"Inside recursion"*: show return values and **Out**.

---

## 6. Public GitHub Repository

- **Repository URL:** https://github.com/MishraAsh2007/CodeTrace
- **Branches:** `main` (overview), `python`, `C_ver`, `Java`.

**Requirements to confirm before submitting:**
- The repository must be **public**. *(The repo is currently public.)*
- The repository must contain the **`/.kiro`** directory at its root. `[TODO: verify /.kiro exists on the relevant branch(es); it was not visible at the python branch root when checked.]`
- The `/.kiro` directory must **NOT** be gitignored (verify it is actually committed and visible in the public repo). `[TODO: confirm .kiro is committed and not ignored.]`
- Include `README.md` (present on each branch) and `docs/PROTOCOL.md` (present on the Java branch).

---

## 7. Testing Instructions / Access

CodeTrace runs locally. Judges can build, run, and test it per branch:

**Python branch (`python`):**
```bash
# from the python branch root
.\run.cmd            # builds the frontend + Rust server, then starts the server
#  (use  .\run.cmd -SkipBuild  to start the last build instantly)
```
Then open http://localhost:8000. For hot-reload UI development: run `.\run.cmd` in one terminal, then `cd frontend && npm run dev` in another and open http://localhost:5173.
- Self-check: from `frontend/`, `npm run check:questions` traces 43 programs and verifies each gets the expected questions (currently 42/43 answered from the built-in bank).
- Requirements: Python 3.11+, Rust (rustup), Node.js 20+.

**Java branch (`Java`, TraceLab):**
```bash
npm ci
npm run build
npm start          # open http://127.0.0.1:4317
npm test           # builds worker+runner, runs Rust unit tests, then 62 integration checks against real JVM programs over HTTP
```
- `npm test` runs **62 integration checks against real JVM runs** (not mocks), covering tracing semantics, collections, limits/cancellation, every gallery example and its repair, compile help, test generation, the language server, practice problems, and more. Port **4317** must be free.
- Requirements: Node.js 24+, Rust stable (MSVC C++ build tools on Windows), and a full **JDK 21+** (a JRE alone is insufficient; `javac` is required). Optional: Eclipse JDT LS for full editor features (`npm run setup:jdtls`).

**C branch (`C_ver`):**
- Use the branch-specific setup from that branch's project configuration (Rust backend + frontend build). The branch README is currently a stub, so build steps `[TODO: confirm exact C-branch build/run commands with the team]`.

- **Hosted / live testing URL:** `[TODO: hosted URL if deployed — note the execution service cannot be statically hosted; see the deployment boundary below.]`
- **Credentials (if a hosted instance requires login):** `[TODO: username / password or access note]`

**Runtime notes for reviewers:**
- The built-in quiz/tutor and (Java) compile help, practice, and editor are **deterministic and need no API key**. The optional AI assistant requires the reviewer to supply their own key/model (or a local Ollama).
- Java: the Java on `PATH` may be a JRE without `javac`; a JDK 21 baseline is required. During development a suitable JDK was found bundled with the VS Code Java extension.
- Rust is needed to build the servers. On Windows, the Python branch documents a GNU-toolchain setup (portable Node + llvm-mingw) for machines without Visual Studio; the Java branch uses MSVC.

**Execution / deployment boundary:** Browser editing and replay can be statically hosted, but compiling and tracing code requires a separate **process-capable execution service** bound to `127.0.0.1` with no authentication and **no real sandbox**. A localhost-only dev runner demonstrates trusted samples and must be described as such; **isolated execution is still on the roadmap** before any public deployment. A public service would run each untrusted compilation/execution in an isolated job with no host credentials, no outbound network by default, bounded CPU/memory/processes, restricted filesystem, an unprivileged identity, timeouts, cleanup, and per-user concurrency quotas; for Java, JDWP must never be exposed to the public network.

---

## 8. How Kiro Was Used

> This section is scaffolded. Fill in each `[TODO]` honestly with what the team actually did. Remove any subsection that does not apply rather than inventing activity. (Note: the Python branch's Socratic tutor is itself named "Kiro" in the product — do not confuse the in-app tutor persona with the Kiro development tool when answering below.)

### 8.1 Which Kiro surfaces (IDE / CLI / Web / Crew)
- `[TODO: which Kiro surfaces the team used: Kiro IDE, Kiro CLI, Kiro Web, and/or Kiro Crew. Note what each was used for, e.g. "Kiro IDE for day-to-day feature implementation; Kiro CLI for batch refactors."]`

### 8.2 Spec-driven development
- `[TODO: describe how specs drove the build. Did you author requirements/design/task specs and have Kiro implement against them? Reference the spec files if they live in /.kiro.]`

### 8.3 Agent hooks
- `[TODO: list any agent hooks configured (e.g. in .kiro/hooks), what event they ran on (on save, on prompt, on test run), and what they automated.]`

### 8.4 Steering docs
- `[TODO: describe steering files used (e.g. .kiro/steering/*.md or AGENTS.md) such as coding conventions, architecture rules, or the trace contract, and how they shaped Kiro's output.]`

### 8.5 MCP (Model Context Protocol)
- `[TODO: list any MCP servers/tools integrated and what they provided, e.g. docs lookup, browser automation, test runners.]`

### 8.6 Property-based testing (PBT)
- `[TODO: describe any property-based tests written, what invariants were checked (e.g. trace replay determinism, stack/heap consistency), and the tooling used.]`

### 8.7 Kiro powers
- `[TODO: list any Kiro powers used (e.g. github-cli, playwright, browser automation) and how they contributed.]`

### 8.8 Representative prompts (optional but recommended)
- `[TODO: paste 2–4 representative prompts that best show how Kiro produced meaningful parts of the project.]`

---

## 9. Judging-Criteria Alignment

| Criterion | How CodeTrace aligns |
|-----------|---------------------|
| **Potential Value** | Expands equitable access to CS education as a free, browser-based, low-install tool (civic services). Turns debugging into guided, self-verifying practice, delivering scarce individualized feedback at scale. A language-independent trace format and three language branches (Python, C, Java) widen reach, and the quiz/tutor works with no API key. |
| **Implementation** | Real, non-mock execution across branches: a React + TypeScript (Vite) + Monaco frontend; a Rust (axum/tokio) server for serving the app and running traces; a Python tracer built on OnlinePythonTutor's `pg_logger`; and, in the Java branch, a JDK 21 compiler + JVM/JDI recording worker. The Python branch's `check:questions` verifies 42/43 programs answer from the bank; the Java branch's `npm test` runs 62 integration checks against real JVM runs. |
| **Quality & Design** | Deliberate honesty: questions only ask what the recorded run supports, suggested fixes are grounded in the program's actual values, and (Java) repairs and AI-suggested tests are verified against the JVM. Readable memory views with routed, color-coded pointer arrows and change highlighting; frame-aware debugging with step-back and replay; resizable panels; and clearly documented runtime/sandbox limits show mature scoping. |

### Definition of done (prototype)
- Executes real code (native Python tracing; real JVM for Java); any frontend mock mode is clearly separate from runnable mode.
- Displays frames, locals, arrays/collections, and shared object references with pointer arrows.
- Replays recorded steps (both directions in Java) and, in Java, preserves source revision across replays.
- Handles multiple source files (Java) and captures compiler diagnostics (Java).
- Offers stdin and stdout/stderr.
- Preserves partial traces on limits and labels them.
- Generates at least one question from the learner's observed execution.
- Re-runs edited code against explicit checks before reporting success (Java).
- Documents unsupported language/runtime features and deployment limits.

---

## 10. Eligibility & IP Acknowledgement

- The team acknowledges and agrees to the Hackachusetts eligibility rules and intellectual-property terms as stated in the official hackathon rules.
- The submission is the team's own work; third-party components are used under their respective licenses — e.g. the **Monaco editor**, the **JDK**, and OnlinePythonTutor's `pg_logger.py` / `pg_encoder.py` (MIT, via the seamile/PyTutor mirror, patched for Python 3.12+).
- Any external references (e.g. Python Tutor) are cited for positioning only and are not claimed as the team's work.
- `[TODO: confirm each team member has read and accepted the official rules, eligibility, and IP/consent terms before submitting.]`

---

*Reference documentation: `README.md` on each branch, and `docs/PROTOCOL.md` on the Java branch.*
