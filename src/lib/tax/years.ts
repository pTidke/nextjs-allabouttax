// Income years named in Indian tax text, as the April–March year they cover,
// labelled "2026-27". A financial year, previous year or tax year names that year
// itself; an assessment year names the year before it (AY 2027-28 assesses the
// income of 2026-27). Only years introduced by one of those words count: a bare
// "2026-27" could be anything.

const KEYWORD =
  /\b(assessment\s+years?|a\.\s?y\.?|ay|financial\s+years?|f\.\s?y\.?|fy|previous\s+years?|tax\s+years?|t\.\s?y\.?|ty)\b[\s:.,-]*/gi;
const YEAR = /^(\d{4})\s*[-–—/]\s*(\d{4}|\d{2})\b/;
const JOINER = /^\s*(?:,|and|&|to|till|until|upto|up\s+to|through|[-–—])\s*/i;
const MAX_YEARS = 30;

const label = (start: number) =>
  `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

function yearAt(text: string) {
  const match = text.match(YEAR);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2].length === 2 ? Number(match[2]) : Number(match[2]) % 100;
  // Only consecutive years: "2026-27" or "2026-2027".
  if (start < 1950 || start > 2100 || (start + 1) % 100 !== end) return null;
  return { start, length: match[0].length };
}

export function incomeYears(text: string): string[] {
  const found = new Set<number>();
  for (const keyword of text.matchAll(KEYWORD)) {
    const word = keyword[1].toLowerCase().replace(/\s+/g, " ");
    const assessment = word.startsWith("assessment") || /^a\.? ?y/.test(word);
    let rest = text.slice(keyword.index! + keyword[0].length);
    let previous: number | null = null;
    let range = false;
    for (;;) {
      const year = yearAt(rest);
      if (!year) break;
      const start = year.start - (assessment ? 1 : 0);
      if (range && previous !== null && start > previous)
        for (let y = previous + 1; y < start && found.size < MAX_YEARS; y++)
          found.add(y);
      found.add(start);
      previous = start;
      rest = rest.slice(year.length);
      const joiner = rest.match(JOINER);
      if (!joiner) break;
      range = /to|till|until|up|through|[-–—]/i.test(joiner[0]);
      rest = rest.slice(joiner[0].length);
      if (found.size >= MAX_YEARS) break;
    }
  }
  return [...found].sort((a, b) => a - b).map(label);
}

// "2026-27" -> "TY 2026-27", the label the tax review form takes.
export const taxYearLabel = (year: string) => `TY ${year}`;
