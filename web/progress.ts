/** Browser-local record of which debugging concepts a student has practiced. */
export type ConceptProgress = { answered: number; firstTry: number };
export type Progress = Record<string, ConceptProgress>;

const KEY = 'tracelab.progress.v1';
export const CONCEPTS: Record<string, string> = {
  'array-bounds': 'Array bounds',
  'null-reference': 'Null references',
  'division-by-zero': 'Division by zero',
  'loop-termination': 'Loop termination',
  'string-equality': 'String equality',
  aliasing: 'Aliasing',
  recursion: 'Recursion',
  'return-values': 'Return values',
  'state-change': 'State changes',
  'string-bounds': 'String indices',
  'parsing-input': 'Parsing input',
  'concurrent-modification': 'Changing a list while looping',
  'integer-division': 'Integer division',
  'pass-by-value': 'Pass by value',
  types: 'Types and conversions',
  'compile-errors': 'Compiler errors',
};

export function loadProgress(): Progress {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    const out: Progress = {};
    for (const [concept, entry] of Object.entries(value as Record<string, ConceptProgress>)) {
      if (concept in CONCEPTS && Number.isInteger(entry?.answered) && Number.isInteger(entry?.firstTry)) out[concept] = { answered: entry.answered, firstTry: entry.firstTry };
    }
    return out;
  } catch { return {}; }
}

/** Records the first correct answer to a question; `firstTry` means no wrong answer came before it. */
export function recordSolved(progress: Progress, concept: string, firstTry: boolean): Progress {
  const entry = progress[concept] ?? { answered: 0, firstTry: 0 };
  const next = { ...progress, [concept]: { answered: entry.answered + 1, firstTry: entry.firstTry + (firstTry ? 1 : 0) } };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Progress is optional. */ }
  return next;
}

export function resetProgress(): Progress {
  try { localStorage.removeItem(KEY); } catch { /* Progress is optional. */ }
  return {};
}
