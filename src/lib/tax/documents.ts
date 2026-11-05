import { createHash } from "node:crypto";
import { load } from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { officialUrl } from "./registry";

export type Extracted = {
  title: string;
  text: string;
  chunks: { anchor: string; text: string }[];
};
export const contentHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function split(text: string, anchor: string) {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: { anchor: string; text: string }[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    for (let i = 0; i < paragraph.length; i += 2200) {
      const part = paragraph.slice(i, i + 2200);
      if (current.length + part.length > 2600 && current) {
        chunks.push({
          anchor: `${anchor}, passage ${chunks.length + 1}`,
          text: current,
        });
        current = "";
      }
      current += `${current ? "\n" : ""}${part}`;
    }
  }
  if (current)
    chunks.push({
      anchor: `${anchor}, passage ${chunks.length + 1}`,
      text: current,
    });
  return chunks;
}

export async function extractDocument(
  bytes: Uint8Array,
  contentType: string,
): Promise<Extracted> {
  let title = "Official tax document";
  let chunks: Extracted["chunks"];
  if (contentType.includes("pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      chunks = text.flatMap((page, i) => split(page, `Page ${i + 1}`));
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else if (contentType.includes("html")) {
    const $ = load(new TextDecoder().decode(bytes));
    title = $("h1").last().text().trim() || $("title").text().trim() || title;
    $("script, style, nav, header, footer, form, noscript").remove();
    const article = $("article").first();
    const root = article.length
      ? article
      : $("[role=main], main, #main-content").first();
    if (!root.length)
      throw new Error(
        "No trusted main-content container; add a source-specific extractor.",
      );
    root.find("p, div, li, h1, h2, h3, h4, tr, br").each((_, el) => {
      $(el).append("\n");
    });
    chunks = split(root.text().replace(/[\t ]+/g, " "), "HTML text");
  } else {
    throw new Error("Unsupported document type; expected HTML or PDF.");
  }
  const text = chunks.map((c) => c.text).join("\n\n");
  if (
    text.length < 300 ||
    chunks.length > 1000 ||
    /access denied|verify you are human|just a moment/i.test(title)
  ) {
    throw new Error(
      "Extraction needs manual review: insufficient text, oversized document, or blocked page.",
    );
  }
  return { title: title.slice(0, 500), text, chunks };
}

export function discoverDocuments(html: string, base: string): string[] {
  const $ = load(html);
  $("nav, header, footer, script, .nav-item, .mobile-nav-item").remove();
  const root = $("[role=main], main, #main-content").first();
  if (!root.length)
    throw new Error(
      "No main listing container; a dedicated adapter is required.",
    );
  const urls = new Set<string>();
  root.find("a[href]").each((_, el) => {
    try {
      const url = officialUrl(new URL($(el).attr("href")!, base).href);
      if (
        /\.pdf$/i.test(url.pathname) ||
        url.pathname.includes("/documents/d/") ||
        url.pathname.startsWith("/w/")
      )
        urls.add(url.href);
    } catch {
      /* Ignore unregistered links, never follow them. */
    }
  });
  // Empty dynamic listings must be reported as broken, not as a successful check.
  if (!urls.size)
    throw new Error(
      "No document links found. This listing may require a dedicated dynamic adapter.",
    );
  if (urls.size > 50)
    throw new Error(
      "Listing exceeds 50 documents; add a paginated adapter before enabling it.",
    );
  return [...urls];
}
