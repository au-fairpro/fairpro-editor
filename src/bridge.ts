// Connects FairPro's messages to the editor. The editor itself sits behind
// EditorAdapter so this file can be tested without SuperDoc, and so the
// rest of the app does not care which editor library is underneath.

import {
  envelope,
  MAX_MENTIONED,
  MAX_SELECTION_CHARS,
  parseParentMessage,
  type DocumentMode,
  type EditorMessage,
  type EditorUser,
  type ParentMessage,
} from "./protocol";
import { isAllowedOrigin } from "./origins";

export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Tell FairPro the person is still working at most this often. */
export const ACTIVITY_INTERVAL_MS = 60_000;

export interface EditorAdapter {
  open(
    file: File,
    options: {
      user: EditorUser;
      mode: DocumentMode;
      onChange: () => void;
      /** The selected text, or "" when nothing is selected. */
      onSelection: (text: string) => void;
      /** Who may be @mentioned in comments. */
      people: EditorUser[];
      /** A comment was added or changed, with the emails it mentions. */
      onComment: (comment: CommentMentions) => void;
    },
  ): Promise<void>;
  exportDocx(): Promise<Blob>;
  setMode(mode: DocumentMode): void;
  /** Inserts at the cursor, or in place of the last selection; throws on failure. */
  insertText(
    text: string,
    options: { replaceSelection: boolean },
  ): Promise<void>;
  close(): void;
}

export interface CommentMentions {
  commentId: string;
  /** Emails of the people the comment mentions. */
  emails: string[];
}

export interface EditorUi {
  /** A short line saying what the editor is doing, read out to screen readers. */
  status(text: string): void;
  /** A warning shown above the document, or null to clear it. */
  banner(text: string | null): void;
}

/** The parts of `window` the bridge uses, so tests can pass a fake. */
export interface HostWindow {
  parent: {
    postMessage(
      message: unknown,
      targetOrigin: string,
      transfer?: Transferable[],
    ): void;
  };
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
}

export interface BridgeOptions {
  host: HostWindow;
  allowedOrigins: readonly string[];
  adapter: EditorAdapter;
  ui: EditorUi;
  now?: () => number;
}

export class Bridge {
  private readonly host: HostWindow;
  private readonly allowedOrigins: readonly string[];
  private readonly adapter: EditorAdapter;
  private readonly ui: EditorUi;
  private readonly now: () => number;
  /** The origin driving the editor, fixed by the first valid message. */
  private parentOrigin: string | null = null;
  private isOpen = false;
  private mode: DocumentMode = "viewing";
  /** The selection last reported to FairPro, so only changes are sent. */
  private selection = "";
  private fileName = "";
  private dirty = false;
  private lastActivity = Number.NEGATIVE_INFINITY;
  /** Emails of the people FairPro offered, lower case, without the person. */
  private mentionable = new Set<string>();
  /** Who each comment's mentions were already reported for. */
  private reported = new Map<string, Set<string>>();
  /** Opens and saves run one at a time, in the order they arrived. */
  private queue: Promise<void> = Promise.resolve();
  private readonly listener = (event: MessageEvent): void => {
    void this.receive(event);
  };

  constructor(options: BridgeOptions) {
    this.host = options.host;
    this.allowedOrigins = options.allowedOrigins;
    this.adapter = options.adapter;
    this.ui = options.ui;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.host.addEventListener("message", this.listener);
    // The parent's origin is not known yet. A message whose target origin
    // does not match the parent is dropped by the browser, and "ready"
    // carries nothing, so it is safe to announce to each allowed origin.
    for (const origin of this.allowedOrigins) {
      this.host.parent.postMessage(envelope({ type: "ready" }), origin);
    }
    this.ui.status("Waiting for FairPro to open a document.");
  }

  stop(): void {
    this.host.removeEventListener("message", this.listener);
    if (this.isOpen) this.adapter.close();
    this.isOpen = false;
  }

  /** Returns the work started for the message, so tests can wait for it. */
  receive(event: MessageEvent): Promise<void> {
    if (event.source !== this.host.parent) return Promise.resolve();
    if (!isAllowedOrigin(event.origin, this.allowedOrigins))
      return Promise.resolve();
    if (this.parentOrigin !== null && event.origin !== this.parentOrigin) {
      return Promise.resolve();
    }
    const parsed = parseParentMessage(event.data);
    if (!parsed.ok) {
      // Stray messages from extensions are common; only answer ones that
      // claim to be FairPro's, so FairPro learns about its own mistakes.
      if (parsed.reason !== "not a FairPro message") {
        this.parentOrigin ??= event.origin;
        this.send({
          type: "error",
          code: "bad_message",
          message: parsed.reason,
        });
      }
      return Promise.resolve();
    }
    this.parentOrigin ??= event.origin;
    const work = this.queue.then(() => this.handle(parsed.message));
    this.queue = work.catch(() => undefined);
    return work;
  }

  private async handle(message: ParentMessage): Promise<void> {
    switch (message.type) {
      case "open":
        return this.open(message);
      case "save":
        return this.save(message.requestId);
      case "setMode":
        if (!this.isOpen) {
          this.send({
            type: "error",
            code: "not_open",
            message: "No document is open.",
          });
          return;
        }
        this.adapter.setMode(message.mode);
        this.mode = message.mode;
        if (message.mode !== "viewing") this.ui.banner(null);
        return;
      case "lockLost":
        if (this.isOpen) this.adapter.setMode("viewing");
        this.mode = "viewing";
        this.ui.banner(message.message);
        return;
      case "insertText":
        return this.insert(message);
    }
  }

  private async insert(
    message: Extract<ParentMessage, { type: "insertText" }>,
  ): Promise<void> {
    const { requestId } = message;
    if (!this.isOpen) {
      this.send({
        type: "error",
        code: "not_open",
        message: "No document is open.",
        requestId,
      });
      return;
    }
    if (this.mode === "viewing") {
      this.send({
        type: "error",
        code: "insert_failed",
        message: "The document is read-only.",
        requestId,
      });
      return;
    }
    if (message.replaceSelection && this.selection === "") {
      this.send({
        type: "error",
        code: "insert_failed",
        message: "Select the text to replace first.",
        requestId,
      });
      return;
    }
    try {
      await this.adapter.insertText(message.text, {
        replaceSelection: message.replaceSelection,
      });
    } catch (error) {
      this.send({
        type: "error",
        code: "insert_failed",
        message: describe(error),
        requestId,
      });
      return;
    }
    this.send({ type: "inserted", requestId });
  }

  private async open(
    message: Extract<ParentMessage, { type: "open" }>,
  ): Promise<void> {
    if (this.isOpen) {
      this.adapter.close();
      this.isOpen = false;
    }
    this.dirty = false;
    this.selection = "";
    this.reported = new Map();
    const me = message.user.email.toLowerCase();
    this.mentionable = new Set(
      message.people
        .map((person) => person.email.toLowerCase())
        .filter((email) => email !== me),
    );
    this.ui.banner(null);
    this.ui.status(`Opening ${message.fileName}.`);
    const file = new File([message.bytes], message.fileName, {
      type: DOCX_TYPE,
    });
    try {
      await this.adapter.open(file, {
        user: message.user,
        mode: message.mode,
        onChange: () => {
          this.changed();
        },
        onSelection: (text) => {
          this.selected(text);
        },
        people: message.people,
        onComment: (comment) => {
          this.commented(comment);
        },
      });
    } catch (error) {
      this.ui.status("The document could not be opened.");
      this.send({
        type: "error",
        code: "open_failed",
        message: describe(error),
      });
      return;
    }
    this.isOpen = true;
    this.mode = message.mode;
    this.fileName = message.fileName;
    this.ui.status(`${message.fileName} is open.`);
    this.send({ type: "loaded", fileName: message.fileName });
  }

  private async save(requestId: string): Promise<void> {
    if (!this.isOpen) {
      this.send({
        type: "error",
        code: "not_open",
        message: "No document is open.",
        requestId,
      });
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await (await this.adapter.exportDocx()).arrayBuffer();
    } catch (error) {
      this.send({
        type: "error",
        code: "save_failed",
        message: describe(error),
        requestId,
      });
      return;
    }
    // FairPro decides whether the save is accepted (version check, lock);
    // the editor only reports that it handed the bytes over.
    this.send({ type: "saved", requestId, fileName: this.fileName, bytes }, [
      bytes,
    ]);
    this.dirty = false;
    this.send({ type: "dirty", dirty: false });
  }

  private selected(text: string): void {
    if (text === this.selection) return;
    this.selection = text;
    this.send({
      type: "selection",
      text: text.slice(0, MAX_SELECTION_CHARS),
      truncated: text.length > MAX_SELECTION_CHARS,
    });
  }

  /**
   * Reports people newly mentioned in a comment: only people FairPro
   * offered, never the person writing, each once per comment.
   */
  private commented({ commentId, emails }: CommentMentions): void {
    const reported = this.reported.get(commentId) ?? new Set<string>();
    const fresh = [
      ...new Set(emails.map((email) => email.toLowerCase())),
    ].filter((email) => this.mentionable.has(email) && !reported.has(email));
    if (fresh.length === 0) return;
    for (const email of fresh) reported.add(email);
    this.reported.set(commentId, reported);
    for (let start = 0; start < fresh.length; start += MAX_MENTIONED) {
      this.send({
        type: "mentioned",
        emails: fresh.slice(start, start + MAX_MENTIONED),
      });
    }
  }

  private changed(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.send({ type: "dirty", dirty: true });
    }
    const now = this.now();
    if (now - this.lastActivity >= ACTIVITY_INTERVAL_MS) {
      this.lastActivity = now;
      this.send({ type: "activity" });
    }
  }

  private send(message: EditorMessage, transfer: Transferable[] = []): void {
    if (this.parentOrigin === null) return;
    this.host.parent.postMessage(
      envelope(message),
      this.parentOrigin,
      transfer,
    );
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300) || "Unknown error";
}
