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
   become spaces and other control characters are dropped. With `via`
   (such as `"the assistant"`), the tracked change also gets a comment by
   "[person] via the assistant" saying the text was suggested (FR-AI-032).
   SuperDoc 2 has no supported way to give one tracked change another
   author ([superdoc/docx-editor#3998](https://github.com/superdoc/docx-editor/issues/3998)),
   so the change itself stays under the person's name.

### Messages

Every message carries `source` (`"fairpro"` from FairPro, `"fairpro-editor"`
from the editor) and `v: 1`. `selection`, `insertText` and `inserted` were
added to version 1 on 3 October 2026; an older FairPro never sends or reads
them, so the version did not change. `open`'s `people` and the
`mentioned` message were added on 5 October 2026 the same way: without
`people` nobody is offered after @ in a comment. `insertText`'s optional
`via` was added on 5 October 2026 too; an older editor ignores it.
`open`'s `language` was added on 18 October 2026: without it the editor spell
checks in Australian English, and an older editor ignores it. The shapes are in
[`src/protocol.ts`](src/protocol.ts).

| From FairPro | Fields                                                     |
| ------------ | ---------------------------------------------------------- |
| `open`       | `fileName`, `bytes`, `user`, `mode`, `people`, `language?` |
| `save`       | `requestId`                                                |
| `setMode`    | `mode`: `editing`, `suggesting`, `viewing`                 |
| `lockLost`   | `message`                                                  |
| `insertText` | `requestId`, `text`, `replaceSelection`, `via?`            |

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

### Spell checking

FairPro sends the organisation's English in `open`'s `language`: `en-AU`
(the default), `en-GB`, `en-US` or `en-CA`. The editor checks the
document's English text against that Hunspell dictionary, whatever English
the Word file itself names (Word files often say `en-US` because that is
Word's default), and skips text the file marks as another language. A
language the editor has no dictionary for turns spell checking off.

SuperDoc draws the red squiggles and offers suggestions on right-click
through its `proofing` option; the editor supplies the provider
(`src/spelling-provider.ts`). The words are checked by
[Typo.js](https://github.com/cfinke/Typo.js) in a web worker
(`src/spelling.worker.ts`), with the dictionaries from
[wooorm/dictionaries](https://github.com/wooorm/dictionaries) served by
the editor itself, so nothing about the document leaves the page.
Acronyms (ABN), names with an inner capital (FairPro), and anything with a
digit, `@` or `/` are not checked, and a short list of contract words the
dictionaries lack (Pty, counterparty, novation and others, in
`src/spelling.ts`) is accepted in every English.

### Security

- The editor only listens to the origins in `VITE_ALLOWED_PARENT_ORIGINS`
  (set at build time; `.env.production` has the default), only to its
  parent window, and only to the first allowed origin that drives it. It
  replies to that exact origin, never `*`.
- FairPro sends the document's bytes, so the editor needs no network access
  and holds no credentials. Its Content-Security-Policy (`vercel.json`) only
  allows its own files, and only `*.fairpro.com.au` may frame it. On AWS,
  CloudFront sends the same headers (fairpro-infra,
  `terraform/live/production/editor`); change both together.
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

## Deploy (AWS)

The editor is moving from Vercel to S3 + CloudFront (Gayan, 15 October
2026). FairPro at `app.fairpro.com.au` embeds the editor at
`editor.fairpro.com.au`, and `.env.production` allows only it (the demo at
`demo.fairpro.com.au` was retired on 17 October 2026). When the browser
names the embedding page, the editor greets only that page, so a second
allowed origin does not log "Unable to post message" in the console. The bucket, distribution and deploy role are in fairpro-infra
(`terraform/live/production/editor`, module `static-site`);
`runbooks/aws-app.md` there, "Editor on AWS", gives the order of the steps
and the DNS cutover.

**Release:** Actions, "AWS deploy", "Run workflow", from `main` or a tag.
`.github/workflows/aws-deploy.yml` runs one release at a time and is never
cancelled half way. It installs, runs `pnpm check` and `pnpm build` as CI
and Vercel do, signs in to AWS through GitHub OIDC, then runs
`node scripts/aws-deploy.ts deploy dist`, which:

1. uploads the hashed files (`assets/name-HASH.ext`) with
   `Cache-Control: public, max-age=31536000, immutable`;
2. uploads the other files, `index.html` last, with `Cache-Control: no-cache`,
   each with its Content-Type set explicitly;
3. invalidates the unhashed paths (`/`, `/index.html`, ...) in CloudFront and
   waits until that is done;
4. only then deletes from the bucket the files the new build no longer has.

The bucket keeps earlier versions for 30 days, so a bad release is undone by
running the workflow again from the previous tag.

**Set up once** (repository settings, Environments): an environment
`aws-editor`, with deployment branches and tags limited to `main` and tags,
and these variables (not secrets; from `terragrunt output`):

| Variable                 | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN`    | `deploy_role_arn`                                                                                 |
| `EDITOR_BUCKET`          | `bucket` (`fairpro-editor-site`)                                                                  |
| `EDITOR_DISTRIBUTION_ID` | `distribution_id`                                                                                 |
| `EDITOR_CHECK_URL`       | optional: `https://<cloudfront_domain>/`, then `https://editor.fairpro.com.au/` after the cutover |

The deploy role trusts only this repository's `aws-editor` environment
(GitHub's immutable subject,
`repo:au-fairpro@337274428/fairpro-editor@1403196457:environment:aws-editor`),
and may only put, delete and list objects in the bucket and create
invalidations. Waiting for the invalidation also needs
`cloudfront:GetInvalidation`, which the role does not have yet (to be added
in fairpro-infra before the first release); until then the workflow stops
at the wait, after the upload and the invalidation, and deletes nothing. When `EDITOR_CHECK_URL` is set, the workflow's last step
fetches it and fails unless the Content-Security-Policy, Referrer-Policy,
X-Content-Type-Options and Permissions-Policy are exactly those in
`vercel.json` and `index.html` is served `no-cache`. Run the same check by
hand with `node scripts/aws-deploy.ts check-headers <url>`.

## Deploy (Vercel, until the cutover)

Vercel keeps serving `editor.fairpro.com.au` until the DNS cutover in
fairpro-infra's runbook; then the domain is removed from the Vercel project.

A Vercel project in the "fairpro" team, linked to this repository, with
production on `main`:

- Framework preset: Vite. Install, build and output settings come from
  `vercel.json`.
- Domain: `editor.fairpro.com.au`.
- Environment variable (only if it differs from `.env.production`):
  `VITE_ALLOWED_PARENT_ORIGINS`, for example `https://app.fairpro.com.au`.

The page is static, so nothing runs on the server.

## Versions lifted by overrides

`pnpm-workspace.yaml` lifts two packages past what their parents ask for,
after the security review of 24 October 2026:

- **pdfjs-dist 6.x** (SuperDoc 2.20.0 asks for ^5.4.296): 5.6.83 to 6.2.107
  can run a malicious PDF's JavaScript (GHSA-hq66-cqwq-w95j). The editor
  only opens Word files, and its end-to-end tests pass on 6.x. Drop the
  override once SuperDoc depends on a fixed version.
- **undici 8.12.2** (through jsdom, tests only).

## Versions held back

- **TypeScript 6.0.3, not 7.0.** typescript-eslint 8.71.0 supports
  TypeScript below 6.1. Revisit when typescript-eslint supports 7.
  (FairPro holds it back for the same reason, ADR 0020 in fairpro-platform.)
