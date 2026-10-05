// The Word round trip (NFR-FID-01, FR-DOC-002): each synthetic reference
// contract is opened the way FairPro opens it (suggesting mode), edited,
// saved and read back. What a reader sees or relies on must be unchanged
// apart from the edit: numbering, tables, headers and footers, sections,
// cross-references, the other side's tracked changes and comments.
//
// When LibreOffice and poppler are installed (CI installs them), each file
// is also laid out as PDF before and after, as a stand-in for reopening it
// in Word: the same number of pages, with the same words on each page.
// Real Word is still checked by hand before go-live (ADR 0141).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { JSDOM } from "jsdom";
import { fingerprint, withoutEdit } from "./fidelity";
import { send, waitFor, watchSecurityErrors, type Received } from "./host";
import { referenceSet } from "./reference-set";

const { DOMParser } = new JSDOM().window;
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");

const MARKER = "FP-EDIT";
const PERSON = { name: "Test Person", email: "test@example.com" };

const COLLEAGUE = { name: "Kamala Fernando", email: "kamala@example.com" };

async function open(page: Page, fileName: string, bytes: Uint8Array) {
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await page.evaluate(
    ({ fileName, data, user, colleague }) => {
      const buffer = new Uint8Array(data).buffer;
      (
        window as unknown as {
          sendToEditor: (m: object, t?: Transferable[]) => void;
        }
      ).sendToEditor(
        {
          type: "open",
          fileName,
          bytes: buffer,
          user,
          mode: "suggesting",
          people: [colleague],
        },
        [buffer],
      );
    },
    { fileName, data: Array.from(bytes), user: PERSON, colleague: COLLEAGUE },
  );
  await waitFor(page, "loaded");
}

/** Saves, and returns the file re-packed as FairPro stores it (repackDocx). */
async function save(page: Page): Promise<Uint8Array> {
  await send(page, { type: "save", requestId: "round-trip" });
  await waitFor(page, "saved");
  const data = await page.evaluate(() => {
    const m = (window as unknown as { received: Received[] }).received.find(
      (x) => x.type === "saved",
    );
    if (!m) throw new Error("no saved message");
    return Array.from(new Uint8Array(m.bytes as ArrayBuffer));
  });
  return zipSync(unzipSync(new Uint8Array(data)));
}

/** Clicks at the end of the paragraph and types, as a person would. */
async function typeAfter(page: Page, paragraph: string, text: string) {
  await page
    .frameLocator("#editor")
    .locator(".superdoc-text-run", { hasText: paragraph.slice(0, 40) })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 20 });
  await waitFor(page, "dirty");
}

/** Whether a command exists; some tools exit non-zero even for --version. */
function installed(command: string): boolean {
  try {
    execFileSync(command, ["-v"], { stdio: "ignore" });
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code !== "ENOENT";
  }
}

const canRender = installed("soffice") && installed("pdftotext");

/** Each page's words, as LibreOffice lays the file out. */
function pages(name: string, bytes: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "fidelity-"));
  writeFileSync(join(dir, `${name}.docx`), bytes);
  execFileSync(
    "soffice",
    ["--headless", "--convert-to", "pdf", "--outdir", dir, `${name}.docx`],
    // Its own profile, so a running LibreOffice does not swallow the job.
    {
      cwd: dir,
      env: { ...process.env, HOME: dir },
      stdio: "ignore",
      timeout: 120_000,
    },
  );
  return execFileSync("pdftotext", [`${name}.pdf`, "-"], { cwd: dir })
    .toString()
    .split("\f")
    .map((page) => page.replace(MARKER, "").replace(/\s+/g, " ").trim())
    .filter((page, index, all) => page !== "" || index < all.length - 1);
}

for (const document of referenceSet()) {
  test(`keeps ${document.name} through an edit and a save`, async ({
    page,
  }) => {
    const errors = watchSecurityErrors(page);
    await open(page, `${document.name}.docx`, document.bytes);
    await typeAfter(page, document.editHere, ` ${MARKER}`);
    const saved = await save(page);

    const before = fingerprint(document.bytes, parse);
    const after = withoutEdit(fingerprint(saved, parse), MARKER, PERSON.name);
    expect(after).toEqual(before);

    if (canRender) {
      expect(pages(`${document.name}-after`, saved)).toEqual(
        pages(document.name, document.bytes),
      );
    }
    expect(errors).toEqual([]);
  });
}

test("saves a comment written in the editor, beside the other side's", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  const document = referenceSet().find(
    (d) => d.name === "counterparty-changes",
  );
  if (!document) throw new Error("no counterparty-changes document");
  await open(page, "comments.docx", document.bytes);

  const editor = page.frameLocator("#editor");
  await editor
    .locator(".superdoc-text-run", { hasText: "liability is limited" })
    .first()
    .dblclick();
  // SuperDoc's add-comment button beside the selection.
  await editor.locator(".superdoc__tools .tools-item").first().click();
  const box = editor.locator("textarea[data-sd-comment-mention-input]");
  await expect(box).toBeFocused();
  await page.keyboard.type("Can we accept this cap?");
  await editor.getByRole("button", { name: "Comment", exact: true }).click();
  await waitFor(page, "dirty");

  const print = fingerprint(await save(page), parse);
  expect(print.comments).toEqual(
    expect.arrayContaining([
      {
        author: "Casey Counsel (counterparty)",
        text: "We need 90 days' notice here.",
        anchor: "The Buyer may terminate for convenience on 30 days' notice.",
      },
      expect.objectContaining({
        author: PERSON.name,
        text: "Can we accept this cap?",
      }),
    ]),
  );
  const mine = print.comments.find((c) => c.author === PERSON.name);
  expect(mine?.anchor).not.toBe("");
  // The other side's tracked changes are still there, still theirs.
  expect(print.tracked).toEqual(fingerprint(document.bytes, parse).tracked);
  expect(errors).toEqual([]);
});

test("takes a reply, with a mention, to a comment written by another program", async ({
  page,
}) => {
  // The other side's comment has no paragraph id, like FairPro's AI
  // comments before 5 October 2026; SuperDoc's Reply did nothing on it.
  const errors = watchSecurityErrors(page);
  const document = referenceSet().find(
    (d) => d.name === "counterparty-changes",
  );
  if (!document) throw new Error("no counterparty-changes document");
  await open(page, "reply.docx", document.bytes);

  const editor = page.frameLocator("#editor");
  const card = editor.locator(".comments-dialog", {
    hasText: "We need 90 days' notice here.",
  });
  await card.click();
  await card.getByRole("button", { name: /^Reply or add others/ }).click();
  const box = card.locator("textarea[data-sd-comment-mention-input]");
  await box.click();
  await page.keyboard.type("60 days? @Ka");
  await editor.getByText(COLLEAGUE.email).click();
  await expect(box).toHaveValue(/@Kamala Fernando/);
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(card).toContainText("60 days?");
  // FairPro is told who the reply mentions, as for a new comment.
  const mentioned = await waitFor(page, "mentioned");
  expect(mentioned.emails).toEqual([COLLEAGUE.email]);

  const print = fingerprint(await save(page), parse);
  expect(print.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        author: PERSON.name,
        text: expect.stringContaining("60 days?"),
      }),
    ]),
  );
  expect(errors).toEqual([]);
});
