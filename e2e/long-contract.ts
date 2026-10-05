// A synthetic contract of about 30 pages, for the opening-time test
// (NFR-PERF-04: "A 30-page contract shall open in the editor within 3
// seconds"). It is built from the same Word XML pieces as the reference set:
// numbered clauses (1. / 1.1 / (a)) under headings and two tables. Every
// party, person and amount is made up; nothing comes from a customer.

import { para, pack, run, text } from "./reference-set";

export const LONG_CONTRACT_TITLE = "Master supply and services agreement";

/** Clause headings; each becomes a numbered Heading 1 with its subclauses. */
const HEADINGS = [
  "Definitions and interpretation",
  "Term",
  "Supply of goods",
  "Services",
  "Service levels",
  "Orders",
  "Delivery",
  "Acceptance",
  "Price and payment",
  "Goods and services tax",
  "Warranties",
  "Intellectual property",
  "Confidentiality",
  "Privacy",
  "Insurance",
  "Liability",
  "Indemnities",
  "Force majeure",
  "Disputes",
  "Termination",
  "Consequences of termination",
  "Notices",
  "Assignment and subcontracting",
  "General",
];

/** Sentences mixed into each subclause, so no two paragraphs are alike. */
const SENTENCES = [
  "The Supplier must perform its obligations with due care, skill and diligence and in accordance with good industry practice.",
  "The Buyer must give the Supplier reasonable access to its premises, systems and personnel where that access is needed.",
  "Each party must comply with all applicable laws, including laws about workplace health and safety and the environment.",
  "A party is not in breach of this clause to the extent that the other party caused or contributed to the failure.",
  "The Supplier must promptly notify the Buyer in writing if it becomes aware of anything that may delay performance.",
  "Any amount payable under this agreement is payable in Australian dollars to the account the receiving party nominates.",
  "The parties must meet at least once each quarter to review performance against the service levels in Schedule 2.",
  "Nothing in this clause limits any other right or remedy that a party has under this agreement or at law.",
  "The Supplier must keep complete and accurate records of the Services and give copies to the Buyer on request.",
  "If a party disputes a matter under this clause, the dispute resolution process in clause 19 applies.",
];

/** About 90 words, chosen deterministically from the sentences above. */
export function subclauseText(clause: number, sub: number): string {
  const start = (clause * 7 + sub * 3) % SENTENCES.length;
  return Array.from(
    { length: 4 },
    (_, i) => SENTENCES[(start + i) % SENTENCES.length],
  ).join(" ");
}

function cell(content: string, width: number, props = ""): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${String(width)}" w:type="dxa"/>${props}</w:tcPr>${content}</w:tc>`;
}

function table(header: string[], rows: string[][]): string {
  const width = Math.floor(9016 / header.length);
  const grid = header.map(() => `<w:gridCol w:w="${String(width)}"/>`).join("");
  const shade = '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>';
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map((value) => cell(para(run(value, "<w:b/>")), width, shade)).join("")}</w:tr>`;
  const body = rows
    .map(
      (row) =>
        `<w:tr>${row.map((value) => cell(text(value), width)).join("")}</w:tr>`,
    )
    .join("");
  return (
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9016" w:type="dxa"/></w:tblPr>' +
    `<w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`
  );
}

function priceTable(): string {
  return table(
    ["Item", "Unit", "Rate (AUD)", "Notes"],
    Array.from({ length: 12 }, (_, i) => [
      `Item ${String(i + 1)}`,
      i % 2 === 0 ? "Hour" : "Each",
      `${String(120 + i * 15)}.00`,
      i % 3 === 0 ? "Business hours only" : "Includes travel",
    ]),
  );
}

function serviceLevelTable(): string {
  return table(
    ["Priority", "Response", "Resolution", "Service credit"],
    [
      ["1 (critical)", "15 minutes", "4 hours", "10% of monthly fee"],
      ["2 (high)", "1 hour", "1 Business Day", "5% of monthly fee"],
      ["3 (medium)", "4 hours", "3 Business Days", "2% of monthly fee"],
      ["4 (low)", "1 Business Day", "10 Business Days", "None"],
    ],
  );
}

/**
 * The document.xml body: a title, the parties, then each heading as a
 * numbered clause with `subclauses` subclauses of about 90 words, every
 * third one with two (a)/(b) items. The price table follows clause 9 and the
 * service-level table clause 5.
 */
export function longContractBody(subclauses = 7): string {
  const parts = [
    text(LONG_CONTRACT_TITLE, { style: "Title" }),
    text(
      "This agreement is made between Example Buyer Pty Ltd and Sample Supplier Pty Ltd.",
    ),
  ];
  HEADINGS.forEach((heading, index) => {
    const clause = index + 1;
    parts.push(text(heading, { style: "Heading1", num: [1, 0] }));
    for (let sub = 1; sub <= subclauses; sub++) {
      parts.push(text(subclauseText(clause, sub), { num: [1, 1] }));
      if (sub % 3 === 0) {
        parts.push(
          text("give the other party written notice within 10 Business Days;", {
            num: [1, 2],
          }),
          text("take all reasonable steps to limit any loss.", {
            num: [1, 2],
          }),
        );
      }
    }
    if (heading === "Service levels") parts.push(serviceLevelTable());
    if (heading === "Price and payment") parts.push(priceTable());
  });
  return parts.join("");
}

/** The ~30-page contract as a .docx file. */
export function longContract(subclauses?: number): Uint8Array {
  return pack({ numbering: true, body: longContractBody(subclauses) });
}
