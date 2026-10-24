/** Workspace layout: collapsible side panels, a resizable editor/memory split and a resizable console. */
export type SidebarView = 'explorer' | 'projects' | 'examples';
export type LayoutState = { sidebar: boolean; view: SidebarView; coach: boolean; console: boolean; split: number; consoleHeight: number };

const KEY = 'tracelab.layout.v1';
export const DEFAULT_SPLIT = 48;
export const DEFAULT_CONSOLE = 150;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function loadLayout(): LayoutState {
  // Without a saved preference, give narrow screens the editor/memory width instead of the file sidebar.
  const fallback: LayoutState = { sidebar: window.innerWidth >= 1500, view: 'explorer', coach: true, console: true, split: DEFAULT_SPLIT, consoleHeight: DEFAULT_CONSOLE };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    return {
      sidebar: typeof saved.sidebar === 'boolean' ? saved.sidebar : fallback.sidebar,
      view: saved.view === 'examples' || saved.view === 'projects' ? saved.view : 'explorer',
      coach: typeof saved.coach === 'boolean' ? saved.coach : true,
      console: typeof saved.console === 'boolean' ? saved.console : true,
      split: Number.isFinite(saved.split) ? clamp(saved.split, 25, 75) : DEFAULT_SPLIT,
      consoleHeight: Number.isFinite(saved.consoleHeight) ? clamp(saved.consoleHeight, 80, 600) : DEFAULT_CONSOLE,
    };
  } catch { return fallback; }
}

export function saveLayout(state: LayoutState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Layout preferences are optional. */ }
}

export function applyLayout(state: LayoutState) {
  const app = document.querySelector<HTMLElement>('.app-layout')!;
  app.classList.toggle('sidebar-hidden', !state.sidebar);
  app.classList.toggle('coach-hidden', !state.coach);
  const workbench = document.querySelector<HTMLElement>('#workbench')!;
  workbench.style.setProperty('--editor-fr', `${state.split}fr`);
  workbench.style.setProperty('--memory-fr', `${100 - state.split}fr`);
  const consolePanel = document.querySelector<HTMLElement>('.console-panel')!;
  consolePanel.classList.toggle('collapsed', !state.console);
  consolePanel.style.setProperty('--console-height', `${state.consoleHeight}px`);
  document.querySelector('#collapse-console')?.setAttribute('aria-expanded', String(state.console));
  document.querySelector('#toggle-sidebar')?.setAttribute('aria-pressed', String(state.sidebar));
  document.querySelector('#toggle-coach')?.setAttribute('aria-pressed', String(state.coach));
  document.querySelector('#toggle-console')?.setAttribute('aria-pressed', String(state.console));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(state.sidebar && button.dataset.view === state.view));
  });
  document.querySelectorAll<HTMLElement>('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== state.view; });
  const columns = document.querySelector('#split-columns');
  columns?.setAttribute('aria-valuenow', String(Math.round(state.split)));
  document.querySelector('#split-console')?.setAttribute('aria-valuenow', String(Math.round(state.consoleHeight)));
}

type SplitterOptions = {
  axis: 'x' | 'y';
  /** Converts a pointer position into a new value. */
  fromPointer: (event: PointerEvent) => number;
  get: () => number;
  set: (value: number) => void;
  step: number;
  /** For a bottom panel: moving the splitter up (ArrowUp) grows the value. */
  invertKeys?: boolean;
  reset: () => void;
  done: () => void;
};

/** Pointer- and keyboard-operable splitter (WAI-ARIA window splitter pattern). */
export function attachSplitter(handle: HTMLElement, options: SplitterOptions) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add(options.axis === 'x' ? 'resizing-x' : 'resizing-y');
    const move = (e: PointerEvent) => options.set(options.fromPointer(e));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
      options.done();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => { options.reset(); options.done(); });
  handle.addEventListener('keydown', event => {
    const decrease = options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const increase = options.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== decrease && event.key !== increase && event.key !== 'Home') return;
    event.preventDefault();
    if (event.key === 'Home') options.reset();
    else options.set(options.get() + (event.key === increase ? 1 : -1) * (options.invertKeys ? -1 : 1) * options.step);
    options.done();
  });
}

export { clamp };
