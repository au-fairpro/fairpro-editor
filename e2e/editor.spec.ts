import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
  received,
  send,
  waitFor,
  watchSecurityErrors,
  type Received,
} from "./host";

async function openSample(
  page: Page,
  mode = "suggesting",
  people: { name: string; email: string }[] = [],
) {
  await page.evaluate(
    async ({ mode, people }) => {
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
          people,
        },
        [bytes],
      );
    },
    { mode, people },
  );
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

async function savedXml(
  page: Page,
  part = "word/document.xml",
): Promise<string> {
  await send(page, { type: "save", requestId: "s1" });
  await waitFor(page, "saved");
  const bytes = await page.evaluate(() => {
    const m = (window as unknown as { received: Received[] }).received.find(
      (x) => x.type === "saved",
    );
    if (!m) throw new Error("no saved message");
    return Array.from(new Uint8Array(m.bytes as ArrayBuffer));
  });
  return strFromU8(unzipSync(new Uint8Array(bytes))[part] ?? new Uint8Array());
}

test("reports the selection, and puts FairPro's text in as tracked changes", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page);
  await waitFor(page, "loaded");

  // Selecting a word is reported to FairPro.
  const editor = page.frameLocator("#editor");
  await editor
    .locator(".superdoc-text-run", {
      hasText: "pay each invoice within 30 days",
    })
    .dblclick();
  await expect
    .poll(
      async () =>
        (await received(page)).find(
          (m) => m.type === "selection" && m.text !== "",
        )?.text,
      { timeout: 30_000 },
    )
    .toBeTruthy();

  // Replacing the selection: a tracked deletion and insertion.
  await send(page, {
    type: "insertText",
    requestId: "i1",
    text: "FP-REPLACED\n\nFP-REPLACED-TWO",
    replaceSelection: true,
  });
  expect((await waitFor(page, "inserted")).requestId).toBe("i1");
  // Inserting at the cursor, after the replaced word: a tracked insertion.
  await send(page, {
    type: "insertText",
    requestId: "i2",
    text: " FP-INSERTED",
    replaceSelection: false,
  });
  await expect
    .poll(async () =>
      (await received(page)).some(
        (m) => m.type === "inserted" && m.requestId === "i2",
      ),
    )
    .toBe(true);
  // Wording of several paragraphs, as the AI suggests it, with a tab and
  // characters Markdown would otherwise read as formatting.
  await send(page, {
    type: "insertText",
    requestId: "i3",
    text: "FP-PARA-ONE *not bold*\tend.\n\n2. FP-PARA-TWO\r\n# FP-PARA-THREE",
    replaceSelection: false,
  });
  await expect
    .poll(async () =>
      (await received(page)).find(
        (m) =>
          (m.type === "inserted" || m.type === "error") && m.requestId === "i3",
      ),
    )
    .toMatchObject({ type: "inserted" });
  const xml = await savedXml(page);
  for (const marker of [
    "FP-REPLACED-TWO",
    "FP-PARA-ONE",
    "FP-PARA-TWO",
    "FP-PARA-THREE",
  ]) {
    expect(xml).toMatch(
      new RegExp(
        `<w:ins\\b[^>]*w:author="Test Person"[^>]*>(?:(?!</w:ins>).)*${marker}`,
        "s",
      ),
    );
  }
  // Each paragraph is its own paragraph, and the text is kept as written.
  const paragraphs = xml.split("</w:p>");
  const holding = (marker: string) =>
    paragraphs.findIndex((p) => p.includes(marker));
  expect(
    new Set(["FP-PARA-ONE", "FP-PARA-TWO", "FP-PARA-THREE"].map(holding)).size,
  ).toBe(3);
  const text = xml.replace(/<[^>]+>/g, "");
  expect(text).toContain("*not bold*");
  expect(text).toContain("2. FP-PARA-TWO");
  expect(text).toContain("# FP-PARA-THREE");
  expect(xml).toMatch(
    /<w:ins\b[^>]*w:author="Test Person"[^>]*>(?:(?!<\/w:ins>).)*FP-REPLACED/s,
  );
  expect(xml).toMatch(/<w:del\b[^>]*w:author="Test Person"/);
  expect(xml).toMatch(
    /<w:ins\b[^>]*w:author="Test Person"[^>]*>(?:(?!<\/w:ins>).)*FP-INSERTED/s,
  );
  expect(errors).toEqual([]);
});

test("marks text an assistant suggested with a comment from '[person] via the assistant' (FR-AI-032)", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page);
  await waitFor(page, "loaded");
  await page
    .frameLocator("#editor")
    .locator(".superdoc-text-run", {
      hasText: "pay each invoice within 30 days",
    })
    .click();
  await send(page, {
    type: "insertText",
    requestId: "v1",
    text: " FP-SUGGESTED",
    replaceSelection: false,
    via: "the assistant",
  });
  expect((await waitFor(page, "inserted")).requestId).toBe("v1");
  const comments = await savedXml(page, "word/comments.xml");
  expect(comments).toMatch(
    /<w:comment\b[^>]*w:author="Test Person via the assistant"[^>]*>(?:(?!<\/w:comment>).)*Suggested by Test Person via the assistant\./s,
  );
  // The tracked change itself stays the person's own.
  const xml = await savedXml(page);
  expect(xml).toMatch(
    /<w:ins\b[^>]*w:author="Test Person"[^>]*>(?:(?!<\/w:ins>).)*FP-SUGGESTED/s,
  );
  expect(errors).toEqual([]);
});

test("refuses to put text in a read-only document", async ({ page }) => {
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page, "viewing");
  await waitFor(page, "loaded");
  await send(page, {
    type: "insertText",
    requestId: "i1",
    text: "SHOULD-NOT-APPEAR",
    replaceSelection: false,
  });
  const error = await waitFor(page, "error");
  expect(error).toMatchObject({ code: "insert_failed", requestId: "i1" });
});

test("offers FairPro's people after @ in a comment and reports who was mentioned", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  await openSample(page, "suggesting", [
    { name: "Kamala Fernando", email: "kamala@example.com" },
    { name: "Nimal Perera", email: "nimal@example.com" },
  ]);
  await waitFor(page, "loaded");
  const editor = page.frameLocator("#editor");
  await editor
    .locator(".superdoc-text-run", {
      hasText: "pay each invoice within 30 days",
    })
    .dblclick();
  // SuperDoc's add-comment button beside the selection.
  await editor.locator(".superdoc__tools .tools-item").first().click();
  const box = editor.locator("textarea[data-sd-comment-mention-input]");
  await expect(box).toBeFocused();
  await page.keyboard.type("Please check @Ka");
  // Only the people FairPro sent are offered.
  await expect(editor.getByText("kamala@example.com")).toBeVisible();
  await expect(editor.getByText("nimal@example.com")).toHaveCount(0);
  await editor.getByText("kamala@example.com").click();
  await expect(box).toHaveValue(/@Kamala Fernando/);
  await editor.getByRole("button", { name: "Comment", exact: true }).click();

  const mentioned = await waitFor(page, "mentioned");
  expect(mentioned.emails).toEqual(["kamala@example.com"]);
  expect(errors).toEqual([]);
});
