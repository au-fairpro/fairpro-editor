import { describe, expect, it } from "vitest";
import { commentMentions } from "./mentions";

// Reading who a SuperDoc comment mentions from its comments update.

describe("commentMentions", () => {
  it("reads the emails of an added or changed comment", () => {
    const comment = {
      commentId: "c1",
      mentions: [
        { name: "Kamala", email: "kamala@example.com" },
        { name: "No email" },
        "junk",
        null,
      ],
    };
    expect(commentMentions({ type: "add", comment })).toEqual({
      commentId: "c1",
      emails: ["kamala@example.com"],
    });
    expect(commentMentions({ type: "update", comment })).toEqual({
      commentId: "c1",
      emails: ["kamala@example.com"],
    });
  });

  it("falls back to the comment's id and treats missing mentions as none", () => {
    expect(commentMentions({ type: "add", comment: { id: "c2" } })).toEqual({
      commentId: "c2",
      emails: [],
    });
  });

  it("ignores other updates and comments without an id", () => {
    const comment = { commentId: "c1", mentions: [] };
    for (const type of ["pending", "deleted", "resolved", "selected"]) {
      expect(commentMentions({ type, comment })).toBeNull();
    }
    expect(commentMentions({ type: "add" })).toBeNull();
    expect(
      commentMentions({ type: "add", comment: { commentId: "" } }),
    ).toBeNull();
  });
});
