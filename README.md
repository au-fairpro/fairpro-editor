# FairPro editor

The in-browser Word editor FairPro uses to edit contracts. It is a thin page
around [SuperDoc](https://github.com/superdoc-dev/superdoc) that FairPro opens
in an iframe and drives through `postMessage`.

This repository is public and licensed under the
[GNU AGPL v3](LICENSE) because SuperDoc's community edition is. FairPro's own
platform is a separate program; it only exchanges messages and files with
this page. See [NOTICE.md](NOTICE.md) for the components and their licences.

## How it works

FairPro does everything that matters: who may edit, the edit lock, versions,
storage and audit. This page only shows a document, lets the person change
it, and hands the bytes back when FairPro asks.

1. FairPro frames `https://editor.fairpro.com.au/` and waits for `ready`.
2. FairPro sends `open` with the `.docx` bytes, the person's name and email,
   and the mode. FairPro uses `suggesting`, so every edit is a tracked change.
3. The editor reports `dirty` after the first change, and `activity` at most
   once a minute while the person works, which FairPro uses to keep the edit
   lock alive.
4. FairPro sends `save`; the editor replies `saved` with the new bytes.
   FairPro checks the version and the lock before storing anything.
5. If another person takes the lock, FairPro sends `lockLost`; the editor
   switches to read-only and shows FairPro's message.
6. The editor reports the selected text in `selection`, so FairPro's AI
   panel can work on it. FairPro sends `insertText` to put the person's
   chosen wording at the cursor or in place of the selection; it arrives
   as a tracked change under the person's name (SuperDoc's Document API with
   `changeMode: "tracked"`), and the editor answers `inserted`. Text of
   several lines goes in line by line: the first line at the cursor (or in
   place of the selection), the rest as new paragraphs after that
   paragraph, since SuperDoc's plain-text insert refuses line breaks. Tabs
   become spaces and other control characters are dropped.

### Messages

Every message carries `source` (`"fairpro"` from FairPro, `"fairpro-editor"`
from the editor) and `v: 1`. `selection`, `insertText` and `inserted` were
added to version 1 on 3 October 2026; an older FairPro never sends or reads
them, so the version did not change. `open`'s `people` and the
`mentioned` message were added on 5 October 2026 the same way: without
`people` nobody is offered after @ in a comment. The shapes are in
[`src/protocol.ts`](src/protocol.ts).

| From FairPro | Fields                                        |
| ------------ | --------------------------------------------- |
| `open`       | `fileName`, `bytes`, `user`, `mode`, `people` |
| `save`       | `requestId`                                   |
| `setMode`    | `mode`: `editing`, `suggesting`, `viewing`    |
| `lockLost`   | `message`                                     |
| `insertText` | `requestId`, `text`, `replaceSelection`       |

| From the editor | Fields                                              |
| --------------- | --------------------------------------------------- |
| `ready`         |                                                     |
| `loaded`        | `fileName`                                          |
| `dirty`         | `dirty`                                             |
| `activity`      |                                                     |
| `saved`         | `requestId`, `fileName`, `bytes`                    |
| `selection`     | `text` (at most 4,000 characters), `truncated`      |
| `inserted`      | `requestId`                                         |
| `mentioned`     | `emails` (at most 20) newly @mentioned in a comment |
| `error`         | `code`, `message`, `requestId` when it has one      |

### Security

- The editor only listens to the origins in `VITE_ALLOWED_PARENT_ORIGINS`
  (set at build time; `.env.production` has the default), only to its
  parent window, and only to the first allowed origin that drives it. It
  replies to that exact origin, never `*`.
- FairPro sends the document's bytes, so the editor needs no network access
  and holds no credentials. Its Content-Security-Policy (`vercel.json`) only
  allows its own files, and only `*.fairpro.com.au` may frame it.
- Comments: after @, SuperDoc offers only the `people` FairPro sent (its
  `users` option). The editor reports each newly mentioned person once per
  comment, only if FairPro offered them and never the person writing;
  FairPro checks them again and sends the notices. The comment's text is
  not sent; it stays in the document.
- SuperDoc's telemetry is switched off. The browser tests fail if the page
  requests anything from another host.

## Develop

Node 24 and pnpm (the version in `package.json`).

```bash
pnpm install
pnpm dev          # http://localhost:5180, for FairPro's dev server to frame
pnpm check        # format, lint, typecheck, unit tests
pnpm test:e2e     # builds, then drives the editor from a stand-in host page
                  # (with soffice and pdftotext installed, also the PDF layout check)
```

In a Claude Code cloud session, run the browser tests with
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

## Word round trip (NFR-FID-01)

`e2e/round-trip.spec.ts` opens each contract in a synthetic reference set
(`e2e/reference-set.ts`) the way FairPro does, in suggesting mode, types an
edit, saves, and reads the file back. Between them the six files hold
three-level clause numbering, a table with merged cells, first-page and
default headers with a "Page X of Y" footer, a landscape schedule in its
own section, bookmarks with REF cross-references, and another party's
tracked changes and comment. The test fails if anything a reader sees or
relies on changed apart from the edit (`e2e/fidelity.ts` says what is
compared: text, styles, numbering, alignment, bold, tables, sections,
headers and footers, field codes, bookmarks, tracked changes and comments).
A further test writes a comment in the editor and checks it is saved into
the Word file beside the other party's.

When LibreOffice Writer and poppler are installed (CI installs them), each
file is also laid out as PDF before and after: the same number of pages,
with the same words on each page. That stands in for reopening the file in
Microsoft Word, which is still checked by hand before go-live. To check a
real contract, add a synthetic copy of its features to the reference set;
never commit a customer's document.

## Opening time (NFR-PERF-04)

`e2e/open-time.spec.ts` checks that a 30-page contract opens within 3
seconds (`OPEN_BUDGET_MS`). The contract is synthetic (`e2e/long-contract.ts`:
24 numbered clauses with subclauses and two tables, built from the reference
set's Word XML). The clock runs in the host page from posting `open` to the
editor's `loaded`. To keep a busy CI runner from failing it, the editor opens
the contract once to warm up, then three times in a freshly loaded editor,
and the fastest of the three must be within the budget (`e2e/timing.ts`).
Every time is written to the test's annotations and the console, and the
test also checks that at least 25 pages were laid out.

## Deploy (Vercel)

A Vercel project in the "fairpro" team, linked to this repository, with
production on `main`:

- Framework preset: Vite. Install, build and output settings come from
  `vercel.json`.
- Domain: `editor.fairpro.com.au`.
- Environment variable (only if it differs from `.env.production`):
  `VITE_ALLOWED_PARENT_ORIGINS`, for example `https://demo.fairpro.com.au`.

The page is static, so nothing runs on the server.

## Versions held back

- **TypeScript 6.0.3, not 7.0.** typescript-eslint 8.71.0 supports
  TypeScript below 6.1. Revisit when typescript-eslint supports 7.
  (FairPro holds it back for the same reason, ADR 0020 in fairpro-platform.)
