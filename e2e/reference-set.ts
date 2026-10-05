// The reference set for the Word round trip (NFR-FID-01): synthetic
// contracts, written here as Word's own XML, that between them hold what a
// real contract carries and an editor most often breaks. Nothing in them
// comes from a customer; every party, person and amount is made up.
//
// | Document              | What it holds                                         |
// | --------------------- | ----------------------------------------------------- |
// | numbering             | Three-level clause numbering (1., 1.1, (a)), headings |
// | tables                | A price table with a header row and merged cells      |
// | headers-footers       | First-page and default headers, page X of Y footer    |
// | schedules             | A landscape schedule in its own section, page breaks  |
// | cross-references      | Bookmarked clauses and REF fields pointing at them    |
// | counterparty-changes  | Tracked insertions, deletions and a comment by the    |
// |                       | other side's lawyer                                   |
//
// Each document's first body paragraph is the "Parties" paragraph the test
// edits, so every file is edited the same way.

import { strToU8, zipSync } from "fflate";

export interface ReferenceDocument {
  name: string;
  /** The text of the paragraph the test clicks into and types after. */
  editHere: string;
  bytes: Uint8Array;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const PARTIES =
  "This agreement is made between Example Buyer Pty Ltd and Sample Supplier Pty Ltd.";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, props = ""): string {
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}

function para(
  content: string,
  {
    style,
    num,
    align,
  }: { style?: string; num?: [number, number]; align?: string } = {},
): string {
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    num
      ? `<w:numPr><w:ilvl w:val="${String(num[1])}"/><w:numId w:val="${String(num[0])}"/></w:numPr>`
      : "",
    align ? `<w:jc w:val="${align}"/>` : "",
  ].join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
}

const text = (value: string, options?: Parameters<typeof para>[1]) =>
  para(run(value), options);

const STYLES = `${XML}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

/** Clause numbering: 1. / 1.1 / (a), the usual Australian contract scheme. */
const NUMBERING = `${XML}<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="567"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1134" w:hanging="567"/></w:pPr></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1701" w:hanging="567"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

interface Parts {
  body: string;
  /** The last section's properties, inside <w:sectPr>. */
  section?: string;
  numbering?: boolean;
  headers?: Record<string, string>;
  footers?: Record<string, string>;
  comments?: string;
}

const LETTER_SECTION =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>';

function pack({
  body,
  section,
  numbering,
  headers = {},
  footers = {},
  comments,
}: Parts): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [
    `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>`,
    `<Override PartName="/word/styles.xml" ContentType="${MAIN}.styles+xml"/>`,
    `<Override PartName="/word/settings.xml" ContentType="${MAIN}.settings+xml"/>`,
  ];
  const rels: string[] = [
    `<Relationship Id="rIdStyles" Type="${OFFICE_REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdSettings" Type="${OFFICE_REL}/settings" Target="settings.xml"/>`,
  ];
  if (numbering) {
    files["word/numbering.xml"] = strToU8(NUMBERING);
    overrides.push(
      `<Override PartName="/word/numbering.xml" ContentType="${MAIN}.numbering+xml"/>`,
    );
    rels.push(
      `<Relationship Id="rIdNumbering" Type="${OFFICE_REL}/numbering" Target="numbering.xml"/>`,
    );
  }
  for (const [kind, parts] of [
    ["header", headers],
    ["footer", footers],
  ] as const) {
    for (const [id, content] of Object.entries(parts)) {
      const tag = kind === "header" ? "hdr" : "ftr";
      files[`word/${id}.xml`] = strToU8(
        `${XML}<w:${tag} xmlns:w="${W}" xmlns:r="${R}">${content}</w:${tag}>`,
      );
      overrides.push(
        `<Override PartName="/word/${id}.xml" ContentType="${MAIN}.${kind}+xml"/>`,
      );
      rels.push(
        `<Relationship Id="${id}" Type="${OFFICE_REL}/${kind}" Target="${id}.xml"/>`,
      );
    }
  }
  if (comments) {
    files["word/comments.xml"] = strToU8(
      `${XML}<w:comments xmlns:w="${W}">${comments}</w:comments>`,
    );
    overrides.push(
      `<Override PartName="/word/comments.xml" ContentType="${MAIN}.comments+xml"/>`,
    );
    rels.push(
      `<Relationship Id="rIdComments" Type="${OFFICE_REL}/comments" Target="comments.xml"/>`,
    );
  }
  files["[Content_Types].xml"] = strToU8(
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      overrides.join("") +
      "</Types>",
  );
  files["_rels/.rels"] = strToU8(
    `${XML}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  files["word/_rels/document.xml.rels"] = strToU8(
    `${XML}<Relationships xmlns="${REL}">${rels.join("")}</Relationships>`,
  );
  files["word/styles.xml"] = strToU8(STYLES);
  files["word/settings.xml"] = strToU8(
    `${XML}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
  );
  files["word/document.xml"] = strToU8(
    `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>${section ?? LETTER_SECTION}</w:sectPr></w:body></w:document>`,
  );
  return zipSync(files, { level: 6, mtime: new Date("2026-10-05T00:00:00Z") });
}

const opening = (title: string) =>
  text(title, { style: "Title" }) + text(PARTIES);

function numbering(): Uint8Array {
  return pack({
    numbering: true,
    body:
      opening("Master services agreement") +
      text("Definitions", { style: "Heading1", num: [1, 0] }) +
      text("In this agreement, the following words have these meanings.", {
        num: [1, 1],
      }) +
      text(
        "Business Day means a day that is not a Saturday, Sunday or public holiday in Sydney.",
        { num: [1, 2] },
      ) +
      text("Services means the services described in the schedule.", {
        num: [1, 2],
      }) +
      text("Services", { style: "Heading1", num: [1, 0] }) +
      text("The Supplier must provide the Services with due care and skill.", {
        num: [1, 1],
      }) +
      text("The Supplier must meet the service levels.", { num: [1, 1] }) +
      text("Payment", { style: "Heading1", num: [1, 0] }) +
      text("The Buyer must pay each invoice within 30 days.", { num: [1, 1] }) +
      text("Amounts are exclusive of GST unless stated otherwise.", {
        num: [1, 1],
      }) +
      text("If the Buyer disputes an invoice, it must:", { num: [1, 1] }) +
      text("notify the Supplier within 10 Business Days; and", {
        num: [1, 2],
      }) +
      text("pay the undisputed part.", { num: [1, 2] }),
  });
}

function cell(content: string, props = ""): string {
  return `<w:tc><w:tcPr><w:tcW w:w="2254" w:type="dxa"/>${props}</w:tcPr>${content}</w:tc>`;
}

function tables(): Uint8Array {
  const head = (value: string) => para(run(value, "<w:b/>"));
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9016" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2254"/><w:gridCol w:w="2254"/><w:gridCol w:w="2254"/><w:gridCol w:w="2254"/></w:tblGrid>' +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(head("Item"), '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}${cell(head("Unit"), '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}${cell(head("Rate (AUD)"), '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}${cell(head("Notes"), '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>')}</w:tr>` +
    `<w:tr>${cell(text("Support"), '<w:vMerge w:val="restart"/>')}${cell(text("Hour"))}${cell(text("180.00", { align: "right" }))}${cell(text("Business hours"))}</w:tr>` +
    `<w:tr>${cell(text(""), "<w:vMerge/>")}${cell(text("After-hours hour"))}${cell(text("270.00", { align: "right" }))}${cell(text("Weekends and nights"))}</w:tr>` +
    `<w:tr>${cell(text("Total fees are capped at AUD 50,000 a year."), '<w:gridSpan w:val="4"/>').replace('<w:tcW w:w="2254"', '<w:tcW w:w="9016"')}</w:tr>` +
    "</w:tbl>";
  return pack({
    body:
      opening("Price schedule") +
      text("The rates below apply from the start date.") +
      table +
      text(
        "Rates are reviewed each year on the anniversary of the start date.",
      ),
  });
}

const fieldRuns = (instruction: string, shown: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run(shown) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function headersFooters(): Uint8Array {
  const body = [
    opening("Supply agreement"),
    ...Array.from({ length: 40 }, (_, index) =>
      text(
        `Clause ${String(index + 1)}. The Supplier must deliver the goods in good condition, packed to protect them in transit, and with the delivery documents the Buyer reasonably asks for.`,
      ),
    ),
  ].join("");
  return pack({
    body,
    headers: {
      header1:
        para(run("Sample Supplier Pty Ltd"), { style: "Header" }) +
        para(run("Confidential"), { style: "Header", align: "right" }),
      header2: para(
        run("Supply agreement between Example Buyer and Sample Supplier"),
        { style: "Header" },
      ),
    },
    footers: {
      footer1: para(
        run("Page ") +
          fieldRuns("PAGE", "1") +
          run(" of ") +
          fieldRuns("NUMPAGES", "2"),
        { style: "Footer", align: "center" },
      ),
    },
    section:
      '<w:headerReference w:type="default" r:id="header2"/><w:headerReference w:type="first" r:id="header1"/><w:footerReference w:type="default" r:id="footer1"/>' +
      LETTER_SECTION +
      "<w:titlePg/>",
  });
}

function schedules(): Uint8Array {
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const row = (cells: string[]) =>
    `<w:tr>${cells.map((value) => `<w:tc><w:tcPr><w:tcW w:w="3489" w:type="dxa"/></w:tcPr>${text(value)}</w:tc>`).join("")}</w:tr>`;
  const landscape =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="13958" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3489"/><w:gridCol w:w="3489"/><w:gridCol w:w="3489"/><w:gridCol w:w="3491"/></w:tblGrid>' +
    row(["Milestone", "Deliverable", "Due", "Payment"]) +
    row(["1", "Design", "1 November 2026", "AUD 10,000"]) +
    row(["2", "Build", "1 February 2027", "AUD 25,000"]) +
    row(["3", "Handover", "1 April 2027", "AUD 15,000"]) +
    "</w:tbl>";
  return pack({
    body:
      opening("Consultancy agreement") +
      text("The Consultant must perform the services in Schedule 1.") +
      text("The Client must pay the milestone payments in Schedule 2.") +
      pageBreak +
      text("Schedule 1: Services", { style: "Heading1" }) +
      text(
        "Advice on the design, build and handover of the Client's records system.",
      ) +
      // The section break: Schedule 2 is on landscape pages.
      `<w:p><w:pPr><w:sectPr>${LETTER_SECTION}</w:sectPr></w:pPr></w:p>` +
      text("Schedule 2: Milestones", { style: "Heading1" }) +
      landscape +
      text("Each payment is due 14 days after the milestone is accepted."),
    section:
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>',
  });
}

function crossReferences(): Uint8Array {
  const bookmarked = (id: number, name: string, value: string) =>
    para(
      `<w:bookmarkStart w:id="${String(id)}" w:name="${name}"/>${run(value)}<w:bookmarkEnd w:id="${String(id)}"/>`,
      { style: "Heading1" },
    );
  return pack({
    body:
      opening("Licence agreement") +
      bookmarked(1, "_RefLicence", "Clause 2: Licence") +
      text(
        "The Licensor grants the Licensee a non-exclusive licence to use the software.",
      ) +
      bookmarked(2, "_RefTermination", "Clause 3: Termination") +
      para(
        run("Either party may end this agreement under ") +
          fieldRuns("REF _RefTermination \\h", "Clause 3: Termination") +
          run(" if the other breaches ") +
          fieldRuns("REF _RefLicence \\h", "Clause 2: Licence") +
          run("."),
      ) +
      para(
        run("Notices go to the address in ") +
          '<w:fldSimple w:instr=" REF _RefLicence \\h "><w:r><w:t>Clause 2: Licence</w:t></w:r></w:fldSimple>' +
          run("."),
      ),
  });
}

function counterpartyChanges(): Uint8Array {
  const by =
    'w:author="Casey Counsel (counterparty)" w:date="2026-10-01T09:00:00Z"';
  return pack({
    body:
      opening("Services agreement") +
      para(
        run("The Supplier's liability is limited to ") +
          `<w:del w:id="101" ${by}><w:r><w:delText xml:space="preserve">the fees paid in the last 12 months</w:delText></w:r></w:del>` +
          `<w:ins w:id="102" ${by}>${run("AUD 100,000")}</w:ins>` +
          run("."),
      ) +
      para(
        '<w:commentRangeStart w:id="0"/>' +
          run("The Buyer may terminate for convenience on 30 days' notice.") +
          '<w:commentRangeEnd w:id="0"/>' +
          '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>',
      ) +
      `<w:p><w:pPr><w:rPr><w:ins w:id="103" ${by}/></w:rPr></w:pPr><w:ins w:id="104" ${by}>${run("Each party must keep the other's confidential information secret.")}</w:ins></w:p>`,
    comments:
      `<w:comment w:id="0" w:author="Casey Counsel (counterparty)" w:date="2026-10-01T09:05:00Z" w:initials="CC">` +
      para(
        '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' +
          run("We need 90 days' notice here."),
        { style: "CommentText" },
      ) +
      "</w:comment>",
  });
}

export function referenceSet(): ReferenceDocument[] {
  return [
    { name: "numbering", bytes: numbering() },
    { name: "tables", bytes: tables() },
    { name: "headers-footers", bytes: headersFooters() },
    { name: "schedules", bytes: schedules() },
    { name: "cross-references", bytes: crossReferences() },
    { name: "counterparty-changes", bytes: counterpartyChanges() },
  ].map((document) => ({ ...document, editHere: PARTIES }));
}
