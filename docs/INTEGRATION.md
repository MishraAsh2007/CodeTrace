# Java, C and Python integration

The Java application remains the frontend and feature baseline. The other branches contribute their execution and teaching logic through adapters to the existing TraceLab protocol. Their standalone React frontends and servers are not needed by this application.

## Source commits

Repository: [MishraAsh2007/Hackachusetts_CodeTutor](https://github.com/MishraAsh2007/Hackachusetts_CodeTutor).

| Role | Branch and commit | Integrated paths |
| --- | --- | --- |
| Java IDE and features | `Java` at `82f7393` | Existing `web/`, Java worker, Rust API, JDT LS and assistant bridges |
| C execution and hints | `C_ver` at `fce98e8` | `backend/src/c/*` → `server/c/*`; `backend/src/trace.rs` → `server/c/trace.rs`; `frontend/public/src/components/tutor/tutorHints.ts` → `web/ctutor.ts` |
| Python tracing and questions | `python` at `5692eb2` | `pg_logger.py`, `pg_encoder.py`, `tracer.py` → `worker/python/`; `frontend/src/quiz/*` → `web/pyquiz/*`; visualization model and samples → `web/pyquiz/model.ts` and `samples.ts` |
| Initial adapted integration | `c-python-integration` at `126b105` | Language dispatch, protocol adapters, shared UI wiring and regression coverage atop the Java commit |

The remote C branch is named `C_ver`. The Python source is `python`, not `python-version`. The C lexer/parser/AST and Python logger/encoder match their source commits. The C interpreter adds cancellation, limits, stable frame IDs and partial-error traces. Python's wrapper adds plain runs, configurable step limits, bounded output and compact trace serialization. Its quiz rules keep the source branch's logic, with import paths adapted to this application.

The source branches are recorded as merged after auditing these ports. The resolved tree keeps the adapted implementation already on `c-python-integration`; copying the standalone applications over the Java frontend would discard the intended integration.

## Preserved Java behavior

Existing saved Java projects and API requests default to Java without a new language field. The Java worker, JDT LS client/bridge, method-test and test-generation engines, practice engine, library persistence and layout implementation are unchanged from the Java baseline. The shared UI adds language selection, C/Python examples, appropriate syntax highlighting, tutor adapters and output tests. Java-only controls are hidden or explained when a C/Python project is open.

The completion pass fixes source-file selection and import round trips, adds explicit Python setup in CI, ignores Python bytecode caches, and documents the language-specific protocol and setup. ZIP imports preserve a custom C/Python filename and reject extra source files instead of silently dropping them.

## Current scope

- C and Python each support one file. Java retains multiple files and packages.
- C is the source branch's teaching interpreter, not GCC/Clang or a complete C implementation. Steps show state after a statement. Its tutor supplies progressive classified-error hints.
- Python uses the source branch's Python Tutor tracer and predict/explain/repair question rules. It inherits the standard-library import allowlist and echoes `input()` values. No pip packages are required.
- Python sends its buffered trace after execution. Step-limit results retain steps; a forced wall-clock timeout, cancellation or oversized response does not preserve the buffered trace.
- Method tests, generated tests, JDT LS, compiler-fix verification, recording start points and algorithm practice remain Java features. C/Python use output tests and their own tutor logic.
- All engines run locally under the user's account. The original local-trusted deployment boundary still applies; the interpreter and import allowlist are not OS isolation.

## Validation

Run `npm run check`, `npm run build` and `npm test` with Node 24+, Rust, JDK 21+ and Python 3.10+. The suite exercises Java regressions, C interpreter behavior, Python trace conversion and the source question bank, as well as cross-language project validation, sharing and import/export. Browser testing is left to the project owner for this merge.
