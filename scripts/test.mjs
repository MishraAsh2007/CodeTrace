import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildWorker, environment, run as command, serverBinary } from './env.mjs';
import { demos, examples } from '../web/examples.ts';
import { checkPassed, failingCheck, output, questionsFor, sameSource, snapshots, validateProject } from '../web/learning.ts';
import { describeStep, stepBackOver, stepOut, stepOver } from '../web/narrate.ts';
import { decodeProject, encodeProject } from '../web/share.ts';

await buildWorker();
await command('cargo', ['test', '--locked']);
await command('cargo', ['build', '--locked']);
const env = environment();
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
  return { files: project.files, mainClass: project.mainClass, stdin: project.stdin, maxSteps: project.maxSteps, timeoutMs: 8000, ...extra };
}
const oneFile = content => ({ files: [{ name: 'Main.java', content }], mainClass: 'Main', stdin: '', maxSteps: 300, timeoutMs: 8000 });
async function wait(id) {
  for (let i = 0; i < 400; i++) {
    const data = await api(`/api/runs/${id}`);
    if (data.status === 'finished') return data;
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
  await test('project import rejects malformed nested values without throwing', () => {
    assert.equal(validateProject({ ...examples[0], files: [null] }), false);
    assert.equal(validateProject({ ...examples[0], checks: [null] }), false);
    assert.equal(validateProject(structuredClone(examples[0])), true);
  });
  console.log(`\n${total} integration checks passed.`);
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
