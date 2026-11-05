import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";
import { MAX_BYTES, officialUrl } from "./registry";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only global IPv6 unicast; IPv4-mapped and local/reserved addresses are rejected.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !address.toLowerCase().startsWith("2001:db8:")
  );
}

// DNS is validated inside the connector actually establishing the socket, avoiding
// the check-then-fetch DNS rebinding gap. Every redirect is validated separately.
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true })
        .then((records) => {
          const safe = records.filter((r) => isPublicAddress(r.address));
          if (!safe.length || safe.length !== records.length)
            return callback(
              new Error("Non-public DNS address rejected."),
              "",
              4,
            );
          if (options.all) callback(null, safe);
          else callback(null, safe[0].address, safe[0].family);
        })
        .catch((error) => callback(error, "", 4));
    },
  },
});

type JsonRequest = { csrf: string; body?: unknown };

export async function fetchOfficial(input: string) {
  return fetchResource(input);
}

// Only the public listing APIs used by the CBDT website may receive a guest token.
export async function fetchCbdtJson(
  input: string,
  request: JsonRequest,
): Promise<unknown> {
  const url = officialUrl(input);
  if (
    url.origin !== "https://www.incometaxindia.gov.in" ||
    !(
      /^\/o\/search\/v1\.0\/search$/.test(url.pathname) ||
      /^\/o\/headless-admin-taxonomy\/v1\.0\/(sites\/20117\/taxonomy-vocabularies|taxonomy-vocabularies\/\d+\/taxonomy-categories)$/.test(
        url.pathname,
      )
    )
  )
    throw new Error("Unsupported CBDT listing endpoint.");
  const response = await fetchResource(url.href, request);
  try {
    return JSON.parse(response.bytes.toString("utf8"));
  } catch {
    throw new Error("CBDT listing returned malformed JSON.");
  }
}

async function fetchResource(input: string, json?: JsonRequest) {
  let url = officialUrl(input);
  const signal = AbortSignal.timeout(json ? 60000 : 25000);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, {
      dispatcher,
      signal,
      redirect: "manual",
      method: json?.body ? "POST" : "GET",
      body: json?.body ? JSON.stringify(json.body) : undefined,
      headers: {
        "User-Agent": "AllAboutTaxResearch/0.1",
        Accept: json ? "application/json" : "text/html,application/pdf",
        ...(json
          ? {
              "Content-Type": "application/json",
              "Accept-Language": "en-US",
              "x-csrf-token": json.csrf,
            }
          : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (json) throw new Error("CBDT listing API redirected unexpectedly.");
      if (!location) throw new Error("Redirect missing location.");
      url = officialUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Official source returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (
      !(json ? /application\/json/i : /text\/html|application\/pdf/i).test(
        contentType,
      )
    ) {
      await response.body?.cancel();
      throw new Error("Unsupported source content type.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source returned no body.");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Source exceeds 8 MB limit.");
        parts.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return { bytes: Buffer.concat(parts), contentType, url: url.href };
  }
  throw new Error("Too many source redirects.");
}
