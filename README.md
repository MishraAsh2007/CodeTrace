# TraceLab

TraceLab is a Java IDE in the browser with a recording debugger and a built-in tutor. It runs your program on a real JVM, records every step, and lets you move forward and back through the call stack and heap. The Tutor asks questions drawn from your own run, then checks your fix against tests.

The site has two parts:

- **http://127.0.0.1:4317/** — the product site: features, how it works, an example gallery and FAQ.
- **http://127.0.0.1:4317/app/** — the IDE. `/app/?demo=<id>` opens a specific example.

**Security boundary.** The Rust runner binds to `127.0.0.1:4317` and runs programs under your OS account, with your normal file and network access. It is not a multi-user sandbox; see [Deployment boundary](#deployment-boundary). The IDE states this in **About TraceLab** and on the landing page FAQ.

## Run it

Requirements: **Node.js 24+, Rust stable, and a full JDK 21+**. On Windows, Rust requires the MSVC C++ build tools. A JRE alone is insufficient.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. For frontend hot reload, run `npm run dev` and open **http://127.0.0.1:5173** (Vite forwards `/api` to the runner on 4317).

This workspace has a local Rust toolchain under `.tools/`; the launch scripts use it automatically. JDK discovery checks `TRACELAB_JAVA_HOME`, `JAVA_HOME`, JDKs bundled with the VS Code Java extension, then `javac` on PATH. Student code is always compiled with `--release 21`.

## Examples

The gallery (landing page, **Examples** view in the IDE, or **⋯ → Browse examples**) has 18 programs. Every buggy example has tests that fail until it is fixed, and the Tutor offers an explain question and a repair question grounded in the recorded run. `npm test` checks that each buggy example fails a test, that applying the Tutor's correct repair makes every test pass, and that each concept tour passes.

| Category | Examples |
| --- | --- |
| Runtime errors | Array index past the end (`<=` loop), a list field never created, `Map.get` returning null, dividing by a zero count, `charAt(length() - i)`, `Integer.parseInt("4.50")`, removing from a list inside for-each |
| Wrong output | `==` on strings, integer division into a double, a swap method that changes copies, sorting an array “copy” that is an alias |
| Never finishes | A loop whose condition never changes, recursion without a base case |
| Compile errors | Storing a double in an int |
| Concept tours | Aliasing, recursion, `ArrayList`, a linked chain of nodes |

## Your own projects

- **Projects:** create as many as you like from **⋯ → New project**, the project switcher in the top bar, or the **My projects** view. Rename, duplicate, export or delete them there. Everything is saved in the browser as you type (`/app/?new` opens the new-project dialog).
- **Start from:** a template (blank program, reads input, class + Main, packages), pasted code, or files. Pasted code with several public classes is split into one file per class.
- **Import:** choose or drop `.java` files, a folder, a `.zip`, or a TraceLab `.json` export. Files are placed by their `package` declaration and public class name, not by the folder they came from, so `src/main/java/com/x/App.java` becomes `com/x/App.java`. The class with a `main` method becomes the main class (preferring one named `Main`). Dropping files onto the Explorer adds them to the open project; dropping anywhere else creates a new one.
- **Explorer:** packages show as folders, the main class has a ▶ badge, and any class with `main` can be made the entry point. If a file's path doesn't match its package or class name, the Explorer and editor show a warning with a one-click **Move**, because TraceLab only records classes whose paths match. Rename/move can also update the class name and package declaration.
- **Examples are templates:** edits to an example are kept with that example, never mixed into your projects. **Save as my project** copies it into your projects and resets the example; **Reset** discards the changes.
- **Export:** a zip with `src/…` and `tracelab.json` (name, main class, input and tests), which imports back with its tests, or a single TraceLab `.json` file.

## Writing tests

- **Program output:** standard input plus the exact expected output (trailing whitespace and line endings ignored).
- **Method call:** a class, a Java expression such as `sum(new int[]{1, 2})` or `new Counter().next()`, and an expected value: `3`, `"text"` (quotes optional), `[1, 2]`, `true`, `null`, or `throws ArithmeticException`. A bare call is prefixed with its class when that class declares the method. Decimals match to about nine significant digits. TraceLab generates a `TraceLabCall__` class in the target's package to evaluate the call, so package-private methods are reachable; it is not added to your project.
- Edit tests in a form (**Tests → Edit** or **Add test**). After a run, **Save this run's output as a test** pre-fills a test, with a reminder to check that the output is actually correct. A failing test can be recorded and stepped through with **Debug this test**.

## The learning loop

1. Open **The extra iteration** and press **Run** (Ctrl+Enter). The JVM throws `ArrayIndexOutOfBoundsException` in `ArraySum.java`.
2. The debugger opens at the exception: `i` is 3 and `values` points to a length-3 array. Hover a reference to isolate its arrow.
3. Answer **Explain** (valid indices are 0 through 2), then **Fix**, which quotes line 6 from the recorded source.
4. Use **Edit ArraySum.java, line 6**, change `<=` to `<`, and press **Run tests**. Four fresh JVM runs check the normal, empty, single-element and negative cases.
5. Run again to see the fixed trace. The history button switches between this run and the previous one.

## Features

- **IDE:** Monaco editor, a project library, multiple files and packages with a package-tree Explorer, rename/move/delete, compiler diagnostics in the editor and Problems panel, lightweight completions (snippets such as `sout`/`fori`, keywords, common JDK types, project identifiers; not semantic IntelliSense), keyboard shortcuts, light/dark/system themes, resizable editor/debugger and bottom-panel splits, collapsible sidebar and Tutor, autosave, import/export, share links (the project travels in the URL fragment, which is not sent to the server), and trace export.
- **Debugger:** real JDK 21 compilation and JDI capture; frames with stable activation IDs, parameters, return values, statics and exceptions; stack and heap columns with reference arrows; renderers for arrays, strings, boxed values, `ArrayList`, `LinkedList`, `ArrayDeque`, `PriorityQueue`, `HashMap`/`LinkedHashMap`/`TreeMap`, `HashSet`/`LinkedHashSet`/`TreeSet` and `StringBuilder`; changed/new highlighting; a “Changes” strip narrating each step; step into/back, frame-aware **Over**, **Out** and **Back** (F10, Shift+F11, Shift+F10); scrubber, autoplay, filter and replay bookmarks.
- **Tutor:** predict/explain/fix questions for array and string bounds, null fields and `Map.get` misses, division by zero, `NumberFormatException`, `ConcurrentModificationException`, non-terminating loops, runaway recursion, string identity, integer division, pass-by-value, aliasing (objects and arrays), return values, state changes and compiler errors (lossy conversion, missing symbols). A question is shown only when the recorded run supports its premise. Repair questions highlight the line and jump to it for editing. Tests run in fresh JVMs; a failing test can be debugged directly; concepts practiced are tallied per browser.
- **Runner:** step/time/output/trace limits, partial traces on limits, cancellation, one job at a time, incremental polling, job cleanup, and host/origin checks.

## Semantics and limits

**A step is recorded before its source line executes.** A line with several expressions is not split into expression-level steps. **Replay is recorded state, not reverse execution:** the program runs to completion or a limit first. Gutter bookmarks navigate the recording; they are not live breakpoints. Editing code pauses line highlights until you open the recorded source.

Output is read asynchronously, so a chunk may appear one step early or late; the console labels it “output received by this step.”

Default limits: 500 steps (configurable 10–2,000), 8 s execution, 96 MiB heap, 32,768 output characters, 24 MiB trace, 24 frames, 64 objects, 32 locals per frame, 32 elements per array or collection, 24 fields per object and 12 traversal levels. The runner keeps the latest eight runs; the browser keeps the current and previous run.

TraceLab never calls student methods such as `toString()` to display objects. Library internals are hidden except for the renderers above. Multi-threaded programs are not supported. Not yet included: semantic IntelliSense (Eclipse JDT LS), Maven/Gradle dependencies, live breakpoints, expression stepping, test types other than stdin/stdout, collaboration, other languages, and a production sandbox. The Tutor is deterministic and needs no API key.

## Tests

```sh
npm test
```

Builds the worker and runner, runs the Rust unit tests, then runs 44 integration checks against real JVM programs over HTTP: tracing semantics, collections, frame identity, limits, cancellation, API rejection, every gallery example and its repair, share links, source analysis, import/zip round trips, the project library, method-call tests (values, arrays, collections, exceptions, void and instance-method errors), every new-project template, and the website/IDE/404 routes. Port 4317 must be free.

## Structure

```text
web/index.html, landing.ts, landing.css   Product site
web/app/index.html, main.ts, style.css    IDE
web/tokens.css, theme.ts, gallery.ts      Shared design tokens, theme and example cards
web/learning.ts, narrate.ts, ...          Tutor questions, step narration, arrows, sharing, layout
web/library.ts                            Browser project library and example edits
web/javasource.ts, importer.ts, zip.ts    Java source analysis, imports/exports, dependency-free zip
web/tests.ts, templates.ts                Output and method-call tests; new-project templates
web/examples.ts                           Example projects and gallery metadata
web/public/screenshots/                   Product screenshots used by the site
server/main.rs                            Rust HTTP API, job supervision, limits, static files
worker/TraceWorker.java                   Java compiler + JDI adapter, emits NDJSON
scripts/                                  Tool discovery, build, launch and integration tests
docs/PROTOCOL.md                          Execution API and trace contract
HACKATHON_PLAN.md                         Research, Python Tutor comparison, roadmap and demo script
```

## Deployment boundary

The site and IDE in `dist/` are static files, but running code needs the Rust/JVM runner, which a static host or ordinary edge worker cannot provide. Before accepting untrusted users, add per-job OS/container isolation for compilation and execution, unprivileged identities, filesystem isolation, outbound-network restrictions, CPU/memory/process quotas, authentication and rate limits. JVM heap limits and deadlines do not protect the host. Do not expose this local API or a JDWP port publicly.
