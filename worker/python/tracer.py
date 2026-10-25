"""
tracer.py: the Python side of the CodeTrace visualizer, used by TraceLab's runner for Python projects.

The Rust server (server/python.rs) runs this file as a worker:

    python tracer.py --worker  < {"code": "...", "stdin": [...], "mode": "trace", "max_steps": 500, "allow_all_modules": false}

The worker imports pg_logger *before* reading stdin. That lets the server keep
one spare worker already started and warmed up, so a Run only pays for the
trace itself rather than for Python's startup (~200 ms on Windows).

It writes the sentinel "@@KIRO_TRACE@@" followed by JSON to stdout:
- mode "trace" (default): the raw pg_logger trace (a list of steps).
- mode "run" (TraceLab, for tests): {"status", "message", "error_line", "stdout"} from running the program
  without tracing, with the same input() and import rules as a trace.

Exit codes: 0 ok, 3 = pg_logger failed to import (setup problem, not the user's fault).

TraceLab changes: the step budget (`max_steps`), the "run" mode, and a 32 KiB cap on printed output.
"""

import json
import sys
import traceback
import types

from capped_output import CappedStringIO

SENTINEL = "@@KIRO_TRACE@@"
SETUP_EXIT_CODE = 3


def run_plain(pg_logger, code, stdin, allow_all_modules):
    """Runs the program without tracing, like pg_logger would (same input() echo and import rules)."""
    queue = list(stdin)
    out = CappedStringIO()

    def fake_input(prompt=""):
        if queue:
            line = queue.pop(0)
            out.write(str(prompt))
            out.write(line + "\n")
            return line
        raise pg_logger.RawInputException(str(prompt))

    import builtins
    user_builtins = dict(vars(builtins))
    user_builtins["input"] = fake_input
    if not allow_all_modules:
        user_builtins["open"] = pg_logger.open_wrapper
        user_builtins["__import__"] = pg_logger.__restricted_import__
    user_globals = {"__name__": "__main__", "__builtins__": user_builtins}
    result = {"status": "ok", "message": None, "error_line": None}
    real_stdout = sys.stdout
    sys.stdout = out
    try:
        compiled = compile(code, "<string>", "exec")
        exec(compiled, user_globals)
    except SystemExit:
        pass
    except pg_logger.RawInputException as exc:
        result.update(status="needs_input", message=str(exc))
    except SyntaxError as exc:
        result.update(status="error", message=f"{type(exc).__name__}: {exc}", error_line=exc.lineno)
    except BaseException as exc:  # noqa: BLE001 - report the student's error
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == "<string>"]
        result.update(status="error", message=f"{type(exc).__name__}: {exc}", error_line=frames[-1].lineno if frames else None)
    finally:
        sys.stdout = real_stdout
    result["stdout"] = out.getvalue()
    return result


def compact(trace):
    """TraceLab: pg_logger repeats every frame, heap object and the whole output in every step, so deep
    recursion grows as depth x steps (a missing base case makes ~50 MB). Each distinct frame and heap entry
    is stored once and steps refer to them by index. Lossless: the runner and the browser expand it back
    (server/python.rs, web/pyquiz/adapter.ts)."""
    frames, frame_ids, heap, heap_ids = [], {}, [], {}

    def intern(table, ids, value, key):
        index = ids.get(key)
        if index is None:
            index = ids[key] = len(table)
            table.append(value)
        return index

    # Output only grows, so each step's stdout is a prefix of the last one: keep its length in characters.
    final = next((s["stdout"] for s in reversed(trace) if isinstance(s.get("stdout"), str)), "")
    for step in trace:
        if "stack_to_render" in step:
            step["stack_to_render"] = [intern(frames, frame_ids, f, json.dumps(f, sort_keys=True)) for f in step["stack_to_render"]]
        if "heap" in step:
            step["heap"] = [intern(heap, heap_ids, [str(k), v], str(k) + json.dumps(v)) for k, v in step["heap"].items()]
        text = step.get("stdout")
        if isinstance(text, str) and final.startswith(text):
            step["stdout"] = len(text)
    return {"format": "compact-1", "frames": frames, "heap": heap, "stdout": final, "trace": trace}


def worker() -> int:
    real_stdout = sys.stdout  # pg_logger redirects sys.stdout while user code runs
    try:
        import pg_logger
    except Exception as exc:  # noqa: BLE001 - report any import failure to the server
        real_stdout.write(f"{type(exc).__name__}: {exc}")
        return SETUP_EXIT_CODE

    request = json.loads(sys.stdin.read())  # blocks here until the server hands us a job
    allow_all = bool(request.get("allow_all_modules", False))
    # pg_logger collects the program's output in StringIO.StringIO(); cap it.
    pg_logger.StringIO = types.SimpleNamespace(StringIO=CappedStringIO)
    if request.get("mode") == "run":
        import random
        random.seed(0)  # as pg_logger does when it is imported
        result = run_plain(pg_logger, request["code"], request.get("stdin", []), allow_all)
    else:
        pg_logger.MAX_EXECUTED_LINES = int(request.get("max_steps", 1000))
        result = pg_logger.exec_script_str_local(
            request["code"],
            json.dumps(request.get("stdin", [])),  # pg_logger wants a JSON *string*
            False,                                 # cumulative_mode: only show live frames
            False,                                 # heap_primitives: inline ints/strs instead of boxing them
            lambda _code, steps: steps,            # finalizer: just hand back the trace list
            allow_all_modules=allow_all,
        )
        result = compact(result)
    real_stdout.write(SENTINEL + json.dumps(result))
    real_stdout.flush()
    return 0


if __name__ == "__main__":
    if "--worker" not in sys.argv:
        sys.exit("tracer.py is started by TraceLab's runner (npm start).")
    sys.exit(worker())
