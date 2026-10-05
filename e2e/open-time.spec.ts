// Opening time (NFR-PERF-04): a 30-page contract opens in the editor within
// 3 seconds. The clock starts when the host page (standing in for FairPro)
// posts `open` with the bytes, and stops when the editor answers `loaded`,
// which it sends once SuperDoc reports the document ready. Both ends are
// read in the host page, so the test's own polling adds nothing.
//
// To keep CI steady, the editor opens the contract once to warm up and then
// three more times, each in a freshly loaded editor; the fastest of the
// three must be within the budget (e2e/timing.ts says why). Every run is
// written to the test's annotations.

import { expect, test, type Page } from "@playwright/test";
import { waitFor, watchSecurityErrors } from "./host";
import { LONG_CONTRACT_TITLE, longContract } from "./long-contract";
import { timeRuns } from "./timing";

/** NFR-PERF-04: a 30-page contract opens within 3 seconds. */
const OPEN_BUDGET_MS = 3000;

/** The contract must really be long: at least this many pages laid out. */
const MIN_PAGES = 25;

const PERSON = { name: "Test Person", email: "test@example.com" };

/** Loads a fresh editor, opens the contract and returns how long it took. */
async function timedOpen(page: Page, bytes: Uint8Array): Promise<number> {
  await page.goto("http://localhost:5181/");
  await waitFor(page, "ready");
  return page.evaluate(
    ({ data, user }) =>
      new Promise<number>((resolve, reject) => {
        const buffer = new Uint8Array(data).buffer;
        let start = 0;
        const timeout = setTimeout(() => {
          reject(new Error("the editor did not report loaded in 60 s"));
        }, 60_000);
        window.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as { type?: string; message?: string };
          if (event.origin !== "http://localhost:5180") return;
          if (message.type === "loaded") {
            clearTimeout(timeout);
            resolve(performance.now() - start);
          } else if (message.type === "error") {
            clearTimeout(timeout);
            reject(new Error(`the editor failed: ${String(message.message)}`));
          }
        });
        start = performance.now();
        (
          window as unknown as {
            sendToEditor: (m: object, t?: Transferable[]) => void;
          }
        ).sendToEditor(
          {
            type: "open",
            fileName: "Long contract.docx",
            bytes: buffer,
            user,
            mode: "suggesting",
            people: [],
          },
          [buffer],
        );
      }),
    { data: Array.from(bytes), user: PERSON },
  );
}

test("opens a 30-page contract within 3 seconds (NFR-PERF-04)", async ({
  page,
}) => {
  const errors = watchSecurityErrors(page);
  const bytes = longContract();

  const timings = await timeRuns(() => timedOpen(page, bytes), {
    warmUps: 1,
    runs: 3,
  });

  const ms = (values: number[]) =>
    values.map((value) => `${String(Math.round(value))} ms`).join(", ");
  const summary =
    `warm-up ${ms(timings.warmUps)}; runs ${ms(timings.runs)}; ` +
    `fastest ${ms([timings.fastest])} (budget ${String(OPEN_BUDGET_MS)} ms)`;
  test.info().annotations.push({ type: "NFR-PERF-04", description: summary });
  console.log(`Opening a 30-page contract: ${summary}`);

  // The last open really laid out the whole contract.
  const pages = page.frameLocator("#editor").locator(".superdoc-page");
  await expect
    .poll(() => pages.count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(MIN_PAGES);
  const laidOut = String(await pages.count());
  test.info().annotations.push({ type: "pages", description: laidOut });
  console.log(`Pages laid out: ${laidOut}`);
  await expect(
    page.frameLocator("#editor").getByText(LONG_CONTRACT_TITLE).first(),
  ).toBeVisible();

  expect(timings.fastest).toBeLessThan(OPEN_BUDGET_MS);
  expect(errors).toEqual([]);
});
