import { prisma } from "../db";
import { HttpError } from "../http";
import { contentHash, extractDocument } from "./documents";

// Reviewers can add an official PDF by hand, for documents the listings do not
// cover. The file itself is what gets indexed; the official URL is what the
// chatbot cites. Uploaded copies are fixed snapshots: the worker never re-fetches
// them and the 48-hour freshness rule does not apply to them.
export const UPLOAD_SOURCE = {
  id: "uploads",
  name: "Uploaded by reviewers",
  // Never fetched. A placeholder, because every source needs a unique URL.
  url: "https://www.allabouttax.in/review/upload",
  kind: "UPLOAD",
} as const;
// Vercel rejects request bodies above about 4.5 MB.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function officialCitationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, "Enter the document's official web address.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !(host.endsWith(".gov.in") || host.endsWith(".nic.in"))
  )
    throw new HttpError(
      400,
      "The official address must be an https link on a .gov.in or .nic.in site.",
    );
  url.hash = "";
  return url.href;
}

export async function uploadDocument(input: {
  bytes: Uint8Array;
  title: string;
  officialUrl: string;
  issuedAt?: string;
}) {
  const title = input.title.trim();
  if (!title || title.length > 500)
    throw new HttpError(
      400,
      "Give the document a title of up to 500 characters.",
    );
  const url = officialCitationUrl(input.officialUrl);
  const bytes = Buffer.from(input.bytes);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, "Upload a PDF of up to 4 MB.");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new HttpError(415, "That file is not a PDF.");
  let issuedAt: Date | null = null;
  if (input.issuedAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedAt))
      throw new HttpError(400, "Enter the issue date as a date.");
    issuedAt = new Date(input.issuedAt);
  }
  // A scanned PDF has no text layer. Keep it, so it is ready for OCR, but it has
  // no passages and cannot pass the text check yet.
  let text = "";
  let chunks: { anchor: string; text: string }[] = [];
  let lastError: string | null = null;
  try {
    const extracted = await extractDocument(bytes, "application/pdf");
    text = extracted.text;
    chunks = extracted.chunks;
  } catch {
    lastError =
      "No usable text layer, so it needs OCR. It stays in the queue until the extraction engine reads it.";
  }
  const hash = contentHash(bytes);
  return prisma.$transaction(
    async (tx) => {
      // The same lock as the worker, so the storage budget cannot be raced.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74329018)::text`;
      if (await tx.taxDocument.findUnique({ where: { url } }))
        throw new HttpError(
          409,
          "That official address is already in the library. Review it from the queue.",
        );
      const maxBytes = Number(process.env.TAX_MAX_ORIGINAL_BYTES || 134217728);
      const [usage] = await tx.$queryRaw<
        { bytes: bigint }[]
      >`SELECT COALESCE(sum(octet_length(original)), 0)::bigint AS bytes FROM "TaxVersion"`;
      if (Number(usage.bytes) + bytes.length > maxBytes)
        throw new HttpError(
          507,
          "The document storage budget is full. Ask the administrator to free space or raise the limit.",
        );
      await tx.taxSource.upsert({
        where: { id: UPLOAD_SOURCE.id },
        create: UPLOAD_SOURCE,
        update: {},
      });
      const document = await tx.taxDocument.create({
        data: {
          sourceId: UPLOAD_SOURCE.id,
          url,
          title,
          issuedAt,
          verifiedAt: new Date(),
          lastError,
        },
      });
      const version = await tx.taxVersion.create({
        data: {
          documentId: document.id,
          hash,
          originalHash: hash,
          original: bytes,
          contentType: "application/pdf",
          text,
          chunks: { create: chunks },
        },
        select: { id: true },
      });
      await tx.taxDocument.update({
        where: { id: document.id },
        data: { latestVersionId: version.id },
      });
      return {
        versionId: version.id,
        passages: chunks.length,
        needsOcr: !!lastError,
      };
    },
    { timeout: 20000 },
  );
}
