// Which pages may embed the editor and talk to it.
//
// The list comes from VITE_ALLOWED_PARENT_ORIGINS at build time, as a
// comma-separated list of origins such as
// "https://demo.fairpro.com.au,http://localhost:3000". A message from any
// other origin is dropped, and the editor only ever replies to the exact
// origin that is driving it, never "*", because replies carry the document.

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const origins = new Set<string>();
  for (const part of value.split(",")) {
    const text = part.trim();
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`VITE_ALLOWED_PARENT_ORIGINS: "${text}" is not a URL`);
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      throw new Error(`VITE_ALLOWED_PARENT_ORIGINS: "${text}" must use https`);
    }
    // An origin is scheme, host and port only; a path or wildcard would be a
    // mistake that silently matches nothing, so refuse it.
    if (text.includes("*") || url.origin !== text.replace(/\/$/, "")) {
      throw new Error(
        `VITE_ALLOWED_PARENT_ORIGINS: "${text}" must be an origin, with no path`,
      );
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export function isAllowedOrigin(
  origin: string,
  allowed: readonly string[],
): boolean {
  return allowed.includes(origin);
}
