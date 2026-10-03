import "./style.css";
import { Bridge, type EditorUi } from "./bridge";
import { parseAllowedOrigins } from "./origins";
import { SuperDocAdapter } from "./superdoc-adapter";

const statusEl = document.querySelector<HTMLElement>("#status");
const bannerEl = document.querySelector<HTMLElement>("#banner");
const sourceEl = document.querySelector<HTMLAnchorElement>("#source");
if (!statusEl || !bannerEl || !sourceEl)
  throw new Error("index.html is missing an element");

// AGPL section 13: people using the editor over a network are offered its
// source. The link points at the exact commit that was built when known.
const commit = import.meta.env.VITE_GIT_COMMIT_SHA;
sourceEl.href = commit
  ? `https://github.com/au-fairpro/fairpro-editor/tree/${commit}`
  : "https://github.com/au-fairpro/fairpro-editor";

const ui: EditorUi = {
  status(text) {
    statusEl.textContent = text;
  },
  banner(text) {
    bannerEl.textContent = text ?? "";
    bannerEl.hidden = text === null;
  },
};

if (window.parent === window) {
  // Opened on its own, not inside FairPro: there is nothing to edit.
  ui.status(
    "This editor opens from FairPro. Open a contract in FairPro and choose Edit.",
  );
} else {
  const bridge = new Bridge({
    host: window,
    allowedOrigins: parseAllowedOrigins(
      import.meta.env.VITE_ALLOWED_PARENT_ORIGINS,
    ),
    adapter: new SuperDocAdapter({
      documentSelector: "#document",
      toolbarSelector: "#toolbar",
    }),
    ui,
  });
  bridge.start();
}
