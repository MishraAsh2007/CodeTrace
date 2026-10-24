// Spell checking runs in a worker: building the Hunspell dictionary takes a moment and must not block typing.
import nspell from 'nspell';
import aff from '../node_modules/dictionary-en/index.aff?raw';
import dic from '../node_modules/dictionary-en/index.dic?raw';

type Request = { id: number; type: 'check'; words: string[]; extra: string[] } | { id: number; type: 'suggest'; word: string };
let speller: ReturnType<typeof nspell> | null = null;
const added = new Set<string>();

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  speller ??= nspell(aff, dic);
  if (request.type === 'check') {
    for (const word of request.extra) if (!added.has(word)) { speller.add(word); added.add(word); }
    const misspelled = request.words.filter(word => !speller!.correct(word) && !speller!.correct(word.toLowerCase()));
    self.postMessage({ id: request.id, misspelled });
  } else {
    self.postMessage({ id: request.id, suggestions: speller.suggest(request.word).slice(0, 4) });
  }
};
