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

export function periodRange(period: string) {
  if (!validPeriod(period)) throw new Error("Invalid tax period.");
  const year = Number(period.slice(3, 7)) - (period.startsWith("AY") ? 1 : 0);
  return {
    start: new Date(Date.UTC(year, 3, 1)),
    end: new Date(Date.UTC(year + 1, 3, 1)),
  };
}
