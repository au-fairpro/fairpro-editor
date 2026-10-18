import { describe, expect, it } from "vitest";
import {
  SpellingProvider,
  type SpellingRequest,
  type SpellingResponse,
  type SpellingWorker,
} from "./spelling-provider";

class FakeWorker implements SpellingWorker {
  sent: SpellingRequest[] = [];
  terminated = false;
  private listener: ((event: MessageEvent<SpellingResponse>) => void) | null =
    null;
  postMessage(message: SpellingRequest): void {
    this.sent.push(message);
  }
  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<SpellingResponse>) => void,
  ): void {
    this.listener = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: SpellingResponse): void {
    this.listener?.({ data } as MessageEvent<SpellingResponse>);
  }
}

const segment = (id: string, text: string, language?: string | null) => ({
  id,
  text,
  ...(language === undefined ? {} : { language }),
  metadata: { surface: "body" as const },
});

describe("SpellingProvider", () => {
  it("sends the segments in the organisation's language and returns the issues", async () => {
    const worker = new FakeWorker();
    const provider = new SpellingProvider(worker, "en-GB");
    const result = provider.check({
      segments: [segment("s1", "the colour", "en-US")],
      maxSuggestions: 3,
    });
    expect(worker.sent).toEqual([
      {
        id: 1,
        language: "en-GB",
        segments: [{ id: "s1", text: "the colour", language: "en-US" }],
        maxSuggestions: 3,
      },
    ]);
    const issue = {
      segmentId: "s1",
      start: 0,
      end: 3,
      kind: "spelling" as const,
      replacements: ["they"],
    };
    worker.reply({ id: 1, issues: [issue] });
    await expect(result).resolves.toEqual({ issues: [issue] });
  });

  it("caps the suggestions and passes a missing language as null", () => {
    const worker = new FakeWorker();
    const provider = new SpellingProvider(worker, "en-AU");
    void provider.check({ segments: [segment("s1", "x")], maxSuggestions: 50 });
    void provider.check({ segments: [segment("s2", "y")] });
    expect(worker.sent.map((m) => m.maxSuggestions)).toEqual([5, 5]);
    expect(worker.sent[0]?.segments[0]?.language).toBeNull();
    expect(worker.sent.map((m) => m.id)).toEqual([1, 2]);
  });

  it("rejects when the worker could not check", async () => {
    const worker = new FakeWorker();
    const provider = new SpellingProvider(worker, "en-AU");
    const result = provider.check({ segments: [segment("s1", "x")] });
    worker.reply({ id: 1, error: "Dictionary missing" });
    await expect(result).rejects.toThrow("Dictionary missing");
  });

  it("answers an aborted check with no issues and ignores a late reply", async () => {
    const worker = new FakeWorker();
    const provider = new SpellingProvider(worker, "en-AU");
    const controller = new AbortController();
    const result = provider.check({
      segments: [segment("s1", "x")],
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).resolves.toEqual({ issues: [] });
    worker.reply({ id: 1, error: "too late" });
    const already = new AbortController();
    already.abort();
    await expect(
      provider.check({ segments: [], signal: already.signal }),
    ).resolves.toEqual({ issues: [] });
    expect(worker.sent).toHaveLength(1);
  });

  it("settles open checks and stops the worker when disposed", async () => {
    const worker = new FakeWorker();
    const provider = new SpellingProvider(worker, "en-AU");
    const result = provider.check({ segments: [segment("s1", "x")] });
    provider.dispose();
    await expect(result).resolves.toEqual({ issues: [] });
    expect(worker.terminated).toBe(true);
  });

  it("says it checks spelling only, offline", () => {
    const provider = new SpellingProvider(new FakeWorker(), "en-AU");
    expect(provider.getCapabilities()).toMatchObject({
      issueKinds: ["spelling"],
      requiresNetwork: false,
    });
  });
});
