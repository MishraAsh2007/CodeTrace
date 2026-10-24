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
  "timeoutMs": 8000
}
```

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
- `terminated`: `stopReason`, `message`, and, when available, `steps`, `exitCode`, `outputTruncated`.

Stop reasons: `completed`, `compile-error`, `exception`, `runtime-error`, `step-limit`, `timeout`, `cancelled`, `unsupported-concurrency`, `trace-limit`, and `worker-error`.

Frames contain `id`, `method`, source `file`/`line`, typed `locals` (parameters carry `argument: true`), and an optional `truncated` flag. IDs are derived from method entry/exit activation tracking; after a caught exception unwinds frames, the worker realigns its activation stack with the real user frames at the next stop, so surviving frames keep their IDs. Objects use JDI identity, scoped to the run, so two references to the same object point to the same heap node. Objects are not pinned alive across stops (returned objects are pinned only until the next stop describes them). Trace data does not invoke methods on target objects. Exceptions that are thrown and caught entirely inside library code are not recorded.

Values are tagged:

```json
{"kind":"primitive","type":"int","value":"42"}
{"kind":"null","value":"null"}
{"kind":"reference","type":"int[]","ref":"o453"}
```

A reference with `omitted: true` was not traversed because of a capture budget. Objects have `id`, `type`, `kind`, and `elements`, `entries`, `fields`, `text`, or an explanatory `message`. Capture kinds:

- `array`, `list` (`ArrayList`, `LinkedList`, `ArrayDeque` head→tail, `PriorityQueue` in internal heap order, `Arrays.asList`) and `set` (`HashSet`, `LinkedHashSet`, `TreeSet`): `length` plus up to 32 `elements`.
- `map` (`HashMap`, `LinkedHashMap` in insertion order, `TreeMap` in key order): `length` plus up to 32 `entries: [{key, value}]`.
- `string`: `java.lang.String`, plus `StringBuilder`/`StringBuffer` decoded from their internal buffer (`length` is the logical length).
- `object` (user classes and boxed primitives), `opaque` (other library types), and `unavailable`.

Collection views are read from JDK fields, never by calling `size()`, `iterator()` or `toString()`. If a JDK's internal layout differs from what the worker expects, the object falls back to `opaque` instead of failing the trace.

## Future adapters

Keep the replay/UI dependent on the event schema, not JDI classes. Additional runtimes should report explicit capabilities and preserve their own language semantics. Version the schema when changing meaning. A new adapter must pass semantic fixtures for aliasing, recursion, exceptions, input/output, limits and source mapping before its language is advertised as supported.
