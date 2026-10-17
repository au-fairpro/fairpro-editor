import { describe, expect, it } from "vitest";
import {
  embeddingOrigin,
  isAllowedOrigin,
  parseAllowedOrigins,
} from "./origins";

describe("parseAllowedOrigins", () => {
  it("reads a comma-separated list, trimming and dropping duplicates", () => {
    expect(
      parseAllowedOrigins(
        " https://demo.fairpro.com.au, http://localhost:3000,,https://demo.fairpro.com.au/",
      ),
    ).toEqual(["https://demo.fairpro.com.au", "http://localhost:3000"]);
  });

  it("returns nothing when unset, so the editor answers no one", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it.each([
    ["plain http on a real host", "http://demo.fairpro.com.au"],
    ["a path", "https://demo.fairpro.com.au/contracts"],
    ["a wildcard", "https://*.fairpro.com.au"],
    ["not a URL", "demo.fairpro.com.au"],
  ])("refuses %s", (_, value) => {
    expect(() => parseAllowedOrigins(value)).toThrow(
      /VITE_ALLOWED_PARENT_ORIGINS/,
    );
  });
});

describe("isAllowedOrigin", () => {
  const allowed = ["https://demo.fairpro.com.au"];
  it("matches the exact origin only", () => {
    expect(isAllowedOrigin("https://demo.fairpro.com.au", allowed)).toBe(true);
    expect(
      isAllowedOrigin("https://demo.fairpro.com.au.evil.example", allowed),
    ).toBe(false);
    expect(isAllowedOrigin("http://demo.fairpro.com.au", allowed)).toBe(false);
    expect(isAllowedOrigin("null", allowed)).toBe(false);
  });
});

describe("embeddingOrigin", () => {
  it("takes the browser's ancestor origin first", () => {
    expect(
      embeddingOrigin(
        ["https://app.fairpro.com.au"],
        "https://other.example/x",
      ),
    ).toBe("https://app.fairpro.com.au");
  });

  it("falls back to the referrer's origin, as in Firefox", () => {
    expect(
      embeddingOrigin(undefined, "https://app.fairpro.com.au/contracts/1"),
    ).toBe("https://app.fairpro.com.au");
    expect(embeddingOrigin([], "https://app.fairpro.com.au/")).toBe(
      "https://app.fairpro.com.au",
    );
  });

  it("knows nothing without either", () => {
    expect(embeddingOrigin(undefined, "")).toBeNull();
    expect(embeddingOrigin([], "not a url")).toBeNull();
  });
});
