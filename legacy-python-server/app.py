"""
app.py: FastAPI server for the Kiro Python Visualizer.

Serves the Monaco IDE (static/) at http://localhost:8000 and a small JSON API:
  GET  /api/health        - is the tracer ready? is Kiro configured?
  POST /api/run-code      - run Python code, return the step-by-step pg_logger trace
  POST /api/explain-step  - Kiro narrates where execution is (Visualize button)
  POST /api/ask-kiro      - one turn of Kiro's Socratic quiz (chat panel)

Run:
  .\\.venv\\Scripts\\python.exe -m uvicorn app:app --reload
Interactive API docs: http://localhost:8000/docs
"""

from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")  # before importing kiro, so GEMINI_* settings are visible

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import kiro  # noqa: E402
import tracer  # noqa: E402

app = FastAPI(title="Kiro Python Visualizer", version="2.0.0")

# Traces are large and repetitive JSON; gzip typically shrinks them 10x or more.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# The IDE is served from this same origin, so CORS is only needed if a separate
# frontend (e.g. a dev server on another port) calls the API.
_origins = [o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


@app.middleware("http")
async def revalidate_static_files(request: Request, call_next):
    """Make browsers re-check IDE files on reload so edits show up immediately (ETags keep it cheap)."""
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

_MAX_CODE_CHARS = 50_000


class RunCodeRequest(BaseModel):
    code: str = Field(..., max_length=_MAX_CODE_CHARS, description="Python source to execute.")
    stdin: list[str] = Field(
        default_factory=list, max_length=200,
        description="Lines fed to input() calls, in order.",
    )


class RunCodeResponse(BaseModel):
    status: str = Field(..., description="ok | error | step_limit | needs_input | timeout | crashed")
    message: Optional[str]
    error_line: Optional[int]
    error_step: Optional[int]
    trace: list[dict[str, Any]]
    step_count: int
    stdout: str
    duration_ms: int


class StepContext(BaseModel):
    code: str = Field(..., max_length=_MAX_CODE_CHARS)
    trace_step: dict[str, Any] = Field(..., description="One step object from /api/run-code's trace.")
    step_index: int = Field(..., ge=0)
    step_count: Optional[int] = Field(None, ge=0)


class ExplainResponse(BaseModel):
    summary: str


class AskKiroRequest(StepContext):
    message: Optional[str] = Field(None, max_length=2000, description="Omit to get Kiro's opening question.")
    interaction_id: Optional[str] = Field(None, max_length=512, description="From the previous reply.")
    context: kiro.ContextMode = Field("full", description="What changed since the last turn: full | state | none")


class AskKiroResponse(BaseModel):
    reply: str
    interaction_id: Optional[str]
    restarted: bool = False


# ---------------------------------------------------------------------------
# Error handling: server-side problems become clean JSON errors
# ---------------------------------------------------------------------------

@app.exception_handler(kiro.KiroError)
async def _kiro_error(_: Request, exc: kiro.KiroError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.exception_handler(tracer.TracerSetupError)
async def _tracer_error(_: Request, exc: tracer.TracerSetupError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["Meta"])
def health():
    return {
        "status": "ok",
        "tracer_ready": tracer.is_ready(),
        "kiro_configured": kiro.is_configured(),
        "model": kiro.model_name(),
        "python": platform.python_version(),
    }


@app.post("/api/run-code", tags=["Execution"], response_model=None,
          responses={200: {"model": RunCodeResponse}})
def run_code(req: RunCodeRequest):
    """Run the code in an isolated subprocess and return its step-by-step trace.

    Plain `def` on purpose: FastAPI runs it in a worker thread, so a 5-second
    program doesn't block other requests. Bugs in the user's code come back as
    `status: "error"` with a 200, not as HTTP errors.
    """
    # JSONResponse skips FastAPI's per-object encoder, which is slow on 1000-step traces.
    return JSONResponse(tracer.get_trace(req.code, req.stdin))


@app.post("/api/explain-step", response_model=ExplainResponse, tags=["Kiro"])
async def explain_step(req: StepContext):
    """Kiro's one- or two-sentence narration of where execution is right now."""
    return await kiro.explain_step(req.code, req.trace_step, req.step_index, req.step_count)


@app.post("/api/ask-kiro", response_model=AskKiroResponse, tags=["Kiro"])
async def ask_kiro(req: AskKiroRequest):
    """One turn of Kiro's Socratic quiz about the given step."""
    return await kiro.chat(
        req.code, req.trace_step, req.step_index,
        step_count=req.step_count,
        message=req.message,
        interaction_id=req.interaction_id,
        context=req.context,
    )


# The IDE itself. Mounted last so /api/* and /docs take precedence.
app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="ide")
