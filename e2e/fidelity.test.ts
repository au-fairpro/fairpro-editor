import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { fingerprint, withoutEdit, type Fingerprint } from "./fidelity";
import { referenceSet } from "./reference-set";

const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");

function reference(name: string): Uint8Array {
  const found = referenceSet().find((d) => d.name === name);
  if (!found) throw new Error(`no reference document ${name}`);
  return found.bytes;
}

/** The same file with one part's XML changed. */
function changed(
  bytes: Uint8Array,
  part: string,
  change: (xml: string) => string,
): Uint8Array {
  const files = unzipSync(bytes);
  const file = files[part];
  if (!file) throw new Error(`no ${part}`);
  return zipSync({ ...files, [part]: strToU8(change(strFromU8(file))) });
}

const print = (bytes: Uint8Array): Fingerprint => fingerprint(bytes, parse);

describe("the reference set", () => {
  it("is six Word files, each with the paragraph the test edits", () => {
    const set = referenceSet();
    expect(set.map((d) => d.name)).toEqual([
      "numbering",
      "tables",
      "headers-footers",
      "schedules",
      "cross-references",
      "counterparty-changes",
    ]);
    for (const document of set) {
      expect(print(document.bytes).paragraphs.map((p) => p.text)).toContain(
        document.editHere,
      );
    }
  });

  it("is the same bytes each time, so a failure can be reproduced", () => {
    expect(referenceSet()[0]?.bytes).toEqual(referenceSet()[0]?.bytes);
  });
});

describe("fingerprint", () => {
  it("reads clause numbering as each level's format", () => {
    const levels = print(reference("numbering")).paragraphs.map(
      (p) => p.numbering,
    );
    expect(levels).toContain("decimal %1.");
    expect(levels).toContain("decimal %1.%2");
    expect(levels).toContain("lowerLetter (%3)");
  });

  it("matches a list whose ids were renumbered", () => {
    const renumbered = changed(
      changed(reference("numbering"), "word/numbering.xml", (xml) =>
        xml
          .replace('w:numId="1"', 'w:numId="7"')
          .replaceAll('w:abstractNumId="0"', 'w:abstractNumId="3"')
          .replace(
            '<w:abstractNumId w:val="0"/>',
            '<w:abstractNumId w:val="3"/>',
          ),
      ),
      "word/document.xml",
      (xml) => xml.replaceAll('<w:numId w:val="1"/>', '<w:numId w:val="7"/>'),
    );
    expect(print(renumbered)).toEqual(print(reference("numbering")));
  });

  it("notices numbering that was lost", () => {
    const lost = changed(reference("numbering"), "word/document.xml", (xml) =>
      xml.replace(/<w:numPr>.*?<\/w:numPr>/, ""),
    );
    expect(print(lost)).not.toEqual(print(reference("numbering")));
  });

  it("reads table rows, merged cells and spans", () => {
    expect(print(reference("tables")).tables).toEqual([
      { cellsPerRow: [4, 4, 4, 1], spans: [4], merged: 2 },
    ]);
    const unmerged = changed(reference("tables"), "word/document.xml", (xml) =>
      xml.replace('<w:gridSpan w:val="4"/>', ""),
    );
    expect(print(unmerged).tables).not.toEqual(
      print(reference("tables")).tables,
    );
  });

  it("reads each section's page, headers and footers", () => {
    expect(print(reference("headers-footers")).sections).toEqual([
      {
        page: "11906x16838 portrait",
        headers: [
          "default: Supply agreement between Example Buyer and Sample Supplier",
          "first: Sample Supplier Pty Ltd | Confidential",
        ],
        footers: ["default: Page 1 of 2"],
        titlePage: true,
      },
    ]);
    expect(print(reference("headers-footers")).fields).toEqual([
      "NUMPAGES",
      "PAGE",
    ]);
    expect(print(reference("schedules")).sections.map((s) => s.page)).toEqual([
      "11906x16838 portrait",
      "16838x11906 landscape",
    ]);
  });

  it("notices a header that lost its text", () => {
    const blank = changed(
      reference("headers-footers"),
      "word/header1.xml",
      (xml) => xml.replace("Confidential", ""),
    );
    expect(print(blank).sections).not.toEqual(
      print(reference("headers-footers")).sections,
    );
  });

  it("reads bookmarks and the fields that refer to them", () => {
    const { bookmarks, fields } = print(reference("cross-references"));
    expect(bookmarks).toEqual(["_RefLicence", "_RefTermination"]);
    expect(fields).toEqual([
      "REF _RefLicence \\h",
      "REF _RefLicence \\h",
      "REF _RefTermination \\h",
    ]);
  });

  it("reads the other side's tracked changes and comments", () => {
    const { tracked, comments } = print(reference("counterparty-changes"));
    const casey = "Casey Counsel (counterparty)";
    expect(tracked).toEqual([
      {
        kind: "del",
        author: casey,
        text: "the fees paid in the last 12 months",
      },
      { kind: "ins", author: casey, text: "AUD 100,000" },
      {
        kind: "ins",
        author: casey,
        text: "Each party must keep the other's confidential information secret.",
      },
    ]);
    expect(comments).toEqual([
      {
        author: casey,
        text: "We need 90 days' notice here.",
        anchor: "The Buyer may terminate for convenience on 30 days' notice.",
      },
    ]);
  });

  it("notices a tracked change that was accepted, or a comment that was dropped", () => {
    const accepted = changed(
      reference("counterparty-changes"),
      "word/document.xml",
      (xml) => xml.replace(/<w:del\b.*?<\/w:del>/, ""),
    );
    expect(print(accepted).tracked).toHaveLength(2);
    const files = unzipSync(reference("counterparty-changes"));
    delete files["word/comments.xml"];
    expect(print(zipSync(files)).comments).toEqual([]);
  });

  it("refuses a file that is not Word", () => {
    expect(() => print(zipSync({ "a.txt": strToU8("a") }))).toThrow(
      "not a Word file",
    );
  });
});

describe("withoutEdit", () => {
  const base = print(reference("tables"));
  const edited: Fingerprint = {
    ...base,
    paragraphs: base.paragraphs.map((p, index) =>
      index === 1 ? { ...p, text: `${p.text} FP-EDIT` } : p,
    ),
    tracked: [
      ...base.tracked,
      { kind: "ins", author: "Test Person", text: "FP-EDIT" },
    ],
  };

  it("takes the typed edit out again", () => {
    expect(withoutEdit(edited, "FP-EDIT", "Test Person")).toEqual(base);
  });

  it("refuses an edit that was not tracked, or not by the person", () => {
    expect(() => withoutEdit(base, "FP-EDIT", "Test Person")).toThrow(
      "not a tracked insertion",
    );
    expect(() => withoutEdit(edited, "FP-EDIT", "Someone Else")).toThrow(
      "not a tracked insertion",
    );
  });
});
