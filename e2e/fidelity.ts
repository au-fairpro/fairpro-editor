// What a Word file must keep through FairPro's editor (NFR-FID-01): a
// fingerprint of the things a reader sees or relies on, read from the file's
// XML. Opening a reference contract, making one edit and saving it must
// leave the fingerprint unchanged apart from that edit.
//
// It compares meaning, not bytes: an editor may renumber ids, reorder
// attributes or add its own parts, and Word does the same.

import { strFromU8, unzipSync } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface Fingerprint {
  paragraphs: {
    text: string;
    style: string | null;
    /** The level's format and text, such as "decimal %1.%2", so a renumbered list still matches. */
    numbering: string | null;
    align: string | null;
    /** Text set in bold directly on the run. */
    bold: string;
  }[];
  tables: { cellsPerRow: number[]; spans: number[]; merged: number }[];
  sections: {
    page: string;
    headers: string[];
    footers: string[];
    titlePage: boolean;
  }[];
  fields: string[];
  bookmarks: string[];
  tracked: { kind: "ins" | "del"; author: string; text: string }[];
  comments: { author: string; text: string; anchor: string }[];
}

export type ParseXml = (xml: string) => Document;

function children(node: Element, name: string): Element[] {
  return Array.from(node.children).filter(
    (child) => child.namespaceURI === W && child.localName === name,
  );
}

function child(node: Element | null | undefined, name: string): Element | null {
  return node ? (children(node, name)[0] ?? null) : null;
}

function all(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS(W, name));
}

function val(node: Element | null): string | null {
  return node?.getAttributeNS(W, "val") ?? node?.getAttribute("w:val") ?? null;
}

function attr(node: Element, name: string): string | null {
  return node.getAttributeNS(W, name) ?? node.getAttribute(`w:${name}`);
}

/** The visible text of a node: its w:t, tabs as spaces, never deleted text. */
function visibleText(node: Element): string {
  return all(node, "t")
    .map((t) => t.textContent)
    .join("");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isOn(node: Element | null): boolean {
  if (!node) return false;
  const value = val(node);
  return value === null || !["0", "false", "off"].includes(value);
}

export function fingerprint(bytes: Uint8Array, parse: ParseXml): Fingerprint {
  const files = unzipSync(bytes);
  const read = (path: string): Document | null => {
    const file = files[path];
    return file ? parse(strFromU8(file)) : null;
  };
  const document = read("word/document.xml");
  if (!document) throw new Error("not a Word file: no word/document.xml");
  const body = all(document, "body")[0];
  if (!body) throw new Error("word/document.xml has no body");

  // Numbering: numId -> abstractNum -> level, so ids may change freely.
  const numbering = read("word/numbering.xml");
  const levelOf = (numId: string, ilvl: string): string | null => {
    if (!numbering || numId === "0") return null;
    const num = all(numbering, "num").find((n) => attr(n, "numId") === numId);
    const abstractId = val(child(num, "abstractNumId"));
    const abstract = all(numbering, "abstractNum").find(
      (a) => attr(a, "abstractNumId") === abstractId,
    );
    const level = abstract
      ? children(abstract, "lvl").find((l) => attr(l, "ilvl") === ilvl)
      : undefined;
    if (!level) return `missing ${numId}/${ilvl}`;
    return `${val(child(level, "numFmt")) ?? ""} ${val(child(level, "lvlText")) ?? ""}`;
  };

  const paragraphs = all(body, "p").map((p) => {
    const pPr = child(p, "pPr");
    const numPr = child(pPr, "numPr");
    const bold = children(p, "r")
      .concat(children(p, "ins").flatMap((ins) => children(ins, "r")))
      .filter((r) => isOn(child(child(r, "rPr"), "b")))
      .map(visibleText)
      .join("");
    return {
      text: squash(visibleText(p)),
      style: val(child(pPr, "pStyle")),
      numbering: numPr
        ? levelOf(
            val(child(numPr, "numId")) ?? "0",
            val(child(numPr, "ilvl")) ?? "0",
          )
        : null,
      align: val(child(pPr, "jc")),
      bold: squash(bold),
    };
  });

  const tables = all(body, "tbl").map((table) => {
    const rows = children(table, "tr");
    const cells = rows.flatMap((row) => children(row, "tc"));
    return {
      cellsPerRow: rows.map((row) => children(row, "tc").length),
      spans: cells
        .map((cell) => Number(val(child(child(cell, "tcPr"), "gridSpan")) ?? 1))
        .filter((span) => span > 1),
      merged: cells.filter((cell) => child(child(cell, "tcPr"), "vMerge"))
        .length,
    };
  });

  // Headers and footers, by the part each section points at.
  const rels = read("word/_rels/document.xml.rels");
  const target = (id: string | null): string | null => {
    if (!rels || !id) return null;
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find(
      (r) => r.getAttribute("Id") === id,
    );
    const path = rel?.getAttribute("Target");
    return path ? `word/${path.replace(/^\/?word\//, "")}` : null;
  };
  const partText = (path: string | null): string => {
    const part = path ? read(path) : null;
    if (!part?.documentElement) return "";
    return all(part.documentElement, "p")
      .map((p) => squash(visibleText(p)))
      .filter(Boolean)
      .join(" | ");
  };
  const references = (sectPr: Element, name: string) =>
    children(sectPr, name)
      .map(
        (ref) =>
          `${attr(ref, "type") ?? "default"}: ${partText(target(ref.getAttributeNS(R, "id") ?? ref.getAttribute("r:id")))}`,
      )
      .sort();
  const sections = all(body, "sectPr").map((sectPr) => {
    const size = child(sectPr, "pgSz");
    return {
      page: size
        ? `${attr(size, "w") ?? ""}x${attr(size, "h") ?? ""} ${attr(size, "orient") ?? "portrait"}`
        : "default",
      headers: references(sectPr, "headerReference"),
      footers: references(sectPr, "footerReference"),
      titlePage: isOn(child(sectPr, "titlePg")),
    };
  });

  // Field codes in the body and in every header and footer (PAGE, REF).
  const fieldParts = [
    body,
    ...Object.keys(files)
      .filter((path) => /^word\/(header|footer)\d*\.xml$/.test(path))
      .flatMap((path) => read(path)?.documentElement ?? []),
  ];
  const fields = fieldParts
    .flatMap((part) => [
      ...all(part, "instrText").map((i) => i.textContent),
      ...all(part, "fldSimple").map((f) => attr(f, "instr") ?? ""),
    ])
    .map(squash)
    .sort();

  const bookmarks = all(body, "bookmarkStart")
    .map((b) => attr(b, "name") ?? "")
    .filter((name) => name !== "_GoBack")
    .sort();

  const tracked = [
    ...all(body, "ins").map((ins) => ({
      kind: "ins" as const,
      author: attr(ins, "author") ?? "",
      text: squash(visibleText(ins)),
    })),
    ...all(body, "del").map((del) => ({
      kind: "del" as const,
      author: attr(del, "author") ?? "",
      text: squash(
        all(del, "delText")
          .map((t) => t.textContent)
          .join(""),
      ),
    })),
  ]
    // A paragraph mark's own insertion carries no text; the inserted
    // paragraph's runs are counted instead.
    .filter((change) => change.text !== "")
    .sort((a, b) => `${a.kind}${a.text}`.localeCompare(`${b.kind}${b.text}`));

  // Each comment's anchored text: the visible text between its range marks.
  const anchors = new Map<string, string>();
  const open = new Set<string>();
  const walk = (node: Element): void => {
    if (node.namespaceURI === W) {
      const id = attr(node, "id") ?? "";
      if (node.localName === "commentRangeStart") open.add(id);
      if (node.localName === "commentRangeEnd") open.delete(id);
      if (node.localName === "t") {
        for (const comment of open) {
          anchors.set(comment, (anchors.get(comment) ?? "") + node.textContent);
        }
      }
    }
    for (const next of Array.from(node.children)) walk(next);
  };
  walk(body);
  const commentsPart = read("word/comments.xml");
  const comments = commentsPart
    ? all(commentsPart, "comment")
        .map((comment) => ({
          author: attr(comment, "author") ?? "",
          text: squash(visibleText(comment)),
          anchor: squash(anchors.get(attr(comment, "id") ?? "") ?? ""),
        }))
        .sort((a, b) => a.text.localeCompare(b.text))
    : [];

  return {
    paragraphs,
    tables,
    sections,
    fields,
    bookmarks,
    tracked,
    comments,
  };
}

/**
 * The fingerprint with one typed edit taken out: the marker leaves the
 * paragraph text, and its tracked insertion by `author` is dropped. Throws
 * when the edit is not there as a tracked insertion, since then the round
 * trip proved nothing.
 */
export function withoutEdit(
  print: Fingerprint,
  marker: string,
  author: string,
): Fingerprint {
  const edit = print.tracked.find(
    (change) =>
      change.kind === "ins" &&
      change.author === author &&
      change.text === marker,
  );
  if (!edit) throw new Error(`the edit ${marker} is not a tracked insertion`);
  return {
    ...print,
    paragraphs: print.paragraphs.map((p) => ({
      ...p,
      text: squash(p.text.replace(marker, "")),
    })),
    tracked: print.tracked.filter((change) => change !== edit),
  };
}
