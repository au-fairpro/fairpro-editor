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

import { SuperDoc } from "superdoc";
import "superdoc/style.css";
import type { DocumentMode, EditorUser } from "./protocol";
import type { EditorAdapter } from "./bridge";

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

/** Why a receipt failed, in words, when it says. */
function failure(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "The text could not be put into the document.";
  }
  const failed = (result as { failure?: { message?: unknown; code?: unknown } })
    .failure;
  const said = failed?.message ?? failed?.code;
  return typeof said === "string" && said
    ? said
    : "The text could not be put into the document.";
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
    }: {
      user: EditorUser;
      mode: DocumentMode;
      onChange: () => void;
      onSelection: (text: string) => void;
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
        onCommentsUpdate: () => {
          onChange();
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
    { replaceSelection }: { replaceSelection: boolean },
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
    const result: unknown = replaceSelection
      ? await doc.replace({ target, text }, tracked)
      : await doc.insert({ target, value: text }, tracked);
    if (!succeeded(result)) throw new Error(failure(result));
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
