// Spell checking in the organisation's English (FairPro ADR "Organisation
// language"). FairPro sends the language with `open`; the editor checks the
// document's English text against that Hunspell dictionary, whatever English
// the Word file itself names (Word files usually say en-US by default).
// Text the document marks as another language is not checked: there is no
// dictionary for it here.
//
// This file is pure so every rule is unit-tested. The dictionaries run in a
// web worker (spelling.worker.ts) and SuperDoc draws the squiggles and the
// suggestions menu through its proofing API (superdoc-adapter.ts).

/** The Englishes FairPro offers, as BCP 47 tags. */
export const SPELLING_LANGUAGES = ["en-AU", "en-GB", "en-US", "en-CA"] as const;
export type SpellingLanguage = (typeof SPELLING_LANGUAGES)[number];

/** What an older FairPro, which sends no language, gets. */
export const DEFAULT_SPELLING_LANGUAGE: SpellingLanguage = "en-AU";

export function isSpellingLanguage(value: unknown): value is SpellingLanguage {
  return (
    typeof value === "string" &&
    (SPELLING_LANGUAGES as readonly string[]).includes(value)
  );
}

/** A Hunspell dictionary, or a stand-in for one in tests. */
export interface WordChecker {
  check(word: string): boolean;
  suggest(word: string, limit: number): string[];
}

export interface WordRange {
  start: number;
  end: number;
  word: string;
}

export interface SpellingSegment {
  id: string;
  text: string;
  language?: string | null;
}

export interface SpellingIssue {
  segmentId: string;
  start: number;
  end: number;
  kind: "spelling";
  replacements: string[];
}

export interface CheckLimits {
  /** Suggestions per misspelt word. */
  maxSuggestions: number;
  /**
   * Different misspelt words given suggestions in one check. Working out
   * suggestions is the slow part (about half a second a word), so the rest
   * are still marked, just without suggestions until a later check.
   */
  maxSuggestedWords: number;
}

export const DEFAULT_LIMITS: CheckLimits = {
  maxSuggestions: 5,
  maxSuggestedWords: 20,
};

/**
 * Whether a segment should be checked with the English dictionary: when it
 * names no language, or any English. "en-US" in the Word file still gets the
 * organisation's English.
 */
export function isEnglish(language: string | null | undefined): boolean {
  if (!language) return true;
  return /^en(?:[-_]|$)/i.test(language);
}

/**
 * Words contracts use that the dictionaries lack, accepted in every
 * English. Kept short: a word goes in only when it is standard in contracts
 * and spelt the same in each English.
 */
export const CONTRACT_WORDS: ReadonlySet<string> = new Set([
  "counterparties",
  "counterparty",
  "licensor",
  "licensors",
  "mutandis",
  "mutatis",
  "novate",
  "novated",
  "novation",
  "offboarding",
  "onboarding",
  "plc",
  "pty",
  "severability",
  "subclause",
  "subclauses",
  "sublicence",
  "sublicences",
  "sublicense",
  "sublicensee",
  "sublicensees",
]);

// A word: letters (and combining marks), with apostrophes inside it, as in
// "doesn't" or "party's".
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
// A run of text without spaces that is not prose: it has a digit, or looks
// like an email address, a web address or a path.
const NOT_PROSE = /[\d@_\\/]|:\/\/|^www\./i;

/** True for words a dictionary should not judge: acronyms and brand-style names. */
function skipWord(word: string): boolean {
  if (word.length < 2) return true;
  // ABN, GST, NSW.
  if (word === word.toUpperCase()) return true;
  // FairPro, iPhone, DocuSign: a capital after the first letter.
  if (/\p{Lu}/u.test(word.slice(1))) return true;
  return false;
}

/** The words in a piece of text to check, with where each sits. */
export function wordsIn(text: string): WordRange[] {
  const words: WordRange[] = [];
  for (const chunk of text.matchAll(/\S+/gu)) {
    if (NOT_PROSE.test(chunk[0])) continue;
    const at = chunk.index;
    for (const match of chunk[0].matchAll(WORD)) {
      if (skipWord(match[0])) continue;
      const start = at + match.index;
      words.push({ start, end: start + match[0].length, word: match[0] });
    }
  }
  return words;
}

/**
 * The misspelt words in the segments, with suggestions. Suggestions are
 * worked out once per different word in a check, for at most
 * `maxSuggestedWords` words.
 */
export function checkSegments(
  segments: readonly SpellingSegment[],
  checker: WordChecker,
  limits: CheckLimits = DEFAULT_LIMITS,
): SpellingIssue[] {
  const issues: SpellingIssue[] = [];
  const verdicts = new Map<string, boolean>();
  const suggestions = new Map<string, string[]>();
  for (const segment of segments) {
    if (!isEnglish(segment.language)) continue;
    for (const { start, end, word } of wordsIn(segment.text)) {
      // Dictionaries spell the apostrophe straight; Word types it curly.
      const plain = word.replaceAll("’", "'");
      let correct = verdicts.get(plain);
      if (correct === undefined) {
        correct =
          CONTRACT_WORDS.has(plain.toLowerCase()) || checker.check(plain);
        verdicts.set(plain, correct);
      }
      if (correct) continue;
      let replacements = suggestions.get(plain);
      if (replacements === undefined) {
        replacements =
          suggestions.size < limits.maxSuggestedWords
            ? checker.suggest(plain, limits.maxSuggestions)
            : [];
        suggestions.set(plain, replacements);
      }
      issues.push({
        segmentId: segment.id,
        start,
        end,
        kind: "spelling",
        replacements,
      });
    }
  }
  return issues;
}
