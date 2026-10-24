# CodeTrace Python Visualizer

CodeTrace is a Monaco-based Python IDE that traces your program step by step, draws its memory (frames,
objects, pointers), and has Kiro, a Socratic AI tutor, quiz you about the exact state you're paused on.

| Part | Tech | Where |
|---|---|---|
| Frontend | React 19 + TypeScript, Vite, Monaco Editor 0.57 (bundled, works offline) | `frontend/` |
| Server | Rust (axum + tokio): serves the app and runs traces. No AI key needed. | `server/` |
| AI tutor | In the browser: Gemini, OpenAI or Anthropic with your own key (optional) | `frontend/src/tutor/` |
| Tracing | Python 3.11+ running pg_logger from OnlinePythonTutor | `tracer.py`, `pg_logger.py`, `pg_encoder.py` |

## Run it

```powershell
.\run.cmd
```

Then open http://localhost:8000. `run.cmd` builds the frontend and the server, then starts the server.
Use `.\run.cmd -SkipBuild` to start the last build instantly. Stop with Ctrl+C.

The built-in quiz works with no key. To also let Kiro's AI answer what you type, see [AI tutor settings](#ai-tutor-settings).

### Hot-reload UI development

Run the server in one terminal (`.\run.cmd`), and in a second terminal:
```powershell
cd frontend
npm run dev
```
Open http://localhost:5173. UI edits reload instantly, and `/api` is proxied to the Rust server.

## Setup on a new machine

You need Python 3.11+, Rust (https://rustup.rs) and Node.js 20+ (https://nodejs.org).
- macOS / Linux, or Windows with Visual Studio Build Tools: `cd frontend && npm install && npm run build`,
  then `cd ../server && cargo run --release` (run from the project root or `server/`).
- Windows without Visual Studio (how this machine is set up): Rust's GNU toolchain (`rustup-init -y
  --default-host x86_64-pc-windows-gnu`), portable Node in `%USERPROFILE%\tools\node-v*-win-x64`, and
  llvm-mingw (https://github.com/mstorsjo/llvm-mingw) in `%USERPROFILE%\tools\llvm-mingw-*`, whose `dlltool`
  the Rust build needs. `run.ps1` finds all three.

## Using it

- Click the gutter (or F9) to set breakpoints, then Run (Ctrl+Enter).
- Step with the toolbar, the timeline slider, Alt+←/→, or F8 to continue to the next breakpoint.
- Visualize (Ctrl+Shift+V) scans memory and spotlights where you are: which nodes your variables point to,
  and any `None` pointer the current line reads through.
- Ask AI (Ctrl+Shift+K) opens a chat where Kiro quizzes you about your program.
- Hover a pointer dot to highlight its arrow and the object it points at.
- When a run ends in an error, a panel under the output explains it and offers **View suggested fix**
  (a before/after diff you can apply with one click) and **Ask AI**. See below.

## Suggested fix on errors

When a run stops with an error (an exception or a syntax error), CodeTrace doesn't just print the message.
A panel appears under the Output with:
- the error and a plain-language reason, grounded in the actual values from the run (e.g. which variable
  was `None`);
- **View suggested fix** — a side-by-side diff of your line and a corrected line. **Apply fix** drops it
  into the editor so you can review it and run again;
- **Ask AI** — opens the chat and asks the AI tutor to explain this specific error.

The fix comes from the same rules as the quiz bank (`frontend/src/quiz/rules/bugs.ts`): `suggestFix()` in
`questionBank.ts` finds the repair that matches the error and uses its correct option, built from your own
code, as the change. It handles None-pointer dereferences (`while a and a.next`), wrong list/str/dict methods
(`.push` → `.append`), index-out-of-range loops, functions that forgot to `return`, bad `int()` input,
`str`-immutability, `for x in 5`, and the common syntax errors (missing `:`, `=` vs `==`, unclosed brackets
or strings, indentation). For errors it can't repair automatically, it still shows the reason and Ask AI.

## AI tutor settings

Open the chat and click the ⚙ chip in its header (or the AI button in the status bar). Pick:

| Provider | Default model | Other suggestions (you can type any model ID) | Get a key |
|---|---|---|---|
| Offline | none | built-in quiz, notes and offline hints only | no key |
| Google Gemini | `gemini-3.5-flash` | `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-4-argon` | https://aistudio.google.com/app/apikey |
| OpenAI | `gpt-6-luna` | `gpt-6.1-sol`, `gpt-6-astra`, `gpt-4.1-mini` | https://platform.openai.com/api-keys |
| Anthropic Claude | `claude-haiku-4-5` | `claude-sonnet-5-5`, `claude-opus-5-5` | https://console.anthropic.com/settings/keys |

Paste your API key, optionally click **Test connection**, then **Save**. The key is stored only in this
browser (localStorage key `visualpy.ai`; untick "Remember the key" to keep it for this tab only) and is sent
straight from the browser to the provider. It never goes to the CodeTrace server, `.env`, or any file.
Anyone with access to this browser profile can read it, so use a key you can revoke.

How the chat decides who answers:
1. The ⚡ quick-check quiz from the built-in bank always comes first when the chat opens.
2. Typed answers to an open quiz question (`b`, or the option's text) are graded locally.
3. Anything else you type goes to the AI tutor when one is set up, basic questions included.
4. With no AI set up, or while the AI is cooling down after a rate limit, "what is X?" questions are answered
   from built-in notes and everything else gets an offline hint.

Replies stream in as they're written. Busy/overloaded errors are retried twice with a short backoff. A rate
limit or "out of quota" error never shows as an error: Kiro pauses AI calls for the time the provider asks
(60 s for quota errors) and serves the next built-in question. A rejected key or unknown model shows a message
pointing back to ⚙ AI settings.

## Memory diagram arrows

`frontend/src/viz/arrows.ts` draws every pointer arrow so it never runs behind a card it doesn't connect.
A straight line or a smooth curve is used when the direct path is clear (most next/left/right pointers).
Otherwise the arrow is routed around the cards on a 6 px grid (A*), with costs for each bend, for hugging a
card, and for sharing a lane with an arrow headed somewhere else, so routes stay simple and spaced apart.
Arrows into the same object merge, self-pointers loop over the top of their card, and every arrow keeps its
glow (stronger for the spotlighted ones). Unchanged diagrams aren't re-routed, and a step re-renders in
about 20 ms.

Every object has a colour (from its id, so it stays the same while you step). The arrows into an object, the
pointer dots that lead to it, and the dot next to its `#id` all use that colour, so you can follow a dot to its
object by colour, and two variables with the same dot colour are aliases. Arrowheads are drawn in a layer above
all the lines, so a crossing line never hides where an arrow ends, and an arrow never ends exactly where one
of the card's own arrows leaves.

## How Kiro picks questions (built-in bank first, AI last)

When the chat opens, `planQuiz()` (`frontend/src/quiz/questionBank.ts`) scans the **whole trace**, every step
the visualizer can show, plus the source code. It runs every rule, ranks what it finds, and posts a short
"🔍 Program scan" summary followed by up to 8 ⚡ Quick check questions. Each question jumps the diagram to its
step and flashes the relevant line.

| Rules | Covers |
|---|---|
| `rules/bugs.ts` | The error the run actually hit: None pointers (+ `while … and …next` fix), index past the end, KeyError (with the dict's real keys), ZeroDivisionError, `list.push`-style wrong methods, UnboundLocalError, missing arguments, string item assignment, `for i in 5`, None from a function with no `return`, bad `int()`, typos, failed asserts, endless loops/recursion, the BST `insert` bug, any other common exception type, and syntax errors (missing `:`, `=` vs `==`, unclosed brackets/strings, indentation). |
| `rules/dsa.ts` | Graph traversal: next node visited, DFS vs. BFS, why `visited` matters (cycles), O(V + E). Stack/queue/heap pops. Sorting: the list after one pass, comparison count. Binary search: `mid`, number of guesses, O(log n). Repeated recursive work and memoization. Counting with a dict. |
| `rules/efficiency.ts` | Nested loops (O(n²), from real counts), `x in list` inside a loop, `list.pop(0)`, building strings with `+=`, sorting inside a loop. |
| `rules/python.ts` | Shared mutable default arguments, functions that return None, `/` vs `//`, slicing. |
| `rules/predict.ts` | Pointer moves, branches (BST left/right), return values, recursion depth, loop counts, aliasing. |

Every question is built from values recorded in this run, so it only appears when the trace backs it up.
Questions about the bug come first, then pitfalls the run proves, then algorithm, efficiency, and basics.

**When the AI is used.** The AI asks the opening question only when the bank has nothing (`needsAi`), or
when the learner finishes the built-in questions and asks for a harder one. It also answers what the learner
types (see [AI tutor settings](#ai-tutor-settings)). These never call the AI:
- typed answers to the open question (`b`, or the option's text) are graded locally,
- the "Smaller hint" / "Where do I look?" chips reveal the question's built-in hints,
- Visualize's "You are here" card is built locally; AI narration only runs when you click "Explain with AI".

| File | What it is |
|---|---|
| `frontend/src/tutor/settings.ts` | Providers, default models, loading/saving the user's settings and key. |
| `frontend/src/tutor/tutor.ts` | The AI tutor (port of `tutor.js`): Socratic prompt, streaming, retries, offline hints. |
| `frontend/src/tutor/state.ts` | Turns the current step into the text the AI sees (code, line, frames, heap). |
| `frontend/src/components/TutorSettings.tsx` | The ⚙ AI settings panel. |
| `frontend/src/quiz/questionBank.ts` | Entry point: `planQuiz()` scans, ranks, summarizes, decides if the AI is needed. |
| `frontend/src/quiz/core.ts` | Shared types and trace/code helpers, `detectTopics()`, `applyRepair()`. |
| `frontend/src/quiz/notes.ts` | Built-in explanations for "what is X?" questions. |
| `frontend/src/quiz/java/Database.ts` | The original Java question generator, repaired and type-checked. Not used at runtime. |
| `frontend/scripts/check-questions.ts` | Self-check (below). |

### Checking the questions

With the server running, from `frontend/`:
```powershell
npm run check:questions
```
It traces 43 programs (samples, DSA, efficiency, Python basics, bugs, syntax errors) and checks that each gets
the expected kind of questions. It also checks each question's shape. For every repair question it applies
**each option** to the code and re-runs it: the correct option must make the program finish, and every wrong
option must still fail or print something different. Currently 42/43 programs are answered from the bank; the
one that goes to the AI is `print('hello')`, which has nothing to quiz on.

To add a question type, write a rule in `quiz/rules/` that returns `Question`s built from the trace (give
repair questions an `edit` so the check can apply them), add it to `collect()` in `questionBank.ts`, and add a
test program to `CASES` in `check-questions.ts`.

## API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/health` | | `{status, tracer_ready, python, server}` |
| `POST /api/run-code` | `{code, stdin[]}` | `{status, message, error_line, error_step, trace[], step_count, stdout, duration_ms}` |

The AI tutor isn't behind the API: the browser calls the provider directly with the user's key.

`status` is one of `ok | error | step_limit | needs_input | timeout | crashed`. Bugs in user code come back
through `status` with HTTP 200, not as HTTP errors. Errors are always `{"detail": "..."}`.

## Notes

- Each run executes `python tracer.py --worker` in its own process with a 5 s timeout and an environment
  stripped of secrets. One spare worker is kept warm, so a run costs ~20-80 ms instead of Python's ~250 ms startup.
- `pg_logger.py` / `pg_encoder.py` come from OnlinePythonTutor's v5-unity (MIT, via the seamile/PyTutor mirror),
  patched for Python 3.12+ (lines marked `PATCHED`).
- The server only listens on 127.0.0.1 and has no authentication. The tracer isn't a real sandbox, so don't
  expose it publicly without running the tracer in a container.
- `legacy-python-server/` is the previous FastAPI version, kept for reference only. It no longer runs against
  the current `tracer.py` and can be deleted.
- `frontend/src/quiz/java/Database.ts` is your original `Database.ts`, repaired. The copy we received had been
  through a Markdown renderer, which stripped every template-literal backtick and pairs of `*` in regexes.
  It's type-checked by `npm run build` but not bundled, since the app traces Python, not Java.
