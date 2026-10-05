// Gives each comment in a Word file a paragraph id before SuperDoc opens it.
//
// A reply to a comment needs the comment paragraph's w14:paraId, the id Word
// writes on every paragraph and threads replies by (w15:paraIdParent in
// commentsExtended.xml). Files from programs that leave it out, such as
// FairPro's own AI comments before 5 October 2026, open with comments nobody
// can reply to: SuperDoc's Reply button does nothing. Found on 5 October 2026
// by testing SuperDoc 2.20.0 (the same comment takes a reply once its
// paragraph has an id), not by reading SuperDoc's engine.
//
// Only paragraphs inside comments that have no id get one; nothing else in
// the file changes. Word ignores ids it does not need, so the saved file
// stays a normal Word file.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const COMMENTS = "word/comments.xml";

/** Every w14:paraId already used anywhere in the file, upper case. */
function usedIds(files: Record<string, Uint8Array>): Set<string> {
  const used = new Set<string>();
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith(".xml")) continue;
    for (const match of strFromU8(data).matchAll(
      /:paraId="([0-9A-Fa-f]{8})"/g,
    )) {
      used.add((match[1] ?? "").toUpperCase());
    }
  }
  return used;
}

/**
 * A new paragraph id: eight hex digits below 0x80000000, as the standard
 * requires, and not already in the file.
 */
function nextId(used: Set<string>, start: number): [string, number] {
  let n = start;
  for (;;) {
    const id = n.toString(16).toUpperCase().padStart(8, "0");
    n += 1;
    if (!used.has(id)) {
      used.add(id);
      return [id, n];
    }
  }
}

/**
 * The file with a w14:paraId on every comment paragraph that had none, or
 * the same bytes when nothing needed one (or the file cannot be read, which
 * SuperDoc then reports as usual).
 */
export function withCommentParagraphIds(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return bytes;
  }
  const part = files[COMMENTS];
  if (!part) return bytes;
  const source = strFromU8(part);
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return bytes;

  const missing = Array.from(doc.getElementsByTagNameNS(W, "comment")).flatMap(
    (comment) =>
      Array.from(comment.getElementsByTagNameNS(W, "p")).filter(
        (p) => !p.getAttributeNS(W14, "paraId"),
      ),
  );
  if (missing.length === 0) return bytes;

  const root = doc.documentElement;
  const prefix = root.lookupPrefix(W14) ?? "w14";
  if (!root.lookupPrefix(W14)) {
    root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:w14", W14);
  }
  const used = usedIds(files);
  let n = 0x10000000;
  for (const p of missing) {
    let id: string;
    [id, n] = nextId(used, n);
    p.setAttributeNS(W14, `${prefix}:paraId`, id);
  }
  const declaration = /^<\?xml[^>]*\?>/.exec(source)?.[0] ?? "";
  const xml = new XMLSerializer().serializeToString(doc);
  files[COMMENTS] = strToU8(
    xml.startsWith("<?xml") ? xml : `${declaration}${xml}`,
  );
  return new Uint8Array(zipSync(files));
}
