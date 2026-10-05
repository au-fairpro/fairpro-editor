import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_INTERVAL_MS,
  Bridge,
  type CommentMentions,
  type EditorAdapter,
  type HostWindow,
  type SuggestedBy,
} from "./bridge";
import type { DocumentMode, EditorUser } from "./protocol";

const PARENT = "https://demo.fairpro.com.au";
const user = { name: "Test Person", email: "test@example.com" };

class FakeAdapter implements EditorAdapter {
  opened: {
    file: File;
    mode: DocumentMode;
    user: EditorUser;
    people: EditorUser[];
  }[] = [];
  onComment: (comment: CommentMentions) => void = () => undefined;
  modes: DocumentMode[] = [];
  closed = 0;
  failOpen: Error | null = null;
  exportResult: Blob | Error = new Blob([new Uint8Array([80, 75, 3, 4])]);
  onChange: () => void = () => undefined;
  onSelection: (text: string) => void = () => undefined;
  inserted: {
    text: string;
    replaceSelection: boolean;
    suggestedBy?: SuggestedBy;
  }[] = [];
  failInsert: Error | null = null;

  open(
    file: File,
    options: {
      user: EditorUser;
      mode: DocumentMode;
      onChange: () => void;
      onSelection: (text: string) => void;
      people: EditorUser[];
      onComment: (comment: CommentMentions) => void;
    },
  ) {
    if (this.failOpen) return Promise.reject(this.failOpen);
    this.opened.push({
      file,
      mode: options.mode,
      user: options.user,
      people: options.people,
    });
    this.onChange = options.onChange;
    this.onComment = options.onComment;
    this.onSelection = options.onSelection;
    return Promise.resolve();
  }
  insertText(
    text: string,
    options: { replaceSelection: boolean; suggestedBy?: SuggestedBy },
  ) {
    if (this.failInsert) return Promise.reject(this.failInsert);
    this.inserted.push({ text, ...options });
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

const people = [
  { name: "Kamala Fernando", email: "Kamala@example.com" },
  { name: "Nimal Perera", email: "nimal@example.com" },
  user,
];
const openMessage = (mode = "suggesting", withPeople: EditorUser[] = []) => ({
  source: "fairpro",
  v: 1,
  type: "open",
  fileName: "MSA.docx",
  bytes: new ArrayBuffer(4),
  user,
  mode,
  people: withPeople,
});
const insert = (text: string, replaceSelection = false, requestId = "i1") => ({
  source: "fairpro",
  v: 1,
  type: "insertText",
  requestId,
  text,
  replaceSelection,
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

  it("reports the selected text when it changes, cut at the limit", async () => {
    await t.deliver(openMessage());
    t.adapter.onSelection("the Supplier");
    t.adapter.onSelection("the Supplier");
    t.adapter.onSelection("x".repeat(5000));
    t.adapter.onSelection("");
    const selections = t.sent
      .map((s) => s.message)
      .filter((m) => m.type === "selection");
    expect(selections).toHaveLength(3);
    expect(selections[0]).toMatchObject({
      text: "the Supplier",
      truncated: false,
    });
    expect(selections[1]?.text).toHaveLength(4000);
    expect(selections[1]?.truncated).toBe(true);
    expect(selections[2]).toMatchObject({ text: "", truncated: false });
  });

  it("inserts text at the cursor and says so", async () => {
    await t.deliver(openMessage());
    await t.deliver(insert("New clause.", false, "i9"));
    expect(t.adapter.inserted).toEqual([
      { text: "New clause.", replaceSelection: false },
    ]);
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "inserted",
      requestId: "i9",
    });
  });

  it("marks text an assistant suggested as '[person] via [it]' (FR-AI-032)", async () => {
    await t.deliver(openMessage());
    await t.deliver({
      ...insert("Clause.", false, "i5"),
      via: "the assistant",
    });
    expect(t.adapter.inserted).toEqual([
      {
        text: "Clause.",
        replaceSelection: false,
        suggestedBy: {
          author: "Test Person via the assistant",
          authorEmail: "test@example.com",
        },
      },
    ]);
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "inserted",
      requestId: "i5",
    });
  });

  it("replaces only when something is selected", async () => {
    await t.deliver(openMessage());
    await t.deliver(insert("Better words.", true, "i1"));
    expect(t.adapter.inserted).toEqual([]);
    expect(t.sent.at(-1)?.message).toMatchObject({
      type: "error",
      code: "insert_failed",
      requestId: "i1",
    });
    t.adapter.onSelection("old words");
    await t.deliver(insert("Better words.", true, "i2"));
    expect(t.adapter.inserted).toEqual([
      { text: "Better words.", replaceSelection: true },
    ]);
  });

  it("refuses to insert when read-only or not open, and reports failures", async () => {
    await t.deliver(insert("x", false, "i1"));
    expect(t.sent.at(-1)?.message).toMatchObject({ code: "not_open" });
    await t.deliver(openMessage("viewing"));
    await t.deliver(insert("x", false, "i2"));
    expect(t.sent.at(-1)?.message).toMatchObject({
      code: "insert_failed",
      message: "The document is read-only.",
    });
    await t.deliver(openMessage("suggesting"));
    await t.deliver({
      source: "fairpro",
      v: 1,
      type: "lockLost",
      message: "m",
    });
    await t.deliver(insert("x", false, "i3"));
    expect(t.sent.at(-1)?.message).toMatchObject({ code: "insert_failed" });
    await t.deliver({
      source: "fairpro",
      v: 1,
      type: "setMode",
      mode: "suggesting",
    });
    t.adapter.failInsert = new Error("no document api");
    await t.deliver(insert("x", false, "i4"));
    expect(t.sent.at(-1)?.message).toMatchObject({
      code: "insert_failed",
      message: "no document api",
      requestId: "i4",
    });
    expect(t.adapter.inserted).toEqual([]);
  });

  it("offers FairPro's people to @mention and reports each new mention once", async () => {
    await t.deliver(openMessage("suggesting", people));
    expect(t.adapter.opened[0]?.people).toEqual(people);
    const mentioned = () =>
      t.sent
        .filter((s) => s.message.type === "mentioned")
        .map((s) => s.message.emails);
    t.adapter.onComment({
      commentId: "c1",
      emails: ["kamala@example.com", "KAMALA@example.com"],
    });
    // Edited later to add Nimal: only Nimal is new.
    t.adapter.onComment({
      commentId: "c1",
      emails: ["kamala@example.com", "nimal@example.com"],
    });
    // Not offered by FairPro, or the person writing: never reported.
    t.adapter.onComment({
      commentId: "c2",
      emails: ["stranger@example.com", user.email],
    });
    // A comment without mentions says nothing.
    t.adapter.onComment({ commentId: "c3", emails: [] });
    expect(mentioned()).toEqual([
      ["kamala@example.com"],
      ["nimal@example.com"],
    ]);
  });

  it("reports at most 20 people in one message, and forgets mentions when another document opens", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `P${String(i)}`,
      email: `p${String(i)}@example.com`,
    }));
    await t.deliver(openMessage("suggesting", many));
    t.adapter.onComment({ commentId: "c1", emails: many.map((p) => p.email) });
    const sizes = () =>
      t.sent
        .filter((s) => s.message.type === "mentioned")
        .map((s) => (s.message.emails as string[]).length);
    expect(sizes()).toEqual([20, 5]);
    await t.deliver(openMessage("suggesting", many));
    t.adapter.onComment({ commentId: "c1", emails: ["p0@example.com"] });
    expect(sizes()).toEqual([20, 5, 1]);
  });
});
