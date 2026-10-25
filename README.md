# TraceLab

TraceLab is a Java, C and Python IDE in the browser with a recording debugger and a built-in tutor. It lets you move forward and back through recorded stack and heap states, answer questions or reveal hints about your run, and check fixes against tests. Java runs on a real JVM; C uses a teaching interpreter; Python uses Python Tutor's tracer.

The site has two parts:

- **http://127.0.0.1:4317/** — the product site: features, how it works, an example gallery and FAQ.
- **http://127.0.0.1:4317/app/** — the IDE. `/app/?demo=<id>` opens a specific example.

**Security boundary.** The Rust runner binds to `127.0.0.1:4317` and runs programs under your OS account, with your normal file and network access. It is not a multi-user sandbox; see [Deployment boundary](#deployment-boundary). The IDE states this in **About TraceLab** and on the landing page FAQ.

## Run it

Requirements: **Node.js 24+, Rust stable, and a full JDK 21+**. Install **Python 3.10+** to run Python projects and the full test suite; no pip packages are needed. On Windows, Rust requires the MSVC C++ build tools. A JRE alone is insufficient.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. For frontend hot reload, run `npm run dev` and open **http://127.0.0.1:5173** (Vite forwards `/api` to the runner on 4317).

This workspace has a local Rust toolchain under `.tools/`; the launch scripts use it automatically. JDK discovery checks `TRACELAB_JAVA_HOME`, `JAVA_HOME`, JDKs bundled with the VS Code Java extension, then `javac` on PATH. Student code is always compiled with `--release 21`.

Python discovery checks `TRACELAB_PYTHON` (an interpreter executable), then `python`/`python3` on PATH. `/api/health` reports availability for each language. C needs no separate C compiler at runtime.

**Java language server (optional, recommended).** Full editor features come from Eclipse JDT LS. TraceLab uses `TRACELAB_JDTLS_HOME`, a copy in `.tools/jdtls`, or the one inside the VS Code Java extension (`redhat.java`). Without either, run `npm run setup:jdtls` (downloads JDT LS 1.63.0, about 50 MB, and checks its SHA-256). The status bar shows **Java: ready** when it is running; without it the editor falls back to snippets and keyword completion. Set `TRACELAB_LANGUAGE_SERVER=off` to disable it. It starts in 5–20 s and uses up to 1 GB of memory.

## Languages

Choose a language in **New project**, import a `.c` or `.py` file, or open an example from the gallery's language filters. All languages use the existing editor, project library, debugger, themes, input/output panel, output tests, import/export and share links.

| Language | Execution and teaching support | Scope |
| --- | --- | --- |
| Java | JDK 21/JDI, trace-grounded questions, checked compiler fixes, JDT LS, method tests, generated tests and practice | Multiple files and packages; all existing Java features retained |
| C | Rust interpreter from `C_ver`, stack/heap snapshots, classified errors and progressive tutor hints | One `.c` file; teaching subset with functions, loops, arrays, pointers, structs and supported built-ins; not a complete C compiler |
| Python | `pg_logger`/`pg_encoder` and the quiz/repair rules from `python` | One `.py` file, Python 3.10+, standard-library import allowlist inherited from the tracer |

Python `input()` echoes supplied lines into the recorded output, matching the source branch; include those lines in expected-output tests. Missing input produces an explanation to add more input and rerun. C and Python support output tests; Java-specific language-server tools, method tests, generated tests, recording start points and practice remain available in Java projects.

See [integration notes](docs/INTEGRATION.md) for source commits, file mappings and remaining engine limitations. The separate `python-version` branch is not used.

## Examples

The gallery (landing page, **Examples** view in the IDE, or **⋯ → Browse examples**) includes the 21 Java programs below plus C and Python examples. Every buggy Java example has tests that fail until it is fixed, and the Tutor offers an explain question and a repair question grounded in the recorded run. `npm test` checks that each buggy Java example fails a test, that applying the Tutor's correct repair makes every test pass, and that each concept tour passes; it also checks the C tutor and Python question bank.

| Category | Examples |
| --- | --- |
| Runtime errors | Array index past the end (`<=` loop), a list field never created, `Map.get` returning null, dividing by a zero count, `charAt(length() - i)`, `Integer.parseInt("4.50")`, removing from a list inside for-each |
| Wrong output | `==` on strings, integer division into a double, a swap method that changes copies, sorting an array “copy” that is an alias |
| Never finishes | A loop whose condition never changes, recursion without a base case |
| Compile errors | Storing a double in an int |
| Concept tours | Aliasing, recursion, `ArrayList`, a linked chain of nodes, a binary search tree, breadth-first search, depth-first search |

## Your own projects

- **Projects:** create as many as you like with **New project** in the top bar, the **+** in the activity bar, the project switcher, **⋯ → New project**, or the **My projects** view. Rename, duplicate, export or delete them in **My projects**. Everything is saved in the browser as you type (`/app/?new` opens the new-project dialog).
- **Files (Java):** **+** (new file) and **upload** (add files from your computer) sit at the right of the editor tabs and in the Explorer header. Both work in examples too. C and Python projects each hold one source file.
- **Start from:** a template (blank program, reads input, class + Main, packages), pasted code, or files. Pasted code with several public classes is split into one file per class.
- **Import:** choose or drop `.java` files, a Java folder/zip, one `.c` or `.py` file, or a TraceLab `.zip`/`.json` export. Java files are placed by their `package` declaration and public class name, not by the folder they came from, so `src/main/java/com/x/App.java` becomes `com/x/App.java`. The class with a `main` method becomes the main class (preferring one named `Main`). Dropping Java files onto a Java project's Explorer adds them to that project; importing C/Python creates a new project and keeps a valid source filename.
- **Explorer:** packages show as folders, the main class has a ▶ badge, and any class with `main` can be made the entry point. If a file's path doesn't match its package or class name, the Explorer and editor show a warning with a one-click **Move**, because TraceLab only records classes whose paths match. Rename/move can also update the class name and package declaration.
- **Examples are templates:** edits to an example are kept with that example, never mixed into your projects. **Save as my project** copies it into your projects and resets the example.
- **Reset:** the **Reset** button in the top bar (also **⋯ → Reset to the starting code**) appears once you change something. For an example it restores the original; for a project it restores the code, input and tests from when you created it (projects created before this feature have no starting copy).
- **Export:** a zip with `src/…` and `tracelab.json` (name, main class, input and tests), which imports back with its tests, or a single TraceLab `.json` file.

## Writing tests

- **Program output:** standard input plus the exact expected output (trailing whitespace and line endings ignored).
- **Method call:** a class, a Java expression such as `sum(new int[]{1, 2})` or `new Counter().next()`, and an expected value: `3`, `"text"` (quotes optional), `[1, 2]`, `true`, `null`, or `throws ArithmeticException`. A bare call is prefixed with its class when that class declares the method. Decimals match to about nine significant digits. TraceLab generates a `TraceLabCall__` class in the target's package to evaluate the call, so package-private methods are reachable; it is not added to your project.
- Edit tests in a form (**Tests → Edit** or **Add test**). After a run, **Save this run's output as a test** pre-fills a test, with a reminder to check that the output is actually correct. A failing test can be recorded and stepped through with **Debug this test**.
- **Method calls can be statements too:** a call is an expression (`sum(xs)`, `new Counter().next()`), statements ending in the value to check (`Counter c = new Counter(); c.add(2); c.value()`), or statements ending in `;`, which checks what they print without the final line break (`Shapes.square(2);` expects `"**\n**"`). Blocks and loops aren't allowed; array initializers are.
- **Generate:** the sampler tries sample arguments on every public or package-private method that takes numbers, booleans, `char`, `String`, arrays (`int[]`, `int[][]`, `String[]`, …) or `List<Integer|String|Double>`: static methods directly, instance methods on an object it can build (a no-argument constructor, a constructor or record whose parameters it has samples for), and `void` methods by what they print. A `void` method that prints nothing is listed as skipped, since its effect is on the object. Calls are spread across methods (2 to 5 each, 40 in all), plus one output test for the current input. All calls run in one plain JVM; a call that never returns is reported after 3 s and the method's other samples are skipped. These are *characterization* tests: they record what the code does now, so a bug becomes the expected answer unless you change it.
- **Ask the AI** (in Generate, when the assistant is set up) covers what the sampler can't: it reads the code and suggests tests with the expected value the code *should* produce, including stateful and `void` methods (as statements), edge cases, invalid input, and output tests with inputs for programs that read standard input. Your code is sent to the configured model only when you press the button. TraceLab runs every suggestion on the JVM and shows it next to what your code does: matching ones are pre-selected; a disagreement means either a bug or a wrong guess, so it starts unselected with **Expect what the code returns** one click away. Unreadable, truncated or unknown-class suggestions are dropped, and a reply that isn't JSON is asked for again once.
- **Where a test came from** is kept with it: tests that came with a template are **starter** tests, generated ones record what the code returned, and **AI** tests are the assistant's expectations. When one fails, the Tests card and the Tutor say who might be wrong (a starter test may describe the template's program, not yours) instead of assuming the code is. Editing a test makes it yours. A new blank project starts with no tests.
- **Speed:** **Run tests** uses a plain JVM without recording, and evaluates all method tests that share a package and input in one JVM, so a dozen method tests take about as long as one program run. **Debug this test** records the failing case.

## Compile errors

When javac rejects the program, the Tutor explains each error in plain language and suggests concrete fixes. TraceLab compiles every suggested fix in the background and labels it **Compiles**, **Clears this error · N others left**, or **Doesn't clear this error**. **Apply** edits the code (Ctrl+Z undoes it) and runs again; the same fixes are available as quick fixes on the red underline (Ctrl+.). In examples, the fixes stay folded until the Tutor's question about the error is answered.

Covered: missing `;` `)` `}` or closing quote, misspelled variables, methods and classes (edit distance), missing imports for common JDK classes, `length` vs `length()` vs `size()`, `String`↔number conversions (`Integer.parseInt`, `nextInt`, `String.valueOf`), lossy conversions, missing `return`, uninitialized locals, non-static access from `main`, unreported checked exceptions (`throws`), duplicate declarations, unreachable code, `if (…);` before `else`, `'a'` vs `"a"`, assigning to `final`, constructor typos, `==` used as a statement, returning a value from `void`, and file/class name mismatches (rename or move). Other errors get an explanation without an automatic fix. Fixes are suggestions for the student to accept; when an error has several causes, the explanation says so.

## Editor

With the language server running, the editor has completions that know types and members (choosing one adds its import), parameter hints, hovers, go to definition (F12), find references (Shift+F12), rename across files (F2), refactorings such as extract variable or method (Ctrl+Shift+R), quick fixes (Ctrl+.), organize imports (Shift+Alt+O), formatting (Shift+Alt+F), parameter-name hints for literal arguments, and errors and warnings as you type. Warnings are tuned for beginner bugs that still compile (an `if (…);`, `x = x`, `a == a`, using a variable that can only be null, a missing `break`, `equals` between unrelated types, an unused value), and the Problems tab and hovers explain each one in plain words.

Spelling is checked in comments, strings and the parts of names (`totalAmout` → “Amout”), skipping programming words and JDK names. Ctrl+. suggests a correction or adds the word to your dictionary (kept in this browser). **⋯ → Editor settings** turns spelling and parameter hints on or off.

The language server reads a copy of the open project in `.local/lsp/project` and serves one project at a time (the most recently active tab).

## Need help and practice

- **When nothing went wrong, the Tutor says so.** A run that finishes without errors gets a verdict instead of a bug hunt: "No problems found" when all tests pass; otherwise "No errors in this run" plus what's missing to judge it (no tests yet, with **Save this output as a test**, **Generate tests** and **Write a test**; or tests not run since the last edit). Questions on such a run are labelled as checks of how the program works, not signs of a bug. A failing starter test is reported as possibly out of date, with **Remove it**.
- **Need help?** appears only when something actually went wrong: the run threw, hung or stopped, a test of yours fails, or the Tutor found a likely bug (a repair question). It tells the story of the run from the recording: what stopped it and what the exception means, then shows a table of the variables on the failing line at every step (with the loop pass and changed values highlighted; click a row to jump there), which cells of an array, list or String were read (out-of-range reads marked), the recursive calls with their arguments and results, and expected vs. printed output for a failing test.
- **Practice this** makes a small problem on the same concept (array bounds, String indexes, loop counts, integer division, division by zero, `==` vs `equals`, pass-by-value, aliasing, recursion, null, parsing, removing while looping, types, scope, object state, return values, breadth-first and depth-first search, binary search trees, binary search, and sorting passes). Built-in problems are deterministic: a seeded generator picks the values and writes the program and the wrong answers (common misconceptions, such as the depth-first order for a breadth-first question). The correct answer is never computed by TraceLab: it runs the program on the JVM, and the answer is what Java printed or threw. **Open as a project** lets you trace it.
- **AI-written problems** are used only when the assistant is set up: for a concept with no built-in generator (such as an exception type TraceLab has no problems for), or when you choose **Ask AI for a different one**. The model writes the program and wrong answers as JSON; its answer is never used. TraceLab checks the program against an allowlist (only `java.util`, `java.math`, `java.time` and `java.text`; no files, network, processes, reflection, threads, input or randomness), runs it on the JVM for the real answer, drops any "wrong" answer that turns out to be right, and asks again (up to three times) if the program doesn't compile or finish. These cards are labelled **Written by AI · answer checked on the JVM**. The runner is not a sandbox, so the allowlist is the only guard on AI-written code.
- Every uncaught exception gets an explain question, including list indexes, `InputMismatchException`, `NoSuchElementException`, `ClassCastException`, `UnsupportedOperationException` and `StackOverflowError`.

## AI assistant (optional)

**Ask** in the Tutor opens a chat about the current program. It sees the code (with line numbers), the recorded run (output, exception, the current step's values, the value table from Need help), the open Tutor question without its answer, test results and editor problems. It is told to rely on recorded values, to say when the recording doesn't show something, and to give hints before solutions. Answers stream in and are labelled as AI answers that can be wrong. Need help, compile errors without an automatic fix, and practice problems link to it.

TraceLab doesn't include a model. Choose one in the setup dialog; anything with an OpenAI-compatible `/chat/completions` endpoint works:

| Option | Cost and privacy |
| --- | --- |
| [Ollama](https://ollama.com) on this computer (`http://127.0.0.1:11434/v1`) | Free, private, no key. `ollama pull qwen2.5-coder:7b` (about 4.7 GB); a 3B model is faster on a laptop CPU. |
| Google Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`) | Free tier with a key from Google AI Studio; code is sent to Google, and free-tier prompts may be used to improve its products. |
| Groq (`https://api.groq.com/openai/v1`, model `openai/gpt-oss-120b`) | Free tier of about 30 requests a minute, 1,000 a day and 8,000 tokens a minute; code is sent to Groq. |
| OpenRouter, LM Studio, others | Free tiers or local servers; use **List models** to pick one. |

A Kiro subscription can't be used here: its API keys only authenticate the Kiro CLI, need a paid plan, and its terms don't cover routing requests from other apps. The runner relays requests through a small Java helper (so the Rust server needs no TLS stack) and keeps the configuration, including the key, in `.local/ai.json` on this computer. The key is never sent back to the browser. Plain `http://` is accepted only for servers on this computer.

## The learning loop

1. Open **The extra iteration** and press **Run** (Ctrl+Enter). The JVM throws `ArrayIndexOutOfBoundsException` in `ArraySum.java`.
2. The debugger opens at the exception: `i` is 3 and `values` points to a length-3 array. Hover a reference to isolate its arrow.
3. Answer **Explain** (valid indices are 0 through 2), then **Fix**, which quotes line 6 from the recorded source.
4. Use **Edit ArraySum.java, line 6**, change `<=` to `<`, and press **Run tests**. Four fresh JVM runs check the normal, empty, single-element and negative cases.
5. Run again to see the fixed trace. The history button switches between this run and the previous one.

## Features

- **IDE:** Monaco editor (with its find, command palette, hovers and quick fixes), semantic Java features through Eclipse JDT LS (see [Editor](#editor)), spelling, a project library, multiple files and packages with a package-tree Explorer, rename/move/delete, compiler diagnostics with explanations and checked fixes in the editor and Problems panel, snippets such as `sout`/`fori`, keyboard shortcuts, light/dark/system themes, resizable editor/debugger and bottom-panel splits, collapsible sidebar and Tutor, autosave, import/export, share links (the project travels in the URL fragment, which is not sent to the server), and trace export.
- **Debugger:** real JDK 21 compilation and JDI capture; frames with stable activation IDs, parameters, return values, statics and exceptions; stack and heap columns with reference arrows; renderers for arrays (including 2D and `char[]`), strings, boxed values, records and enums (as objects), `ArrayList`, `LinkedList`, `ArrayDeque`, `PriorityQueue`, `Stack`/`Vector`, `HashMap`/`LinkedHashMap`/`TreeMap`, `HashSet`/`LinkedHashSet`/`TreeSet`, `List.of`/`Set.of`/`Map.of`, `Arrays.asList`, `Collections.unmodifiable…`/`empty…`/`singleton…`, `subList`, `EnumMap`/`EnumSet`, map `keySet()`/`values()`/`entrySet()` views and entries, iterators (what `next()` returns), `Optional`, `BitSet`, `StringBuilder`, atomics, `BigInteger`/`BigDecimal`, `UUID`, JDK enum constants and `java.time` values (as their text); pictures of data structures above the stack and heap, laid out to grow sideways and scroll, each foldable and with a larger view (Esc closes it): a **call tree** for recursive methods (each call with its arguments and result, growing as you step), **graphs** for adjacency lists, adjacency matrices, edge lists, `Map<K, List<K>>` and node objects with neighbor lists (columns by distance from the start; visited, queued and current nodes colored from the recorded `visited`/`dist`/`parent` arrays or sets and the queue or stack, and the path of recursive calls), **grids** for 2D arrays (row and column markers for `grid[r][c]`, a `visited[][]` grid shown as colors, walls, queued cells numbered), **trees** for classes with two or more child fields (in order), and **chains** for linked lists; changed/new highlighting; index markers that show where the code is in an array, list, string or 2D array (`values[i]`, `list.get(j)`, `word.charAt(word.length() - 1 - i)`, `grid[r][c]`, and the current element of a for-each loop), with an out-of-range index drawn as a dashed cell past the end and a hint such as `→ values[2] = 2` next to the index variable; a “Changes” strip narrating each step; step into/back, frame-aware **Over**, **Out** and **Back** (F10, Shift+F11, Shift+F10); scrubber, autoplay, filter and replay bookmarks.
- **Tutor:** predict/explain/fix questions for array and string bounds, null fields and `Map.get` misses, division by zero, `NumberFormatException`, `ConcurrentModificationException`, non-terminating loops, runaway recursion, string identity, integer division, pass-by-value, aliasing (objects and arrays), return values, state changes and compiler errors (lossy conversion, missing symbols), and algorithms: which value `poll()`/`remove()`/`pop()` returns next (checked against the next step), how many calls a recursion makes, which call returns first, and which call starts next in a depth-first search. A question is shown only when the recorded run supports its premise. Repair questions highlight the line and jump to it for editing. Tests run in fresh JVMs; a failing test can be debugged directly; concepts practiced are tallied per browser.
- **Runner:** step/time/output/trace limits, cancellation, one job at a time, incremental polling, job cleanup, and host/origin checks. See below for language-specific trace retention.

## Semantics and limits

**Java and Python line steps are recorded before their source line executes; C records after each statement.** The debugger labels the phase accordingly. A source line is not necessarily an expression-level step. **Replay is recorded state, not reverse execution:** the program runs to completion or a limit first. Gutter bookmarks navigate the recording; they are not live breakpoints. Editing code pauses line highlights until you open the recorded source.

Output is read asynchronously, so a chunk may appear one step early or late; the console labels it “output received by this step.”

Java defaults: 500 steps (configurable 10–2,000), 15 s execution, 96 MiB heap, 32,768 output characters, 40 MiB trace, 48 frames, 160 objects, 32 locals per frame, 64 elements per array or collection, 24 fields per object, 48 traversal levels and 64 returns between two steps. The runner keeps the latest eight runs; the browser keeps the current and previous run. Java capture costs about 3–4 ms per step for a heap of 60–70 objects.

C and Python also accept 10–2,000 steps and execution timeouts up to 15 s. Python projects default to 1,000 steps. Java's JVM heap limit does not apply to either engine. C retains recorded states when a runtime error or execution limit stops it. Python returns its trace when the worker finishes: a step-limit result retains its recorded states, but forcibly stopping Python for a wall-clock timeout, cancellation or oversized response loses that run's buffered trace.

**Recording from a later point.** For a long program, right-click a line and choose **Start recording here** (or **Start recording here when…**, or Project settings → Recording start). The program runs at nearly full speed with only that line watched, then recording starts the first time (or the n-th time) the line is about to run with an optional condition true, such as `i == 50 && total > 100`. Conditions can use variables on that line, fields, array elements, `.length`, `.size()`, `.isEmpty()`, numbers, chars, strings (compared by text), `true`/`false`/`null`, arithmetic, comparisons, `!`, `&&` and `||`; they only read values. A line without code moves to the next line with code in the same method. Frames already running when recording starts are shown with all their values. If the line never runs or the condition is never true, the debugger says which, and how many times the line did run. The start point follows its line as you edit and is saved with the project.

The Java tracer never calls student methods such as `toString()` to display objects. Library internals are hidden except for the renderers above. Multi-threaded programs are not supported. Not yet included: Maven/Gradle dependencies, live breakpoints, expression stepping, test types beyond program output and method calls, collaboration, additional languages, and a production sandbox. The Tutor, Need help, practice, compile help and the editor are deterministic and need no API key; only the optional assistant uses a model.

## Tests

```sh
npm test
```

Builds the worker and runner, runs the Rust unit tests, then runs integration checks against Java, C and Python programs over HTTP: tracing semantics, collections, frame identity, limits, cancellation, API rejection, every gallery example and its repair, share links, source analysis, import/zip round trips, the project library, method-call tests (values, arrays, collections, exceptions, void and instance-method errors), every new-project template, plain-run and compile-only modes, index markers, compile help (each suggested fix for 28 javac errors must compile), test generation, spelling and warning explanations, the Java language server (completion, live problems, quick fixes, rename across files; skipped when none is installed), Need help visualizations, explain questions for other exception types, practice problems for every concept and variant, the AI assistant, AI-written practice and AI-suggested tests against a mock server, starter-test and clean-run explanations, tests for objects, statements and printed output, the new collection and JDK views, recording start points, larger captures, graph/call-tree/grid/chain views, algorithm questions, Reset, and the website/IDE/404 routes. C checks cover pointers, structs, input, errors, hints and execution limits. Python checks cover trace conversion, input, errors, import restrictions, the original question-bank cases and executable repairs. Cross-language checks cover project validation, import/export and sharing. These checks use the API and local modules, without a browser. Port 4317 must be free.

## Structure

```text
web/index.html, landing.ts, landing.css   Product site
web/app/index.html, main.ts, style.css    IDE
web/tokens.css, theme.ts, gallery.ts      Shared design tokens, theme and example cards
web/learning.ts, narrate.ts, ...          Tutor questions, step narration, arrows, sharing, layout
web/library.ts                            Browser project library and example edits
web/javasource.ts, importer.ts, zip.ts    Java source analysis, imports/exports, dependency-free zip
web/tests.ts, testgen.ts, templates.ts    Output and method-call tests, test generation, new-project templates
web/compilehelp.ts                        javac error explanations and fixes
web/languages.ts, ctutor.ts                Language metadata and C tutor hints
web/pyquiz/                               Python question bank, repair rules and trace adapter
web/cursors.ts                            Index markers for arrays, lists, strings and for-each loops
web/help.ts, exceptions.ts, practice.ts    Need help views, exception guide, JVM-checked practice problems
web/structures.ts                         Call trees, graphs, grids, trees and linked-list chains
web/startat.ts                            Recording start points: condition check, line tracking
web/lsp.ts, lspmonaco.ts                  Language-server client and its Monaco editor features
web/linthelp.ts, spell.ts, spell.worker.ts  Warning explanations and spelling
web/assistant.ts                          AI assistant context, prompt and answer rendering
web/examples.ts                           Example projects and gallery metadata
web/public/screenshots/                   Product screenshots used by the site
server/main.rs                            Rust HTTP API, job supervision, limits, static files
server/lsp.rs, assist.rs                  Eclipse JDT LS bridge; optional AI assistant relay
server/c/                                C interpreter and TraceLab event adapter
server/python.rs                         Python worker supervision and TraceLab event adapter
worker/TraceWorker.java                   Java compiler + JDI adapter, emits NDJSON
worker/python/                           Python Tutor tracer, encoding and worker wrapper
worker/AssistProxy.java                   HTTPS relay for the assistant
scripts/                                  Tool discovery, build, launch and integration tests
docs/PROTOCOL.md                          Execution API and trace contract
docs/INTEGRATION.md                       Language branch provenance and integration scope
HACKATHON_PLAN.md                         Research, Python Tutor comparison, roadmap and demo script
```

## Deployment boundary

The site and IDE in `dist/` are static files, but running code needs the Rust/JVM runner, which a static host or ordinary edge worker cannot provide. Before accepting untrusted users, add per-job OS/container isolation for compilation and execution, unprivileged identities, filesystem isolation, outbound-network restrictions, CPU/memory/process quotas, authentication and rate limits. JVM heap limits and deadlines do not protect the host. Do not expose this local API or a JDWP port publicly.
