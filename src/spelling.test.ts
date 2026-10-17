import { readFileSync } from "node:fs";
import { join } from "node:path";
import Typo from "typo-js";
import { describe, expect, it } from "vitest";
import {
  checkSegments,
  DEFAULT_SPELLING_LANGUAGE,
  isEnglish,
  isSpellingLanguage,
  wordsIn,
  type WordChecker,
} from "./spelling";

function dictionary(pkg: string): WordChecker {
  const read = (file: string) =>
    readFileSync(
      join(import.meta.dirname, "..", "node_modules", pkg, file),
      "utf8",
    );
  const typo = new Typo("en", read("index.aff"), read("index.dic"));
  return {
    check: (word) => typo.check(word),
    suggest: (word, limit) => typo.suggest(word, limit),
  };
}

const misspelt = (checker: WordChecker, text: string) =>
  checkSegments([{ id: "s", text }], checker, {
    maxSuggestions: 3,
    maxSuggestedWords: 20,
  }).map((issue) => text.slice(issue.start, issue.end));

describe("spelling languages", () => {
  it("offers Australian, British, American and Canadian English, Australian first", () => {
    expect(DEFAULT_SPELLING_LANGUAGE).toBe("en-AU");
    expect(isSpellingLanguage("en-GB")).toBe(true);
    expect(isSpellingLanguage("en-NZ")).toBe(false);
    expect(isSpellingLanguage(42)).toBe(false);
  });

  it("checks text that names no language or any English, and nothing else", () => {
    expect(isEnglish(undefined)).toBe(true);
    expect(isEnglish(null)).toBe(true);
    expect(isEnglish("en-US")).toBe(true);
    expect(isEnglish("EN_gb")).toBe(true);
    expect(isEnglish("en")).toBe(true);
    expect(isEnglish("si-LK")).toBe(false);
    expect(isEnglish("eng")).toBe(false);
  });
});

describe("wordsIn", () => {
  it("finds words with where they sit, keeping apostrophes inside a word", () => {
    expect(wordsIn("The party\u2019s duty doesn't end.")).toEqual([
      { start: 0, end: 3, word: "The" },
      { start: 4, end: 11, word: "party\u2019s" },
      { start: 12, end: 16, word: "duty" },
      { start: 17, end: 24, word: "doesn't" },
      { start: 25, end: 28, word: "end" },
    ]);
  });

  it("leaves out acronyms, brand-style names, numbers, addresses and single letters", () => {
    const words = wordsIn(
      "The ABN of FairPro is 12a345; see www.example.com, a@b.co, https://x.y/z or C:\\docs, clause 3(a) and item x.",
    ).map((w) => w.word);
    expect(words).toEqual([
      "The",
      "of",
      "is",
      "see",
      "or",
      "clause",
      "and",
      "item",
    ]);
  });

  it("splits hyphenated words into their parts", () => {
    expect(wordsIn("non-disclosure").map((w) => w.word)).toEqual([
      "non",
      "disclosure",
    ]);
  });
});

describe("checkSegments", () => {
  const fake = (known: string[]) => {
    const asked: string[] = [];
    const checker: WordChecker = {
      check: (word) => known.includes(word.toLowerCase()),
      suggest: (word) => {
        asked.push(word);
        return [`${word}!`];
      },
    };
    return { checker, asked };
  };

  it("marks each misspelt word with suggestions, once per word", () => {
    const { checker, asked } = fake(["the"]);
    const issues = checkSegments(
      [
        { id: "a", text: "the teh" },
        { id: "b", text: "teh" },
      ],
      checker,
    );
    expect(issues).toEqual([
      {
        segmentId: "a",
        start: 4,
        end: 7,
        kind: "spelling",
        replacements: ["teh!"],
      },
      {
        segmentId: "b",
        start: 0,
        end: 3,
        kind: "spelling",
        replacements: ["teh!"],
      },
    ]);
    expect(asked).toEqual(["teh"]);
  });

  it("skips text in another language", () => {
    const { checker } = fake([]);
    expect(
      checkSegments(
        [{ id: "a", text: "ගිවිසුම word", language: "si-LK" }],
        checker,
      ),
    ).toEqual([]);
  });

  it("checks curly apostrophes as straight ones", () => {
    const checked: string[] = [];
    checkSegments([{ id: "a", text: "doesn\u2019t" }], {
      check: (word) => {
        checked.push(word);
        return true;
      },
      suggest: () => [],
    });
    expect(checked).toEqual(["doesn't"]);
  });

  it("stops working out suggestions after the limit but still marks the words", () => {
    const { checker, asked } = fake([]);
    const issues = checkSegments([{ id: "a", text: "aa bb cc" }], checker, {
      maxSuggestions: 1,
      maxSuggestedWords: 2,
    });
    expect(issues.map((i) => i.replacements)).toEqual([["aa!"], ["bb!"], []]);
    expect(asked).toEqual(["aa", "bb"]);
  });
});

describe("the dictionaries", () => {
  const text =
    "The organisation will pay the licence fee in the colour catalogue. The organization will pay the license fee in the color catalog.";

  it("Australian English accepts Australian spelling and marks American spelling", () => {
    expect(misspelt(dictionary("dictionary-en-au"), text)).toEqual([
      "organization",
      "color",
      "catalog",
    ]);
  });

  it("British English agrees with Australian on these words", () => {
    expect(misspelt(dictionary("dictionary-en-gb"), text)).toEqual([
      "organization",
      "color",
      "catalog",
    ]);
  });

  it("American English marks the Australian spelling instead", () => {
    expect(misspelt(dictionary("dictionary-en"), text)).toEqual([
      "organisation",
      "licence",
      "colour",
      "catalogue",
    ]);
  });

  it("accepts common contract words the dictionaries lack, in every English", () => {
    const words =
      "Example Supplier Pty Ltd, the counterparty, the licensor, novation, severability, subclause and onboarding mutatis mutandis.";
    for (const pkg of [
      "dictionary-en-au",
      "dictionary-en-gb",
      "dictionary-en",
      "dictionary-en-ca",
    ]) {
      expect(misspelt(dictionary(pkg), words)).toEqual([]);
    }
  });

  it("suggests the right word for a common slip", () => {
    const issues = checkSegments(
      [{ id: "s", text: "We recieve it." }],
      dictionary("dictionary-en-au"),
    );
    expect(issues[0]?.replacements).toContain("receive");
  });
});
