import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { withCommentParagraphIds } from "./comment-ids";

// Replies to a comment whose paragraph has no w14:paraId do nothing in
// SuperDoc (found 5 October 2026 with FairPro's AI comments).

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function docx(
  comments: string | null,
  body = "<w:p/>",
): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {
    "word/document.xml": strToU8(
      `${DECLARATION}<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    ),
  };
  if (comments !== null) files["word/comments.xml"] = strToU8(comments);
  return new Uint8Array(zipSync(files));
}

const comments = (inner: string, ns = "") =>
  `${DECLARATION}<w:comments xmlns:w="${W}"${ns}>${inner}</w:comments>`;

function paraIds(bytes: Uint8Array): (string | null)[] {
  const xml = strFromU8(
    unzipSync(bytes)["word/comments.xml"] ?? new Uint8Array(),
  );
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS(W, "p")).map((p) =>
    p.getAttributeNS(W14, "paraId"),
  );
}

describe("withCommentParagraphIds", () => {
  it("gives every comment paragraph without an id a new one", () => {
    const out = withCommentParagraphIds(
      docx(
        comments(
          '<w:comment w:id="3" w:author="FairPro AI"><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="4" w:author="Casey"><w:p><w:r><w:t>Three</w:t></w:r></w:p></w:comment>',
        ),
      ),
    );
    const ids = paraIds(out);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(id).toMatch(/^[0-7][0-9A-F]{7}$/);
    expect(new Set(ids).size).toBe(3);
    const xml = strFromU8(
      unzipSync(out)["word/comments.xml"] ?? new Uint8Array(),
    );
    expect(xml.startsWith(DECLARATION)).toBe(true);
    // The comments themselves are unchanged.
    expect(xml).toContain('w:author="FairPro AI"');
    expect(xml).toContain("<w:t>Two</w:t>");
  });

  it("keeps ids already there and never repeats one used elsewhere in the file", () => {
    const out = withCommentParagraphIds(
      docx(
        comments(
          '<w:comment w:id="1"><w:p w14:paraId="0ABCDEF0"><w:r><w:t>Has one</w:t></w:r></w:p></w:comment>' +
            '<w:comment w:id="2"><w:p><w:r><w:t>Needs one</w:t></w:r></w:p></w:comment>',
          ` xmlns:w14="${W14}"`,
        ),
        '<w:p w14:paraId="10000000"/>',
      ),
    );
    const [kept, added] = paraIds(out);
    expect(kept).toBe("0ABCDEF0");
    expect(added).toBe("10000001");
  });

  it("returns the same bytes when there is nothing to do", () => {
    const none = docx(null);
    expect(withCommentParagraphIds(none)).toBe(none);
    const all = docx(
      comments(
        '<w:comment w:id="1"><w:p w14:paraId="1A2B3C4D"/></w:comment>',
        ` xmlns:w14="${W14}"`,
      ),
    );
    expect(withCommentParagraphIds(all)).toBe(all);
    const notZip = new Uint8Array([1, 2, 3]);
    expect(withCommentParagraphIds(notZip)).toBe(notZip);
    const broken = docx("<w:comments");
    expect(withCommentParagraphIds(broken)).toBe(broken);
  });
});
