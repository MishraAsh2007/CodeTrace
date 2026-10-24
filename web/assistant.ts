import { buildHelp, shortValue } from './help.ts';
import { exceptionMessage, normalizeOutput, output, snapshots } from './learning.ts';
import { displayMethod, heapIndex } from './narrate.ts';
import type { Project, Question, Run } from './types';

/**
 * The optional AI assistant: what it is told, and a safe renderer for its answers. Facts about the program's
 * behavior come from the recording; the model is asked to rely on them and to say when it can't tell.
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export const SYSTEM_PROMPT = `You are the tutor inside TraceLab, a Java IDE for students learning to debug.
The student's project, their last recorded run and the current debugger step are attached as CONTEXT.

Rules:
- Base every claim about what the program did on the recorded facts in CONTEXT (values, output, exceptions). If the recording doesn't show something, say you can't tell from the recording and suggest how to find out (for example which step to look at).
- Never invent values, line numbers or output.
- Teach first. Explain why, point to the line and the values involved, and suggest what to check or try. Show a full corrected program only when the student explicitly asks for the solution; prefer showing the one or two lines that change.
- If a Tutor question is open, don't reveal its answer; help the student reason toward it.
- Keep answers short: usually under 150 words. Use Markdown with \`code\` for identifiers and fenced \`\`\`java blocks for code.
- The program is Java 21, single-threaded, using only the standard library.`;

const MAX_FILE = 9000;
const MAX_FILES = 18000;

/** Project source with line numbers, trimmed to a budget so the active file is always included. */
function sourceSection(project: Project, activeFile: string): string {
  const files = [...project.files].sort((a, b) => (a.name === activeFile ? -1 : b.name === activeFile ? 1 : 0));
  let budget = MAX_FILES;
  const parts: string[] = [];
  for (const file of files) {
    if (budget <= 0) { parts.push(`(${file.name} omitted to save space)`); continue; }
    const numbered = file.content.split('\n').map((line, i) => `${String(i + 1).padStart(3)} | ${line}`).join('\n');
    const text = numbered.length > Math.min(MAX_FILE, budget) ? `${numbered.slice(0, Math.min(MAX_FILE, budget))}\n… (truncated)` : numbered;
    budget -= text.length;
    parts.push(`### ${file.name}\n\`\`\`java\n${text}\n\`\`\``);
  }
  return parts.join('\n\n');
}

export type AssistContext = {
  project: Project; activeFile: string; run: Run | null; step: number; dirty: boolean;
  question?: Question; questionSolved?: boolean;
  tests?: { name: string; status: string; detail?: string }[];
  /** Problems shown in the editor (javac or the language server). */
  problems?: { file: string; line: number; message: string }[];
};

/** Everything the assistant is told about the program, as Markdown. */
export function contextMessage(c: AssistContext): string {
  const out: string[] = ['# CONTEXT', `Project “${c.project.name}”, main class \`${c.project.mainClass}\`.${c.project.stdin ? ` Standard input:\n\`\`\`\n${c.project.stdin.slice(0, 1500)}\n\`\`\`` : ' No standard input.'}`];
  out.push('## Source', sourceSection(c.project, c.activeFile));
  if (c.problems?.length) out.push('## Problems shown in the editor', c.problems.slice(0, 15).map(p => `- ${p.file}:${p.line}: ${p.message.split('\n')[0]}`).join('\n'));
  const run = c.run;
  if (!run) out.push('## Run', 'The program has not been run yet, so there is no recording.');
  else {
    const states = snapshots(run);
    const end = run.events.at(-1);
    out.push('## Last recorded run', c.dirty ? 'Note: the code was edited after this run, so the recording may not match the source above.' : 'The recording matches the source above.');
    const diagnostics = run.events.filter(e => e.kind === 'diagnostic' && e.severity === 'error');
    if (diagnostics.length) out.push(`javac rejected the program:\n${diagnostics.slice(0, 10).map(d => `- ${d.file}:${d.line}:${d.column}: ${d.message}`).join('\n')}`);
    else {
      out.push(`Stop reason: ${end?.stopReason ?? 'unknown'} after ${states.length} recorded steps.`);
      const failure = states.find(e => e.exception && !e.exception.caught);
      if (failure) out.push(`Uncaught ${failure.exception!.type} at ${failure.location?.file}:${failure.location?.line}: ${exceptionMessage(run, failure)}`);
      const stdout = normalizeOutput(output(run, 'stdout'));
      out.push(stdout ? `Standard output${stdout.length > 2000 ? ' (last 2000 characters)' : ''}:\n\`\`\`\n${stdout.slice(-2000)}\n\`\`\`` : 'The program printed nothing to standard output.');
      const stderr = normalizeOutput(output(run, 'stderr'));
      if (stderr) out.push(`Standard error:\n\`\`\`\n${stderr.slice(-1200)}\n\`\`\``);
      let at = Math.min(c.step, states.length - 1);
      while (at > 0 && !states[at]?.frames) at--;
      const state = states[at];
      if (state?.frames?.length) {
        const heap = heapIndex(state);
        out.push(`### Debugger is at step ${at + 1} of ${states.length}: before ${state.location?.file} line ${state.location?.line}`,
          state.frames.slice(0, 6).map(f => `- ${displayMethod(f.method)} (${f.file}:${f.line}): ${f.locals.filter(v => v.name !== 'args').slice(0, 10).map(v => `${v.name} = ${shortValue(v.value, heap)}`).join(', ') || 'no locals'}`).join('\n'));
        const help = buildHelp(run, { step: at, question: c.question });
        const table = help.visuals.find(v => v.kind === 'table');
        if (table && table.kind === 'table') out.push(`### ${table.title} (from the recording)`, [table.columns.join(' | '), ...table.rows.slice(-14).map(r => r.cells.join(' | '))].join('\n'));
        const calls = help.visuals.find(v => v.kind === 'calls');
        if (calls && calls.kind === 'calls') out.push('### Calls (from the recording)', calls.calls.slice(0, 15).map(k => `${'  '.repeat(k.depth)}${k.label} → ${k.result}`).join('\n'));
      }
    }
  }
  if (c.question) {
    out.push('## Open Tutor question', `${c.question.title}: ${c.question.prompt.replace(/`/g, '')}\nOptions: ${c.question.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o.replace(/`/g, '')}`).join('; ')}`,
      c.questionSolved ? `The student answered correctly (${String.fromCharCode(65 + c.question.correct)}).` : 'The student has not answered it correctly yet. Do not reveal the answer.');
  }
  if (c.tests?.length) out.push('## Tests', c.tests.map(t => `- ${t.name}: ${t.status}${t.detail ? ` (${t.detail})` : ''}`).join('\n'));
  return out.join('\n\n');
}

/** The messages for one turn: rules, context, the last few turns, then the new question. */
export function buildMessages(context: string, history: ChatMessage[], question: string): ChatMessage[] {
  const recent = history.filter(m => m.role !== 'system').slice(-8);
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: context }, { role: 'assistant', content: 'I have the project, the recording and the current step. What would you like to know?' }, ...recent, { role: 'user', content: question }];
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** A small Markdown renderer for answers: code blocks, inline code, bold, italics, lists, headings and paragraphs. Escapes everything else. */
export function renderMarkdown(text: string): string {
  const blocks: string[] = [];
  const parts = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose.trim()) {
      let list: 'ul' | 'ol' | null = null;
      let paragraph: string[] = [];
      const flush = () => { if (paragraph.length) { blocks.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
      const close = () => { if (list) { blocks.push(`</${list}>`); list = null; } };
      for (const line of prose.split('\n')) {
        const bullet = line.match(/^\s*[-*]\s+(.*)/), numbered = line.match(/^\s*\d+[.)]\s+(.*)/), heading = line.match(/^#{1,4}\s+(.*)/);
        if (bullet || numbered) {
          flush();
          const kind = bullet ? 'ul' : 'ol';
          if (list !== kind) { close(); blocks.push(`<${kind}>`); list = kind; }
          blocks.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
        } else if (heading) { flush(); close(); blocks.push(`<h5>${inline(heading[1])}</h5>`); }
        else if (!line.trim()) { flush(); close(); }
        else { close(); paragraph.push(line.trim()); }
      }
      flush(); close();
    }
    if (i + 2 < parts.length) blocks.push(`<pre class="md-code"><code>${escapeHtml(parts[i + 2].replace(/\n$/, ''))}</code></pre>`);
  }
  return blocks.join('');
}
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

export type AssistStatus = { configured: boolean; provider?: string; url?: string; model?: string; hasKey?: boolean; local?: boolean };
export const PROVIDERS = [
  { id: 'ollama', name: 'Ollama on this computer', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b', key: false, note: 'Free and private: your code stays on this computer. Install Ollama, then run ollama pull qwen2.5-coder:7b (about 4.7 GB). A smaller model such as qwen2.5-coder:3b answers faster on a laptop.' },
  { id: 'gemini', name: 'Google Gemini (free tier)', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', key: true, note: 'Get a free API key in Google AI Studio. Your code and run details are sent to Google, and on the free tier Google may use prompts to improve its products. Rate limits apply.' },
  { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1', model: '', key: true, note: 'Free tier with rate limits. Create a key at console.groq.com, then pick a model with List models. Your code is sent to Groq.' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: '', key: true, note: 'One key for many providers, including some free models (their ids end in :free). Your code is sent to OpenRouter and the model’s provider.' },
  { id: 'custom', name: 'Other OpenAI-compatible server', url: '', model: '', key: true, note: 'Any server with an OpenAI-compatible /chat/completions endpoint, such as LM Studio (http://127.0.0.1:1234/v1).' },
] as const;
