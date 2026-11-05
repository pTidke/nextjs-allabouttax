import { load } from "cheerio";
import { fetchCbdtJson, fetchOfficial } from "./fetch";
import { officialUrl } from "./registry";

const origin = "https://www.incometaxindia.gov.in";
const pageSize = 20;
type Page = {
  items: Record<string, unknown>[];
  totalCount: number;
  lastPage: number;
  page: number;
};
export type DiscoveredDocument = {
  url: string;
  title: string;
  issuedAt: Date | null;
};
export type CbdtFetch = typeof fetchCbdtJson;

export function discoveryStartYear(now = new Date()) {
  const year = Number(
    process.env.TAX_DISCOVERY_START_YEAR || now.getUTCFullYear(),
  );
  if (!Number.isInteger(year) || year < 2000 || year > now.getUTCFullYear())
    throw new Error(
      "TAX_DISCOVERY_START_YEAR must be between 2000 and the current year.",
    );
  return year;
}
function pageData(value: unknown, page: number): Page {
  const result = value as Page;
  if (
    !result ||
    !Array.isArray(result.items) ||
    !Number.isInteger(result.totalCount) ||
    result.totalCount < 0 ||
    !Number.isInteger(result.lastPage) ||
    result.lastPage < 0 ||
    result.page !== page ||
    (result.totalCount > 0 && result.lastPage < 1)
  )
    throw new Error("CBDT returned an invalid listing page.");
  return result;
}
function fields(item: Record<string, unknown>) {
  const embedded = item.embedded as {
    contentFields?: {
      name: string;
      contentFieldValue?: { data?: string; document?: { contentUrl?: string } };
    }[];
  };
  if (!Array.isArray(embedded?.contentFields))
    throw new Error("CBDT record is missing embedded content.");
  return new Map(
    embedded.contentFields.map((f) => [f.name, f.contentFieldValue]),
  );
}
export function parseCbdtDocument(
  item: Record<string, unknown>,
): DiscoveredDocument {
  const values = fields(item);
  const title = String(item.title || "").trim();
  const link = values.get("reportFile")?.document?.contentUrl;
  if (!title || !link)
    throw new Error(
      "CBDT record has no downloadable document; a new content adapter is required.",
    );
  const url = officialUrl(new URL(link, origin).href);
  if (url.origin !== origin || !url.pathname.startsWith("/documents/"))
    throw new Error(
      "CBDT record points outside its official document library.",
    );
  const date = values.get("circularNotificationDate")?.data;
  const issuedAt = date ? new Date(date) : null;
  if (issuedAt && !Number.isFinite(issuedAt.getTime()))
    throw new Error("CBDT record has an invalid issue date.");
  return { url: url.href, title: title.slice(0, 500), issuedAt };
}

// Uses the same public guest search and Year taxonomy as the official website.
// Complete pagination within the declared issue-year window; no silent truncation.
export async function discoverCbdt(
  listingUrl: string,
  fetcher = fetchOfficial,
  jsonFetcher: CbdtFetch = fetchCbdtJson,
  startYear = discoveryStartYear(),
  now = new Date(),
): Promise<DiscoveredDocument[]> {
  const startedAt = Date.now();
  const listing = officialUrl(listingUrl);
  const expectedKey =
    listing.pathname === "/circulars"
      ? "CIRCULAR_KEY"
      : listing.pathname === "/notifications"
        ? "NOTIFICATION_KEY"
        : null;
  if (listing.origin !== origin || !expectedKey)
    throw new Error("Unknown CBDT listing.");
  const html = (await fetcher(listing.href)).bytes.toString("utf8");
  const $ = load(html);
  const component = $("etds-circular-notification").first();
  const structureId = component.attr("structureid");
  const csrf = html.match(/Liferay\.authToken\s*=\s*['"]([^'"]+)['"]/)?.[1];
  if (
    !csrf ||
    !structureId ||
    !/^\d+$/.test(structureId) ||
    component.attr("structurekey") !== expectedKey
  )
    throw new Error(
      "CBDT listing configuration changed; adapter review required.",
    );
  const json = async (path: string, body?: unknown) => {
    try {
      return await jsonFetcher(`${origin}${path}`, { csrf, body });
    } catch (error) {
      const endpoint = new URL(path, origin);
      const stage = endpoint.pathname.endsWith("/search")
        ? `search page ${endpoint.searchParams.get("page")}`
        : "year taxonomy";
      throw new Error(
        `CBDT ${stage}: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  };
  const vocab = pageData(
    await json(
      `/o/headless-admin-taxonomy/v1.0/sites/20117/taxonomy-vocabularies?${new URLSearchParams({ filter: "name eq 'Year'", fields: "id,name", restrictFields: "actions,creator" })}`,
    ),
    1,
  );
  const vocabularyId = vocab.items.find((i) => i.name === "Year")?.id;
  if (!vocabularyId || !/^\d+$/.test(String(vocabularyId)))
    throw new Error("CBDT Year vocabulary unavailable.");
  const years: Record<string, unknown>[] = [];
  for (let p = 1; ; p++) {
    const page = pageData(
      await json(
        `/o/headless-admin-taxonomy/v1.0/taxonomy-vocabularies/${vocabularyId}/taxonomy-categories?page=${p}&pageSize=100&fields=id,name&restrictFields=actions,creator`,
      ),
      p,
    );
    years.push(...page.items);
    if (p >= page.lastPage) {
      if (years.length !== page.totalCount)
        throw new Error("CBDT year taxonomy was incomplete.");
      break;
    }
    if (p >= 10) throw new Error("CBDT year taxonomy exceeded its page limit.");
  }
  const documents = new Map<string, DiscoveredDocument>();
  for (let year = startYear; year <= now.getUTCFullYear(); year++) {
    const yearId = years.find((i) => String(i.name) === String(year))?.id;
    if (!yearId || !/^\d+$/.test(String(yearId)))
      throw new Error(
        `CBDT has no year filter for ${year}; coverage cannot be confirmed.`,
      );
    let expectedTotal: number | undefined;
    const ids = new Set<string>();
    for (let p = 1; ; p++) {
      if (Date.now() - startedAt > 8 * 60 * 1000)
        throw new Error(
          "CBDT discovery exceeded its time budget; narrow the configured year window.",
        );
      const page = pageData(
        await json(
          `/o/search/v1.0/search?nestedFields=embedded&page=${p}&pageSize=${pageSize}&restrictFields=embedded.actions,embedded.creator`,
          {
            attributes: {
              "search.empty.search": true,
              "search.experiences.blueprint.external.reference.code":
                "CIRCULAR_NOTIFICATION_BP_ERC",
              "search.experiences.structure_id": structureId,
              "search.experiences.structure_key": expectedKey,
              "search.experiences.year_id": String(yearId),
            },
          },
        ),
        p,
      );
      expectedTotal ??= page.totalCount;
      if (page.totalCount !== expectedTotal || page.lastPage > 100)
        throw new Error(
          "CBDT listing changed during pagination or exceeds 100 pages; retry/review required.",
        );
      for (const item of page.items) {
        const id = String((item.embedded as { id?: number })?.id || "");
        if (!id || ids.has(id))
          throw new Error(
            "CBDT returned a missing or repeated record across pages.",
          );
        ids.add(id);
        const document = parseCbdtDocument(item);
        if (!document.issuedAt || document.issuedAt.getUTCFullYear() !== year)
          throw new Error(
            "CBDT year filter did not match the document issue date.",
          );
        documents.set(document.url, document);
      }
      if (p >= page.lastPage) {
        if (ids.size !== expectedTotal)
          throw new Error("CBDT pagination omitted records.");
        break;
      }
    }
  }
  return [...documents.values()];
}
