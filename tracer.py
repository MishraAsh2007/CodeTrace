"""
tracer.py: the Python side of the CodeTrace visualizer.

The Rust server (server/) runs this file as a worker:

    python tracer.py --worker  < {"code": "...", "stdin": [...], "allow_all_modules": false}

The worker imports pg_logger *before* reading stdin. That lets the server keep
one spare worker already started and warmed up, so a Run only pays for the
trace itself rather than for Python's startup (~200 ms on Windows).

It writes the sentinel "@@KIRO_TRACE@@" followed by the raw pg_logger trace (JSON)
to stdout. The server parses it and sends the frontend a summary:
status / message / error_line / error_step / trace / step_count / stdout / duration_ms.

Exit codes: 0 ok, 3 = pg_logger failed to import (setup problem, not the user's fault).
"""

import json
import sys

SENTINEL = "@@KIRO_TRACE@@"
SETUP_EXIT_CODE = 3


def worker() -> int:
    real_stdout = sys.stdout  # pg_logger redirects sys.stdout while user code runs
    try:
        import pg_logger
    except Exception as exc:  # noqa: BLE001 - report any import failure to the server
        real_stdout.write(f"{type(exc).__name__}: {exc}")
        return SETUP_EXIT_CODE

    request = json.loads(sys.stdin.read())  # blocks here until the server hands us a job
    trace = pg_logger.exec_script_str_local(
        request["code"],
        json.dumps(request.get("stdin", [])),  # pg_logger wants a JSON *string*
        False,                                 # cumulative_mode: only show live frames
        False,                                 # heap_primitives: inline ints/strs instead of boxing them
        lambda _code, steps: steps,            # finalizer: just hand back the trace list
        allow_all_modules=bool(request.get("allow_all_modules", False)),
    )
    real_stdout.write(SENTINEL + json.dumps(trace))
    real_stdout.flush()
    return 0


if __name__ == "__main__":
    if "--worker" not in sys.argv:
        sys.exit("tracer.py is started by the Rust server. Run the app with .\\run.ps1")
    sys.exit(worker())
