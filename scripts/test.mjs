import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildWorker, environment, run as command, serverBinary } from './env.mjs';
import { demos, examples } from '../web/examples.ts';
import { checkPassed, expandEvents, failingCheck, output, questionsFor, sameSource, snapshots, validateProject } from '../web/learning.ts';
import { describeStep, stepBackOver, stepOut, stepOver } from '../web/narrate.ts';
import { decodeProject, encodeProject } from '../web/share.ts';
import { analyzeJava, expectedPath, fileIssues, mainClasses, renameType, setPackage, splitTopLevelTypes } from '../web/javasource.ts';
import { limitProblem, projectFromSources, projectFromZip, projectToZip } from '../web/importer.ts';
import { Library } from '../web/library.ts';
import { batchOutcome, batchRequest, batchResults, callShape, evaluateTest, harnessErrorDetail, qualifyCall, requestForTest, splitStatements, testProblems, valuesMatch } from '../web/tests.ts';
import { aiTestMessages, caseToCheck, parseAiTests, planTests, sampleCalls } from '../web/testgen.ts';
import { isStarterCheck } from '../web/templates.ts';
import { originNote } from '../web/learning.ts';
import { applyEdits, compileIssues } from '../web/compilehelp.ts';
import { cursorsFor } from '../web/cursors.ts';
import { chainViews, graphViews, gridViews, recursionTree, treeViews } from '../web/structures.ts';
import { cursorsByObject } from '../web/cursors.ts';
import { JavaLanguageClient } from '../web/lsp.ts';
import { lintHelp } from '../web/linthelp.ts';
import { buildHelp, enclosingLoop } from '../web/help.ts';
import { aiPracticeMessages, answerText, parseAiPractice, practiceConcepts, practiceFor, practiceOptions, practiceOutcome, unsafeProgram } from '../web/practice.ts';
import { checkCondition, describeStart, shiftLine } from '../web/startat.ts';
import { checkable, spellingTokens } from '../web/spell.ts';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildMessages, contextMessage, renderMarkdown } from '../web/assistant.ts';
import { templates } from '../web/templates.ts';
import { readZip, writeZip } from '../web/zip.ts';
import { cErrorOf, hintsForError } from '../web/ctutor.ts';
import { pythonFix, pythonQuestions, pythonResult } from '../web/pyquiz/adapter.ts';
import { applyRepair, planQuiz } from '../web/pyquiz/questionBank.ts';
import { CASES as PY_CASES } from './pyquiz-cases.mjs';
import { systemPrompt } from '../web/assistant.ts';
import { singleFileProject } from '../web/importer.ts';

await buildWorker();
await command('cargo', ['test', '--locked']);
await command('cargo', ['build', '--locked']);
const env = { ...environment(), TRACELAB_AI_CONFIG: '.local/test-ai.json' };
rmSync('.local/test-ai.json', { force: true });
const server = spawn(serverBinary, [], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
const base = 'http://127.0.0.1:4317';
const headers = { 'Content-Type': 'application/json', 'X-TraceLab-Client': 'browser-v1' };
let total = 0;
async function test(name, fn) { await fn(); total++; console.log(`PASS ${name}`); }
async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers } });
  assert.equal(response.ok, true, await response.clone().text());
  return response.json();
}
function request(project, extra = {}) {
  return { ...(project.language ? { language: project.language } : {}), files: project.files, mainClass: project.mainClass, stdin: project.stdin, maxSteps: project.maxSteps, timeoutMs: 8000, ...extra };
}
const oneFile = content => ({ files: [{ name: 'Main.java', content }], mainClass: 'Main', stdin: '', maxSteps: 300, timeoutMs: 8000 });
/** A C or Python run request for one file. */
const single = (language, content, extra = {}) => ({ language, files: [{ name: language === 'c' ? 'main.c' : 'main.py', content }], mainClass: 'main', stdin: '', maxSteps: 500, timeoutMs: 8000, ...extra });
async function wait(id) {
  for (let i = 0; i < 400; i++) {
    const data = await api(`/api/runs/${id}`);
    if (data.status === 'finished') { expandEvents(data.events); return data; }
    await sleep(80);
  }
  throw new Error('A test run did not finish.');
}
async function execute(body) { const { id } = await api('/api/runs', { method: 'POST', body: JSON.stringify(body) }); return wait(id); }
const reason = data => data.events.at(-1)?.stopReason;
const example = id => examples.find(p => p.example === id);
const answerOf = (data, id) => { const q = questionsFor(data).find(q => q.id === id); assert.ok(q, `question ${id} in ${questionsFor(data).map(q => q.id)}`); return q.options[q.correct]; };
const repairedProject = (id, from, to) => {
  const project = structuredClone(example(id));
  const file = project.files.find(f => f.content.includes(from));
  assert.ok(file, `source contains ${from}`);
  file.content = file.content.replace(from, to);
  return project;
};
async function allChecksPass(project) {
  for (const check of project.checks) {
    const data = await execute(request(project, { stdin: check.stdin }));
    assert.equal(checkPassed(data, check), true, `${project.name} / ${check.name}: ${JSON.stringify(data.events.slice(-3))}`);
  }
}

try {
  for (let i = 0; i < 100 && !serverLog.includes('TraceLab:'); i++) {
    if (server.exitCode !== null) throw new Error(`Test server could not start. Stop any existing TraceLab server first.\n${serverLog}`);
    await sleep(50);
  }
  assert.match(serverLog, /TraceLab:/, 'Test server started');
  await test('real two-file compilation, JVM exception, and trace-grounded question', async () => {
    const data = await execute(request(examples[0]));
    assert.equal(reason(data), 'exception', JSON.stringify(data.events.slice(-3)));
    const failure = data.events.find(e => e.exception?.type === 'java.lang.ArrayIndexOutOfBoundsException');
    assert.equal(failure.location.file, 'ArraySum.java');
    assert.ok(failure.frames.some(f => f.locals.some(v => v.name === 'i' && v.value.value === '3')));
    assert.ok(failure.heap.some(o => o.kind === 'array' && o.length === 3 && o.elements.map(v => v.value).join() === '4,7,2'));
    const q = questionsFor(data).find(q => q.id === 'array-bounds');
    assert.ok(q); assert.equal(q.options[q.correct], '0 through 2');
    assert.ok(data.events.every((e, i) => e.sequence === i && e.schemaVersion === 1 && e.runId === data.id));
    assert.equal(sameSource(examples[0], data), true, 'Wire JSON key order must not mark source as changed');
    const changed = structuredClone(examples[0]); changed.files[0].content += '\n// edited';
    assert.equal(sameSource(changed, data), false);
  });
  const repaired = structuredClone(examples[0]);
  repaired.files[1].content = repaired.files[1].content.replace('i <= values.length', 'i < values.length');
  for (const check of repaired.checks) await test(`repair verification: ${check.name}`, async () => {
    const data = await execute(request(repaired, { stdin: check.stdin }));
    assert.equal(checkPassed(data, check), true, JSON.stringify(data.events.slice(-3)));
  });
  await test('shared references and field mutation retain object identity', async () => {
    const data = await execute(request(examples[1]));
    assert.equal(reason(data), 'completed');
    assert.equal(output(data, 'stdout').trim(), '42');
    assert.ok(data.events.some(e => {
      const vars = e.frames?.find(f => f.method === 'Main.main')?.locals ?? [];
      const first = vars.find(v => v.name === 'first'), second = vars.find(v => v.name === 'second');
      return first?.value.ref && first.value.ref === second?.value.ref && e.heap.some(o => o.id === first.value.ref && o.fields?.some(f => f.value.value === '42'));
    }));
  });
  await test('recursion has distinct frame activations', async () => {
    const data = await execute(request(examples[2]));
    assert.equal(reason(data), 'completed');
    const deepest = data.events.filter(e => e.frames).sort((a, b) => b.frames.length - a.frames.length)[0];
    assert.ok(deepest.frames.length >= 6);
    assert.equal(new Set(deepest.frames.map(f => f.id)).size, deepest.frames.length);
    assert.equal(output(data, 'stdout').trim(), '120');
  });
  await test('ArrayList renderer captures its logical elements', async () => {
    const data = await execute(request(examples[3]));
    assert.equal(reason(data), 'completed');
    assert.ok(data.events.some(e => e.heap?.some(o => o.kind === 'list' && o.length === 2)));
  });
  await test('compiler diagnostics retain file and line', async () => {
    const data = await execute(oneFile('public class Main { public static void main(String[] args) { int x = ; } }'));
    assert.equal(reason(data), 'compile-error');
    assert.ok(data.events.some(e => e.kind === 'diagnostic' && e.file === 'Main.java' && e.line === 1 && e.severity === 'error'));
  });
  await test('infinite loop retains exactly the requested number of source stops', async () => {
    const data = await execute(request(examples[4]));
    assert.equal(reason(data), 'step-limit');
    assert.equal(data.events.filter(e => e.kind === 'line' || e.kind === 'exception').length, 100);
  });
  await test('wall timeout retains a partial trace even while sleeping', async () => {
    const data = await execute({ ...oneFile('public class Main {\n public static void main(String[] args) throws Exception {\n int x = 2;\n Thread.sleep(12000);\n System.out.println(x);\n }\n }'), timeoutMs: 700 });
    assert.equal(reason(data), 'timeout');
    assert.ok(data.events.some(e => e.kind === 'line'));
  });
  await test('caught exceptions do not report a failed run', async () => {
    const data = await execute(oneFile('public class Main {\n public static void main(String[] args) {\n try {\n throw new IllegalArgumentException("oops");\n } catch (IllegalArgumentException e) {\n System.out.println("caught");\n }\n }\n }'));
    assert.equal(reason(data), 'completed');
    assert.ok(data.events.some(e => e.exception?.caught === true));
    assert.equal(output(data, 'stdout').trim(), 'caught');
  });
  await test('packaged source names map to the original files', async () => {
    const data = await execute({ ...oneFile(''), mainClass: 'demo.Main', files: [{ name: 'demo/Main.java', content: 'package demo;\n public class Main {\n public static void main(String[] args) {\n System.out.println("packaged");\n }\n }' }] });
    assert.equal(reason(data), 'completed');
    assert.ok(data.events.some(e => e.location?.file === 'demo/Main.java'));
  });
  await test('UTF-8 and stderr are captured separately', async () => {
    const data = await execute(oneFile('public class Main { public static void main(String[] args) { System.out.println("héllo 🌱"); System.err.println("warning"); } }'));
    assert.equal(reason(data), 'completed');
    assert.equal(output(data, 'stdout').trim(), 'héllo 🌱');
    assert.equal(output(data, 'stderr').trim(), 'warning');
  });
  await test('large output is drained and bounded without deadlocking', async () => {
    const data = await execute(oneFile('public class Main { public static void main(String[] args) { System.out.print("a".repeat(100000)); } }'));
    assert.equal(reason(data), 'completed');
    assert.equal(output(data, 'stdout').length, 32768);
    assert.equal(data.events.at(-1).outputTruncated, true);
  });
  await test('null-reference questions use a recorded JVM exception', async () => {
    const data = await execute(oneFile('public class Main {\n public static void main(String[] args) {\n String value = null;\n System.out.println(value.length());\n }\n }'));
    assert.equal(reason(data), 'exception');
    assert.ok(questionsFor(data).some(q => q.id === 'null'));
  });
  await test('cancellation stops the JVM and releases the job slot', async () => {
    const { id } = await api('/api/runs', { method: 'POST', body: JSON.stringify({ ...oneFile('public class Main { public static void main(String[] args) throws Exception { Thread.sleep(12000); } }'), timeoutMs: 15000 }) });
    const busy = await fetch(base + '/api/runs', { method: 'POST', headers, body: JSON.stringify(request(examples[1])) });
    assert.equal(busy.status, 409);
    await sleep(1000);
    await api(`/api/runs/${id}`, { method: 'DELETE' });
    const data = await wait(id);
    assert.equal(reason(data), 'cancelled');
    assert.equal(reason(await execute(request(examples[1]))), 'completed');
  });
  await test('local API rejects traversal, untrusted origins, and missing client headers', async () => {
    const bad = { ...oneFile('class Main {}'), files: [{ name: '../Escape.java', content: '' }] };
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers, body: JSON.stringify(bad) })).status, 400);
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: JSON.stringify(request(examples[1])) })).status, 403);
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request(examples[1])) })).status, 403);
  });
  await test('incremental polling returns only events at or after since', async () => {
    const full = await execute(request(examples[1]));
    const page = await api(`/api/runs/${full.id}?since=3`);
    assert.equal(page.total, full.events.length);
    assert.deepEqual(page.events.map(e => e.sequence), full.events.slice(3).map(e => e.sequence));
    assert.equal((await api(`/api/runs/${full.id}?since=100000`)).events.length, 0);
  });
  await test('return values and argument flags are recorded per activation', async () => {
    const data = await execute(request(example('recursion')));
    const returns = data.events.flatMap(e => e.returns ?? []).filter(r => r.method === 'Main.factorial');
    assert.deepEqual(returns.map(r => r.value.value), ['1', '2', '6', '24', '120']);
    const frameIds = new Set(data.events.flatMap(e => e.frames ?? []).map(f => f.id));
    assert.ok(returns.every(r => frameIds.has(r.frameId)), 'each return names a recorded activation');
    const n = data.events.find(e => e.frames?.[0]?.method === 'Main.factorial').frames[0].locals.find(v => v.name === 'n');
    assert.equal(n.argument, true);
    assert.equal(answerOf(data, questionsFor(data).find(q => q.id.startsWith('return-')).id), '6');
  });
  await test('frame identities survive exceptions caught inside recursion', async () => {
    const data = await execute(oneFile(`public class Main {
    static int dive(int n) {
        if (n == 0) throw new IllegalStateException("bottom");
        try {
            return dive(n - 1);
        } catch (IllegalStateException e) {
            if (n < 2) throw e;
            return helper(n);
        }
    }
    static int helper(int n) { return n * 10; }
    public static void main(String[] args) {
        int r = dive(3);
        System.out.println(r);
    }
}`));
    assert.equal(reason(data), 'completed');
    assert.equal(output(data, 'stdout').trim(), '20');
    const entered = data.events.find(e => e.frames?.[0]?.method === 'Main.dive' && e.frames[0].locals.some(v => v.name === 'n' && v.value.value === '2'));
    const inHelper = data.events.find(e => e.frames?.[0]?.method === 'Main.helper');
    assert.ok(entered && inHelper);
    assert.deepEqual(inHelper.frames.map(f => f.method), ['Main.helper', 'Main.dive', 'Main.dive', 'Main.main']);
    assert.equal(inHelper.frames[1].id, entered.frames[0].id, 'dive(2) keeps its activation ID after unwinding dive(1) and dive(0)');
    assert.equal(new Set(inHelper.frames.map(f => f.id)).size, 4);
    assert.ok(data.events.filter(e => e.kind === 'exception').every(e => e.exception.caught));
  });
  await test('collection renderers read JDK internals without calling methods', async () => {
    const data = await execute(oneFile(`import java.util.*;
public class Main {
    public static void main(String[] args) {
        HashMap<String, Integer> counts = new HashMap<>();
        counts.put("ada", 1);
        counts.put("grace", 2);
        LinkedHashMap<String, Integer> ordered = new LinkedHashMap<>();
        ordered.put("z", 1);
        ordered.put("a", 2);
        TreeMap<String, Integer> sorted = new TreeMap<>(ordered);
        TreeSet<String> names = new TreeSet<>(List.of("b", "c", "a"));
        HashSet<Integer> seen = new HashSet<>();
        LinkedList<Integer> queue = new LinkedList<>(List.of(5, 6, 7));
        ArrayDeque<String> stack = new ArrayDeque<>();
        stack.push("x");
        stack.push("y");
        StringBuilder text = new StringBuilder("hé");
        text.append("llo");
        System.out.println(counts.size() + sorted.firstKey() + names.first() + queue.size() + stack.peek() + text + seen.size());
    }
}`));
    assert.equal(reason(data), 'completed');
    const last = data.events.filter(e => e.frames).at(-1);
    const heap = new Map(last.heap.map(o => [o.id, o]));
    const local = name => heap.get(last.frames[0].locals.find(v => v.name === name).value.ref);
    const text = value => heap.get(value.ref)?.text;
    const boxed = value => heap.get(value.ref)?.fields?.[0]?.value.value;
    assert.equal(local('counts').kind, 'map');
    assert.deepEqual(local('counts').entries.map(e => `${text(e.key)}=${boxed(e.value)}`).sort(), ['ada=1', 'grace=2']);
    assert.deepEqual(local('ordered').entries.map(e => text(e.key)), ['z', 'a'], 'LinkedHashMap keeps insertion order');
    assert.deepEqual(local('sorted').entries.map(e => text(e.key)), ['a', 'z'], 'TreeMap is in key order');
    assert.equal(local('names').kind, 'set');
    assert.deepEqual(local('names').elements.map(text), ['a', 'b', 'c']);
    assert.deepEqual([local('seen').kind, local('seen').length], ['set', 0]);
    assert.deepEqual(local('queue').elements.map(boxed), ['5', '6', '7']);
    assert.deepEqual(local('stack').elements.map(text), ['y', 'x'], 'ArrayDeque runs from head to tail');
    assert.deepEqual([local('text').kind, local('text').text], ['string', 'héllo']);
  });
  await test('buggy lessons produce explain and repair questions from the trace', async () => {
    const bounds = await execute(request(example('bounds')));
    assert.equal(answerOf(bounds, 'bounds-repair'), '`i < values.length`');
    assert.deepEqual(questionsFor(bounds).find(q => q.id === 'bounds-repair').focus, { file: 'ArraySum.java', line: 6 });
    const loop = await execute(request(example('loop')));
    assert.equal(answerOf(loop, 'loop-stuck'), 'Nothing in the loop changes `count`.');
    assert.equal(answerOf(loop, 'loop-repair'), '`count++;`');
    const strings = await execute(request(example('strings')));
    assert.equal(output(strings, 'stdout').trim(), 'Not confirmed');
    assert.equal(strings.events.filter(e => e.kind === 'exception').length, 0, 'library-internal exceptions are not recorded');
    assert.equal(answerOf(strings, 'string-identity'), 'false, because they are different objects');
    assert.equal(answerOf(strings, 'string-repair'), '`answer.equals(expected)`');
    assert.equal(failingCheck(strings, example('strings').checks)?.check.name, 'Typed yes');
    const counts = await execute(request(example('counts')));
    assert.equal(reason(counts), 'exception');
    assert.equal(answerOf(counts, 'map-missing-key'), 'null, because the key has no entry yet');
    assert.equal(answerOf(counts, 'map-repair'), '`counts.getOrDefault(word, 0) + 1`');
    const alias = await execute(request(example('aliasing')));
    assert.match(answerOf(alias, 'alias-predict'), /^42,/);
  });
  await test('the repairs suggested by the questions pass every check', async () => {
    await allChecksPass(repairedProject('loop', 'System.out.println(count);', 'System.out.println(count);\n            count++;'));
    await allChecksPass(repairedProject('strings', 'answer == expected', 'answer.equals(expected)'));
    await allChecksPass(repairedProject('counts', 'counts.get(word) + 1', 'counts.getOrDefault(word, 0) + 1'));
    await allChecksPass(example('nodes'));
  });
  await test('narration and frame-aware stepping follow recorded activations', async () => {
    const data = await execute(request(example('recursion')));
    const states = snapshots(data);
    const call = states.findIndex(s => s.frames?.length === 1 && s.location.line === 13);
    const over = stepOver(states, call);
    assert.equal(states[over].frames.length, 1, 'step over skips every factorial stop');
    assert.ok(over > call + 5);
    const inner = states.findIndex(s => s.frames?.length === 3);
    const out = stepOut(states, inner);
    assert.ok(!states[out].frames.some(f => f.id === states[inner].frames[0].id));
    assert.ok(describeStep(data, states, out).some(item => item.kind === 'return' && /^Main\.factorial\(n = \d+\) returned \d+\.$/.test(item.text)), 'returns name the call and its arguments');
    const firstReturn = states.findIndex(s => s.returns?.length);
    assert.ok(describeStep(data, states, firstReturn).some(item => item.text === 'Main.factorial(n = 1) returned 1.'));
    assert.equal(stepBackOver(states, over), call);
    assert.ok(describeStep(data, states, call + 1).some(item => item.kind === 'call' && item.text.includes('n = 5')));
    const bounds = await execute(request(example('bounds')));
    const boundStates = snapshots(bounds);
    const failure = boundStates.findIndex(s => s.exception);
    assert.match(describeStep(bounds, boundStates, failure)[0].text, /^Threw ArrayIndexOutOfBoundsException: Index 3/);
    assert.ok(boundStates.some((_, i) => describeStep(bounds, boundStates, i).some(item => item.text === 'i: 0 → 1')));
  });
  await test('share links round-trip and reject damaged or oversized payloads', async () => {
    const payload = await encodeProject(example('bounds'));
    assert.match(payload, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeProject(payload), example('bounds'));
    await assert.rejects(decodeProject('not*base64'), /malformed/);
    await assert.rejects(decodeProject(payload.slice(0, 20)), /damaged|does not contain/);
    const bomb = new Uint8Array(await new Response(new Blob(['x'.repeat(3 * 1024 * 1024)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const encoded = Buffer.from(bomb).toString('base64url');
    await assert.rejects(decodeProject(encoded), /1 MiB/);
  });
  await test('every gallery demo has a project; buggy demos fail a test, tours pass all', async () => {
    assert.deepEqual(demos.map(d => d.id).sort(), examples.map(e => e.example).sort());
    for (const demo of demos) {
      const project = example(demo.id);
      assert.ok(project.checks.length > 0, `${demo.id} has tests`);
      const results = [];
      for (const check of project.checks) results.push(checkPassed(await execute(request(project, { stdin: check.stdin })), check));
      if (demo.category === 'tour') assert.ok(results.every(Boolean), `${demo.id} is a working program`);
      else assert.ok(results.some(r => !r), `${demo.id} has a bug that a test catches`);
    }
  });
  // For each buggy demo: the Tutor's correct repair, applied to the source, makes every test pass.
  const repairs = [
    ['divide', 'division-repair', 'int average = total / count;', 'int average = count == 0 ? 0 : total / count;'],
    ['intdiv', 'integer-division-repair', 'double average = total / scores.length;', 'double average = (double) total / scores.length;'],
    ['copy', 'copy-repair', 'int[] sorted = original;', 'int[] sorted = original.clone();'],
    ['parse', 'parse-repair', 'int price = Integer.parseInt(line);', 'double price = Double.parseDouble(line);'],
    ['palindrome', 'charat-repair', 'word.charAt(word.length() - i)', 'word.charAt(word.length() - 1 - i)'],
    ['library', 'field-repair', 'private ArrayList<String> books;', 'private ArrayList<String> books = new ArrayList<>();'],
    ['lossy', 'lossy-repair', 'int half = total / 2.0;', 'double half = total / 2.0;'],
    ['sumto', 'recursion-repair', 'static int sumTo(int n) {', 'if (n <= 0) return 0;'],
  ];
  for (const [id, questionId, from, fix] of repairs) await test(`${id}: the Tutor's repair fixes the program`, async () => {
    const data = await execute(request(example(id)));
    assert.equal(answerOf(data, questionId), `\`${fix}\``);
    const repaired = repairedProject(id, from, questionId === 'recursion-repair' ? `${from}\n        ${fix}` : fix);
    await allChecksPass(repaired);
  });
  await test('swap, removal: explain and repair questions match the recorded run', async () => {
    const swap = await execute(request(example('swap')));
    assert.equal(answerOf(swap, 'pass-by-value'), '1, because swap changed only its own copy');
    assert.match(answerOf(swap, 'pass-by-value-repair'), /^Do the reassignment in `main`/);
    await allChecksPass(repairedProject('swap', 'swap(x, y);', 'int temp = x;\n        x = y;\n        y = temp;'));
    const removal = await execute(request(example('removal')));
    assert.equal(answerOf(removal, 'modification'), 'The loop removed an element from the list it was iterating over.');
    assert.equal(answerOf(removal, 'modification-repair'), 'Replace the loop with `names.removeIf(name -> name.length() < 3);`');
    const project = structuredClone(example('removal'));
    project.files[0].content = project.files[0].content.replace(/for \(String name : names\) \{[\s\S]*?\n {8}\}\n/, 'names.removeIf(name -> name.length() < 3);\n');
    await allChecksPass(project);
  });
  await test('compile errors and runaway recursion are explained from evidence', async () => {
    const lossy = await execute(request(example('lossy')));
    assert.equal(reason(lossy), 'compile-error');
    const explain = questionsFor(lossy).find(q => q.id === 'lossy');
    assert.equal(explain.step, -1);
    assert.deepEqual(explain.focus, { file: 'Main.java', line: 6 });
    const typo = await execute(oneFile('public class Main {\n public static void main(String[] args) {\n int total = 3;\n System.out.println(totl);\n }\n}'));
    assert.match(answerOf(typo, 'missing-symbol'), /misspelling of `total`/);
    const sumto = await execute(request(example('sumto')));
    assert.equal(reason(sumto), 'step-limit');
    assert.match(questionsFor(sumto).find(q => q.id === 'runaway-recursion').context, /none of them returned/);
  });
  await test('the website, IDE and 404 page are served', async () => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="site">/);
    const app = await fetch(base + '/app/');
    assert.equal(app.status, 200);
    assert.match(await app.text(), /<div id="app">/);
    assert.equal((await fetch(base + '/app', { redirect: 'manual' })).status, 307);
    const missing = await fetch(base + '/no-such-page');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /This page doesn’t exist/);
    for (const theme of ['light', 'dark']) assert.equal((await fetch(`${base}/screenshots/ide-${theme}.webp`)).status, 200);
  });
  await test('source analysis ignores comments, strings and text blocks', () => {
    const src = `package com.example.app;\nimport java.util.*;\n/** class Fake { */\npublic final class Main {\n  static final String S = "class Nope { } \\" }";\n  char c = '{';\n  String t = """\n    class AlsoNope {\n    """;\n  record Pair(int a, int b) {}\n  public static void main(final String... args) { helper(1); }\n  private static int helper(int n) { return n; }\n  int field = helper(2);\n}\nclass Helper { public static void main(String args[]) {} }\n`;
    const info = analyzeJava(src);
    assert.equal(info.packageName, 'com.example.app');
    assert.deepEqual(info.types.map(t => [t.name, t.isPublic, t.hasMain]), [['Main', true, true], ['Helper', false, true]]);
    assert.deepEqual(info.types[0].methods.map(m => m.name), ['main', 'helper']);
    assert.equal(expectedPath(src), 'com/example/app/Main.java');
    assert.deepEqual(mainClasses([{ name: 'x', content: src }]), ['com.example.app.Main', 'com.example.app.Helper']);
    assert.equal(renameType('public class Old { Old() {} }', 'Old', 'New'), 'public class New { Old() {} }');
    assert.equal(setPackage('package a;\npublic class A {}', 'b.c'), 'package b.c;\npublic class A {}');
    assert.equal(setPackage('public class A {}', 'p'), 'package p;\n\npublic class A {}');
    const issues = fileIssues([{ name: 'Main.java', content: src }, { name: 'Wrong.java', content: 'public class Right {}' }, { name: 'ok/T.java', content: 'package ok; public class T {}' }]);
    assert.deepEqual([...issues.entries()].map(([k, v]) => [k, v.expected]), [['Main.java', 'com/example/app/Main.java'], ['Wrong.java', 'Right.java']]);
    for (const e of examples) assert.equal(fileIssues(e.files).size, 0, `${e.example} file paths match their classes`);
  });
  await test('pasted and uploaded sources become correctly placed project files', async () => {
    const split = splitTopLevelTypes('import java.util.List;\n\npublic class A { List<String> x; }\n\nclass Hidden {}\n\npublic interface B { void go(); }\n');
    assert.deepEqual(split.map(f => f.name), ['A.java', 'B.java']);
    assert.match(split[0].content, /class Hidden/);
    assert.match(split[1].content, /^import java\.util\.List;/);
    const folder = projectFromSources('Folder', [
      { path: 'proj/src/main/java/com/x/App.java', text: 'package com.x;\r\npublic class App { public static void main(String[] a) {} }' },
      { path: 'proj/src/main/java/com/x/util/U.java', text: '\uFEFFpackage com.x.util;\npublic class U {}' },
    ]);
    assert.deepEqual(folder.project.files.map(f => f.name), ['com/x/App.java', 'com/x/util/U.java']);
    assert.equal(folder.project.mainClass, 'com.x.App');
    assert.ok(folder.project.files.every(f => !f.content.includes('\r') && !f.content.startsWith('\uFEFF')));
    assert.match(limitProblem(Array.from({ length: 21 }, (_, i) => ({ name: `C${i}.java`, content: `class C${i} {}` }))), /up to 20/);
    assert.throws(() => projectFromSources('x', [{ path: 'Notes.java', text: '// just a comment' }]), /no Java files/);
    for (const project of [...examples, ...templates.map(t => t.create('T'))]) {
      const back = await projectFromZip(await projectToZip(project), 'zip');
      assert.deepEqual({ ...back.project, example: project.example }, { ...project }, `${project.name} survives a zip round trip`);
    }
    const plain = await writeZip([{ path: 'repo/src/Main.java', data: new TextEncoder().encode('public class Main { public static void main(String[] a) {} }') }, { path: 'repo/README.md', data: new Uint8Array(10) }]);
    const imported = await projectFromZip(plain, 'repo');
    assert.deepEqual([imported.project.name, imported.project.files.map(f => f.name)], ['repo', ['Main.java']]);
    const bomb = await writeZip([{ path: 'Big.java', data: new Uint8Array(200000).fill(32) }]);
    await assert.rejects(readZip(bomb, { maxEntries: 10, maxEntry: 65536, maxTotal: 100000 }), /larger than 64 KiB/);
    await assert.rejects(projectFromZip(new Uint8Array([1, 2, 3]), 'x'), /not a zip/);
  });
  await test('project library keeps projects and example edits apart', () => {
    const map = new Map();
    const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
    let clock = 1000;
    const lib = new Library(storage, validateProject, () => clock++);
    map.set('tracelab.project.v1', JSON.stringify({ ...example('loop'), name: 'My old work' }));
    const migrated = lib.migrateLegacy(p => examples.find(e => JSON.stringify(e) === JSON.stringify(p))?.example ?? null, new Set(examples.map(e => e.example)));
    assert.deepEqual(migrated, { kind: 'example', id: 'loop' }, 'an edited example stays an example with saved edits');
    assert.equal(lib.load(migrated).name, 'My old work');
    assert.equal(map.has('tracelab.project.v1'), false);
    const a = lib.create(templates[0].create('Alpha'));
    const b = lib.create(templates[2].create('Beta'));
    assert.deepEqual(lib.list().map(p => p.name), ['Beta', 'Alpha']);
    const edited = lib.load({ kind: 'project', id: a }); edited.files[0].content += '// edit';
    lib.save({ kind: 'project', id: a }, edited);
    assert.deepEqual(lib.list().map(p => p.name), ['Alpha', 'Beta'], 'most recently saved first');
    const copy = lib.duplicate(b);
    assert.equal(lib.summary(copy).name, 'Beta (copy)');
    assert.equal(lib.uniqueName('Alpha'), 'Alpha 2');
    lib.setCurrent({ kind: 'project', id: b });
    lib.remove(b);
    assert.equal(lib.current, null);
    assert.equal(lib.load({ kind: 'project', id: b }), null);
    const reopened = new Library(storage, validateProject);
    assert.deepEqual(reopened.list().map(p => p.name).sort(), ['Alpha', 'Beta (copy)']);
    assert.equal(reopened.hasExampleEdits('loop'), true);
    reopened.resetExample('loop');
    assert.equal(reopened.hasExampleEdits('loop'), false);
  });
  await test('method-call tests evaluate expressions against the real program', async () => {
    const library = { version: 1, name: 'Calls', example: '', mainClass: 'app.Main', stdin: '', maxSteps: 300, checks: [], files: [
      { name: 'app/Main.java', content: 'package app;\npublic class Main { public static void main(String[] a) { System.out.println(MathUtil.average(new int[]{1, 2})); } }\n' },
      { name: 'app/MathUtil.java', content: 'package app;\nimport java.util.*;\npublic class MathUtil {\n  public static double average(int[] xs) { int s = 0; for (int x : xs) s += x; System.out.print("noise"); return (double) s / xs.length; }\n  static int divide(int a, int b) { return a / b; }\n  public static String shout(String s) { return s.toUpperCase(); }\n  public static int[] pair(int a) { return new int[]{a, a}; }\n  public static List<String> names() { return List.of("Ada", "Lin"); }\n  public static void nothing() {}\n  public int instance() { return 7; }\n}\n' },
    ] };
    const cases = [
      [{ call: 'average(new int[]{1, 2})', expectedOutput: '1.5' }, true, /Returned 1\.5/],
      [{ call: 'MathUtil.divide(7, 2)', expectedOutput: '3' }, true],
      [{ call: 'divide(1, 0)', expectedOutput: 'throws ArithmeticException' }, true],
      [{ call: 'shout("hi")', expectedOutput: 'HI' }, true],
      [{ call: 'pair(4)', expectedOutput: '[4, 4]' }, true],
      [{ call: 'names()', expectedOutput: '["Ada", "Lin"]' }, true],
      [{ call: 'new MathUtil().instance()', expectedOutput: '7' }, true],
      [{ call: 'divide(9, 3)', expectedOutput: '4' }, false, /Expected 4, got 3/],
      [{ call: 'nothing()', expectedOutput: '0' }, false, /returns void/],
      [{ call: 'instance()', expectedOutput: '7' }, false, /instance method/],
      [{ call: 'missing(1)', expectedOutput: '1' }, false, /does not compile/],
    ];
    for (const [fields, passes, detail] of cases) {
      const check = { name: fields.call, kind: 'call', target: 'app.MathUtil', stdin: '', ...fields };
      assert.deepEqual(testProblems(check, library), []);
      const req = requestForTest(library, check, request(library));
      assert.equal(req.mainClass, 'app.TraceLabCall__');
      const outcome = evaluateTest(await execute(req), check);
      assert.equal(outcome.passed, passes, `${fields.call}: ${outcome.detail}`);
      if (detail) assert.match(outcome.detail, detail);
    }
    assert.match(testProblems({ name: 'x', kind: 'call', target: 'app.Nope', call: 'if (ok) { f(); }', stdin: '', expectedOutput: '' }, library).join(' '), /no blocks.*Choose the class.*expected value/);
    assert.equal(testProblems({ name: 'x', kind: 'call', target: 'app.MathUtil', call: 'int[] xs = {1, 2}; MathUtil.average(xs)', stdin: '', expectedOutput: '1.5' }, library).length, 0, 'statements before the checked expression are allowed');
    assert.equal(valuesMatch('0.3', '0.30000000000000004'), true);
    assert.equal(valuesMatch('hi', '"hi"'), true);
    assert.equal(valuesMatch('throws java.lang.ArithmeticException', 'value 3'), false);
  });
  await test('every new-project template runs and passes its own tests', async () => {
    for (const template of templates) {
      const project = template.create(template.name);
      assert.ok(validateProject(project), template.id);
      assert.equal(project.language ?? 'java', template.language, template.id);
      if (template.language === 'java') {
        assert.deepEqual([...fileIssues(project.files).keys()], [], `${template.id} paths match`);
        assert.ok(mainClasses(project.files).includes(project.mainClass), `${template.id} main class exists`);
      }
      if (!project.checks.length) assert.equal(reason(await execute(request(project))), 'completed', `${template.id} runs`);
      for (const check of project.checks) {
        const outcome = evaluateTest(await execute(requestForTest(project, check, request(project))), check);
        assert.equal(outcome.passed, true, `${template.id} / ${check.name}: ${outcome.detail}`);
      }
    }
  });
  await test('plain run and compile-only modes report outcomes without recording', async () => {
    const plain = await execute(request(examples[0], { mode: 'run' }));
    assert.equal(reason(plain), 'exception');
    assert.equal(plain.events.at(-1).recorded, false);
    assert.equal(plain.events.at(-1).exception.type, 'java.lang.ArrayIndexOutOfBoundsException');
    assert.ok(!plain.events.some(e => e.kind === 'line'), 'nothing is recorded');
    assert.match(evaluateTest(plain, examples[0].checks[0]).detail, /^ArrayIndexOutOfBoundsException: Index 3 out of bounds/);
    const done = await execute(request(example('recursion'), { mode: 'run' }));
    assert.equal(reason(done), 'completed');
    assert.equal(output(done, 'stdout').trim(), '120');
    const flood = await execute({ ...oneFile('public class Main { public static void main(String[] args) { while (true) System.out.println("again"); } }'), mode: 'run' });
    assert.equal(reason(flood), 'output-limit');
    const compiled = await execute(request(examples[0], { mode: 'compile' }));
    assert.equal(reason(compiled), 'compiled');
    assert.equal(output(compiled, 'stdout'), '');
    assert.equal(reason(await execute({ ...oneFile('public class Main { int x = ; }'), mode: 'compile' })), 'compile-error');
    assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers, body: JSON.stringify({ ...oneFile('class Main {}'), mode: 'debug' }) })).status, 400);
  });
  await test('index markers follow loops through arrays, lists, strings and grids', async () => {
    const marks = (data, states, i) => cursorsFor(data, states, i).map(c => `${c.name}[${c.label}]=${c.index}${c.inRange ? '' : '!'}${c.kind === 'for-each' ? ' each' : ''}`);
    const everyMark = data => { const states = snapshots(data); return new Set(states.flatMap((_, i) => marks(data, states, i))); };
    const bounds = await execute(request(examples[0]));
    const states = snapshots(bounds);
    assert.deepEqual(marks(bounds, states, states.findIndex(e => e.exception && !e.exception.caught)), ['values[i]=3!'], 'the failing index is past the end');
    const palindrome = everyMark(await execute(request(example('palindrome'))));
    assert.ok(palindrome.has('word[i]=0') && palindrome.has('word[word.length() - i]=5!'), [...palindrome].join());
    const custom = everyMark(await execute(oneFile(`import java.util.*;
public class Main {
    int[] data = {9, 8};
    int peek(int k) { return data[k]; }
    public static void main(String[] args) {
        int[] values = {4, 7, 2};
        int total = 0;
        for (int v : values) {
            total += v;
        }
        for (int i = values.length - 1; i >= 0; i--) {
            total += values[values.length - 1 - i];
        }
        List<String> names = new ArrayList<>(List.of("a", "b"));
        for (int j = 0; j < names.size(); j++) {
            System.out.println(names.get(j));
        }
        int[][] grid = {{1, 2}, {3, 4}};
        for (int r = 0; r < grid.length; r++) {
            for (int c = 0; c < grid[r].length; c++) {
                total += grid[r][c];
            }
        }
        System.out.println(new Main().peek(1) + total);
    }
}
`)));
    for (const mark of ['values[v]=2 each', 'values[values.length - 1 - i]=2', 'names[j]=1', 'grid[r]=1', 'grid[r][c]=1', 'data[k]=1']) assert.ok(custom.has(mark), `${mark} in ${[...custom].join(', ')}`);
  });
  await test('compile help explains javac errors and every suggested fix compiles', async () => {
    const wrap = body => `import java.util.*;\npublic class Main {\n${body}\n}\n`;
    const main = body => wrap(`  public static void main(String[] args) {\n${body}\n  }`);
    const cases = {
      'Missing semicolon': main('    int x = 5\n    System.out.println(x);'),
      'Unknown name totl': main('    int total = 3;\n    System.out.println(totl);'),
      'Scanner needs an import': 'public class Main {\n  public static void main(String[] args) {\n    Scanner in = new Scanner(System.in);\n  }\n}\n',
      'Arrays use length, not length()': main('    int[] v = {1};\n    System.out.println(v.length());'),
      'Arrays use length, not size()': main('    int[] v = {1};\n    System.out.println(v.size());'),
      'Strings use length()': main('    String s = "a";\n    System.out.println(s.length);'),
      'Lists use size()': main('    List<Integer> v = new ArrayList<>();\n    System.out.println(v.length);'),
      'A String can’t be used as an int': main('    Scanner in = new Scanner(System.in);\n    int n = in.nextLine();'),
      'An int can’t be used as a String': main('    String s = 5;'),
      'A double doesn’t fit in an int': main('    int half = 7 / 2.0;'),
      'Not every path returns a value': wrap('  static int sign(int n) {\n    if (n > 0) {\n      return 1;\n    }\n  }\n  public static void main(String[] args) {}'),
      'count has no starting value': main('    int count;\n    count++;'),
      'Missing closing brace': 'public class Main {\n  public static void main(String[] args) {\n    for (int i = 0; i < 3; i++) {\n      System.out.println(i);\n  }\n}\n',
      'main can’t use helper without an object': wrap('  int helper() { return 1; }\n  public static void main(String[] args) {\n    System.out.println(helper());\n  }'),
      'FileNotFoundException must be handled': 'import java.io.*;\npublic class Main {\n  public static void main(String[] args) {\n    new FileReader("x.txt");\n  }\n}\n',
      'x is declared twice': main('    int x = 1;\n    int x = 2;'),
      'This line can never run': wrap('  static int f() {\n    return 1;\n    System.out.println("never");\n  }\n  public static void main(String[] args) {}'),
      'An if ends with a stray semicolon': main('    int x = 1;\n    if (x > 0);\n      System.out.println(1);\n    else\n      System.out.println(2);'),
      'Comparing a char with a String': main('    String s = "a";\n    if (s.charAt(0) == "a") {}'),
      'x is final': main('    final int x = 1;\n    x = 2;'),
      'Constructor name doesn’t match the class': wrap('  public Mian() {}\n  public static void main(String[] args) {}'),
      'Text is missing its closing quote': main('    System.out.println("hello);'),
      '== compares; = assigns': main('    int x = 1;\n    x == 2;'),
      'A void method can’t return a value': wrap('  static void f() {\n    return 5;\n  }\n  public static void main(String[] args) {}'),
      'Missing )': main('    System.out.println("a";'),
      'Unknown method lenght()': main('    String s = "a";\n    System.out.println(s.lenght());'),
      'Unknown class Strng': main('    Strng s = "a";'),
    };
    const compileErrors = async files => (await execute({ ...oneFile(''), files, mode: 'compile' })).events.filter(e => e.kind === 'diagnostic' && e.severity === 'error');
    for (const [title, content] of Object.entries(cases)) {
      const files = [{ name: 'Main.java', content }];
      const [issue] = compileIssues(files, await compileErrors(files));
      assert.equal(issue?.title, title);
      assert.ok(issue.explanation.length > 20, title);
      assert.ok(issue.fixes.length > 0, `${title} has a fix`);
      const remaining = await compileErrors(applyEdits(files, issue.fixes[0].action));
      assert.deepEqual(remaining.map(e => e.message.split('\n')[0]), [], `${title}: ${issue.fixes[0].label}`);
    }
    // A move fix renames the file to match its public class.
    const misnamed = [{ name: 'Main.java', content: 'public class Other {\n  public static void main(String[] args) {}\n}\n' }];
    const [move] = compileIssues(misnamed, await compileErrors(misnamed));
    assert.deepEqual(move.fixes[0].action, { kind: 'move', from: 'Main.java', to: 'Other.java' });
    assert.deepEqual(await compileErrors(applyEdits(misnamed, move.fixes[0].action)), []);
    // Some errors get an explanation but no automatic fix.
    const deref = [{ name: 'Main.java', content: main('    int x = 5;\n    System.out.println(x.length());') }];
    const [explained] = compileIssues(deref, await compileErrors(deref));
    assert.equal(explained.title, 'int values have no methods');
    assert.deepEqual(explained.fixes, []);
  });
  await test('generated tests try sample calls in one JVM and attribute hangs and bad calls', async () => {
    const files = [{ name: 'Main.java', content: `public class Main {
    public static void main(String[] args) { System.out.println(max(new int[]{4, 9, 2})); }
    static int max(int[] xs) { int best = 0; for (int x : xs) if (x > best) best = x; return best; }
    static boolean isEven(int n) { return n % 2 == 0; }
    static int spin(int n) { while (n > 0) { } return n; }
    static void hello() { System.out.println("hi"); }
    int counter() { return 1; }
    private static int secret() { return 4; }
}
` }];
    const plan = planTests(files);
    // Instance methods run on a new Main(); void methods are checked by what they print.
    assert.deepEqual(plan.skipped.map(s => s.method).sort(), ['secret']);
    assert.deepEqual(plan.cases.filter(c => c.method === 'counter' || c.method === 'hello').map(c => [c.call, c.expression, !!c.printed]), [['hello();', 'Main.hello();', true], ['new Main().counter()', 'new Main().counter()', false]]);
    assert.deepEqual(plan.cases.filter(c => c.method === 'max').map(c => c.call), ['max(new int[]{})', 'max(new int[]{7})', 'max(new int[]{3, 1, 2})', 'max(new int[]{-2, 5, 5, 0})']);
    assert.deepEqual(sampleCalls({ name: 'find', params: [{ type: 'int[]', name: 'xs' }, { type: 'int', name: 't' }] }).slice(0, 3), ['find(new int[]{}, 0)', 'find(new int[]{7}, 1)', 'find(new int[]{3, 1, 2}, 2)']);
    assert.deepEqual(sampleCalls({ name: 'add', params: [{ type: 'int', name: 'a' }, { type: 'int', name: 'b' }] })[0], 'add(0, 1)');
    const runBase = { files, mainClass: 'Main', stdin: '', maxSteps: 100, timeoutMs: 2000 };
    const id = call => plan.cases.find(c => c.call === call).id;
    const batch = await execute(batchRequest(runBase, '', plan.cases).request);
    assert.equal(reason(batch), 'timeout', 'spin(1) never returns');
    const results = batchResults(output(batch, 'stdout'));
    assert.equal(results.get(id('max(new int[]{3, 1, 2})')).value, '3');
    assert.equal(results.get(id('isEven(-3)')).value, 'false');
    assert.equal(results.get(id('spin(0)')).value, '0');
    assert.equal(results.has(id('spin(1)')), false);
    // Calls after the endless one need their own batch.
    const later = batchResults(output(await execute(batchRequest(runBase, '', plan.cases.filter(c => c.method === 'counter' || c.method === 'hello')).request), 'stdout'));
    assert.equal(later.get(id('new Main().counter()')).value, '1');
    assert.equal(later.get(id('hello();')).value, '"hi"', 'a void method is checked by what it prints');
    // A call that doesn't compile is traced to its own line in the harness.
    const { request: bad, lines } = batchRequest(runBase, '', [{ id: 7, expression: 'Main.isEven(4)' }, { id: 8, expression: 'Main.hello()' }]);
    const error = (await execute({ ...bad, mode: 'compile' })).events.find(e => e.kind === 'diagnostic' && e.severity === 'error');
    assert.equal(lines.get(error.line), 8);
    assert.match(harnessErrorDetail(error.message), /returns void/);
    // A confirmed case becomes an ordinary method test.
    const check = caseToCheck(plan.cases.find(c => c.call === 'max(new int[]{7})'), '7');
    assert.equal(batchOutcome(check, results.get(id('max(new int[]{7})'))).passed, true);
    assert.equal(batchOutcome({ ...check, expectedOutput: '8' }, results.get(id('max(new int[]{7})'))).detail, 'Expected 8, got 7');
    const project = { name: 'Gen', files, mainClass: 'Main', stdin: '', maxSteps: 100, checks: [check] };
    assert.equal(evaluateTest(await execute(requestForTest(project, check, { ...runBase, mode: 'run' })), check).passed, true);
    assert.equal(check.origin, 'generated');
  });
  await test('tests for everything: objects, statements, printed output, spread sampling, and AI suggestions checked on the JVM', async () => {
    const files = [
      { name: 'Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        Counter c = new Counter(2);\n        c.add(3);\n        System.out.println(c.value());\n    }\n}\n' },
      { name: 'Counter.java', content: `public class Counter {
    private int value;
    public Counter(int start) { value = start; }
    public void add(int n) { value += n; }
    public int value() { return value; }
    public static void stars(int n) { System.out.println("*".repeat(n)); }
}
` },
      { name: 'Shape.java', content: 'public abstract class Shape {\n    public abstract double area();\n    public String name() { return "shape"; }\n}\n' },
      { name: 'Point.java', content: 'public record Point(int x, int y) {\n    public int sum() { return x + y; }\n}\n' },
    ];
    const plan = planTests(files);
    const calls = plan.cases.map(c => c.call);
    assert.ok(calls.includes('new Counter(2).value()'), 'a constructor with sample arguments builds the object');
    assert.ok(calls.some(c => /^new Counter\(2\)\.add\(\d\);$/.test(c)), 'instance void methods are checked by what they print');
    assert.ok(calls.includes('stars(1);'));
    assert.ok(calls.some(c => c.startsWith('new Point(2, 2).sum(')), 'records are built from their components');
    assert.deepEqual(plan.skipped.filter(s => s.className === 'Shape').map(s => s.method).sort(), ['area', 'name']);
    // Many methods share the case budget instead of the first ones taking all of it.
    const many = [{ name: 'M.java', content: `public class M {\n${Array.from({ length: 12 }, (_, i) => `    public static int f${i}(int n) { return n + ${i}; }`).join('\n')}\n}\n` }];
    const spread = planTests(many);
    assert.equal(new Set(spread.cases.map(c => c.method)).size, 12);
    // Statement calls: build an object, change it, check a value; or check what statements print.
    const project = { version: 1, name: 'Objects', example: '', files, mainClass: 'Main', stdin: '', maxSteps: 100, checks: [] };
    const runBase = { files, mainClass: 'Main', stdin: '', maxSteps: 100, timeoutMs: 3000, mode: 'run' };
    const stateful = { name: 'add twice', kind: 'call', target: 'Counter', call: 'Counter c = new Counter(1); c.add(2); c.add(3); c.value()', stdin: '', expectedOutput: '6' };
    const printed = { name: 'stars', kind: 'call', target: 'Counter', call: 'stars(3);', stdin: '', expectedOutput: '"***"' };
    assert.deepEqual(testProblems(stateful, project), []);
    assert.deepEqual(testProblems({ ...stateful, call: 'if (true) { x(); }' }, project).length, 1);
    for (const check of [stateful, printed]) assert.equal(evaluateTest(await execute(requestForTest(project, check, runBase)), check).passed, true, check.call);
    const shapes = callShape('Counter c = new Counter(1); c.add(2); c.value()');
    assert.deepEqual(shapes, { statements: ['Counter c = new Counter(1)', 'c.add(2)'], result: 'c.value()' });
    assert.equal(callShape('Counter.stars(2);').result, null);
    assert.deepEqual(splitStatements('a("x;y"); b(\';\'); c'), ['a("x;y")', "b(';')", 'c']);
    assert.equal(qualifyCall('stars(2); stars(3);', 'Counter', files), 'Counter.stars(2); Counter.stars(3);');
    // AI suggestions: unknown classes and malformed tests are dropped; the rest run on the JVM next to the code.
    const reply = JSON.stringify({ tests: [
      { kind: 'call', target: 'Counter', call: 'Counter c = new Counter(0); c.add(5); c.value()', expected: '5', why: 'adds to the start' },
      { kind: 'call', target: 'Counter', call: 'new Counter(-1).value()', expected: '0', why: 'a wrong guess' },
      { kind: 'call', target: 'Nope', call: 'x()', expected: '1' },
      { kind: 'call', target: 'Counter', call: 'a();; b()', expected: '1' },
      { kind: 'output', name: 'Main output', stdin: '', expected: '5' },
    ] });
    const parsed = parseAiTests(`Here you go:\n${reply}`, files);
    assert.equal(parsed.tests.length, 3); assert.equal(parsed.dropped, 2);
    const cases = parsed.tests.filter(t => t.kind === 'call').map((t, id) => ({ id, expression: qualifyCall(t.call, t.target, files) }));
    const ran = batchResults(output(await execute(batchRequest(runBase, '', cases).request), 'stdout'));
    assert.equal(valuesMatch(parsed.tests[0].expected, ran.get(0).value), true, 'the code agrees');
    assert.deepEqual([valuesMatch(parsed.tests[1].expected, ran.get(1).value), ran.get(1).value], [false, '-1'], 'a disagreement is shown, not trusted');
    assert.equal(typeof parseAiTests('no json here', files), 'string');
    // A reply cut off mid-way keeps the tests that were complete.
    const cut = parseAiTests(reply.slice(0, reply.indexOf('a wrong guess')), files);
    assert.deepEqual(cut.tests.map(t => t.call), ['Counter c = new Counter(0); c.add(5); c.value()']);
    const messages = aiTestMessages(files, [], plan, { hasMain: true, mainClass: 'Main' });
    assert.match(messages[0].content, /SHOULD do/);
    assert.match(messages[1].content, /### Counter\.java/);
  });
  await test('spelling checks words in comments, text and names; lint messages get explanations', async () => {
    const src = 'public class Main {\n    // We recieve the numbrs here\n    static int totalAmout = 0; // see https://exampel.com\n    String s = "Helo %d\\n";\n    char c = \'x\';\n}\n';
    const tokens = checkable(spellingTokens(src));
    const words = tokens.map(t => t.word);
    assert.ok(words.includes('recieve') && words.includes('numbrs') && words.includes('Amout') && words.includes('Helo'), words.join());
    assert.ok(!words.includes('exampel') && !words.includes('d') && !words.includes('int'), 'URLs, format specifiers and short words are skipped');
    assert.equal(tokens.find(t => t.word === 'Amout').kind, 'name');
    assert.equal(src.slice(tokens.find(t => t.word === 'recieve').offset).startsWith('recieve'), true);
    const { default: nspell } = await import('nspell');
    const speller = nspell(readFileSync('node_modules/dictionary-en/index.aff', 'utf8'), readFileSync('node_modules/dictionary-en/index.dic', 'utf8'));
    assert.deepEqual(['recieve', 'numbrs', 'Amout', 'Helo', 'total', 'Main', 'static'].filter(w => !speller.correct(w)), ['recieve', 'numbrs', 'Amout', 'Helo']);
    assert.ok(speller.suggest('recieve').includes('receive'));
    assert.match(lintHelp('Empty control-flow statement'), /semicolon right after if/);
    assert.match(lintHelp('The assignment to variable count has no effect'), /this\.count = count/);
    assert.match(lintHelp('Null pointer access: The variable t can only be null at this location'), /t is always null/);
    assert.match(lintHelp('Unlikely argument type for equals(): int seems to be unrelated to String'), /never equal/);
    assert.equal(lintHelp('Some message TraceLab does not know'), null);
  });
  await test('Java language server: completion, problems as you type, quick fixes and rename across files', async () => {
    const health = await api('/api/health');
    if (health.languageServer === 'unavailable') { console.log('SKIP language server (none installed; run npm run setup:jdtls)'); return; }
    const client = new JavaLanguageClient(base);
    const diagnostics = {};
    client.onDiagnostics = (file, list) => { diagnostics[file] = list; };
    const main = 'public class Main {\n    public static void main(String[] args) {\n        String name = "abc";\n        int total = Helper.twice(3);\n        if (total > 2);\n        System.out.println(name.length() + total);\n        ArrayList<String> xs = new ArrayList<>();\n    }\n}\n';
    const helper = 'public class Helper {\n    public static int twice(int n) {\n        return n * 2;\n    }\n}\n';
    await client.connect([{ name: 'Main.java', content: main }, { name: 'Helper.java', content: helper }]);
    assert.equal(client.state, 'ready', client.reason);
    for (let i = 0; i < 300 && !(diagnostics['Main.java'] ?? []).some(d => /ArrayList/.test(d.message)); i++) await sleep(100);
    const messages = (diagnostics['Main.java'] ?? []).map(d => d.message);
    assert.ok(messages.includes('Empty control-flow statement'), messages.join(' | '));
    assert.ok(messages.some(m => /ArrayList cannot be resolved to a type/.test(m)), messages.join(' | '));
    const completion = await client.request('textDocument/completion', { textDocument: { uri: client.uri('Main.java') }, position: { line: 5, character: 32 } });
    assert.ok((completion.items ?? completion).some(i => i.label.startsWith('length')), 'member completion on a String');
    // Quick fixes need the server's latest diagnostics, which can be republished while the project is still being built.
    let actions = [];
    for (let i = 0; i < 20 && !actions.some(a => a.title === "Import 'ArrayList' (java.util)"); i++) {
      if (i) await sleep(500);
      const unresolved = diagnostics['Main.java'].filter(d => /ArrayList/.test(d.message));
      actions = await client.request('textDocument/codeAction', { textDocument: { uri: client.uri('Main.java') }, range: unresolved[0].range, context: { diagnostics: unresolved } });
    }
    assert.ok(actions.some(a => a.title === "Import 'ArrayList' (java.util)"), actions.map(a => a.title).join(' | '));
    // Renaming across files needs the server's search index, which can lag behind the first diagnostics.
    let changed = [], rename;
    for (let i = 0; i < 20 && changed.length < 2; i++) {
      if (i) await sleep(500);
      rename = await client.request('textDocument/rename', { textDocument: { uri: client.uri('Helper.java') }, position: { line: 1, character: 23 }, newName: 'doubled' }, 30000);
      changed = [...Object.keys(rename.changes ?? {}), ...(rename.documentChanges ?? []).map(c => c.textDocument.uri)].map(uri => client.nameOf(uri)).sort();
    }
    assert.deepEqual(changed, ['Helper.java', 'Main.java'], JSON.stringify(rename));
    // A second page reuses the running server instead of initializing it again.
    const again = new JavaLanguageClient(base);
    await again.connect([{ name: 'Main.java', content: main }]);
    assert.equal(again.state, 'ready', again.reason);
    await api('/api/lsp/stop', { method: 'POST', body: '{}' });
  });
  await test('need help: loop passes, cells read, recursive calls and output differences from the recording', async () => {
    const bounds = await execute(request(examples[0]));
    const help = buildHelp(bounds, { question: questionsFor(bounds)[0], step: 0, checks: examples[0].checks });
    assert.equal(help.title, 'Why ArrayIndexOutOfBoundsException happened');
    const table = help.visuals.find(v => v.kind === 'table');
    assert.deepEqual(table.columns.slice(0, 3), ['Step', 'Line', 'Pass']);
    assert.equal(table.rows.at(-1).mark, 'error');
    assert.equal(table.rows.at(-1).cells[2], '4', 'the header ran a 4th time before the failing pass');
    const cells = help.visuals.find(v => v.kind === 'cells');
    assert.deepEqual(cells.cells.filter(c => c.outside).map(c => c.index), [3]);
    assert.ok(help.story.some(s => /header on line 6 ran 4 times/.test(s)), help.story.join(' | '));
    const runaway = await execute(request(example('sumto')));
    const recursion = buildHelp(runaway, { step: snapshots(runaway).length - 1 });
    assert.equal(recursion.title, 'Why the program didn’t finish');
    const calls = recursion.visuals.find(v => v.kind === 'calls');
    assert.equal(calls.title, 'The recursive calls');
    assert.match(calls.calls[0].label, /^Main\.sumTo\(/);
    assert.ok(calls.calls[1].depth > calls.calls[0].depth);
    const wrong = await execute(oneFile('public class Main {\n public static void main(String[] args) {\n System.out.println("Total: 6");\n System.out.println("Average: 2");\n }\n}'));
    const diff = buildHelp(wrong, { step: 0, checks: [{ name: 'avg', stdin: '', expectedOutput: 'Total: 6\nAverage: 2.0' }] });
    assert.equal(diff.title, 'Why the output doesn’t match');
    assert.deepEqual(diff.visuals.find(v => v.kind === 'diff').lines.map(l => l.same), [true, false]);
    assert.equal(enclosingLoop('class A {\n void f() {\n  for (int i = 0; i < 3; i++) {\n   x();\n  }\n  do { y(); } while (z);\n }\n}', 4).header, 3);
  });
  await test('every uncaught exception type gets an explanation question', async () => {
    const cases = [
      ['import java.util.*;\npublic class Main {\n public static void main(String[] args) {\n List<Integer> xs = List.of(1, 2);\n xs.add(3);\n }\n}', 'exception-unsupportedoperation', '', /unmodifiable|doesn’t allow/],
      ['import java.util.*;\npublic class Main {\n public static void main(String[] args) {\n List<Integer> xs = new ArrayList<>(List.of(1, 2, 3));\n System.out.println(xs.get(3));\n }\n}', 'exception-indexoutofbounds', '', /outside a list/],
      ['import java.util.*;\npublic class Main {\n public static void main(String[] args) {\n Scanner in = new Scanner(System.in);\n int n = in.nextInt();\n }\n}', 'exception-inputmismatch', 'abc', /token that isn’t the type/],
      ['public class Main {\n public static void main(String[] args) {\n Object o = "text";\n Integer n = (Integer) o;\n }\n}', 'exception-classcast', '', /cast asked Java/],
    ];
    for (const [source, id, stdin, meaning] of cases) {
      const data = await execute({ ...oneFile(source), stdin });
      const q = questionsFor(data).find(x => x.id === id);
      assert.ok(q, `${id} in ${questionsFor(data).map(x => x.id)}`);
      assert.match(q.options[q.correct], meaning);
      assert.equal(new Set(q.options).size, 3);
      if (stdin) assert.match(q.context, /The input had 1 token/);
    }
  });
  await test('practice problems: every concept and variant runs, and the JVM’s result is one of the options', async () => {
    for (const concept of practiceConcepts) {
      // Three seeds per concept, chosen so that every variant (distinct title) runs at least once.
      const titles = new Map();
      for (let seed = 1; seed <= 80; seed++) { const t = practiceFor(concept, seed).title.replace(/,.*/, ''); if (!titles.has(t)) titles.set(t, seed); }
      const seeds = [...new Set([...titles.values(), 1, 2, 3])].slice(0, Math.max(3, titles.size));
      for (const seed of seeds) {
        const item = practiceFor(concept, seed);
        assert.equal(item.concept, concept);
        const data = await execute({ ...oneFile(item.code), maxSteps: 100, timeoutMs: 3000, mode: 'run' });
        const outcome = practiceOutcome(data.events);
        assert.notEqual(outcome.kind, 'other', `${concept} #${seed} finished: ${JSON.stringify(data.events.slice(-2))}`);
        const { options, correct } = practiceOptions(item, outcome, seed);
        assert.equal(options[correct], answerText(outcome));
        assert.ok(options.length >= 3 && new Set(options).size === options.length, `${concept} #${seed}: ${options.join(' | ')}`);
      }
    }
    assert.equal(practiceFor('array-bounds', 42).code, practiceFor('array-bounds', 42).code, 'a seed always gives the same problem');
  });
  await test('AI assistant: context from the recording, key kept on the server, streamed answers and provider errors', async () => {
    // A stand-in for an OpenAI-compatible server (Ollama, Gemini, …).
    const seen = [];
    const mock = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
        if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"mock-small"},{"id":"mock-coder"}]}'); return; }
        const request = JSON.parse(body);
        if (request.model === 'bad') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"invalid api key"}}'); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // Practice requests get a problem whose "wrong" answers include the real one, which TraceLab must drop.
        const practiceReply = JSON.stringify({ title: 'Queue order', code: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Deque<Integer> q = new ArrayDeque<>();\n        q.add(1); q.add(2); q.push(3);\n        System.out.println(q.poll() + " " + q.poll());\n    }\n}', prompt: 'What does this program print?', wrong: ['1 2', '3 1', '2 1'], why: 'push adds at the head.' });
        const pieces = /practice problems/.test(request.messages[0].content) ? [practiceReply.slice(0, 40), practiceReply.slice(40)] : ['Index ', '3 is ', '**past** the end.'];
        for (const piece of pieces) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise(r => mock.listen(0, '127.0.0.1', r));
    const port = mock.address().port;
    try {
      assert.deepEqual(await api('/api/assist/config'), { configured: false });
      const remoteHttp = await fetch(base + '/api/assist/config', { method: 'POST', headers, body: JSON.stringify({ provider: 'custom', url: 'http://example.com/v1', model: 'm' }) });
      assert.equal(remoteHttp.status, 400, 'plain http is only for servers on this computer');
      const saved = await api('/api/assist/config', { method: 'POST', body: JSON.stringify({ provider: 'custom', url: `http://127.0.0.1:${port}/v1/`, model: 'mock-coder', key: 'sk-test-123' }) });
      assert.equal(saved.configured, true); assert.equal(saved.hasKey, true); assert.equal(saved.local, true);
      assert.ok(!JSON.stringify(await api('/api/assist/config')).includes('sk-test-123'), 'the key never goes back to the browser');
      assert.deepEqual((await api('/api/assist/models', { method: 'POST', body: '{}' })).models, ['mock-coder', 'mock-small']);
      const bounds = await execute(request(examples[0]));
      const states = snapshots(bounds);
      const q = questionsFor(bounds)[0];
      const context = contextMessage({ project: examples[0], activeFile: 'ArraySum.java', run: bounds, step: states.length - 1, dirty: false, question: q, questionSolved: false });
      assert.match(context, /Uncaught java\.lang\.ArrayIndexOutOfBoundsException at ArraySum\.java:7: Index 3 out of bounds for length 3/);
      assert.match(context, /i = 3/);
      assert.match(context, /Do not reveal the answer/);
      assert.match(context, /  6 \| /, 'source is sent with line numbers');
      const { id } = await api('/api/assist/chat', { method: 'POST', body: JSON.stringify({ messages: buildMessages(context, [], 'Why did it fail?') }) });
      let page;
      for (let i = 0; i < 100; i++) { page = await api(`/api/assist/chat/${id}`); if (page.status !== 'running') break; await sleep(100); }
      assert.equal(page.status, 'done', page.error);
      assert.equal(page.text, 'Index 3 is **past** the end.');
      const chat = seen.find(s => s.url === '/v1/chat/completions');
      assert.equal(chat.auth, 'Bearer sk-test-123');
      assert.equal(chat.body.model, 'mock-coder'); assert.equal(chat.body.stream, true);
      assert.match(chat.body.messages[0].content, /tutor inside TraceLab/);
      assert.equal(chat.body.messages.at(-1).content, 'Why did it fail?');
      // AI practice: the model writes the program and wrong answers; the JVM supplies the answer.
      const asked = await api('/api/assist/chat', { method: 'POST', body: JSON.stringify({ messages: aiPracticeMessages('bfs', 'Breadth-first search', 7), maxTokens: 2048 }) });
      for (let i = 0; i < 100; i++) { page = await api(`/api/assist/chat/${asked.id}`); if (page.status !== 'running') break; await sleep(100); }
      const written = parseAiPractice(page.text, 'bfs');
      assert.equal(written.source, 'ai', JSON.stringify(written));
      const outcome = practiceOutcome((await execute({ ...oneFile(written.code), maxSteps: 100, timeoutMs: 3000, mode: 'run' })).events);
      assert.deepEqual(outcome, { kind: 'output', text: '3 1' });
      const { options, correct } = practiceOptions(written, outcome, 7);
      assert.equal(options[correct], '3 1');
      assert.deepEqual([...options].sort(), ['1 2', '2 1', '3 1'], 'the model’s “wrong” answer that was right is not offered twice');
      assert.match(parseAiPractice('{"title":"x","code":"import java.io.File;\\npublic class Main { public static void main(String[] a) {} }","prompt":"?","wrong":["1","2"],"why":"y"}', 'bfs'), /outside java\.util/);
      assert.match(unsafeProgram('public class Main { public static void main(String[] a) throws Exception { Runtime.getRuntime().exec("calc"); } }'), /Runtime/);
      assert.match(unsafeProgram('public class Main { public static void main(String[] a) { new Thread(() -> {}).start(); } }'), /Thread/);
      assert.equal(unsafeProgram('import java.util.*;\npublic class Main { public static void main(String[] a) { List<Integer> shortestPath = new ArrayList<>(); System.out.println("Files"); } }'), null);
      assert.equal(typeof parseAiPractice('Sure! Here is a problem.', 'bfs'), 'string');
      await api('/api/assist/config', { method: 'POST', body: JSON.stringify({ provider: 'custom', url: `http://127.0.0.1:${port}/v1`, model: 'bad' }) });
      const failed = await api('/api/assist/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
      for (let i = 0; i < 100; i++) { page = await api(`/api/assist/chat/${failed.id}`); if (page.status !== 'running') break; await sleep(100); }
      assert.equal(page.status, 'error');
      assert.match(page.error, /401: invalid api key\. Check the API key/);
      assert.equal(seen.at(-1).auth, 'Bearer sk-test-123', 'an empty key field keeps the saved key');
      assert.equal(renderMarkdown('Use `i < n`.\n\n- <script>x</script>\n\n```java\nint[] a = {1};\n```'), '<p>Use <code>i &lt; n</code>.</p><ul><li>&lt;script&gt;x&lt;/script&gt;</li></ul><pre class="md-code"><code>int[] a = {1};</code></pre>');
    } finally {
      mock.close();
      await api('/api/assist/config', { method: 'DELETE' });
    }
  });
  await test('data structures: List.of/Set.of/Map.of, Stack and unmodifiable views, and binary trees drawn as trees', async () => {
    const data = await execute(oneFile(`import java.util.*;
public class Main {
    public static void main(String[] args) {
        List<String> one = List.of("x");
        List<Integer> many = List.of(1, 2, 3);
        Set<Integer> set = Set.of(5, 6, 7);
        Map<String, Integer> map = Map.of("a", 1, "b", 2);
        List<Integer> view = Collections.unmodifiableList(new ArrayList<>(List.of(9, 8)));
        Stack<Integer> stack = new Stack<>();
        stack.push(1); stack.push(2);
        System.out.println(one.size() + many.size() + set.size() + map.size() + view.size() + stack.peek());
    }
}`));
    const last = snapshots(data).filter(s => s.frames).at(-1);
    const heap = new Map(last.heap.map(o => [o.id, o]));
    const local = name => heap.get(last.frames[0].locals.find(v => v.name === name).value.ref);
    const items = o => (o.elements ?? []).map(e => e.kind === 'reference' ? heap.get(e.ref)?.text ?? heap.get(e.ref)?.fields?.[0]?.value.value : e.value);
    assert.deepEqual([local('one').kind, items(local('one'))], ['list', ['x']]);
    assert.deepEqual(items(local('many')), ['1', '2', '3']);
    assert.deepEqual([local('set').kind, items(local('set')).sort()], ['set', ['5', '6', '7']]);
    assert.equal(local('map').kind, 'map'); assert.equal(local('map').entries.length, 2);
    assert.deepEqual(items(local('view')), ['9', '8']);
    assert.match(local('view').message, /Unmodifiable view of an ArrayList/);
    assert.deepEqual([local('stack').kind, items(local('stack'))], ['list', ['1', '2']]);
    const bst = await execute(request(example('bst')));
    const states = snapshots(bst);
    const built = states.find(s => s.location?.file === 'Main.java' && s.location.line === 9);
    const [tree] = treeViews(built);
    assert.equal(tree.type, 'Node');
    assert.equal(tree.nodes.length, 7); assert.equal(tree.edges.length, 6);
    assert.deepEqual([...tree.nodes].sort((a, b) => a.x - b.x).map(n => n.label), ['20', '30', '40', '50', '60', '70', '80'], 'in-order layout reads sorted');
    assert.deepEqual(tree.nodes.find(n => n.label === '50'), { ...tree.nodes.find(n => n.label === '50'), depth: 0, refs: ['root'] });
    assert.equal(treeViews(snapshots(await execute(request(example('nodes')))).find(s => s.heap?.length > 3)).length, 0, 'a linked list (one self field) is not a tree');
  });
  const fib = `public class Main {
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }
    public static void main(String[] args) {
        int f = fib(20);
        int total = 0;
        for (int i = 0; i < 30; i++) {
            total += i;
        }
        System.out.println(f + " " + total);
    }
}`;
  await test('recording start points: a line, a condition, a hit count, and clear reasons when they never fire', async () => {
    const lines = data => snapshots(data).filter(s => s.frames);
    const at = (data, name) => lines(data)[0].frames[0].locals.find(v => v.name === name)?.value.value;
    // fib(20) makes 21,891 calls; starting after it records only the last line.
    const late = await execute({ ...oneFile(fib), startAt: { file: 'Main.java', line: 14, condition: '', hit: 1 } });
    assert.equal(reason(late), 'completed');
    assert.equal(lines(late)[0].location.line, 14);
    assert.equal(at(late, 'f'), '6765');
    assert.equal(at(late, 'total'), '435');
    assert.deepEqual(late.events.at(-1).start, { reached: true, file: 'Main.java', line: 14 });
    const conditional = await execute({ ...oneFile(fib), maxSteps: 50, startAt: { file: 'Main.java', line: 12, condition: 'i == 25 && total > 100', hit: 1 } });
    assert.deepEqual([lines(conditional)[0].location.line, at(conditional, 'i'), at(conditional, 'total')], [12, '25', '300']);
    // The third time fib runs with n == 1: frames that were already running get their own identities.
    const third = await execute({ ...oneFile(fib), maxSteps: 30, startAt: { file: 'Main.java', line: 3, condition: 'n == 1', hit: 3 } });
    const frames = lines(third)[0].frames;
    assert.equal(frames[0].locals.find(v => v.name === 'n').value.value, '1');
    assert.equal(new Set(frames.map(f => f.id)).size, frames.length);
    assert.ok(frames.every(f => /^f\d+$/.test(f.id)), frames.map(f => f.id).join());
    // A closing brace starts at the method's next line with code; nothing after the method's end does.
    const brace = await execute({ ...oneFile(fib), maxSteps: 20, startAt: { file: 'Main.java', line: 13, condition: '', hit: 1 } });
    assert.equal(lines(brace)[0].location.line, 14);
    const never = await execute({ ...oneFile(fib), startAt: { file: 'Main.java', line: 12, condition: 'i == 99', hit: 1 } });
    assert.equal(lines(never).length, 0);
    assert.match(never.events.at(-1).start.message, /reached line 12 of Main\.java 30 times, but i == 99 was never true/);
    const unknown = await execute({ ...oneFile(fib), startAt: { file: 'Main.java', line: 12, condition: 'j > 2', hit: 1 } });
    assert.match(unknown.events.at(-1).start.message, /`j` isn’t a variable or field on that line/);
    const empty = await execute({ ...oneFile(fib), startAt: { file: 'Main.java', line: 7, condition: '', hit: 1 } });
    assert.match(empty.events.at(-1).start.message, /no code that runs on line 7/);
    const bad = await execute({ ...oneFile(fib), startAt: { file: 'Main.java', line: 12, condition: 'i == == 2', hit: 1 } });
    assert.equal(reason(bad), 'bad-start');
    const missing = await fetch(base + '/api/runs', { method: 'POST', headers, body: JSON.stringify({ ...oneFile(fib), startAt: { file: 'Other.java', line: 1 } }) });
    assert.equal(missing.status, 400);
    // Plain runs ignore the start point.
    assert.equal(reason(await execute({ ...oneFile(fib), mode: 'run', startAt: { file: 'Main.java', line: 12, condition: 'i == 99' } })), 'completed');
    // The editor checks the same grammar as the worker, and start lines follow edits.
    assert.equal(checkCondition('visited[node] && dist[next] + 1 >= 3 || name == "ada" && list.size() > 0'), null);
    assert.match(checkCondition('i == == 2'), /Unexpected “==”/);
    assert.match(checkCondition('list.get(0) == 1'), /Only \.size\(\)/);
    assert.equal(describeStart({ file: 'Main.java', line: 4, condition: 'i == 2', hit: 3 }), 'line 4 of Main.java when i == 2, the 3rd time');
    assert.equal(shiftLine(10, [{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2 }, text: 'a\nb\n' }]), 12);
    assert.equal(shiftLine(10, [{ range: { startLineNumber: 3, startColumn: 1, endLineNumber: 5 }, text: '' }]), 8);
    assert.equal(shiftLine(10, [{ range: { startLineNumber: 10, startColumn: 9, endLineNumber: 10 }, text: '\n' }]), 10);
    assert.equal(shiftLine(10, [{ range: { startLineNumber: 10, startColumn: 1, endLineNumber: 10 }, text: '\n' }]), 11);
    assert.equal(validateProject({ ...examples[0], startAt: { file: 'ArraySum.java', line: 6, condition: 'i == 2' } }), true);
    assert.equal(validateProject({ ...examples[0], startAt: { file: 'Nope.java', line: 6 } }), false);
  });
  await test('capture: long linked structures, compact primitive arrays, and views of more JDK types', async () => {
    const data = await execute(oneFile(`import java.util.*;
import java.time.*;
import java.math.BigInteger;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
public class Main {
    static class Node { int value; Node next; Node(int value, Node next) { this.value = value; this.next = next; } }
    enum Color { RED, GREEN, BLUE }
    public static void main(String[] args) {
        Node head = null;
        for (int i = 0; i < 40; i++) {
            head = new Node(i, head);
        }
        int[] numbers = new int[50];
        Map<String, Integer> ages = new HashMap<>(Map.of("ann", 30, "bob", 25));
        Set<String> names = ages.keySet();
        Collection<Integer> years = ages.values();
        Set<Map.Entry<String, Integer>> entries = ages.entrySet();
        List<Integer> list = new ArrayList<>(List.of(4, 5, 6));
        Iterator<Integer> it = list.iterator();
        it.next();
        Optional<String> some = Optional.of("x");
        Optional<String> none = Optional.empty();
        BitSet bits = new BitSet();
        bits.set(1); bits.set(70);
        LocalDate date = LocalDate.of(2026, 10, 24);
        Duration span = Duration.ofMinutes(90);
        AtomicInteger counter = new AtomicInteger(42);
        BigInteger big = BigInteger.TWO.pow(70);
        TimeUnit unit = TimeUnit.SECONDS;
        EnumMap<Color, Integer> scores = new EnumMap<>(Color.class);
        scores.put(Color.BLUE, 3);
        System.out.println(head.value + numbers.length + names.size() + years.size() + entries.size() + it.next() + some.get() + none.isPresent() + bits + date + span + counter + big + unit + scores);
    }
}`));
    assert.equal(reason(data), 'completed');
    const last = snapshots(data).filter(s => s.frames).at(-1);
    const heap = new Map(last.heap.map(o => [o.id, o]));
    const local = name => heap.get(last.frames[0].locals.find(v => v.name === name).value.ref);
    const show = v => v.kind === 'reference' ? (heap.get(v.ref)?.text ?? heap.get(v.ref)?.fields?.[0]?.value.value) : v.value;
    assert.equal(last.heap.filter(o => o.type === 'Main$Node').length, 40, 'all 40 nodes are captured');
    assert.equal(local('numbers').elements.length, 50);
    assert.deepEqual(local('numbers').elements[0], { kind: 'primitive', type: 'int', value: '0' });
    const raw = await api(`/api/runs/${data.id}`);
    assert.ok(raw.events.some(e => e.heap?.some(o => o.elementType === 'int' && Array.isArray(o.values))), 'primitive arrays travel in compact form');
    assert.deepEqual([local('names').kind, local('names').elements.map(show).sort()], ['set', ['ann', 'bob']]);
    assert.deepEqual(local('years').elements.map(show).sort(), ['25', '30']);
    assert.equal(local('entries').entries.length, 2);
    const it = local('it');
    assert.deepEqual(it.fields.map(f => f.name.split('.').at(-1)), ['over', 'next', 'nextIndex']);
    assert.deepEqual([show(it.fields[1].value), it.fields[2].value.value], ['6', '2']);
    assert.equal(show(local('some').fields[0].value), 'x');
    assert.match(local('none').message, /Optional\.empty/);
    assert.deepEqual([local('bits').kind, local('bits').elements.map(show)], ['set', ['1', '70']]);
    assert.deepEqual(['date', 'span', 'counter', 'big', 'unit'].map(n => [local(n).kind, local(n).text]),
      [['value', '2026-10-24'], ['value', 'PT1H30M'], ['value', '42'], ['value', '1180591620717411303424'], ['value', 'SECONDS']]);
    assert.equal(local('scores').entries.length, 1);
    const deep = await execute(oneFile('public class Main {\n static int depth(int n) { if (n == 0) { return 0; } return 1 + depth(n - 1); }\n public static void main(String[] args) {\n  System.out.println(depth(40));\n }\n}'));
    assert.equal(Math.max(...snapshots(deep).filter(s => s.frames).map(s => s.frames.length)), 42, 'forty nested calls keep all their frames');
    assert.ok(!snapshots(deep).some(s => s.framesTruncated));
    // Returns are kept while many calls unwind between two stops.
    assert.equal(deep.events.flatMap(e => e.returns ?? []).filter(r => r.method === 'Main.depth').length, 41);
  });
  await test('structure views: graphs colored by the search, recursion trees, grids and linked lists', async () => {
    const bfs = await execute(request(example('bfs')));
    const states = snapshots(bfs);
    const during = states.find(s => s.location?.line === 28 && s.frames[0].locals.find(v => v.name === 'node')?.value.value === '1');
    const graphs = graphViews(during);
    assert.equal(graphs.length, 1, 'the edge list and the adjacency list built from it are drawn once');
    const [g] = graphs;
    assert.deepEqual([g.name, g.kind, g.directed, g.nodes.length, g.edges.length], ['neighbors', 'adjacency list', false, 5, 5]);
    const node = key => g.nodes.find(n => n.key === key);
    assert.deepEqual([node('0').x, node('1').x, node('2').x, node('3').x, node('4').x], [0, 1, 1, 2, 3], 'columns are distances from node 0');
    assert.equal(node('1').current, true);
    assert.deepEqual([node('2').queued, node('2').visited, node('1').badge, g.sources.badge, g.sources.queue], [1, true, '1', 'dist', 'queue']);
    assert.equal(node('4').visited, false);
    const dfs = await execute(request(example('dfs')));
    const dfsStates = snapshots(dfs);
    const deepest = dfsStates.find(s => s.frames?.filter(f => f.method === 'Main.visit').length === 3);
    const [d] = graphViews(deepest);
    assert.equal(d.directed, true);
    assert.deepEqual(d.nodes.filter(n => n.onPath || n.current).map(n => n.key).sort(), ['0', '1', '3']);
    assert.deepEqual(d.edges.filter(e => e.path).map(e => `${e.from}-${e.to}`), ['0-1', '1-3']);
    assert.equal(d.sources.visited, 'visited');
    const tree = recursionTree(dfsStates, dfsStates.length - 1);
    assert.deepEqual([tree.method, tree.calls, tree.nodes.find(n => n.depth === 0).label], ['Main.visit', 5, 'visit(0)']);
    assert.ok(tree.nodes.every(n => n.state === 'done'));
    const fibRun = await execute(oneFile('public class Main {\n static int fib(int n) {\n  if (n < 2) {\n   return n;\n  }\n  return fib(n - 1) + fib(n - 2);\n }\n public static void main(String[] args) {\n  System.out.println(fib(5));\n }\n}'));
    const fibTree = recursionTree(snapshots(fibRun), snapshots(fibRun).length - 1);
    assert.deepEqual([fibTree.calls, fibTree.columns, fibTree.rows], [15, 8, 5]);
    assert.equal(fibTree.nodes.find(n => n.depth === 0).result, '5');
    const mid = recursionTree(snapshots(fibRun), 6);
    assert.ok(mid.nodes.length < 15 && mid.nodes.some(n => n.state === 'current'), 'the tree grows as you step');
    const grid = await execute(oneFile(`public class Main {
    public static void main(String[] args) {
        char[][] maze = { "..#".toCharArray(), ".#.".toCharArray() };
        boolean[][] seen = new boolean[2][3];
        for (int r = 0; r < 2; r++) {
            for (int c = 0; c < 3; c++) {
                if (maze[r][c] == '.') {
                    seen[r][c] = true;
                }
            }
        }
        System.out.println(seen[1][2]);
    }
}`));
    const gridStates = snapshots(grid);
    const inside = gridStates.findIndex(s => s.location?.line === 7 && s.frames[0].locals.find(v => v.name === 'r')?.value.value === '1' && s.frames[0].locals.find(v => v.name === 'c')?.value.value === '2');
    const views = gridViews(gridStates[inside], gridStates[inside - 1], cursorsByObject(cursorsFor(grid, gridStates, inside)));
    const mazeView = views.find(v => v.name === 'maze');
    assert.deepEqual([mazeView.rows, mazeView.cols, mazeView.overlay], [2, 3, 'seen']);
    assert.deepEqual(mazeView.cells.map(row => row.map(c => c.tone || c.text)), [['visited', 'visited', 'wall'], ['visited', 'wall', '.']]);
    assert.deepEqual(mazeView.cells[1][2].marks, ['c'], 'maze[r][c] marks the cell in use');
    assert.deepEqual(mazeView.rowMarks[1], ['r']);
    const nodes = await execute(request(example('nodes')));
    const listState = snapshots(nodes).findLast(s => s.heap?.length > 3);
    const [chain] = chainViews(listState);
    assert.ok(chain.chains[0].nodes.length >= 2 && chain.chains[0].nodes[0].refs.length >= 1, JSON.stringify(chain));
    assert.equal(treeViews(listState).length, 0, 'a linked list is not a tree');
  });
  await test('Tutor questions about algorithms: queues, call counts, which call returns first, and depth-first order', async () => {
    const bfs = await execute(request(example('bfs')));
    const removal = questionsFor(bfs).find(q => q.id.startsWith('removal-'));
    assert.ok(removal, questionsFor(bfs).map(q => q.id).join());
    assert.deepEqual([removal.concept, removal.options[removal.correct]], ['bfs', '1']);
    assert.match(removal.context, /holding \[1, 2\], first to last/);
    const dfs = await execute(request(example('dfs')));
    assert.equal(answerOf(dfs, 'call-count'), '5');
    assert.equal(answerOf(dfs, 'first-return'), 'visit(4)');
    assert.equal(answerOf(dfs, 'next-call'), 'visit(3)');
    assert.equal(questionsFor(dfs).find(q => q.id === 'next-call').concept, 'dfs');
    const stack = await execute(oneFile('import java.util.*;\npublic class Main {\n public static void main(String[] args) {\n  Deque<Integer> stack = new ArrayDeque<>();\n  stack.push(1);\n  stack.push(2);\n  stack.push(3);\n  int top = stack.pop();\n  int next = stack.pop();\n  System.out.println(top + next);\n }\n}'));
    const popped = questionsFor(stack).find(q => q.id.startsWith('removal-'));
    assert.deepEqual([popped.concept, popped.options[popped.correct]], ['dfs', '3']);
  });
  await test('starter tests and clean runs: no bug is claimed without evidence', async () => {
    assert.equal(templates.find(t => t.id === 'blank').create('x').checks.length, 0, 'a blank project starts without tests');
    assert.ok(templates.filter(t => t.id !== 'blank').every(t => t.create('x').checks.every(c => c.origin === 'template' && isStarterCheck(c))));
    const legacy = { name: 'Prints a greeting', stdin: '', expectedOutput: 'Hello, TraceLab!' };
    assert.equal(isStarterCheck(legacy), true, 'projects made before origins were recorded');
    assert.equal(isStarterCheck({ ...legacy, name: 'Mine' }), false);
    const sum = oneFile('public class Main {\n    static int sum(int[] xs) { int t = 0; for (int x : xs) t += x; return t; }\n    public static void main(String[] args) {\n        System.out.println(sum(new int[]{1, 2, 3, 4, 5}));\n    }\n}\n');
    const data = await execute(sum);
    const mismatch = failingCheck(data, [legacy]);
    assert.deepEqual([mismatch.starter, mismatch.actual], [true, '15']);
    const help = buildHelp(data, { step: 0, checks: [legacy] });
    assert.equal(help.title, 'The output differs from a starter test');
    assert.ok(help.story.some(s => /came with the project template/.test(s)), help.story.join(' | '));
    assert.ok(!help.story.some(s => /step back from it/.test(s)), 'no bug hunt for a starter test');
    const own = { name: 'Sum', stdin: '', expectedOutput: '16' };
    const ownHelp = buildHelp(data, { step: 0, checks: [own] });
    assert.equal(ownHelp.title, 'Why the output doesn’t match');
    assert.ok(ownHelp.story.some(s => /If the program is right and the test expects the wrong thing/.test(s)));
    assert.match(originNote({ ...own, origin: 'generated' }), /generated from what the code did/);
    assert.match(originNote({ ...own, origin: 'ai' }), /AI assistant suggested/);
    assert.equal(failingCheck(data, [{ ...own, expectedOutput: '15' }]), null, 'a passing test is not a mismatch');
    assert.equal(validateProject({ ...examples[0], checks: [{ ...examples[0].checks[0], origin: 'ai' }] }), true);
    assert.equal(validateProject({ ...examples[0], checks: [{ ...examples[0].checks[0], origin: 'guess' }] }), false);
  });
  await test('Reset returns a project to how it was created', () => {
    const store = new Map();
    const kv = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    const library = new Library(kv, validateProject);
    const start = structuredClone(templates[0].create('Start'));
    const id = library.create(start);
    const edited = { ...structuredClone(start), name: 'Renamed', files: [{ name: 'Main.java', content: 'public class Main {}' }] };
    library.save({ kind: 'project', id }, edited);
    const reset = library.resetProject(id);
    assert.equal(reset.name, 'Renamed', 'the name stays');
    assert.deepEqual(reset.files, start.files);
    assert.deepEqual(library.load({ kind: 'project', id }).files, start.files);
    library.remove(id);
    assert.equal(library.original(id), null);
  });
  await test('project import rejects malformed nested values without throwing', () => {
    assert.equal(validateProject({ ...examples[0], files: [null] }), false);
    assert.equal(validateProject({ ...examples[0], checks: [null] }), false);
    assert.equal(validateProject(structuredClone(examples[0])), true);
  });
  await test('C runs: states after each statement, frames and pointers, errors where they happen, and the C tutor’s hints', async () => {
    const bounds = await execute(request(example('c-bounds')));
    assert.equal(reason(bounds), 'exception');
    const failure = bounds.events.find(e => e.kind === 'exception');
    assert.deepEqual([failure.location.line, failure.location.phase, failure.errorKind, failure.exception.type], [7, 'after', 'index_out_of_bounds', 'Index out of bounds']);
    assert.deepEqual(failure.frames.map(f => [f.method, f.line]), [['sum', 7], ['main', 14]], 'innermost first, the caller at the line of the call');
    assert.equal(failure.frames[0].locals.find(v => v.name === 'i').value.value, '3');
    assert.equal(failure.frames[1].locals.find(v => v.name === 'values').type, 'int[3]');
    const array = failure.heap.find(o => o.kind === 'array');
    assert.deepEqual(array.elements.map(e => e.value), ['4', '7', '2']);
    assert.equal(failure.frames[0].locals.find(v => v.name === 'values').value.ref, array.id, 'the pointer parameter refers to main’s array');
    const hints = hintsForError(cErrorOf(bounds));
    assert.equal(hints.title, 'Array index out of bounds');
    assert.match(hints.hints[0].text, /length 3 has valid indices 0 to 2/);
    assert.deepEqual(questionsFor(bounds), [], 'C runs get hints, not Java questions');
    const states = snapshots(bounds);
    assert.ok(states.slice(0, -1).every(s => s.location?.phase === 'after'));
    assert.match(evaluateTest(await execute(request(example('c-bounds'), { mode: 'run' })), example('c-bounds').checks[0]).detail, /Index out of bounds: array index 3 out of bounds/);

    const parse = await execute(single('c', 'int main(void) {\n    int x = 5\n    return 0;\n}\n'));
    assert.equal(reason(parse), 'compile-error');
    const diagnostic = parse.events.find(e => e.kind === 'diagnostic');
    assert.deepEqual([diagnostic.file, diagnostic.line, diagnostic.errorKind, diagnostic.stage], ['main.c', 3, 'parse_missing_semicolon', 'parse']);
    assert.equal(hintsForError(cErrorOf(parse)).title, 'Missing semicolon');

    const loop = await execute(single('c', 'int main(void) {\n    while (1) {}\n    return 0;\n}\n', { maxSteps: 50 }));
    assert.equal(reason(loop), 'step-limit');
    assert.equal(snapshots(loop).length, 51, 'exactly the step budget, then the end');
    assert.equal(cErrorOf(loop).kind, 'infinite_loop');
    const plainLoop = await execute(single('c', 'int main(void) {\n    while (1) {}\n    return 0;\n}\n', { mode: 'run', timeoutMs: 1500 }));
    assert.ok(['step-limit', 'timeout'].includes(reason(plainLoop)), reason(plainLoop));

    const swapped = structuredClone(example('c-swap'));
    swapped.files[0].content = swapped.files[0].content.replace('void swap(int a, int b) {\n    int temp = a;\n    a = b;\n    b = temp;', 'void swap(int *a, int *b) {\n    int temp = *a;\n    *a = *b;\n    *b = temp;').replace('swap(x, y);', 'swap(&x, &y);');
    const pointers = await execute(request(swapped));
    assert.equal(output(pointers, 'stdout').trim(), '2 1');
    const inSwap = snapshots(pointers).find(s => s.frames?.[0]?.method === 'swap');
    assert.equal(inSwap.frames[0].locals[0].value.value, '&x in main', 'a pointer to a variable reads &x');

    const list = await execute(request(example('c-list')));
    assert.equal(reason(list), 'completed');
    const end = snapshots(list).filter(s => s.frames).at(-1);
    const chain = chainViews(end)[0];
    assert.deepEqual(chain.chains[0].nodes.map(n => n.label), ['30', '20', '10']);
    const pushes = snapshots(list).flatMap(s => s.returns ?? []).filter(r => r.method === 'push');
    assert.equal(pushes.length, 3, 'returns are reported per call');
    assert.notEqual(pushes[0].frameId, pushes[1].frameId, 'each call has its own frame id');
    const stop = await api('/api/runs', { method: 'POST', body: JSON.stringify(single('c', 'int main(void) { int i = 0; while (1) { i = i + 1; } return 0; }', { mode: 'run', timeoutMs: 15000 })) });
    await sleep(200);
    await api(`/api/runs/${stop.id}`, { method: 'DELETE' });
    assert.equal(reason(await wait(stop.id)), 'cancelled');
  });
  await test('Python runs: pg_logger steps become TraceLab events one for one, with Python values, errors and input', async () => {
    const pairs = await execute(request(example('py-pairs')));
    assert.equal(reason(pairs), 'exception');
    const result = pythonResult(pairs);
    const states = snapshots(pairs);
    assert.equal(states.length, result.trace.length + 1, 'one snapshot per raw step, then the end');
    assert.ok(result.trace.every((step, i) => states[i].location.line === step.line));
    const failure = states[result.error_step];
    assert.deepEqual([failure.exception.type, failure.exception.caught, failure.location.line], ['AttributeError', false, 20]);
    assert.deepEqual(failure.frames.map(f => f.method), ['sum_of_pairs', '<module>']);
    assert.equal(failure.frames[1].line, 26, 'the module frame shows the line of the call');
    const node = failure.heap.find(o => o.type === 'Node');
    assert.deepEqual(node.fields.map(f => f.name), ['next', 'val']);
    assert.ok(chainViews(failure).length, 'the linked list is drawn as a chain');
    const questions = questionsFor(pairs);
    assert.ok(questions.length && questions.every(q => q.id.startsWith('py:') && q.concept.startsWith('python:') && q.topic));
    const repair = questions.find(q => q.kind === 'repair' && q.patched);
    assert.ok(repair, questions.map(q => q.id).join(', '));
    const fixed = await execute(request({ ...example('py-pairs'), files: [{ name: 'main.py', content: repair.patched }] }));
    assert.equal(reason(fixed), 'completed');
    assert.equal(output(fixed, 'stdout').trim(), 'sum: 8');
    assert.equal(pythonFix(pairs).diff.patched, repair.patched, 'the suggested fix is the repair question’s answer');
    const returned = snapshots(await execute(request(example('py-factorial')))).flatMap(s => s.returns ?? []);
    assert.deepEqual(returned.map(r => r.value.value), ['1', '2', '6', '24']);

    const syntax = await execute(single('python', 'x = 3\nif x > 1\n    print(x)\n'));
    assert.equal(reason(syntax), 'compile-error');
    const diagnostic = syntax.events.find(e => e.kind === 'diagnostic');
    assert.deepEqual([diagnostic.line, diagnostic.message.split(':')[0]], [2, 'SyntaxError']);
    assert.ok(questionsFor(syntax).some(q => q.kind === 'repair' && q.step === -1));

    const greet = await execute(single('python', 'name = input("Name? ")\nprint("Hi", name)\n', { stdin: 'Ada\n' }));
    assert.equal(output(greet, 'stdout'), 'Name? Ada\nHi Ada\n', 'pg_logger echoes input like a terminal');
    const plainGreet = await execute(single('python', 'name = input("Name? ")\nprint("Hi", name)\n', { stdin: 'Ada\n', mode: 'run' }));
    assert.equal(output(plainGreet, 'stdout'), output(greet, 'stdout'), 'plain runs (tests) print the same');
    assert.equal(reason(await execute(single('python', 'a = input()\nb = input()\n', { stdin: 'one' }))), 'needs-input');
    const loop = await execute(single('python', 'while True:\n    pass\n', { maxSteps: 40 }));
    assert.equal(reason(loop), 'step-limit');
    assert.equal(snapshots(loop).length, 41, 'the step budget, then the end');
    const flood = await execute(single('python', 'while True:\n    print("x" * 80)\n', { maxSteps: 2000 }));
    assert.equal(reason(flood), 'output-limit');
    const blocked = await execute(single('python', 'import os\nprint(os.getcwd())\n'));
    assert.equal(blocked.events.find(e => e.exception)?.exception.type, 'ImportError', 'imports are limited, as in Python Tutor');
    const caught = await execute(single('python', 'try:\n    1 / 0\nexcept ZeroDivisionError:\n    print("caught")\n'));
    assert.equal(reason(caught), 'completed');
    assert.ok(snapshots(caught).some(s => s.exception?.caught === true));
  });
  await test('Python Tutor questions (the python branch’s self-check): expected concepts, valid questions, and repairs that fix the program', async () => {
    const problems = [];
    const run = async (code, stdin = []) => pythonResult(await execute(single('python', code, { stdin: stdin.join('\n'), maxSteps: 1000 })));
    for (const c of PY_CASES) {
      const result = await run(c.code, c.stdin);
      const plan = planQuiz(result, c.code);
      if ((plan.needsAi ? 'ai' : 'local') !== c.expect) problems.push(`${c.name}: expected ${c.expect}`);
      const concepts = new Set(plan.questions.map(q => q.concept));
      for (const want of c.concepts ?? []) if (!concepts.has(want)) problems.push(`${c.name}: no "${want}" question (got ${[...concepts].join(', ')})`);
      for (const q of plan.questions) {
        if (q.options.length !== 3 || new Set(q.options).size !== 3 || q.correct < 0 || q.correct > 2) problems.push(`${c.name}/${q.id}: bad options`);
        if (q.step >= result.trace.length || (q.step < 0 && result.trace.length > 0)) problems.push(`${c.name}/${q.id}: step ${q.step} out of range`);
        if (/\$\{|undefined|NaN|\[object/.test(q.context + q.prompt + q.options.join('') + q.explanation)) problems.push(`${c.name}/${q.id}: unfilled text`);
        if (q.kind !== 'repair') continue;
        if (!q.edit) { problems.push(`${c.name}/${q.id}: repair without an edit`); continue; }
        const fixed = await run(applyRepair(c.code, q.edit, q.options[q.correct]), c.stdin);
        if (fixed.status !== 'ok') { problems.push(`${c.name}/${q.id}: the correct option gives ${fixed.status} (${fixed.message})`); continue; }
        for (let i = 0; i < q.options.length; i++) {
          if (i === q.correct) continue;
          const wrong = await run(applyRepair(c.code, q.edit, q.options[i]), c.stdin);
          if (wrong.status === 'ok' && wrong.stdout === fixed.stdout) problems.push(`${c.name}/${q.id}: wrong option ${q.options[i]} also fixes it`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
  await test('C and Python projects: validation, examples, import and export, spelling and the assistant', async () => {
    for (const language of ['c', 'python']) {
      const project = singleFileProject('Mine', language, language === 'c' ? 'int main(void) { return 0; }' : 'print(1)');
      assert.ok(validateProject(project), language);
      assert.equal(validateProject({ ...project, files: [...project.files, { name: `other.${language === 'c' ? 'c' : 'py'}`, content: '' }] }), false, 'one file');
      assert.equal(validateProject({ ...project, files: [{ name: 'Main.java', content: '' }] }), false, 'the file matches the language');
      assert.equal(validateProject({ ...project, startAt: { file: project.files[0].name, line: 1 } }), false, 'no start points');
      assert.equal(validateProject({ ...project, checks: [{ name: 'm', stdin: '', expectedOutput: '1', kind: 'call', target: 'Main', call: 'f()' }] }), false, 'output tests only');
      assert.equal(validateProject({ ...project, language: 'ruby' }), false);
      assert.deepEqual(await decodeProject(await encodeProject(project)), project, 'share links keep the language');
      const zip = await projectFromZip(await projectToZip(project), 'zip');
      assert.deepEqual([zip.project.language, zip.project.files], [language, project.files]);
    }
    const demosByLanguage = Object.groupBy(demos.filter(d => d.language), d => d.language);
    assert.deepEqual(Object.keys(demosByLanguage).sort(), ['c', 'python']);
    for (const d of demos.filter(d => d.language)) assert.equal(example(d.id).language, d.language, d.id);
    assert.equal(validateProject({ ...examples[0], language: undefined }), true, 'Java projects need no language');
    const tokens = spellingTokens('# a misspeled coment\nx = 7 // 2\ns = \'wrng\'\n', true).map(t => t.word);
    assert.ok(tokens.includes('misspeled') && tokens.includes('wrng') && !tokens.includes('7'), tokens.join(' '));
    assert.ok(spellingTokens('int x = a // comnent\n').some(t => t.word === 'comnent'), 'C and Java comments are unchanged');
    assert.match(systemPrompt('python'), /Python 3, traced by Online Python Tutor/);
    assert.match(systemPrompt('c'), /C interpreter/);
    assert.equal(systemPrompt('java'), systemPrompt(), 'the Java prompt is unchanged');
    const context = contextMessage({ project: example('py-pairs'), activeFile: 'main.py', run: null, step: 0, dirty: false });
    assert.match(context, /a Python program in `main.py`/);
    assert.match(context, /```python/);
  });
  console.log(`\n${total} integration checks passed.`);
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
