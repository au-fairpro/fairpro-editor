// Driving the editor from the stand-in host page (host-server.ts), shared
// by the end-to-end tests.
import { expect, type Page } from "@playwright/test";

export interface Received {
  source: string;
  v: number;
  type: string;
  [key: string]: unknown;
}

export async function received(page: Page): Promise<Received[]> {
  return page.evaluate(
    () => (window as unknown as { received: Received[] }).received,
  );
}

export async function waitFor(page: Page, type: string): Promise<Received> {
  await expect
    .poll(async () => (await received(page)).some((m) => m.type === type), {
      timeout: 60_000,
    })
    .toBe(true);
  const found = (await received(page)).find((m) => m.type === type);
  if (!found) throw new Error(`no ${type} message`);
  return found;
}

export function watchSecurityErrors(page: Page): string[] {
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

export async function send(page: Page, message: object) {
  await page.evaluate((m) => {
    (window as unknown as { sendToEditor: (m: object) => void }).sendToEditor(
      m,
    );
  }, message);
}
