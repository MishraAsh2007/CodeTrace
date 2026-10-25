import { categories, demos, examples } from './examples';
import type { Demo, DemoCategory } from './examples';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b6b52"/><path d="M9 10.5h14v3.2h-5.3V23h-3.4v-9.3H9z" fill="#fff"/><circle cx="22.6" cy="21.4" r="2.4" fill="#f5b544"/></svg>`;

const chipFor: Record<DemoCategory, string> = { runtime: 'danger', output: 'warning', hang: 'violet', compile: 'info', tour: 'accent' };
export const categoryLabel = (id: DemoCategory) => categories.find(c => c.id === id)?.label ?? id;
export const demoName = (demo: Demo) => examples.find(e => e.example === demo.id)?.name ?? demo.id;

/** One gallery card. `href` makes it a link (landing page); otherwise a button with data-open-demo (IDE). */
export function demoCard(demo: Demo, arrow: string, href?: string): string {
  const language = demo.language ? `<span class="language-tag ${demo.language}">${demo.language === 'c' ? 'C' : 'Python'}</span>` : '';
  const inner = `<div class="demo-card-top"><span class="chip ${chipFor[demo.category]}">${esc(demo.symptom)}</span>${language}<span class="level">${esc(demo.level)}</span></div>
    <h3>${esc(demoName(demo))}</h3><p>${esc(demo.summary)}</p>
    <code class="demo-snippet" title="${esc(demo.snippet)}">${esc(demo.snippet)}</code>
    <div class="demo-tags">${demo.concepts.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <span class="demo-open">${demo.category === 'tour' ? 'Open tour' : 'Debug it'} ${arrow}</span>`;
  return href
    ? `<a class="demo-card" data-category="${demo.category}" href="${esc(href)}">${inner}</a>`
    : `<button class="demo-card" data-category="${demo.category}" data-open-demo="${esc(demo.id)}">${inner}</button>`;
}

/** Gallery filters: everything, a category, or a language. */
export type GalleryFilter = DemoCategory | 'all' | 'java' | 'c' | 'python';
const LANGUAGE_FILTERS = [{ id: 'java' as const, label: 'Java' }, { id: 'c' as const, label: 'C' }, { id: 'python' as const, label: 'Python' }];
const matches = (demo: Demo, filter: GalleryFilter) => filter === 'all' || demo.category === filter || (demo.language ?? 'java') === filter;

export function filterBar(active: GalleryFilter): string {
  const button = (c: { id: GalleryFilter; label: string }) => `<button data-filter="${c.id}" aria-pressed="${active === c.id}">${esc(c.label)}<span class="count">${demos.filter(d => matches(d, c.id)).length}</span></button>`;
  return [{ id: 'all' as const, label: 'All' }, ...categories].map(button).join('') + `<span class="filter-divider" aria-hidden="true"></span>${LANGUAGE_FILTERS.map(button).join('')}`;
}

export function visibleDemos(active: GalleryFilter): Demo[] { return demos.filter(d => matches(d, active)); }
