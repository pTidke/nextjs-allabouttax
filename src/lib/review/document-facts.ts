import type { EngineDocument, EngineLine } from "./extraction-runs";
import { incomeYears, taxYearLabel } from "../tax/years";

// Facts about a document read by rules: what kind of document it is, its
// number, Gazette number, who issued it and when (from the first pages), when it
// comes into force, the one taxpayer it is about if any, and the income years it
// names. They are proposals, each with the line it came from;
// the tax reviewer confirms or edits them before approving (AD-46).

export type FactField =
  | "documentType"
  | "documentNumber"
  | "gazetteNumber"
  | "issuingAuthority"
  | "issuedOn"
  | "effectiveFrom"
  | "entityName"
  | "period"
  | "periodMode"
  | "applicabilityNote";
export type DocumentFact = {
  field: FactField;
  value: string;
  source: { lineId: string; page: number; text: string };
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const TYPES: [RegExp, string][] = [
  [/^NOTIFICATIONS?\b/, "NOTIFICATION"],
  [/^CIRCULARS?\b/, "CIRCULAR"],
];
const NUMBER =
  /\b(?:notification|circular)?\s*no\.?\s*[:-]?\s*(\d{1,4})\s*(?:\/|of)\s*(\d{4})\b/i;
const GAZETTE = /\b(S\.\s?O\.|G\.\s?S\.\s?R\.)\s*(\d{1,5})\s*\(\s*E\s*\)/i;
const AUTHORITY = [
  /\bministry\s+of\s+finance\b/i,
  /\bdepartment\s+of\s+revenue\b/i,
  /\bcentral\s+board\s+of\s+direct\s+taxes\b/i,
];
const WORD_DATE =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{4})\b/i;
const NUMERIC_DATE =
  /\bdated?\s*[:-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/i;
// "shall come into force on the 1st day of April, 2026", "with effect from ...".
const IN_FORCE =
  /\b(?:come\s+into\s+force|with\s+effect\s+from|w\.\s?e\.\s?f\.?|effective\s+from)\b/i;
const ON_PUBLICATION =
  /\b(?:come\s+into\s+force|take\s+effect)\b[^.]{0,40}\b(?:date\s+of\s+(?:its\s+)?publication|publication\s+in\s+the\s+official\s+gazette)/i;
const DAY_OF =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{4})\b/i;
// An order about one taxpayer: "in the case of M/s ABC Limited", "approves
// the XYZ Foundation (PAN: ...)".
const ENTITY = [
  /\bin\s+the\s+case\s+of\s+(?:M\/s\.?\s*)?([A-Z][A-Za-z0-9&.' -]{2,120}?)(?=\s*(?:\(|,|;|\.\s|\.$|$|\bfor\b|\bas\b))/,
  /\b(?:approves|notifies|specifies|in\s+respect\s+of|in\s+favour\s+of)\s+(?:the\s+)?(?:M\/s\.?\s*)?([A-Z][A-Za-z0-9&.' -]{2,120}?)\s*\(\s*PAN\b/,
];

const iso = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
};
const titleCase = (text: string) =>
  text
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And)\b/g, (w) => w.toLowerCase());

// corrections: reviewed text by line id, so facts come from what a person
// confirmed rather than the engine's first reading.
export function documentFacts(
  document: EngineDocument,
  corrections: Map<string, string> = new Map(),
): DocumentFact[] {
  const reviewed = (line: EngineLine) => ({
    ...line,
    text: corrections.get(line.id) ?? line.text,
  });
  const lines = document.pages
    .slice(0, 2)
    .flatMap((page) => page.lines.map(reviewed))
    .filter((line) => !line.excluded && line.text.trim());
  const facts: DocumentFact[] = [];
  const source = (line: EngineLine) => ({
    lineId: line.id,
    page: line.page,
    text: line.text.trim().slice(0, 300),
  });
  const first = <T>(find: (line: EngineLine) => T | null) => {
    for (const line of lines) {
      const value = find(line);
      if (value) return { value, line };
    }
    return null;
  };

  const type = first((line) => {
    const text = line.text.trim().toUpperCase();
    return TYPES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  });
  if (type)
    facts.push({
      field: "documentType",
      value: type.value,
      source: source(type.line),
    });

  const number = first((line) => {
    const m = line.text.match(NUMBER);
    return m ? `${Number(m[1])}/${m[2]}` : null;
  });
  if (number)
    facts.push({
      field: "documentNumber",
      value: number.value,
      source: source(number.line),
    });

  const gazette = first((line) => {
    const m = line.text.match(GAZETTE);
    return m ? `${m[1].replace(/\s/g, "").toUpperCase()} ${m[2]}(E)` : null;
  });
  if (gazette)
    facts.push({
      field: "gazetteNumber",
      value: gazette.value,
      source: source(gazette.line),
    });

  const authority: { name: string; line: EngineLine }[] = [];
  for (const line of lines)
    for (const pattern of AUTHORITY) {
      const m = line.text.match(pattern);
      if (
        m &&
        !authority.some((a) => a.name.toLowerCase() === m[0].toLowerCase())
      )
        authority.push({ name: titleCase(m[0].replace(/\s+/g, " ")), line });
    }
  if (authority.length)
    facts.push({
      field: "issuingAuthority",
      value: authority.map((a) => a.name).join(", "),
      source: source(authority[0].line),
    });

  const issued = first((line) => {
    const words = line.text.match(WORD_DATE);
    // A date on a line that also names a place or says "dated" is the issue date;
    // other dates (deadlines, periods) are not.
    if (words && /new delhi|dated|date\b/i.test(line.text))
      return iso(
        Number(words[3]),
        MONTHS.indexOf(words[2].toLowerCase()) + 1,
        Number(words[1]),
      );
    const numeric = line.text.match(NUMERIC_DATE);
    if (numeric)
      return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    return null;
  });
  if (issued)
    facts.push({
      field: "issuedOn",
      value: issued.value,
      source: source(issued.line),
    });

  const everyLine = document.pages
    .flatMap((page) => page.lines.map(reviewed))
    .filter((line) => !line.excluded && line.text.trim());

  // When it comes into force: a date on the line that says so, or the issue
  // date when it comes into force on publication.
  for (const line of everyLine) {
    let value: string | null = null;
    if (IN_FORCE.test(line.text)) {
      const m = line.text.match(DAY_OF);
      if (m)
        value = iso(
          Number(m[3]),
          MONTHS.indexOf(m[2].toLowerCase()) + 1,
          Number(m[1]),
        );
    }
    if (!value && ON_PUBLICATION.test(line.text) && issued)
      value = issued.value;
    if (value) {
      facts.push({ field: "effectiveFrom", value, source: source(line) });
      break;
    }
  }

  // Who it is about, when it names one taxpayer.
  for (const line of everyLine) {
    const name = ENTITY.map((pattern) => line.text.match(pattern)?.[1])
      .find(Boolean)
      ?.trim();
    if (name && name.split(/\s+/).length >= 2) {
      facts.push({ field: "entityName", value: name, source: source(line) });
      break;
    }
  }

  // Years named anywhere in the document, with the first line naming one.
  const years = new Set<string>();
  let yearLine: EngineLine | null = null;
  for (const line of everyLine) {
    const found = incomeYears(line.text);
    if (found.length && !yearLine) yearLine = line;
    found.forEach((y) => years.add(y));
  }
  const sorted = [...years].sort();
  if (yearLine && sorted.length === 1) {
    facts.push({
      field: "periodMode",
      value: "SINGLE_PERIOD",
      source: source(yearLine),
    });
    facts.push({
      field: "period",
      value: taxYearLabel(sorted[0]),
      source: source(yearLine),
    });
  } else if (yearLine && sorted.length > 1) {
    facts.push({
      field: "periodMode",
      value: "MULTI_PERIOD",
      source: source(yearLine),
    });
    facts.push({
      field: "applicabilityNote",
      value: `Names the income years ${sorted.join(", ")} (tax years; an assessment year is the year after).`,
      source: source(yearLine),
    });
  }
  return facts;
}
