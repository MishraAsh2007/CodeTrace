# TraceLab local execution protocol (v1)

The Rust service listens only on `127.0.0.1:4317`. API calls except health require `X-TraceLab-Client: browser-v1`. This header and strict host/origin checks reduce drive-by browser requests; they are not authentication or an execution sandbox.

## Endpoints

`GET /api/health` returns runner availability and mode.

`POST /api/runs` accepts:

```json
{
  "files": [
    {"name": "Main.java", "content": "public class Main { public static void main(String[] args) { System.out.println(42); } }"}
  ],
  "mainClass": "Main",
  "stdin": "",
  "maxSteps": 500,
  "timeoutMs": 15000,
  "mode": "trace",
  "startAt": {"file": "Main.java", "line": 12, "condition": "i == 25 && total > 100", "hit": 1}
}
```

`startAt` is optional and applies to `trace` mode only (other modes ignore it). `file` must be one of the request's files, `line` is 1–100,000, `hit` (default 1) is 1–1,000,000, and `condition` (default empty) is one line of at most 200 characters. The runner passes it to the worker as `start.txt` in the job directory (file, line, hit and condition on four lines). Until the start point fires, only breakpoints on that line are enabled (method entry/exit and the other line breakpoints are created but stay off), so the program runs at nearly full speed; nothing before it counts against `maxSteps`. It fires the `hit`-th time the line is about to run with the condition true; the frames already on the stack then get fresh activation IDs, and recording continues as usual. A line with no code moves to the next line with code in the same method (or, on a method's signature line, its first statement). An uncaught exception before the start point is recorded where it happens. A condition that can't be parsed ends the run with stop reason `bad-start` before compiling.

Condition grammar: `||`, `&&`, `!`, comparisons (`== != < <= > >=`), `+ - * / %`, unary minus, parentheses, numbers, `'c'`, `"text"`, `true`, `false`, `null`, names, `.field`, `.length` (arrays), `[index]`, and `.size()`, `.isEmpty()`, `.length()` (strings and the collections with views below). Names resolve to the paused frame's locals, then fields of `this`, then static fields of the frame's class, then user class names (for `Main.count`). Strings compare by text and boxed numbers by value. Evaluation reads values only. A name that isn't visible or an index out of range makes the condition false, and the first such problem is reported.

`mode` is optional:

- `trace` (default): compile, then run under JDI and record every step.
- `run`: compile, then run on a plain JVM with the same input, output, heap and time limits, without recording (about twice as fast). The `terminated` event has `recorded: false` and `steps: 0`. An uncaught exception is parsed from the JVM's `Exception in thread …` line into `exception: {type, message, caught: false}` with stop reason `exception`. A program that exceeds the output limit is stopped immediately with stop reason `output-limit`. Used for tests and test generation.
- `compile`: compile only. The run ends with stop reason `compiled` or `compile-error`. Used to check suggested compile fixes.

It returns `{"id":"<opaque run id>"}` immediately. A busy runner returns HTTP 409. Paths are validated relative `.java` paths; entry classes are dot-separated Java identifiers. Requests are limited to 20 files, 64 KiB per file, 256 KiB total source, 16 KiB input and a 512 KiB JSON body.

`GET /api/runs/{id}?since=N` returns `{id,status,request,since,total,events}`. Status is `running` or `finished`. The immutable request is the exact source/input/configuration used for that run. Events are ordered by a monotonically increasing `sequence`; `events` contains only events with `sequence >= since` (default 0), and `total` is the number recorded so far. The browser polls with `since` set to the number of events it already holds, so each event is transferred once. A run is complete when `status` is `finished` and the client holds `total` events.

`DELETE /api/runs/{id}` requests cancellation. The worker observes a cancellation sentinel. The Rust supervisor force-stops the process tree if the worker does not respond promptly. Existing trace events remain readable.

## Trace events

Every event has `schemaVersion: 1`, `runId`, `sequence`, and `kind`.

- `status`: a human-readable progress `message`.
- `diagnostic`: `severity`, relative `file`, one-based `line`/`column`, and compiler `message`.
- `line`: `location: {file,line,phase:"before"}`, `threadId`, `frames`, `statics`, `heap`, capture truncation flags, and optional `returns`.
- `returns` (on `line`/`exception`): user methods that completed normally since the previous stop, oldest first: `{method, frameId, value}` or `{method, frameId, void: true}`. `frameId` matches the activation's frame `id`. Constructors and static initializers are omitted; methods exited by an exception produce no entry (JDWP does not report those exits).
- `exception`: the same captured state, plus `exception: {type,message,caught}`. For a library exception, location is the nearest user-source frame; do not present it as the exact internal library throw location.
- `output`: `stream` (`stdout` or `stderr`) and a text chunk. Receipt order is preserved, not exact source-line synchronization.
- `terminated`: `stopReason`, `message`, and, when available, `steps`, `exitCode`, `outputTruncated`, `recorded` (false in `run` mode), `exception` (`run` mode only) and `start` (when the request had `startAt`): `{reached, file, line, message?}`. `line` is the line where recording started (after moving off a line without code); when `reached` is false, `message` says why: the file's classes never loaded, the line has no code, the line never ran, or it ran N times without the condition being true (with the first evaluation problem, such as a name that isn't visible).

Stop reasons: `completed`, `compile-error`, `exception`, `runtime-error`, `step-limit`, `timeout`, `cancelled`, `unsupported-concurrency`, `trace-limit`, `worker-error`, `bad-start`, and, outside `trace` mode, `output-limit` (`run`) and `compiled` (`compile`).

Frames contain `id`, `method`, source `file`/`line`, typed `locals` (parameters carry `argument: true`), and an optional `truncated` flag. IDs are derived from method entry/exit activation tracking; after a caught exception unwinds frames, the worker realigns its activation stack with the real user frames at the next stop, so surviving frames keep their IDs. Objects use JDI identity, scoped to the run, so two references to the same object point to the same heap node. Objects are not pinned alive across stops (returned objects are pinned only until the next stop describes them). Trace data does not invoke methods on target objects. Exceptions that are thrown and caught entirely inside library code are not recorded.

Values are tagged:

```json
{"kind":"primitive","type":"int","value":"42"}
{"kind":"null","value":"null"}
{"kind":"reference","type":"int[]","ref":"o453"}
```

A reference with `omitted: true` was not traversed because of a capture budget. Objects have `id`, `type`, `kind`, and `elements`, `entries`, `fields`, `text`, or an explanatory `message`. Budgets per step: 48 frames, 32 locals per frame, 160 objects, 48 traversal levels, 64 elements or entries per collection, 24 fields per object, 32 statics, 64 pending returns, 512 characters of text; the runner stops a trace at 40 MiB. Capture kinds:

- `array`, `list` (`ArrayList`, `LinkedList`, `ArrayDeque` head→tail, `PriorityQueue` in internal heap order, `Stack`/`Vector`, `Arrays.asList`, `List.of`, `subList`, `Collections.emptyList`/`singletonList`, a map's `values()`) and `set` (`HashSet`, `LinkedHashSet`, `TreeSet`, `Set.of`, `EnumSet`, a map's `keySet()`, and `BitSet` as the indexes of its set bits): `length` plus up to 64 `elements`.
- Primitive arrays travel in a compact form: `elementType` (such as `int`) and `values` (the elements as text) instead of `elements`. Clients expand them into `{kind: "primitive", type, value}` elements on receipt (`expandEvents` in `web/learning.ts`).
- `map` (`HashMap`, `LinkedHashMap` in insertion order, `TreeMap` in key order, `Map.of`, `EnumMap`, a map's `entrySet()`): `length` plus up to 64 `entries: [{key, value}]`. A single `Map.Entry` (from iterating `entrySet()`) is a `map` with one entry and no `length`.
- `string`: `java.lang.String`, plus `StringBuilder`/`StringBuffer` decoded from their internal buffer (`length` is the logical length).
- `value`: an immutable library value shown as `text`: `java.time` types (`LocalDate`, `LocalTime`, `LocalDateTime`, `Instant`, `Duration`, `Period`, `YearMonth`, `Year`, `ZonedDateTime`, `OffsetDateTime`, zones) as their `toString()`, `AtomicInteger`/`AtomicLong`/`AtomicBoolean`, `BigInteger`, `BigDecimal`, `UUID`, `OptionalInt`/`OptionalLong`/`OptionalDouble`, and constants of JDK enums by name. The text is rebuilt from fields with the worker's own JDK classes, not by calling methods on the target.
- `object` (user classes and boxed primitives), `opaque` (other library types), and `unavailable`. Iterators of `ArrayList`, `LinkedList`, `ArrayDeque`, `HashMap`, `LinkedHashMap` and `TreeMap` are `object`s with synthetic fields `iterator.over` (the collection), `iterator.next` (what `next()` returns, if anything) and, for lists, `iterator.nextIndex`. `Optional` is an `object` with one `java.util.Optional.value` field, or none and a message when empty.

Collection views are read from JDK fields, never by calling `size()`, `iterator()` or `toString()`. If a JDK's internal layout differs from what the worker expects, the object falls back to `opaque` instead of failing the trace.

## Method-call tests

The runner has no special endpoint for these. The browser adds a generated `TraceLabCall__.java` to the request's files, in the target class's package, and sets `mainClass` to it. Its `main` evaluates the test's expression, catches any `Throwable`, and prints one line prefixed by U+001E and `TRACELAB_RESULT `: `value <formatted value>` or `throws <exception class>`. Strings and chars are printed as literals, arrays and collections element by element; other objects use `String.valueOf`, so this is the one place student `toString()` methods can run. The harness file is excluded when comparing a run with the project's source. Requests still count against the 20-file limit.

A call is split at top-level semicolons (outside strings, chars and brackets). One piece is an expression and is evaluated as is. Statements followed by an expression run inside a lambda, `((Thunk__) () -> { statements; return expression; }).get()`. Statements ending in `;` run inside `printed__`, which swaps `System.out` for a buffer while they run and returns what they printed, with `\r\n` turned into `\n` and trailing whitespace removed, as a `String` value. A leading bare call in each statement is qualified with the target class.

Checks may carry `origin`: `template` (came with a new-project template), `generated` (recorded what the code returned when generated) or `ai` (an expected value suggested by the assistant). It only changes how a failure is explained. Projects saved before origins existed are recognized by the name and expected output of the old template tests.

**Run tests** and test generation use a batch form of the harness in `run` mode: `main` evaluates many expressions in turn, each as `run(<id>, () -> <expression or block>)` on its own source line, and prints `TRACELAB_RESULT <id> value …` or `TRACELAB_RESULT <id> throws …` after each one. A javac error on a harness line is attributed to that expression, which is dropped before retrying. If the batch stops early (timeout, output limit or `System.exit`), the first expression without a result is reported as unfinished and the rest run in a new batch. "Debug this test" still records a single expression with the one-call harness.

## Language server bridge

Editor features come from Eclipse JDT LS, which the runner starts on demand and shares between page loads. The browser speaks plain LSP JSON-RPC; the runner only frames it.

- `GET /api/lsp/status` → `{state, reason, session}`; `state` is `off`, `running`, `stopped` or `unavailable` (no server installed).
- `POST /api/lsp/start` starts the server if needed and returns `{session, next, initialized, rootPath, settingsPath, runtimePath, runtimeName}`. When a new page connects to a running server, the runner closes the previous page's documents, answers its `initialize` with the cached result and drops a second `initialized`; `shutdown` and `exit` from pages are ignored. The runner sets `initialize.processId` to its own PID so JDT LS exits if the runner is killed.
- `POST /api/lsp/files {files}` mirrors the project into `.local/lsp/project` (same path rules as runs) and deletes other `.java` files there; it returns `{created, removed}`.
- `POST /api/lsp/send {session, messages}` writes up to 200 JSON-RPC messages. A stale session gets HTTP 409.
- `GET /api/lsp/receive?session&since&wait` long-polls (up to 25 s) for server messages with sequence ≥ `since`: `{session, state, reason, next, messages}`.
- `POST /api/lsp/stop` stops the server.

Compiler settings (`.local/lsp/compiler.prefs`) match `--release 21` and raise beginner-relevant warnings.

## AI assistant relay

Off until configured. The configuration lives in `.local/ai.json` (override with `TRACELAB_AI_CONFIG`).

- `GET /api/assist/config` → `{configured, provider, url, model, hasKey, local}`. The key itself is never returned.
- `POST /api/assist/config {provider, url, model, key?}` saves it; omitting `key` keeps the saved one, an empty string clears it. `url` must be `https://`, or `http://` for `localhost`, `127.0.0.1` or `[::1]`. `DELETE` removes it.
- `POST /api/assist/models` lists model ids from `{url}/models`.
- `POST /api/assist/chat {messages, maxTokens?}` starts a streamed `{url}/chat/completions` request (at most 40 messages, 160 KB, two at a time) and returns `{id}`. `GET /api/assist/chat/{id}` → `{status: running|done|error, text, error}`; `DELETE` stops it.

The request goes through `worker/AssistProxy.java` (Java's HTTP client), which receives the method, URL, headers (including `Authorization`) and body on stdin and streams response lines back.

## Future adapters

Keep the replay/UI dependent on the event schema, not JDI classes. Additional runtimes should report explicit capabilities and preserve their own language semantics. Version the schema when changing meaning. A new adapter must pass semantic fixtures for aliasing, recursion, exceptions, input/output, limits and source mapping before its language is advertised as supported.
