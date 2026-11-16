import type { EngineDocument, EngineLine } from "./extraction-runs";

// The closing parts of an order that the chatbot does not need: who signed it
// (a name, a designation, a phone number) and the "Copy to" list of offices it
// was sent to. Nobody asks who signed a notification, and a distribution list
// only adds noise to the passages (owner, 16 November). The document number in
// brackets at the foot, "[Notification No. 1/2026/F. No. ...]", stays: it tells
// documents apart.
//
// These lines are left out of the passages and need no check. The review page
// still shows them, greyed, with the reason, so a person can see what was left
// out. Rules only, and deliberately narrow: a block is a signature only when it
// is short and comes after the body has started, and a "Copy to" list runs
// until the next heading (an annexure after it is kept).
//
// Page furniture goes the same way: the Gazette's running header on each page
// ("THE GAZETTE OF INDIA : EXTRAORDINARY [PART II—SEC. 3(ii)]"), page numbers,
// and any short line, not a sentence, repeated at the top or foot of three or
// more pages. Left in, a
// running header would land in the middle of a sentence that runs onto the
// next page.

export type ClosingReason = "signature" | "copy list" | "page header";

const FURNITURE = [
  /^(?:\d{1,4}\s+)?(?:THE\s+)?GAZETTE\s+OF\s+INDIA\b/i,
  /^\[?\s*PART\s+[IVX]+\s*[—–-]+\s*SEC/i,
  /\[\s*PART\s+[IVX]+\s*[—–-]+\s*SEC[^\]]*\]\s*\d{0,4}$/i,
  /^[-–—\s]*\d{1,4}[-–—\s]*$/,
  /^page\s+\d+(?:\s+of\s+\d+)?$/i,
];
// Lines at the top or foot of a page that may be furniture.
const EDGE = 3;
const furnitureKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/\s+/g, " ")
    .trim();

function pageFurniture(document: EngineDocument) {
  const found = new Set<string>();
  const edges = document.pages.map((page) => {
    const lines = page.lines.filter(
      (line) => !line.excluded && line.text.trim() && !line.table_id,
    );
    return [...lines.slice(0, EDGE), ...lines.slice(-EDGE)];
  });
  const seen = new Map<string, Set<number>>();
  edges.forEach((lines, page) => {
    for (const line of lines) {
      const text = line.text.trim();
      if (text.length <= 120 && FURNITURE.some((p) => p.test(text)))
        found.add(line.id);
      const key = furnitureKey(text);
      if (key.length >= 4)
        seen.set(key, (seen.get(key) ?? new Set()).add(page));
    }
  });
  // A repeated line counts only when it is short and does not read as a
  // sentence: a running title, not a paragraph that happens to recur.
  if (document.pages.length >= 3)
    edges.forEach((lines) => {
      for (const line of lines) {
        const text = line.text.trim();
        if (
          text.length <= 80 &&
          !/[.;:,]["'”’)\]]*$/.test(text) &&
          (seen.get(furnitureKey(text))?.size ?? 0) >= 3
        )
          found.add(line.id);
      }
    });
  return found;
}

const COPY_START =
  /^\s*(?:copy|copies)\b(?:\s+(?:of\s+the\s+above|of\s+this(?:\s+\w+)?|is|are))?(?:\s+(?:forwarded|sent))?\s*(?:to|for)\b(?!\s+(?:the\s+)?extent)|^\s*copy\s*:/i;
const DESIGNATION =
  /^(?:\(?\s*[A-Z][A-Za-z.' -]{1,60}\)?\s*[,–—-]?\s*)?(?:(?:Under|Deputy|Joint|Additional|Addl\.?|Assistant|Asstt\.?|Principal|Chief|Special)\s+)?(?:Secretary|Director|Commissioner|Section\s+Officer|Officer\s+on\s+Special\s+Duty|OSD)\b[^.;:]*$/;
const CONTACT =
  /^(?:tel(?:e(?:phone|fax))?|ph(?:one)?|fax|e-?mail|mob(?:ile)?)\b/i;
const VALEDICTION = /^yours\s+(?:faithfully|sincerely|truly)\b/i;
// A name on its own line: "(Rajarshi Singh)", "RAJ KUMAR", "Sd/-".
const NAME =
  /^(?:\(\s*[A-Z][A-Za-z.' -]{2,50}\s*\)|[A-Z][A-Z.' -]{2,50}|[Ss]d\/-?)$/;
const SHORT = 150;

type Unit = {
  lines: EngineLine[];
  text: string;
  heading: boolean;
  table: boolean;
};

function units(document: EngineDocument, skip: Set<string>): Unit[] {
  const out: Unit[] = [];
  for (const page of document.pages) {
    let key = "";
    for (const line of page.lines) {
      if (line.excluded || !line.text.trim() || skip.has(line.id)) continue;
      const k = `${page.number}:${line.table_id ? `t:${line.table_id}` : `p:${line.paragraph}`}`;
      if (k !== key || !out.length) {
        out.push({
          lines: [],
          text: "",
          heading: line.role === "heading" && !line.table_id,
          table: !!line.table_id,
        });
        key = k;
      }
      const unit = out[out.length - 1];
      unit.lines.push(line);
      unit.text = unit.text
        ? `${unit.text} ${line.text.trim()}`
        : line.text.trim();
    }
  }
  return out;
}

const signatureLike = (unit: Unit) =>
  !unit.table &&
  unit.text.length <= SHORT &&
  (DESIGNATION.test(unit.text) ||
    CONTACT.test(unit.text) ||
    VALEDICTION.test(unit.text));

export function closingLines(document: EngineDocument) {
  const found = new Map<string, ClosingReason>();
  const furniture = pageFurniture(document);
  for (const id of furniture) found.set(id, "page header");
  const all = units(document, furniture);
  const mark = (unit: Unit, reason: ClosingReason) => {
    for (const line of unit.lines) found.set(line.id, reason);
  };
  // The body starts at the first paragraph that is not a heading and is longer
  // than a heading line: nothing before it (the ministry, the department, the
  // title) can be a signature.
  let body = false;
  let copy = false;
  for (let i = 0; i < all.length; i++) {
    const unit = all[i];
    if (COPY_START.test(unit.text)) {
      copy = true;
      mark(unit, "copy list");
      continue;
    }
    if (copy && unit.heading) copy = false;
    if (copy) {
      mark(unit, "copy list");
      continue;
    }
    if (!body) {
      body = !unit.heading && unit.text.length > SHORT;
      continue;
    }
    if (signatureLike(unit)) {
      mark(unit, "signature");
      // The name just above a designation belongs to the signature.
      const before = all[i - 1];
      if (
        before &&
        !found.has(before.lines[0].id) &&
        !before.table &&
        before.text.length <= 60 &&
        NAME.test(before.text) &&
        DESIGNATION.test(unit.text)
      )
        mark(before, "signature");
    }
  }
  return found;
}

export const closingLabel: Record<ClosingReason, string> = {
  signature: "Signature",
  "copy list": "“Copy to” list",
  "page header": "Page header or number",
};
