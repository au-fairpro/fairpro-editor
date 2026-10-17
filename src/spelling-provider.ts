// SuperDoc's proofing provider for the organisation's English. SuperDoc
// splits the document into text segments, calls `check` after edits, and
// draws the squiggles and the suggestions menu; this hands the segments to
// the dictionary worker and returns what it found.

import type { Config } from "superdoc";
import type {
  SpellingIssue,
  SpellingLanguage,
  SpellingSegment,
} from "./spelling";

type ProofingConfig = NonNullable<Config["proofing"]>;
export type ProofingProvider = NonNullable<ProofingConfig["provider"]>;
type CheckRequest = Parameters<ProofingProvider["check"]>[0];
type CheckResult = Awaited<ReturnType<ProofingProvider["check"]>>;

export interface SpellingRequest {
  id: number;
  language: SpellingLanguage;
  segments: SpellingSegment[];
  maxSuggestions: number;
}

export type SpellingResponse =
  { id: number; issues: SpellingIssue[] } | { id: number; error: string };

/** The parts of a Worker the provider uses, so tests can pass a fake. */
export interface SpellingWorker {
  postMessage(message: SpellingRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SpellingResponse>) => void,
  ): void;
  terminate(): void;
}

export const MAX_SUGGESTIONS = 5;

export class SpellingProvider implements ProofingProvider {
  readonly id = "fairpro-hunspell";
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (result: CheckResult) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly worker: SpellingWorker,
    readonly language: SpellingLanguage,
  ) {
    worker.addEventListener("message", ({ data }) => {
      const waiter = this.waiting.get(data.id);
      if (!waiter) return;
      this.waiting.delete(data.id);
      if ("error" in data) waiter.reject(new Error(data.error));
      else waiter.resolve({ issues: data.issues });
    });
  }

  getCapabilities() {
    return {
      issueKinds: ["spelling" as const],
      supportsSuggestions: true,
      supportsMultipleLanguages: false,
      supportsBatching: true,
      requiresNetwork: false,
    };
  }

  check(request: CheckRequest): Promise<CheckResult> {
    if (request.signal?.aborted) return Promise.resolve({ issues: [] });
    const id = this.nextId++;
    return new Promise<CheckResult>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      request.signal?.addEventListener("abort", () => {
        if (this.waiting.delete(id)) resolve({ issues: [] });
      });
      this.worker.postMessage({
        id,
        language: this.language,
        segments: request.segments.map(({ id: segmentId, text, language }) => ({
          id: segmentId,
          text,
          language: language ?? null,
        })),
        maxSuggestions: Math.min(
          request.maxSuggestions ?? MAX_SUGGESTIONS,
          MAX_SUGGESTIONS,
        ),
      });
    });
  }

  dispose(): void {
    for (const waiter of this.waiting.values()) {
      waiter.resolve({ issues: [] });
    }
    this.waiting.clear();
    this.worker.terminate();
  }
}
