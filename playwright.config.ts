import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Unit tests (*.test.ts) beside them run in Vitest.
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    // Cloud sessions provide Chromium here; CI installs Playwright's own.
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  webServer: [
    {
      // Built for the test host only, so production origins are not involved.
      command: "pnpm build && pnpm preview",
      env: { VITE_ALLOWED_PARENT_ORIGINS: "http://localhost:5181" },
      url: "http://localhost:5180/",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node e2e/host-server.ts",
      url: "http://localhost:5181/",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
