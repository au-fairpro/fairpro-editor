import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

interface Received {
  source: string;
  v: number;
  type: string;
  [key: string]: unknown;
}

async function received(page: Page): Promise<Received[]> {
  return page.evaluate(
    () => (window as unknown as { received: Received[] }).received,
  );
}

async function waitFor(page: Page, type: string): Promise<Received> {
  await expect
    .poll(async () => (await received(page)).some((m) => m.type === type), {
      timeout: 60_000,
    })
    .toBe(true);
  const found = (await received(page)).find((m) => m.type === type);
  if (!found) throw new Error(`no ${type} message`);
  return found;
}

async function openSample(page: Page, mode = "suggesting") {
  await page.evaluate(async (mode) => {
    const bytes = await (await fetch("/sample.docx")).arrayBuffer();
    const w = window as unknown as {
      sendToEditor: (m: object, t?: Transferable[]) => void;
    };
    w.sendToEditor(
      {
        type: "open",
        fileName: "Sample MSA.docx",
        bytes,
        user: { name: "Test Person", email: "test@example.com" },
        mode,
      },
      [bytes],
    );
  }, mode);
}

function watchSecurityErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|Refused to/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  // Contracts must not leave the browser: telemetry is off, and the editor
  // fetches nothing from anywhere but its own origin.
  page.on("request", (request) => {
    const { hostname, protocol } = new URL(request.url());
    if (
      !["blob:", "data:"].includes(protocol) &&
      !["localhost", "127.0.0.1"].includes(hostname)
    ) {
      errors.push(`request to ${request.url()}`);
    }
  });
  return errors;
}

test("opens a document, tracks an edit and hands the edited bytes back", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page);
  expect((await waitFor(page, "loaded")).fileName).toBe("Sample MSA.docx");

  const editor = page.frameLocator("#editor");
  await editor
    .locator(".superdoc-text-run", {
      hasText: "pay each invoice within 30 days",
    })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(" FP-EDIT", { delay: 20 });
  await waitFor(page, "dirty");
  await waitFor(page, "activity");

  await page.evaluate(() => {
    (window as unknown as { sendToEditor: (m: object) => void }).sendToEditor({
      type: "save",
      requestId: "r1",
    });
  });
  await waitFor(page, "saved");
  const saved = await page.evaluate(() => {
    const m = (window as unknown as { received: Received[] }).received.find(
      (x) => x.type === "saved",
    );
    if (!m) throw new Error("no saved message");
    return {
      requestId: m.requestId,
      fileName: m.fileName,
      bytes: Array.from(new Uint8Array(m.bytes as ArrayBuffer)),
    };
  });
  expect(saved.requestId).toBe("r1");
  expect(saved.fileName).toBe("Sample MSA.docx");
  const xml = strFromU8(
    unzipSync(new Uint8Array(saved.bytes))["word/document.xml"] ??
      new Uint8Array(),
  );
  expect(xml).toContain("FP-EDIT");
  // Suggesting mode: the edit is a tracked insertion, not a silent change.
  expect(xml).toMatch(/<w:ins\b[^>]*w:author="Test Person"/);

  expect(errors).toEqual([]);
});

test("switches to read-only and says why when FairPro reports the lock is lost", async ({
  page,
}) => {
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page, "editing");
  await waitFor(page, "loaded");
  await page.evaluate(() => {
    (window as unknown as { sendToEditor: (m: object) => void }).sendToEditor({
      type: "lockLost",
      message: "Alex Chen is now editing this document.",
    });
  });
  await expect(page.frameLocator("#editor").getByRole("alert")).toHaveText(
    "Alex Chen is now editing this document.",
  );
  const editor = page.frameLocator("#editor");
  await editor
    .locator(".superdoc-text-run", {
      hasText: "pay each invoice within 30 days",
    })
    .click();
  await page.keyboard.type(" SHOULD-NOT-APPEAR");
  await page.waitForTimeout(1500);
  expect(
    (await received(page)).some((m) => m.type === "dirty" && m.dirty === true),
  ).toBe(false);
});

test("ignores a page whose origin is not allowed", async ({ page }) => {
  // 127.0.0.1 is a different origin from localhost, so the editor must not
  // answer it, even though it is the same test page.
  await page.goto("http://127.0.0.1:5181/");
  await page.waitForTimeout(3000);
  await openSample(page);
  await page.waitForTimeout(5000);
  expect(await received(page)).toEqual([]);
});
