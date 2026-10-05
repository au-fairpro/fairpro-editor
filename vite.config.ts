import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The commit being built, for the "Source code" link (AGPL section 13).
// Vercel and GitHub Actions each provide it under their own name.
process.env.VITE_GIT_COMMIT_SHA ??=
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";

// `vite preview` serves the same security headers as Vercel (vercel.json),
// so the end-to-end tests run under the production Content-Security-Policy.
// Only frame-ancestors differs: the test host page is on localhost, and on
// 127.0.0.1 to prove the editor's own origin check refuses it.
interface VercelConfig {
  headers: { headers: { key: string; value: string }[] }[];
}
const vercel = JSON.parse(
  readFileSync(new URL("./vercel.json", import.meta.url), "utf8"),
) as VercelConfig;
const previewHeaders = Object.fromEntries(
  vercel.headers
    .flatMap((rule) => rule.headers)
    .map(({ key, value }) => [
      key,
      key === "Content-Security-Policy"
        ? value.replace(
            /frame-ancestors [^;]+/,
            "frame-ancestors http://localhost:5181 http://127.0.0.1:5181",
          )
        : value,
    ]),
);

export default defineConfig({
  // SuperDoc is one large bundle by design; splitting it gains nothing here.
  build: { target: "esnext", sourcemap: false, chunkSizeWarningLimit: 12000 },
  worker: { format: "es" },
  preview: { port: 5180, strictPort: true, headers: previewHeaders },
  server: { port: 5180, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
  },
});
