import { describe, expect, it } from "vitest";
import {
  asMarkdownParagraphs,
  cleanText,
  failure,
  trackedChangeIds,
  viaAuthor,
} from "./text";

// The AI's wording goes into the document through SuperDoc's Document API,
// whose plain-text insert refuses control characters, line breaks included
// ("text-payload-unsupported-control-char", reported on 3 October 2026).

describe("cleanText", () => {
  it("keeps line breaks plain, turns tabs to spaces and drops other control characters", () => {
    expect(cleanText("One\r\nTwo\rThree\tend\u0000\u000b\u001f.")).toBe(
      "One\nTwo\nThree end.",
    );
    expect(cleanText("\n\nA\n\n\n\nB\n\n")).toBe("A\n\nB");
    expect(cleanText(" \t\n ")).toBe("");
  });
});

describe("asMarkdownParagraphs", () => {
  it("makes one paragraph per line, with Markdown's marks escaped", () => {
    expect(
      asMarkdownParagraphs(
        "1. The Supplier *must*\n\n# Not a heading\n- not a list\n2) [x] <b> & _y_ | ~z~ `c` \\",
      ),
    ).toBe(
      [
        "1\\. The Supplier \\*must\\*",
        "\\# Not a heading",
        "\\- not a list",
        "2\\) \\[x\\] \\<b\\> \\& \\_y\\_ \\| \\~z\\~ \\`c\\` \\\\",
      ].join("\n\n"),
    );
  });
});

describe("failure", () => {
  it("puts SuperDoc's failure codes in plain words", () => {
    expect(
      failure({
        success: false,
        failure: { code: "text-payload-unsupported-control-char" },
      }),
    ).toBe("The text has characters the document cannot take.");
    expect(failure({ failure: { message: "paste-target-unsupported" } })).toBe(
      "The text could not be put into the document. (paste-target-unsupported)",
    );
    expect(
      failure({ failure: { code: "X_Y", message: "The target moved." } }),
    ).toBe("The target moved.");
    expect(failure(false)).toBe("The text could not be put into the document.");
    expect(failure({})).toBe("The text could not be put into the document.");
  });
});

describe("trackedChangeIds", () => {
  it("reads the tracked changes a receipt made", () => {
    expect(
      trackedChangeIds({
        success: true,
        inserted: [
          { kind: "entity", entityType: "trackedChange", entityId: "tc-1" },
          { kind: "entity", entityType: "comment", entityId: "c-1" },
          { kind: "entity", entityType: "trackedChange", entityId: "" },
          null,
        ],
      }),
    ).toEqual(["tc-1"]);
  });

  it("finds none in a receipt without them", () => {
    expect(trackedChangeIds({ success: true })).toEqual([]);
    expect(trackedChangeIds(null)).toEqual([]);
    expect(trackedChangeIds({ inserted: "tc-1" })).toEqual([]);
  });
});

describe("viaAuthor", () => {
  it("names the person, then what suggested it", () => {
    expect(viaAuthor("Ann Lee", "the assistant")).toBe(
      "Ann Lee via the assistant",
    );
  });
});
