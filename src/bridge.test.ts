import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_INTERVAL_MS,
  Bridge,
  type EditorAdapter,
  type HostWindow,
} from "./bridge";
import type { DocumentMode, EditorUser } from "./protocol";

const PARENT = "https://demo.fairpro.com.au";
const user = { name: "Test Person", email: "test@example.com" };

class FakeAdapter implements EditorAdapter {
  opened: { file: File; mode: DocumentMode; user: EditorUser }[] = [];
  modes: DocumentMode[] = [];
  closed = 0;
  failOpen: Error | null = null;
  exportResult: Blob | Error = new Blob([new Uint8Array([80, 75, 3, 4])]);
  onChange: () => void = () => undefined;

  open(
    file: File,
    options: { user: EditorUser; mode: DocumentMode; onChange: () => void },
  ) {
    if (this.failOpen) return Promise.reject(this.failOpen);
    this.opened.push({ file, mode: options.mode, user: options.user });
    this.onChange = options.onChange;
    return Promise.resolve();
  }
  exportDocx() {
    return this.exportResult instanceof Error
      ? Promise.reject(this.exportResult)
      : Promise.resolve(this.exportResult);
  }
  setMode(mode: DocumentMode) {
    this.modes.push(mode);
  }
  close() {
    this.closed += 1;
  }
}

function setup(now = () => 0) {
  const sent: {
    message: Record<string, unknown>;
    origin: string;
    transfer?: Transferable[];
  }[] = [];
  const parent = {
    postMessage(message: unknown, origin: string, transfer?: Transferable[]) {
      sent.push({
        message: message as Record<string, unknown>,
        origin,
        transfer,
      });
    },
  };
  const host: HostWindow = {
    parent,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const adapter = new FakeAdapter();
  const ui = { status: vi.fn(), banner: vi.fn() };
  const bridge = new Bridge({
    host,
    allowedOrigins: [PARENT, "http://localhost:3000"],
    adapter,
    ui,
    now,
  });
  const deliver = (data: unknown, origin = PARENT, source: unknown = parent) =>
    bridge.receive({ data, origin, source } as MessageEvent);
  const types = () => sent.map((s) => s.message.type);
  return { bridge, adapter, ui, sent, deliver, types, parent };
}

const openMessage = (mode = "suggesting") => ({
  source: "fairpro",
  v: 1,
  type: "open",
  fileName: "MSA.docx",
  bytes: new ArrayBuffer(4),
  user,
  mode,
});
const save = (requestId = "r1") => ({
  source: "fairpro",
  v: 1,
  type: "save",
  requestId,
});

describe("Bridge", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("announces ready to each allowed origin, and nowhere else", () => {
    t.bridge.start();
    expect(t.sent.map((s) => [s.message.type, s.origin])).toEqual([
      ["ready", PARENT],
      ["ready", "http://localhost:3000"],
    ]);
  });

  it("opens a document in the requested mode and reports it loaded", async () => {
    await t.deliver(openMessage("suggesting"));
    expect(t.adapter.opened).toHaveLength(1);
    expect(t.adapter.opened[0]?.mode).toBe("suggesting");
    expect(t.adapter.opened[0]?.file.name).toBe("MSA.docx");
    expect(t.sent.at(-1)).toEqual({
      message: {
        type: "loaded",
        fileName: "MSA.docx",
        source: "fairpro-editor",
        v: 1,
      },
      origin: PARENT,
      transfer: [],
    });
  });

  it("ignores messages from origins that are not allowed", async () => {
    await t.deliver(openMessage(), "https://evil.example");
    expect(t.adapter.opened).toHaveLength(0);
    expect(t.sent).toEqual([]);
  });

  it("ignores messages that do not come from the parent window", async () => {
    await t.deliver(openMessage(), PARENT, {});
    expect(t.adapter.opened).toHaveLength(0);
  });

  it("answers only the first allowed origin that drives it", async () => {
    await t.deliver(openMessage());
    await t.deliver(save(), "http://localhost:3000");
    expect(t.types()).not.toContain("saved");
    expect(t.sent.every((s) => s.origin === PARENT)).toBe(true);
  });

  it("stays silent about stray messages but reports malformed FairPro ones", async () => {
    await t.deliver({ hello: "extension" });
    expect(t.sent).toEqual([]);
    await t.deliver({ source: "fairpro", v: 1, type: "open" });
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "error",
      code: "bad_message",
    });
  });

  it("reports the first change as dirty once, and activity at most once a minute", async () => {
    let now = 0;
    t = setup(() => now);
    await t.deliver(openMessage());
    t.adapter.onChange();
    t.adapter.onChange();
    now = ACTIVITY_INTERVAL_MS - 1;
    t.adapter.onChange();
    now = ACTIVITY_INTERVAL_MS;
    t.adapter.onChange();
    expect(t.types().filter((x) => x === "dirty")).toHaveLength(1);
    expect(t.types().filter((x) => x === "activity")).toHaveLength(2);
  });

  it("hands the exported bytes back on save, transferring the buffer", async () => {
    await t.deliver(openMessage());
    t.adapter.onChange();
    await t.deliver(save("r7"));
    const saved = t.sent.find((s) => s.message.type === "saved");
    expect(saved?.message).toMatchObject({
      requestId: "r7",
      fileName: "MSA.docx",
    });
    const bytes = saved?.message.bytes as ArrayBuffer;
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(saved?.transfer).toEqual([bytes]);
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "dirty",
      dirty: false,
    });
  });

  it("refuses to save before a document is open", async () => {
    await t.deliver(save("r1"));
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "error",
      code: "not_open",
      requestId: "r1",
    });
  });

  it("reports a failed export against its request", async () => {
    await t.deliver(openMessage());
    t.adapter.exportResult = new Error("export broke");
    await t.deliver(save("r2"));
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "error",
      code: "save_failed",
      requestId: "r2",
      message: "export broke",
    });
  });

  it("reports a document that will not open", async () => {
    t.adapter.failOpen = new Error("not a docx");
    await t.deliver(openMessage());
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "error",
      code: "open_failed",
      message: "not a docx",
    });
    await t.deliver(save());
    expect(t.sent.at(-1)?.message).toMatchObject({ code: "not_open" });
  });

  it("closes the old document before opening another", async () => {
    await t.deliver(openMessage());
    await t.deliver(openMessage());
    expect(t.adapter.closed).toBe(1);
    expect(t.adapter.opened).toHaveLength(2);
  });

  it("switches to viewing and shows why when the lock is lost", async () => {
    await t.deliver(openMessage("editing"));
    await t.deliver({
      source: "fairpro",
      v: 1,
      type: "lockLost",
      message: "Alex is editing.",
    });
    expect(t.adapter.modes).toEqual(["viewing"]);
    expect(t.ui.banner).toHaveBeenLastCalledWith("Alex is editing.");
    await t.deliver({
      source: "fairpro",
      v: 1,
      type: "setMode",
      mode: "suggesting",
    });
    expect(t.adapter.modes).toEqual(["viewing", "suggesting"]);
    expect(t.ui.banner).toHaveBeenLastCalledWith(null);
  });

  it("runs messages in order, so a save waits for the open before it", async () => {
    const opening = t.deliver(openMessage());
    const saving = t.deliver(save("r1"));
    await Promise.all([opening, saving]);
    expect(t.types()).toEqual(["loaded", "saved", "dirty"]);
  });
});
