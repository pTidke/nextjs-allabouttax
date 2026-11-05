import { fetchOfficial } from "../src/lib/tax/fetch";
import { extractDocument, contentHash } from "../src/lib/tax/documents";
import { discoverCbdt, discoveryStartYear } from "../src/lib/tax/cbdt";
import { sources } from "../src/lib/tax/registry";

async function main() {
  // Read-only probe: no database, credentials, publication, or model calls.
  for (const source of sources) {
    try {
      const fetched = await fetchOfficial(source.url);
      if (source.kind === "LISTING")
        console.log(
          JSON.stringify({
            source: source.id,
            status: "ok",
            documents: (await discoverCbdt(source.url)).length,
            issueYearFrom: discoveryStartYear(),
          }),
        );
      else {
        const document = await extractDocument(
          fetched.bytes,
          fetched.contentType,
        );
        console.log(
          JSON.stringify({
            source: source.id,
            status: "ok",
            title: document.title,
            bytes: fetched.bytes.length,
            characters: document.text.length,
            chunks: document.chunks.length,
            sha256: contentHash(fetched.bytes),
          }),
        );
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          source: source.id,
          status: "blocked",
          reason: error instanceof Error ? error.message : "Fetch failed",
        }),
      );
    }
  }
}
void main();
