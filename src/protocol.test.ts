import { describe, expect, it } from "vitest";
import {
  envelope,
  MAX_DOCUMENT_BYTES,
  MAX_INSERT_CHARS,
  MAX_PEOPLE,
  parseParentMessage,
} from "./protocol";

const user = { name: "Test Person", email: "test@example.com" };
const base = { source: "fairpro", v: 1 };

function open(overrides: Record<string, unknown> = {}) {
  return {
    ...base,
    type: "open",
    fileName: "MSA.docx",
    bytes: new ArrayBuffer(10),
    user,
    mode: "suggesting",
    ...overrides,
  };
}

describe("parseParentMessage", () => {
  it("accepts a well-formed open and keeps only the known fields", () => {
    const result = parseParentMessage({ ...open(), extra: "ignored" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toEqual({
      type: "open",
      fileName: "MSA.docx",
      bytes: expect.any(ArrayBuffer) as ArrayBuffer,
      user,
      mode: "suggesting",
      people: [],
    });
    expect(Object.keys(result.message)).not.toContain("extra");
  });

  it("keeps the people who may be @mentioned, and only their name and email", () => {
    const result = parseParentMessage(
      open({
        people: [{ name: "Kamala", email: "kamala@example.com", id: "x" }],
      }),
    );
    expect(
      result.ok && result.message.type === "open" && result.message.people,
    ).toEqual([{ name: "Kamala", email: "kamala@example.com" }]);
  });

  it.each([
    ["not an object", "hello"],
    ["null", null],
    ["an array", [1]],
    ["another source", { ...open(), source: "other" }],
    ["no source", { type: "save", requestId: "r1", v: 1 }],
  ])("refuses %s as not a FairPro message", (_, data) => {
    expect(parseParentMessage(data)).toEqual({
      ok: false,
      reason: "not a FairPro message",
    });
  });

  it("refuses another protocol version", () => {
    expect(parseParentMessage({ ...open(), v: 2 })).toEqual({
      ok: false,
      reason: "unsupported protocol version 2",
    });
  });

  it.each([
    ["a non-docx name", { fileName: "MSA.pdf" }],
    ["an empty name", { fileName: "" }],
    ["a very long name", { fileName: "a".repeat(300) + ".docx" }],
    ["bytes that are not an ArrayBuffer", { bytes: "UEsDBA==" }],
    ["empty bytes", { bytes: new ArrayBuffer(0) }],
    ["a user without an email", { user: { name: "Test" } }],
    ["no user", { user: undefined }],
    ["an unknown mode", { mode: "owner" }],
    ["people that is not a list", { people: "everyone" }],
    ["a person without an email", { people: [{ name: "Kamala" }] }],
    [
      "too many people",
      {
        people: Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => ({
          name: `P${String(i)}`,
          email: `p${String(i)}@example.com`,
        })),
      },
    ],
  ])("refuses an open with %s", (_, overrides) => {
    expect(parseParentMessage(open(overrides)).ok).toBe(false);
  });

  it("refuses a document over the size limit", () => {
    const result = parseParentMessage(
      open({ bytes: new ArrayBuffer(MAX_DOCUMENT_BYTES + 1) }),
    );
    expect(result).toEqual({ ok: false, reason: "document is too large" });
  });

  it("accepts save, setMode and lockLost", () => {
    expect(
      parseParentMessage({ ...base, type: "save", requestId: "r1" }),
    ).toEqual({
      ok: true,
      message: { type: "save", requestId: "r1" },
    });
    expect(
      parseParentMessage({ ...base, type: "setMode", mode: "viewing" }),
    ).toEqual({
      ok: true,
      message: { type: "setMode", mode: "viewing" },
    });
    expect(
      parseParentMessage({
        ...base,
        type: "lockLost",
        message: "Alex is editing.",
      }),
    ).toEqual({
      ok: true,
      message: { type: "lockLost", message: "Alex is editing." },
    });
  });

  it("gives lockLost a default message when none is usable", () => {
    expect(
      parseParentMessage({ ...base, type: "lockLost", message: 42 }),
    ).toEqual({
      ok: true,
      message: {
        type: "lockLost",
        message: "Someone else is editing this document.",
      },
    });
  });

  it("refuses a save without a requestId and an unknown type", () => {
    expect(parseParentMessage({ ...base, type: "save" }).ok).toBe(false);
    expect(
      parseParentMessage({ ...base, type: "save", requestId: "x".repeat(101) })
        .ok,
    ).toBe(false);
    expect(parseParentMessage({ ...base, type: "delete" })).toEqual({
      ok: false,
      reason: "unknown message type delete",
    });
  });
});

describe("insertText", () => {
  const insert = (overrides: Record<string, unknown> = {}) => ({
    ...base,
    type: "insertText",
    requestId: "i1",
    text: "The Supplier shall keep records.",
    replaceSelection: false,
    ...overrides,
  });

  it("accepts text to insert or to replace the selection with", () => {
    expect(parseParentMessage({ ...insert(), extra: "dropped" })).toEqual({
      ok: true,
      message: {
        type: "insertText",
        requestId: "i1",
        text: "The Supplier shall keep records.",
        replaceSelection: false,
      },
    });
    expect(parseParentMessage(insert({ replaceSelection: true })).ok).toBe(
      true,
    );
  });

  it("refuses empty or overlong text, a missing requestId or flag", () => {
    expect(parseParentMessage(insert({ text: "" })).ok).toBe(false);
    expect(
      parseParentMessage(insert({ text: "x".repeat(MAX_INSERT_CHARS + 1) })).ok,
    ).toBe(false);
    expect(parseParentMessage(insert({ requestId: undefined })).ok).toBe(false);
    expect(parseParentMessage(insert({ replaceSelection: "yes" })).ok).toBe(
      false,
    );
  });
});

describe("envelope", () => {
  it("marks messages as the editor protocol version 1", () => {
    expect(envelope({ type: "ready" })).toEqual({
      type: "ready",
      source: "fairpro-editor",
      v: 1,
    });
  });
});
