/** Light/dark theme. "system" follows the OS preference; the choice is stored per browser. */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'tracelab.theme.v1';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function themeChoice(): ThemeChoice {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
}
export function resolvedTheme(choice = themeChoice()): 'light' | 'dark' {
  return choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
}
export function applyTheme(choice = themeChoice()): 'light' | 'dark' {
  const theme = resolvedTheme(choice);
  document.documentElement.dataset.theme = theme;
  return theme;
}
export function setTheme(choice: ThemeChoice): 'light' | 'dark' {
  try { if (choice === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { /* Preference is optional. */ }
  return applyTheme(choice);
}
/** Calls `listener` when the effective theme changes because the OS preference changed. */
export function onSystemThemeChange(listener: (theme: 'light' | 'dark') => void) {
  media.addEventListener('change', () => { if (themeChoice() === 'system') listener(applyTheme()); });
}
