// Runs the Hunspell dictionary off the page's main thread, so checking a
// long contract never makes typing stutter. The dictionary files are served
// by the editor itself (its Content-Security-Policy allows only its own
// origin), and are loaded the first time a language is asked for.

import Typo from "typo-js";
// The dictionary packages export only a Node loader, so their files are
// imported by path; Vite copies each to the build with a hashed name.
import auAff from "../node_modules/dictionary-en-au/index.aff?url";
import auDic from "../node_modules/dictionary-en-au/index.dic?url";
import caAff from "../node_modules/dictionary-en-ca/index.aff?url";
import caDic from "../node_modules/dictionary-en-ca/index.dic?url";
import gbAff from "../node_modules/dictionary-en-gb/index.aff?url";
import gbDic from "../node_modules/dictionary-en-gb/index.dic?url";
import usAff from "../node_modules/dictionary-en/index.aff?url";
import usDic from "../node_modules/dictionary-en/index.dic?url";
import {
  checkSegments,
  type SpellingLanguage,
  type WordChecker,
} from "./spelling";
import type { SpellingRequest, SpellingResponse } from "./spelling-provider";

const FILES: Record<SpellingLanguage, { aff: string; dic: string }> = {
  "en-AU": { aff: auAff, dic: auDic },
  "en-GB": { aff: gbAff, dic: gbDic },
  "en-US": { aff: usAff, dic: usDic },
  "en-CA": { aff: caAff, dic: caDic },
};

const loaded = new Map<SpellingLanguage, Promise<WordChecker>>();

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Dictionary ${url}: ${String(response.status)}`);
  return response.text();
}

function dictionary(language: SpellingLanguage): Promise<WordChecker> {
  let checker = loaded.get(language);
  if (!checker) {
    const files = FILES[language];
    checker = Promise.all([text(files.aff), text(files.dic)]).then(
      ([aff, dic]) => {
        const typo = new Typo(language, aff, dic);
        return {
          check: (word) => typo.check(word),
          suggest: (word, limit) => typo.suggest(word, limit),
        };
      },
    );
    loaded.set(language, checker);
    // A failed load is tried again next time rather than remembered.
    checker.catch(() => loaded.delete(language));
  }
  return checker;
}

self.addEventListener("message", (event: MessageEvent<SpellingRequest>) => {
  const { id, language, segments, maxSuggestions } = event.data;
  void dictionary(language)
    .then((checker) =>
      checkSegments(segments, checker, {
        maxSuggestions,
        maxSuggestedWords: 20,
      }),
    )
    .then(
      (issues): SpellingResponse => ({ id, issues }),
      (error: unknown): SpellingResponse => ({
        id,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((response) => {
      self.postMessage(response);
    });
});
