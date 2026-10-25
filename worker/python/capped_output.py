"""TraceLab: a capped stdout for traced Python programs.

This lives outside tracer.py on purpose: pg_logger traces every function whose module is __main__, and the
worker runs tracer.py as __main__, so a write() defined there would show up in the student's trace.
"""

import io

MAX_OUTPUT = 32768


class OutputLimitExceeded(BaseException):
    """Raised by print() once the program has printed MAX_OUTPUT characters. A BaseException, so
    `except Exception` in the student's code doesn't swallow it."""


class CappedStringIO(io.StringIO):
    def write(self, text):
        room = MAX_OUTPUT - self.tell()
        if len(text) > room:
            super().write(text[:max(room, 0)])
            raise OutputLimitExceeded(f"the program printed more than {MAX_OUTPUT} characters")
        return super().write(text)
