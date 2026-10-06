// SuperDoc behind the EditorAdapter interface.
//
// Settings that matter, from the FairPro editor spike (3 October 2026):
// - Telemetry off. SuperDoc sends a document-open event by default; contract
//   documents must not announce themselves to a third party.
// - FairPro chooses the mode. It asks for "suggesting" so every edit is a
//   tracked change, as lawyers expect when a contract is negotiated.
// - SuperDoc 2 starts its engine in a web worker, which needs Vite's worker
//   handling; a plain esbuild bundle fails with "browser worker failed to
//   start".
// - Selection and insertion go through SuperDoc's public UI controller
//   (`superdoc.ui`): `selection.subscribe` reports what is selected. Text goes
//   in through the active editor's Document API (`doc.insert`, `doc.replace`)
//   with `changeMode: "tracked"`. The Document API ignores the suggesting
//   mode, so without that option an insertion would be a silent change.
//   `activeEditor.commands` is null in SuperDoc 2 and is not used.
// - @mentions in comments: SuperDoc's `users` option lists who its comment
//   box offers after @, and each comment in `onCommentsUpdate` carries a
//   `mentions` list of { name, email }. FairPro sends the list and is told
//   who was mentioned; it decides who may be and tells them.
// - "[name] via the assistant" (FR-AI-032): SuperDoc 2 has no supported way
//   to set a tracked change's author per insertion
//   (github.com/superdoc/docx-editor/issues/3998), so the change stays
//   under the person's name and a comment anchored to it, created with the
//   Document API's `comments.create` (`trackedChangeId`, `author`,
//   `authorEmail`), says who suggested it.

import { SuperDoc } from "superdoc";
import "superdoc/style.css";
import type { DocumentMode, EditorUser } from "./protocol";
import type { CommentMentions, EditorAdapter, SuggestedBy } from "./bridge";
import { commentMentions } from "./mentions";
import {
  asMarkdownParagraphs,
  cleanText,
  failure,
  trackedChangeIds,
} from "./text";

export interface SuperDocAdapterOptions {
  /** CSS selector of the element the document is drawn in. */
  documentSelector: string;
  /** CSS selector of the element the toolbar is drawn in. */
  toolbarSelector: string;
}

type Capture = NonNullable<ReturnType<SuperDoc["ui"]["selection"]["capture"]>>;
type Target = NonNullable<Capture["selectionTarget"]>;

/** A command result or receipt that reports success. */
export function succeeded(result: unknown): boolean {
  if (typeof result === "boolean") return result;
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { success?: unknown }).success === true
  );
}

export class SuperDocAdapter implements EditorAdapter {
  private superdoc: SuperDoc | null = null;
  /** The last non-empty selection, so it can be restored after FairPro's panel took focus. */
  private lastSelection: Capture | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly options: SuperDocAdapterOptions) {}

  open(
    file: File,
    {
      user,
      mode,
      onChange,
      onSelection,
      people,
      onComment,
    }: {
      user: EditorUser;
      mode: DocumentMode;
      onChange: () => void;
      onSelection: (text: string) => void;
      people: EditorUser[];
      onComment: (comment: CommentMentions) => void;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        this.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      this.superdoc = new SuperDoc({
        selector: this.options.documentSelector,
        toolbar: this.options.toolbarSelector,
        document: file,
        documentMode: mode,
        user: { name: user.name, email: user.email },
        users: people.map((person) => ({
          name: person.name,
          email: person.email,
        })),
        telemetry: { enabled: false },
        onReady: () => {
          settled = true;
          this.watchSelection(onSelection);
          resolve();
        },
        onException: ({ error }) => {
          fail(error);
        },
        onContentError: ({ error }) => {
          fail(error);
        },
        onEditorUpdate: () => {
          onChange();
        },
        onCommentsUpdate: (update) => {
          onChange();
          const mentioned = commentMentions(update);
          if (mentioned) onComment(mentioned);
        },
      });
    });
  }

  async exportDocx(): Promise<Blob> {
    if (!this.superdoc) throw new Error("No document is open.");
    return this.superdoc.export({
      exportType: ["docx"],
      triggerDownload: false,
    });
  }

  private watchSelection(onSelection: (text: string) => void): void {
    const ui = this.superdoc?.ui;
    if (!ui) return;
    this.stopWatching = ui.selection.subscribe(({ snapshot }) => {
      const text = snapshot.empty ? "" : snapshot.quotedText;
      this.lastSelection = text ? ui.selection.capture() : null;
      onSelection(text);
    });
  }

  async insertText(
    text: string,
    {
      replaceSelection,
      suggestedBy,
    }: { replaceSelection: boolean; suggestedBy?: SuggestedBy },
  ): Promise<void> {
    const ui = this.superdoc?.ui;
    const doc = this.superdoc?.activeEditor?.doc;
    if (!ui || !doc) throw new Error("No document is open.");
    let target: Target | null;
    if (replaceSelection) {
      target = this.lastSelection?.selectionTarget ?? null;
      if (!target) throw new Error("Select the text to replace first.");
    } else {
      // At the cursor: a collapsed target at the selection's end, so text
      // that is still selected is kept, not replaced.
      const current = ui.selection.getSnapshot().selectionTarget;
      target = current ? { ...current, start: current.end } : null;
      if (!target)
        throw new Error("Click in the document where the text should go.");
    }
    // The Document API ignores the suggesting mode, so ask for tracking.
    const tracked = { changeMode: "tracked" as const };
    const clean = cleanText(text);
    if (!clean) throw new Error("There is no text to put in.");
    const [first = "", ...rest] = clean.split("\n").filter((l) => l.trim());
    // The first line goes in where the person chose, as plain text.
    const placed: unknown = replaceSelection
      ? await doc.replace({ target, text: first.trim() }, tracked)
      : await doc.insert({ target, value: first.trim() }, tracked);
    if (!succeeded(placed)) throw new Error(failure(placed));
    const changes = trackedChangeIds(placed);
    if (rest.length === 0) {
      await this.markSuggested(changes, suggestedBy);
      return;
    }
    // Plain text cannot carry a line break, and Markdown cannot go in the
    // middle of a paragraph, so further lines become new paragraphs after
    // the paragraph the first line went into.
    const end = target.end;
    if (end.kind !== "text") {
      throw new Error("Only the first line could be put in here.");
    }
    const { address: block } = await doc.getNodeById({ nodeId: end.blockId });
    if (block.kind !== "block") {
      throw new Error("Only the first line could be put in here.");
    }
    const after: unknown = await doc.insert(
      {
        target: block,
        placement: "after",
        value: asMarkdownParagraphs(rest.join("\n")),
        type: "markdown",
      },
      tracked,
    );
    if (!succeeded(after)) throw new Error(failure(after));
    await this.markSuggested(
      [...changes, ...trackedChangeIds(after)],
      suggestedBy,
    );
  }

  /**
   * Comments on the first tracked change an insertion made, as "[name] via
   * [it]", saying who suggested the text. The text is in by now, so a
   * comment that cannot be made does not undo or fail the insertion; the
   * change still carries the person's own name.
   */
  private async markSuggested(
    changes: readonly string[],
    suggestedBy: SuggestedBy | undefined,
  ): Promise<void> {
    const doc = this.superdoc?.activeEditor?.doc;
    const [trackedChangeId] = changes;
    if (!suggestedBy || !doc || !trackedChangeId) return;
    try {
      await doc.comments.create({
        trackedChangeId,
        author: suggestedBy.author,
        authorEmail: suggestedBy.authorEmail,
        text: `Suggested by ${suggestedBy.author}.`,
      });
    } catch {
      // Left without the comment; see above.
    }
  }

  setMode(mode: DocumentMode): void {
    this.superdoc?.setDocumentMode(mode);
  }

  close(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.lastSelection = null;
    this.superdoc?.destroy();
    this.superdoc = null;
  }
}
