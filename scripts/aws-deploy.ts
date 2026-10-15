// Uploads the built editor (dist/) to its S3 bucket behind CloudFront
// (editor.fairpro.com.au; fairpro-infra modules/static-site, ADR 0006 there).
// Run by .github/workflows/aws-deploy.yml after `pnpm build`:
//
//   node scripts/aws-deploy.ts deploy          (EDITOR_BUCKET, EDITOR_DISTRIBUTION_ID)
//   node scripts/aws-deploy.ts check-headers <url>
//
// The order matters, so a person opening the editor mid-release never gets
// a page that points at files not yet uploaded:
//   1. hashed files (assets/name-HASH.ext), cached for a year as immutable;
//   2. the other files, index.html last, revalidated on every request;
//   3. a CloudFront invalidation of the unhashed paths, waited for;
//   4. only then, files the new build no longer has are deleted.
//
// The deploy role may only put, delete and list objects in the bucket and
// create invalidations (static-site's "upload-releases" policy); waiting for
// the invalidation also needs cloudfront:GetInvalidation.
//
// The security headers are served by CloudFront's response headers policy,
// not by this script. vercel.json stays their source of truth (vite preview
// serves them to the end-to-end tests), and check-headers proves CloudFront
// sends the same ones.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";

// Vite names built files name-HASH.ext under assets/; the hash is 8
// characters of [A-Za-z0-9_-].
const HASHED = /^assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

export function isHashed(key: string): boolean {
  return HASHED.test(key);
}

export function cacheControl(key: string): string {
  return isHashed(key) ? IMMUTABLE : REVALIDATE;
}

// Set explicitly: a module script or WebAssembly file served with the wrong
// type is refused by the browser (X-Content-Type-Options: nosniff), and the
// AWS CLI's guess depends on the Python it was built with.
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  map: "application/json",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function contentType(key: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase();
  const type = extension ? CONTENT_TYPES[extension] : undefined;
  if (!type) {
    throw new Error(
      `${key}: no Content-Type known for this file; add it to scripts/aws-deploy.ts`,
    );
  }
  return type;
}

export interface Upload {
  key: string;
  contentType: string;
  cacheControl: string;
}

// Hashed files first, then the unhashed ones, index.html last.
export function uploadOrder(keys: readonly string[]): Upload[] {
  const rank = (key: string) =>
    isHashed(key) ? 0 : key === "index.html" ? 2 : 1;
  return [...keys]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => ({
      key,
      contentType: contentType(key),
      cacheControl: cacheControl(key),
    }));
}

// The paths CloudFront may hold an old copy of: every unhashed file, and
// "/" for index.html (the distribution's default root object).
export function invalidationPaths(keys: readonly string[]): string[] {
  const paths = keys.filter((key) => !isHashed(key)).map((key) => `/${key}`);
  if (keys.includes("index.html")) paths.push("/");
  return paths.sort();
}

export function staleKeys(
  remote: readonly string[],
  local: readonly string[],
): string[] {
  const keep = new Set(local);
  return remote.filter((key) => !keep.has(key)).sort();
}

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .sort();
}

// Runs one AWS CLI command and returns what it printed.
export type Aws = (args: string[]) => string;

export interface DeployOptions {
  dir: string;
  bucket: string;
  distributionId: string;
  aws: Aws;
  log?: (line: string) => void;
}

export function deploy(options: DeployOptions): void {
  const { dir, bucket, distributionId, aws } = options;
  const log = options.log ?? console.log;
  const keys = listFiles(dir);
  if (!keys.includes("index.html")) {
    throw new Error(`${dir} has no index.html; run pnpm build first`);
  }

  for (const upload of uploadOrder(keys)) {
    log(`upload ${upload.key} (${upload.cacheControl})`);
    aws([
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      upload.key,
      "--body",
      join(dir, upload.key),
      "--content-type",
      upload.contentType,
      "--cache-control",
      upload.cacheControl,
      "--output",
      "json",
    ]);
  }

  const paths = invalidationPaths(keys);
  log(`invalidate ${paths.join(" ")}`);
  const id = aws([
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    distributionId,
    "--paths",
    ...paths,
    "--query",
    "Invalidation.Id",
    "--output",
    "text",
  ]).trim();
  if (!id) throw new Error("CloudFront returned no invalidation id");
  log(`wait for invalidation ${id}`);
  aws([
    "cloudfront",
    "wait",
    "invalidation-completed",
    "--distribution-id",
    distributionId,
    "--id",
    id,
  ]);

  const listed = aws([
    "s3api",
    "list-objects-v2",
    "--bucket",
    bucket,
    "--query",
    "Contents[].Key",
    "--output",
    "json",
  ]);
  const remote = (JSON.parse(listed.trim() || "null") ?? []) as string[];
  const stale = staleKeys(remote, keys);
  for (let start = 0; start < stale.length; start += 1000) {
    const batch = stale.slice(start, start + 1000);
    log(`delete ${batch.join(" ")}`);
    const result = aws([
      "s3api",
      "delete-objects",
      "--bucket",
      bucket,
      "--delete",
      JSON.stringify({ Objects: batch.map((Key) => ({ Key })), Quiet: true }),
      "--output",
      "json",
    ]);
    const errors = (JSON.parse(result.trim() || "{}") as { Errors?: unknown[] })
      .Errors;
    if (errors?.length) {
      throw new Error(`could not delete: ${JSON.stringify(errors)}`);
    }
  }
  log(`done: ${String(keys.length)} files, ${String(stale.length)} removed`);
}

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

// The security headers in vercel.json, which CloudFront must also send.
export function expectedHeaders(vercelJson: string): Map<string, string> {
  const config = JSON.parse(vercelJson) as VercelConfig;
  return new Map(
    config.headers
      .flatMap((rule) => rule.headers)
      .map(({ key, value }) => [key.toLowerCase(), value]),
  );
}

// What differs between the expected headers and a response's, one line each.
export function headerDifferences(
  expected: ReadonlyMap<string, string>,
  actual: Headers,
): string[] {
  const differences: string[] = [];
  for (const [name, value] of expected) {
    const got = actual.get(name);
    if (got !== value) {
      differences.push(
        `${name}: expected "${value}", got ${got === null ? "nothing" : `"${got}"`}`,
      );
    }
  }
  return differences;
}

async function checkHeaders(url: string): Promise<void> {
  const expected = expectedHeaders(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  // index.html must be revalidated, so a release reaches people at once.
  expected.set("cache-control", REVALIDATE);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const differences = headerDifferences(expected, response.headers);
  if (differences.length) {
    throw new Error(`${url} headers differ:\n${differences.join("\n")}`);
  }
  console.log(`${url}: ${String(expected.size)} headers as expected`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, argument] = process.argv.slice(2);
  if (command === "deploy") {
    deploy({
      dir: argument ?? "dist",
      bucket: required("EDITOR_BUCKET"),
      distributionId: required("EDITOR_DISTRIBUTION_ID"),
      aws: (args) =>
        execFileSync("aws", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          maxBuffer: 64 * 1024 * 1024,
        }),
    });
  } else if (command === "check-headers" && argument) {
    await checkHeaders(argument);
  } else {
    console.error(
      "usage: node scripts/aws-deploy.ts deploy [dir] | check-headers <url>",
    );
    process.exit(2);
  }
}
