import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  LONG_CONTRACT_TITLE,
  longContract,
  longContractBody,
  subclauseText,
} from "./long-contract";

function documentXml(bytes: Uint8Array): Document {
  const part = unzipSync(bytes)["word/document.xml"];
  if (!part) throw new Error("no word/document.xml");
  return new DOMParser().parseFromString(strFromU8(part), "application/xml");
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("the long contract", () => {
  const xml = documentXml(longContract());
  const words = xml.documentElement.textContent
    .split(/\s+/)
    .filter(Boolean).length;

  it("is well-formed Word XML with numbering and styles", () => {
    expect(xml.getElementsByTagName("parsererror")).toHaveLength(0);
    const files = Object.keys(unzipSync(longContract()));
    expect(files).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "word/document.xml",
        "word/numbering.xml",
        "word/styles.xml",
      ]),
    );
  });

  it("has a title, 24 numbered clause headings and two tables", () => {
    const styles = Array.from(xml.getElementsByTagNameNS(W, "pStyle")).map(
      (s) => s.getAttributeNS(W, "val"),
    );
    expect(styles.filter((s) => s === "Title")).toHaveLength(1);
    expect(styles.filter((s) => s === "Heading1")).toHaveLength(24);
    expect(xml.getElementsByTagNameNS(W, "tbl")).toHaveLength(2);
    expect(xml.documentElement.textContent).toContain(LONG_CONTRACT_TITLE);
  });

  it("holds about 30 pages of text", () => {
    // About 460 words fill a page of these clauses in the editor; the
    // end-to-end test counts the pages it actually lays out.
    expect(words).toBeGreaterThan(12_500);
    expect(words).toBeLessThan(16_000);
  });

  it("grows with the number of subclauses", () => {
    expect(longContractBody(2).length).toBeLessThan(longContractBody().length);
  });

  it("is the same every time, so timings compare", () => {
    expect(longContract()).toEqual(longContract());
  });

  it("varies the wording between subclauses", () => {
    expect(subclauseText(1, 1)).not.toBe(subclauseText(1, 2));
    expect(subclauseText(1, 1).split(" ").length).toBeGreaterThan(70);
  });
});
