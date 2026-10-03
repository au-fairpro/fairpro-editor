// Text FairPro sends for the document, made ready for SuperDoc's Document
// API, and SuperDoc's failure receipts in words. No SuperDoc import here, so
// the unit tests run without a browser.

/**
 * Text ready for SuperDoc: line endings made plain, tabs as spaces, and
 * other control characters taken out. SuperDoc's plain-text insert refuses
 * control characters, including line breaks
 * ("text-payload-unsupported-control-char").
 */
export function cleanText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      // eslint-disable-next-line no-control-regex -- removing them is the point
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Text of several lines as Markdown that SuperDoc turns into one paragraph
 * per line, with every character that Markdown would read as formatting
 * escaped, so the words go in exactly as written.
 */
export function asMarkdownParagraphs(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) =>
      line
        .replace(/[\\`*_[\]<>#|~&]/g, "\\$&")
        // A line that starts like a list item stays plain text.
        .replace(/^(\d+)([.)])/, "$1\\$2")
        .replace(/^([-+])(\s)/, "\\$1$2"),
    )
    .join("\n\n");
}

/** Plain words for SuperDoc's failure codes FairPro shows. */
const FAILURES: Record<string, string> = {
  "text-payload-unsupported-control-char":
    "The text has characters the document cannot take.",
};

const COULD_NOT = "The text could not be put into the document.";

/**
 * Why a receipt failed, in words for the person. SuperDoc's failures carry a
 * code such as "paste-target-unsupported", sometimes as the message itself;
 * a code FairPro has no words for is shown after a plain sentence.
 */
export function failure(result: unknown): string {
  if (typeof result !== "object" || result === null) return COULD_NOT;
  const failed = (result as { failure?: { message?: unknown; code?: unknown } })
    .failure;
  const said = [failed?.code, failed?.message].filter(
    (x): x is string => typeof x === "string" && x !== "",
  );
  for (const code of said) {
    const known = FAILURES[code];
    if (known) return known;
  }
  const message = said.find((x) => !CODE.test(x));
  if (message) return message;
  return said[0] ? `${COULD_NOT} (${said[0]})` : COULD_NOT;
}

/** A bare failure code rather than a sentence. */
const CODE = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i;
