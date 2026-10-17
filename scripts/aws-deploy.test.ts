// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllowedOrigins } from "../src/origins";
import {
  IMMUTABLE,
  REVALIDATE,
  cacheControl,
  contentType,
  deploy,
  expectedHeaders,
  headerDifferences,
  invalidationPaths,
  isHashed,
  listFiles,
  staleKeys,
  uploadOrder,
} from "./aws-deploy";

// Names as Vite builds them today.
const BUILD = [
  "assets/docx-engine.es-Bf4hR1VC.js",
  "assets/index-BKEx2g_x.js",
  "assets/index-Dgxez1U6.css",
  "assets/pdf.worker.min-t-CYmkGJ.es-BIB1aa7o.js",
  "index.html",
];

describe("cache rules", () => {
  it("treats Vite's hashed files under assets/ as immutable for a year", () => {
    for (const key of BUILD.filter((key) => key.startsWith("assets/"))) {
      expect(isHashed(key)).toBe(true);
      expect(cacheControl(key)).toBe(IMMUTABLE);
    }
    expect(IMMUTABLE).toBe("public, max-age=31536000, immutable");
  });

  it.each([
    "index.html",
    "favicon.ico",
    "robots.txt",
    "assets/logo.svg",
    "fonts/inter-Bf4hR1VC.woff2",
  ])("revalidates %s, which has no hash or is outside assets/", (key) => {
    expect(isHashed(key)).toBe(false);
    expect(cacheControl(key)).toBe(REVALIDATE);
  });
});

describe("contentType", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["assets/index-BKEx2g_x.js", "text/javascript; charset=utf-8"],
    ["assets/index-Dgxez1U6.css", "text/css; charset=utf-8"],
    ["assets/engine-Bf4hR1VC.wasm", "application/wasm"],
    ["assets/font-Bf4hR1VC.woff2", "font/woff2"],
  ])("serves %s as %s", (key, type) => {
    expect(contentType(key)).toBe(type);
  });

  it("refuses a file it does not know, rather than letting S3 guess", () => {
    expect(() => contentType("assets/data-Bf4hR1VC.bin")).toThrow(
      /Content-Type/,
    );
    expect(() => contentType("LICENSE")).toThrow(/Content-Type/);
  });
});

describe("uploadOrder", () => {
  it("uploads hashed files first and index.html last", () => {
    const order = uploadOrder([
      "index.html",
      "robots.txt",
      ...BUILD.slice(0, 4),
    ]).map((upload) => upload.key);
    expect(order.slice(0, 4).every(isHashed)).toBe(true);
    expect(order.slice(4)).toEqual(["robots.txt", "index.html"]);
  });

  it("gives every file its cache rule and type", () => {
    expect(uploadOrder(["index.html"])).toEqual([
      {
        key: "index.html",
        contentType: "text/html; charset=utf-8",
        cacheControl: "no-cache",
      },
    ]);
  });
});

describe("invalidationPaths", () => {
  it("invalidates the unhashed files and the root, never hashed ones", () => {
    expect(invalidationPaths([...BUILD, "robots.txt"])).toEqual([
      "/",
      "/index.html",
      "/robots.txt",
    ]);
  });
});

describe("staleKeys", () => {
  it("lists what is in the bucket but not in the build", () => {
    expect(
      staleKeys(
        ["index.html", "assets/index-OLDOLD00.js", "assets/index-BKEx2g_x.js"],
        BUILD,
      ),
    ).toEqual(["assets/index-OLDOLD00.js"]);
    expect(staleKeys([], BUILD)).toEqual([]);
  });
});

function fakeBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), "editor-dist-"));
  mkdirSync(join(dir, "assets"));
  for (const key of BUILD) writeFileSync(join(dir, key), "synthetic");
  return dir;
}

describe("listFiles", () => {
  it("lists files with forward slashes, relative to the build", () => {
    expect(listFiles(fakeBuild())).toEqual([...BUILD].sort());
  });
});

describe("deploy", () => {
  function run(remote: string[] | null, answers: Record<string, string> = {}) {
    const calls: string[][] = [];
    const dir = fakeBuild();
    deploy({
      dir,
      bucket: "fairpro-editor-site",
      distributionId: "E2EXAMPLE",
      log: () => undefined,
      aws: (args) => {
        calls.push(args);
        const action = `${args[0] ?? ""} ${args[1] ?? ""}`;
        if (action in answers) return answers[action] ?? "";
        if (action === "cloudfront create-invalidation") return "I2EXAMPLE\n";
        if (action === "s3api list-objects-v2") return JSON.stringify(remote);
        return "";
      },
    });
    return { calls, dir };
  }

  it("uploads, invalidates and waits, and only then deletes old files", () => {
    const { calls, dir } = run([
      ...BUILD,
      "assets/index-OLDOLD00.js",
      "old.html",
    ]);
    const actions = calls.map((args) => `${args[0] ?? ""} ${args[1] ?? ""}`);
    expect(actions).toEqual([
      ...BUILD.map(() => "s3api put-object"),
      "cloudfront create-invalidation",
      "cloudfront wait",
      "s3api list-objects-v2",
      "s3api delete-objects",
    ]);

    const puts = calls.slice(0, BUILD.length);
    const index = puts.at(-1) ?? [];
    expect(index).toEqual([
      "s3api",
      "put-object",
      "--bucket",
      "fairpro-editor-site",
      "--key",
      "index.html",
      "--body",
      join(dir, "index.html"),
      "--content-type",
      "text/html; charset=utf-8",
      "--cache-control",
      "no-cache",
      "--output",
      "json",
    ]);
    for (const put of puts.slice(0, -1)) {
      expect(put).toContain(IMMUTABLE);
    }

    expect(calls[BUILD.length]).toEqual([
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      "E2EXAMPLE",
      "--paths",
      "/",
      "/index.html",
      "--query",
      "Invalidation.Id",
      "--output",
      "text",
    ]);
    expect(calls[BUILD.length + 1]).toEqual([
      "cloudfront",
      "wait",
      "invalidation-completed",
      "--distribution-id",
      "E2EXAMPLE",
      "--id",
      "I2EXAMPLE",
    ]);
    const deletion = calls.at(-1) ?? [];
    expect(
      JSON.parse(deletion[deletion.indexOf("--delete") + 1] ?? ""),
    ).toEqual({
      Objects: [{ Key: "assets/index-OLDOLD00.js" }, { Key: "old.html" }],
      Quiet: true,
    });
  });

  it("deletes nothing on a first release into an empty bucket", () => {
    const { calls } = run(null);
    expect(calls.at(-1)?.[1]).toBe("list-objects-v2");
  });

  it("deletes in batches of at most 1,000", () => {
    const old = Array.from(
      { length: 1500 },
      (_, n) => `assets/x-${String(n).padStart(8, "0")}.js`,
    );
    const { calls } = run([...BUILD, ...old]);
    const deletions = calls.filter((args) => args[1] === "delete-objects");
    expect(deletions).toHaveLength(2);
  });

  it("stops if S3 reports a file it could not delete", () => {
    expect(() =>
      run([...BUILD, "old.html"], {
        "s3api delete-objects": JSON.stringify({
          Errors: [{ Key: "old.html", Code: "AccessDenied" }],
        }),
      }),
    ).toThrow(/could not delete/);
  });

  it("refuses a build with no index.html", () => {
    const dir = mkdtempSync(join(tmpdir(), "editor-dist-"));
    expect(() => {
      deploy({
        dir,
        bucket: "b",
        distributionId: "d",
        aws: () => "",
        log: () => undefined,
      });
    }).toThrow(/index.html/);
  });
});

describe("security headers", () => {
  const vercelJson = readFileSync(
    new URL("../vercel.json", import.meta.url),
    "utf8",
  );
  const expected = expectedHeaders(vercelJson);

  it("reads the headers Vercel serves today", () => {
    expect([...expected.keys()].sort()).toEqual([
      "content-security-policy",
      "permissions-policy",
      "referrer-policy",
      "x-content-type-options",
    ]);
    expect(expected.get("content-security-policy")).toMatch(
      /frame-ancestors https:\/\/fairpro\.com\.au https:\/\/\*\.fairpro\.com\.au$/,
    );
  });

  it("finds no difference when CloudFront sends the same, plus its own", () => {
    const headers = new Headers([...expected]);
    headers.set("strict-transport-security", "max-age=63072000");
    expect(headerDifferences(expected, headers)).toEqual([]);
  });

  it("reports a missing or changed header", () => {
    const headers = new Headers([...expected]);
    headers.delete("permissions-policy");
    headers.set("referrer-policy", "origin");
    expect(headerDifferences(expected, headers)).toEqual([
      'referrer-policy: expected "no-referrer", got "origin"',
      'permissions-policy: expected "camera=(), microphone=(), geolocation=(), payment=(), usb=()", got nothing',
    ]);
  });
});

describe(".env.production", () => {
  it("lets only FairPro on AWS embed the editor (demo retired 17 October 2026)", () => {
    const line = readFileSync(
      new URL("../.env.production", import.meta.url),
      "utf8",
    )
      .split("\n")
      .find((text) => text.startsWith("VITE_ALLOWED_PARENT_ORIGINS="));
    expect(parseAllowedOrigins(line?.split("=")[1])).toEqual([
      "https://app.fairpro.com.au",
    ]);
  });
});
