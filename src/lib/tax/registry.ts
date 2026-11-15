export const sources = [
  {
    id: "cbdt-circulars",
    name: "CBDT circulars",
    url: "https://www.incometaxindia.gov.in/circulars",
    kind: "LISTING",
  },
  {
    id: "cbdt-notifications",
    name: "CBDT notifications",
    url: "https://www.incometaxindia.gov.in/notifications",
    kind: "LISTING",
  },
  {
    id: "income-tax-transition",
    name: "Income Tax Department — transition FAQ",
    url: "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act",
    kind: "DOCUMENT",
  },
] as const;

// Exact hosts only. Adding a source is a code-reviewed change in this first release.
export const allowedHosts = new Set([
  "www.incometaxindia.gov.in",
  "incometaxindia.gov.in",
  "www.incometax.gov.in",
  "incometax.gov.in",
]);
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_FRESHNESS_MS = 48 * 60 * 60 * 1000;

export function officialUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Only registered official HTTPS hosts are permitted.");
  }
  url.hash = "";
  return url;
}

export function validPeriod(value: unknown): value is string {
  if (typeof value !== "string" || !/^(FY|AY|TY) 20\d{2}-\d{2}$/.test(value))
    return false;
  const year = Number(value.slice(3, 7));
  return Number(value.slice(-2)) === (year + 1) % 100;
}

// FY, TY and AY are three labels for one April–March income year: FY 2026-27,
// TY 2026-27 and AY 2027-28 all name April 2026 to March 2027.
export function equivalentPeriods(period: string): string[] {
  const start = periodRange(period).start.getUTCFullYear();
  const label = (year: number) =>
    `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  return [`FY ${label(start)}`, `TY ${label(start)}`, `AY ${label(start + 1)}`];
}

export function periodRange(period: string) {
  if (!validPeriod(period)) throw new Error("Invalid tax period.");
  const year = Number(period.slice(3, 7)) - (period.startsWith("AY") ? 1 : 0);
  return {
    start: new Date(Date.UTC(year, 3, 1)),
    end: new Date(Date.UTC(year + 1, 3, 1)),
  };
}

// The tax year named in a question, as a canonical period, or null. Only labelled
// forms count ("FY 2025-26", "AY 2026-27", "tax year 2026-27", "financial year
// 2025-2026"); a bare "2025-26" is left to the model, because people use it for
// both the income year and the assessment year. Two different years: null.
const LABELS: Record<string, "FY" | "AY" | "TY"> = {
  fy: "FY",
  ay: "AY",
  ty: "TY",
  "financial year": "FY",
  "previous year": "FY",
  "assessment year": "AY",
  "tax year": "TY",
};
const NAMED =
  /\b(fy|ay|ty|financial\s+year|previous\s+year|assessment\s+year|tax\s+year)\s*[:.]?\s*'?(\d{4}|\d{2})\s*[-–/]\s*(\d{4}|\d{2})\b/gi;
export function detectPeriod(text: string): string | null {
  const found = new Set<string>();
  for (const match of text.matchAll(NAMED)) {
    const label = LABELS[match[1].toLowerCase().replace(/\s+/g, " ")];
    const start = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    const end = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const period = `${label} ${start}-${String(end % 100).padStart(2, "0")}`;
    if (end !== start + 1 || !validPeriod(period)) continue;
    // FY 2026-27, TY 2026-27 and AY 2027-28 are one year: compare by income year.
    found.add(equivalentPeriods(period)[0]);
  }
  return found.size === 1 ? [...found][0] : null;
}

// Which tax year a question is about: one chosen explicitly, else one named in
// the question, else the most recent one named earlier in the chat (newest
// first), else null for "not stated".
export function resolvePeriod(
  stated: string | undefined,
  question: string,
  earlier: string[],
): string | null {
  return (
    stated ??
    detectPeriod(question) ??
    earlier.map(detectPeriod).find((period) => period !== null) ??
    null
  );
}

// Stored as a conversation's period when it is not tied to one tax year.
export const ANY_PERIOD = "AUTO";
