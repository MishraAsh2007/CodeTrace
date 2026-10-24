import { categories, demos, examples } from './examples';
import type { Demo, DemoCategory } from './examples';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b6b52"/><path d="M9 10.5h14v3.2h-5.3V23h-3.4v-9.3H9z" fill="#fff"/><circle cx="22.6" cy="21.4" r="2.4" fill="#f5b544"/></svg>`;

const chipFor: Record<DemoCategory, string> = { runtime: 'danger', output: 'warning', hang: 'violet', compile: 'info', tour: 'accent' };
export const categoryLabel = (id: DemoCategory) => categories.find(c => c.id === id)?.label ?? id;
export const demoName = (demo: Demo) => examples.find(e => e.example === demo.id)?.name ?? demo.id;

/** One gallery card. `href` makes it a link (landing page); otherwise a button with data-open-demo (IDE). */
export function demoCard(demo: Demo, arrow: string, href?: string): string {
  const inner = `<div class="demo-card-top"><span class="chip ${chipFor[demo.category]}">${esc(demo.symptom)}</span><span class="level">${esc(demo.level)}</span></div>
    <h3>${esc(demoName(demo))}</h3><p>${esc(demo.summary)}</p>
    <code class="demo-snippet" title="${esc(demo.snippet)}">${esc(demo.snippet)}</code>
    <div class="demo-tags">${demo.concepts.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <span class="demo-open">${demo.category === 'tour' ? 'Open tour' : 'Debug it'} ${arrow}</span>`;
  return href
    ? `<a class="demo-card" data-category="${demo.category}" href="${esc(href)}">${inner}</a>`
    : `<button class="demo-card" data-category="${demo.category}" data-open-demo="${esc(demo.id)}">${inner}</button>`;
}

export function filterBar(active: DemoCategory | 'all'): string {
  const count = (id: DemoCategory | 'all') => id === 'all' ? demos.length : demos.filter(d => d.category === id).length;
  return [{ id: 'all' as const, label: 'All' }, ...categories].map(c => `<button data-filter="${c.id}" aria-pressed="${active === c.id}">${esc(c.label)}<span class="count">${count(c.id)}</span></button>`).join('');
}

export function visibleDemos(active: DemoCategory | 'all'): Demo[] { return active === 'all' ? demos : demos.filter(d => d.category === active); }
