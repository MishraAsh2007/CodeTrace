import { createIcons, ArrowRight, Bug, Footprints, Layers, ListChecks, Lightbulb, Share2, Sun, Moon, Monitor, Cpu, ShieldCheck, Code, Eye, FolderOpen, Play, CircleCheck, Spline, History } from 'lucide';
import { demos } from './examples';
import type { DemoCategory } from './examples';
import { demoCard, filterBar, LOGO_SVG, visibleDemos } from './gallery';
import { applyTheme, onSystemThemeChange, resolvedTheme, setTheme, themeChoice } from './theme';
import type { ThemeChoice } from './theme';
import './tokens.css';
import './landing.css';

const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => createIcons({ icons: { ArrowRight, Bug, Footprints, Layers, ListChecks, Lightbulb, Share2, Sun, Moon, Monitor, Cpu, ShieldCheck, Code, Eye, FolderOpen, Play, CircleCheck, Spline, History }, attrs: { 'stroke-width': 1.75 } });
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let filter: DemoCategory | 'all' = 'all';
applyTheme();

const features: [string, string, string][] = [
  ['play', 'Real Java, real JVM', 'Your code is compiled with javac and runs on a JDK 21 virtual machine. What you see is what Java actually did, not a simulation.'],
  ['history', 'Step forward and back', 'Every line is recorded, so you can step backward as easily as forward, jump over calls, step out of methods and scrub through the whole run.'],
  ['layers', 'Stack and heap, drawn', 'Frames, local variables, objects, arrays, lists, maps and sets, with arrows from each reference to the object it points to.'],
  ['lightbulb', 'A tutor that read your run', 'Questions are built from the values your program produced: predict what happens next, explain the error, then choose a fix.'],
  ['list-checks', 'Prove the fix with tests', 'Check what a program prints, or call one method and check what it returns. Every test runs your current code in a fresh JVM.'],
  ['folder-open', 'Your own projects', 'Start from a template, paste code, or drop in .java files, a folder or a zip. TraceLab sorts files into packages, finds the main class, and saves every project in your browser.'],
];
const steps: [string, string][] = [
  ['Open a project', 'Start from an example, a template, your own files, or a shared link. Write Java in a full code editor.'],
  ['Run and record', 'TraceLab compiles and runs the program, recording each line, frame and object along the way.'],
  ['Step through memory', 'Replay the run. See which values changed, which method was called, and which line threw.'],
  ['Explain, fix, test', 'Answer questions about what happened, choose a repair, make the edit, and run the tests.'],
];
const faqs: [string, string][] = [
  ['Where does my code run?', 'In this release, programs run through the TraceLab runner on your own computer (127.0.0.1). The runner is not a sandbox: programs have the same file and network access as your account, so only run code you trust.'],
  ['Which Java versions are supported?', 'Programs are compiled with javac --release 21 and run on JDK 21 or newer. Standard library classes are available; Maven and Gradle dependencies are not yet supported.'],
  ['How are the tutor’s questions created?', 'From your recorded run and the exact source that produced it. A question is shown only when the recording supports its premise, for example the index that failed or the value a method returned. No AI model guesses at your code.'],
  ['Does TraceLab change how my program behaves?', 'TraceLab never calls your objects’ methods, such as toString, to display them. Recording does slow execution down, so programs that depend on timing or run many threads are not a good fit yet.'],
  ['What happens with infinite loops?', 'Runs stop after a step or time limit, and everything recorded up to that point stays available. The Tutor can point out a loop condition that never changes.'],
  ['Is my work saved?', 'Yes. Every project is saved in your browser as you type, and you can keep as many as you like. Changes to an example are kept with that example until you save it as your own project or reset it. Export a project as a zip to back it up or open it in another editor.'],
  ['Can I use my own code?', 'Yes. Paste classes into a new project, or drop in .java files, a folder or a zip. TraceLab places each file by its package declaration, splits pasted code with several public classes into separate files, and picks the class with a main method. Programs must use only the Java standard library for now.'],
];

$('#site').innerHTML = `
  <header class="nav"><div class="container nav-inner">
    <a class="logo" href="/">${LOGO_SVG}<span>TraceLab</span></a>
    <nav class="nav-links" aria-label="Sections"><a href="#features">Features</a><a href="#how">How it works</a><a href="#examples">Examples</a><a href="#faq">FAQ</a></nav>
    <div class="nav-actions"><button class="icon-btn" id="theme" aria-label="Change theme"></button><a class="btn btn-primary" href="/app/">Open the IDE ${icon('arrow-right')}</a></div>
  </div></header>
  <main>
    <section class="hero"><div class="container">
      <div class="hero-copy">
        <span class="eyebrow">Java IDE · recording debugger · built-in tutor</span>
        <h1>See exactly what your Java code does.</h1>
        <p class="lead">TraceLab runs your program on a real JVM and records every step. Move forward and back through the call stack and heap, watch each value change, and learn to fix bugs with questions drawn from your own run.</p>
        <div class="hero-actions"><a class="btn btn-primary btn-lg" href="/app/">Open the IDE ${icon('arrow-right')}</a><a class="btn btn-secondary btn-lg" href="#examples">${icon('bug')}Debug an example</a></div>
        <p class="hero-note">${icon('shield-check')}No account needed. Projects stay in your browser.</p>
      </div>
      <figure class="hero-shot">
        <div class="window"><div class="window-bar"><span></span><span></span><span></span><em>TraceLab IDE</em></div><img id="hero-image" alt="The TraceLab IDE paused on an ArrayIndexOutOfBoundsException: Java code on the left, the call stack and heap with reference arrows in the middle, and a Tutor question on the right." width="1600" height="1000" /></div>
      </figure>
    </div></section>
    <section class="strip"><div class="container strip-inner"><span>Built on</span><b>${icon('code')}javac · JDK 21</b><b>${icon('cpu')}Java Debug Interface</b><b>${icon('eye')}Monaco editor</b><b>${icon('shield-check')}Rust runner</b></div></section>
    <section class="section" id="features"><div class="container">
      <div class="section-head"><span class="eyebrow">Features</span><h2>A debugger that explains itself</h2><p>Everything you need to understand a program’s behavior, in one window.</p></div>
      <div class="feature-grid">${features.map(([i, t, d]) => `<article class="feature"><span class="feature-icon">${icon(i)}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
    </div></section>
    <section class="section alt" id="how"><div class="container">
      <div class="section-head"><span class="eyebrow">How it works</span><h2>From “it crashed” to “I know why”</h2></div>
      <ol class="steps">${steps.map(([t, d], i) => `<li><span class="step-number">${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
    </div></section>
    <section class="section" id="examples"><div class="container">
      <div class="section-head"><span class="eyebrow">Examples</span><h2>${demos.filter(d => d.category !== 'tour').length} programs with bugs, ready to debug</h2><p>Each one opens in the IDE with tests that fail. Run it, find out why from the recording, fix it, and make the tests pass.</p></div>
      <div class="filter-bar" id="filters"></div>
      <div class="demo-grid" id="demo-grid"></div>
    </div></section>
    <section class="section alt"><div class="container principles">
      <div class="section-head left"><span class="eyebrow">Honest by design</span><h2>Built to teach, not to guess</h2></div>
      <div class="principle-list">
        <div>${icon('circle-check')}<h3>Evidence first</h3><p>Every question points to the step it is about. If the recording can’t support a question, TraceLab doesn’t ask it.</p></div>
        <div>${icon('spline')}<h3>Nothing hidden</h3><p>When a limit is reached, the steps recorded so far stay available, with a clear note about what was left out and why.</p></div>
        <div>${icon('list-checks')}<h3>Fixes are tested</h3><p>A fix counts when your code passes the tests. Passing tests confirms those cases, and TraceLab says so.</p></div>
      </div>
    </div></section>
    <section class="section" id="faq"><div class="container faq-wrap">
      <div class="section-head left"><span class="eyebrow">FAQ</span><h2>Questions, answered</h2></div>
      <div class="faq">${faqs.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
    </div></section>
    <section class="cta"><div class="container cta-inner"><div><h2>Start with a bug.</h2><p>Open the IDE on an off-by-one error and see the exact step where the index leaves the array.</p></div><div class="cta-actions"><a class="btn btn-primary btn-lg" href="/app/?demo=bounds">Debug “The extra iteration” ${icon('arrow-right')}</a><a class="btn btn-secondary btn-lg" href="/app/?new">Start your own project</a></div></div></section>
  </main>
  <footer class="footer"><div class="container footer-inner"><a class="logo" href="/">${LOGO_SVG}<span>TraceLab</span></a><nav aria-label="Footer"><a href="/app/">IDE</a><a href="#examples">Examples</a><a href="#faq">FAQ</a></nav><p>© 2026 TraceLab. Java is a trademark of Oracle and/or its affiliates.</p></div></footer>
`;

function renderDemos() {
  $('#filters').innerHTML = filterBar(filter);
  $('#demo-grid').innerHTML = visibleDemos(filter).map(d => demoCard(d, icon('arrow-right'), `/app/?demo=${encodeURIComponent(d.id)}`)).join('');
  icons();
}
function renderTheme() {
  const choice = themeChoice();
  const theme = resolvedTheme(choice);
  $('#theme').innerHTML = icon(choice === 'system' ? 'monitor' : choice === 'dark' ? 'moon' : 'sun');
  $('#theme').title = `Theme: ${choice === 'system' ? `system (${theme})` : choice}`;
  $<HTMLImageElement>('#hero-image').src = `/screenshots/ide-${theme}.webp`;
  icons();
}
$('#filters').addEventListener('click', e => { const b = (e.target as Element).closest<HTMLElement>('[data-filter]'); if (b) { filter = b.dataset.filter as DemoCategory | 'all'; renderDemos(); } });
$('#theme').addEventListener('click', () => { const order: ThemeChoice[] = ['system', 'light', 'dark']; setTheme(order[(order.indexOf(themeChoice()) + 1) % 3]); renderTheme(); });
onSystemThemeChange(() => renderTheme());
renderDemos(); renderTheme();
