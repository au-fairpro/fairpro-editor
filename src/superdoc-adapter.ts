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

export class SuperDocAdapter implements EditorAdapter {
  private superdoc: SuperDoc | null = null;

  constructor(private readonly options: SuperDocAdapterOptions) {}

  open(
    file: File,
    {
      user,
      mode,
      onChange,
    }: { user: EditorUser; mode: DocumentMode; onChange: () => void },
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

  setMode(mode: DocumentMode): void {
    this.superdoc?.setDocumentMode(mode);
  }

  close(): void {
    this.superdoc?.destroy();
    this.superdoc = null;
  }
}
