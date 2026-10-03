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

### Messages

Every message carries `source` (`"fairpro"` from FairPro, `"fairpro-editor"`
from the editor) and `v: 1`. The shapes are in
[`src/protocol.ts`](src/protocol.ts).

| From FairPro | Fields                                     |
| ------------ | ------------------------------------------ |
| `open`       | `fileName`, `bytes`, `user`, `mode`        |
| `save`       | `requestId`                                |
| `setMode`    | `mode`: `editing`, `suggesting`, `viewing` |
| `lockLost`   | `message`                                  |

| From the editor | Fields                                         |
| --------------- | ---------------------------------------------- |
| `ready`         |                                                |
| `loaded`        | `fileName`                                     |
| `dirty`         | `dirty`                                        |
| `activity`      |                                                |
| `saved`         | `requestId`, `fileName`, `bytes`               |
| `error`         | `code`, `message`, `requestId` when it has one |

### Security

- The editor only listens to the origins in `VITE_ALLOWED_PARENT_ORIGINS`
  (set at build time; `.env.production` has the default), only to its
  parent window, and only to the first allowed origin that drives it. It
  replies to that exact origin, never `*`.
- FairPro sends the document's bytes, so the editor needs no network access
  and holds no credentials. Its Content-Security-Policy (`vercel.json`) only
  allows its own files, and only `*.fairpro.com.au` may frame it.
- SuperDoc's telemetry is switched off. The browser tests fail if the page
  requests anything from another host.

## Develop

Node 24 and pnpm (the version in `package.json`).

```bash
pnpm install
pnpm dev          # http://localhost:5180, for FairPro's dev server to frame
pnpm check        # format, lint, typecheck, unit tests
pnpm test:e2e     # builds, then drives the editor from a stand-in host page
```

In a Claude Code cloud session, run the browser tests with
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

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
