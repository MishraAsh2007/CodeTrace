declare module 'nspell' {
  type Speller = { correct(word: string): boolean; suggest(word: string): string[]; add(word: string): Speller };
  export default function nspell(aff: string, dic?: string): Speller;
}
