import type { EngineDocument, EngineLine } from "./extraction-runs";
import { incomeYears, taxYearLabel } from "../tax/years";

// Facts about a document read by rules from its first pages: what kind of
// document it is, its number, Gazette number, who issued it and when, and the
// income years it names. They are proposals, each with the line it came from;
// the tax reviewer confirms or edits them before approving (AD-46).

export type FactField =
  | "documentType"
  | "documentNumber"
  | "gazetteNumber"
  | "issuingAuthority"
  | "issuedOn"
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

  // Years named anywhere in the document, with the first line naming one.
  const years = new Set<string>();
  let yearLine: EngineLine | null = null;
  for (const line of document.pages.flatMap((page) =>
    page.lines.map(reviewed),
  )) {
    if (line.excluded) continue;
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
