// The messages FairPro and the editor exchange through postMessage.
//
// FairPro (the parent window) owns everything that matters: who may edit,
// the edit lock, versions and storage. The editor only shows a document,
// lets the person change it, and hands the bytes back when asked. Keeping
// it that thin is what lets FairPro swap the editor (ADR in fairpro-platform)
// and keeps FairPro's own code out of this AGPL repository.
//
// Every message carries `source` and `v` so either side can ignore stray
// messages from browser extensions or other frames, and so the protocol
// can change without guessing.

export const PROTOCOL_VERSION = 1;
export const PARENT_SOURCE = "fairpro";
export const EDITOR_SOURCE = "fairpro-editor";

export const DOCUMENT_MODES = ["editing", "suggesting", "viewing"] as const;
export type DocumentMode = (typeof DOCUMENT_MODES)[number];

/** Largest document the editor accepts, matching FairPro's upload limit. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** Selected text longer than this is cut when reported to FairPro. */
export const MAX_SELECTION_CHARS = 4000;

/** Longest text FairPro may ask the editor to insert. */
export const MAX_INSERT_CHARS = 20_000;

export interface EditorUser {
  name: string;
  email: string;
}

/** Messages FairPro sends to the editor. */
export type ParentMessage =
  | {
      type: "open";
      fileName: string;
      /** The .docx itself, sent by FairPro so the editor needs no network access. */
      bytes: ArrayBuffer;
      user: EditorUser;
      mode: DocumentMode;
    }
  | { type: "save"; requestId: string }
  | { type: "setMode"; mode: DocumentMode }
  /** Another person now holds the edit lock, or it expired: stop editing. */
  | { type: "lockLost"; message: string }
  /**
   * Put text into the document where the person's cursor is, or in place of
   * the text they selected. In suggesting mode it arrives as a tracked change
   * under the person's name, like their own typing.
   */
  | {
      type: "insertText";
      requestId: string;
      text: string;
      replaceSelection: boolean;
    };

/** Messages the editor sends to FairPro. */
export type EditorMessage =
  | { type: "ready" }
  | { type: "loaded"; fileName: string }
  | { type: "dirty"; dirty: boolean }
  /** The person is working; FairPro uses this to keep the edit lock alive. */
  | { type: "activity" }
  | { type: "saved"; requestId: string; fileName: string; bytes: ArrayBuffer }
  /**
   * The text the person has selected, or "" when nothing is, so FairPro can
   * offer to work on it. Sent when it changes.
   */
  | { type: "selection"; text: string; truncated: boolean }
  | { type: "inserted"; requestId: string }
  | {
      type: "error";
      code: EditorErrorCode;
      message: string;
      requestId?: string;
    };

export type EditorErrorCode =
  "open_failed" | "save_failed" | "insert_failed" | "not_open" | "bad_message";

export type Envelope<T> = T & { source: string; v: number };

export function envelope<T extends EditorMessage>(message: T): Envelope<T> {
  return { ...message, source: EDITOR_SOURCE, v: PROTOCOL_VERSION };
}

export type ParseResult =
  { ok: true; message: ParentMessage } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function isDocumentMode(value: unknown): value is DocumentMode {
  return (
    typeof value === "string" &&
    (DOCUMENT_MODES as readonly string[]).includes(value)
  );
}

/**
 * Checks a message from FairPro. Anything that is not exactly one of the
 * shapes above is refused, so a wrong or hostile message never reaches
 * SuperDoc.
 */
export function parseParentMessage(data: unknown): ParseResult {
  if (!isRecord(data) || data.source !== PARENT_SOURCE) {
    return { ok: false, reason: "not a FairPro message" };
  }
  if (data.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `unsupported protocol version ${String(data.v)}`,
    };
  }
  switch (data.type) {
    case "open": {
      if (
        !isText(data.fileName, 255) ||
        !data.fileName.toLowerCase().endsWith(".docx")
      ) {
        return { ok: false, reason: "fileName must be a .docx name" };
      }
      if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength === 0) {
        return { ok: false, reason: "bytes must be a non-empty ArrayBuffer" };
      }
      if (data.bytes.byteLength > MAX_DOCUMENT_BYTES) {
        return { ok: false, reason: "document is too large" };
      }
      const user = data.user;
      if (
        !isRecord(user) ||
        !isText(user.name, 200) ||
        !isText(user.email, 320)
      ) {
        return { ok: false, reason: "user needs a name and an email" };
      }
      if (!isDocumentMode(data.mode)) {
        return {
          ok: false,
          reason: "mode must be editing, suggesting or viewing",
        };
      }
      return {
        ok: true,
        message: {
          type: "open",
          fileName: data.fileName,
          bytes: data.bytes,
          user: { name: user.name, email: user.email },
          mode: data.mode,
        },
      };
    }
    case "save":
      if (!isText(data.requestId, 100))
        return { ok: false, reason: "save needs a requestId" };
      return { ok: true, message: { type: "save", requestId: data.requestId } };
    case "setMode":
      if (!isDocumentMode(data.mode)) {
        return {
          ok: false,
          reason: "mode must be editing, suggesting or viewing",
        };
      }
      return { ok: true, message: { type: "setMode", mode: data.mode } };
    case "lockLost":
      return {
        ok: true,
        message: {
          type: "lockLost",
          message: isText(data.message, 500)
            ? data.message
            : "Someone else is editing this document.",
        },
      };
    case "insertText":
      if (!isText(data.requestId, 100))
        return { ok: false, reason: "insertText needs a requestId" };
      if (!isText(data.text, MAX_INSERT_CHARS)) {
        return {
          ok: false,
          reason: `text must be 1 to ${String(MAX_INSERT_CHARS)} characters`,
        };
      }
      if (typeof data.replaceSelection !== "boolean") {
        return { ok: false, reason: "replaceSelection must be true or false" };
      }
      return {
        ok: true,
        message: {
          type: "insertText",
          requestId: data.requestId,
          text: data.text,
          replaceSelection: data.replaceSelection,
        },
      };
    default:
      return { ok: false, reason: `unknown message type ${String(data.type)}` };
  }
}
