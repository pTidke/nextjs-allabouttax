import { createHash } from "node:crypto";
import { prisma } from "../db";
import { HttpError } from "../http";
import { requireReviewer } from "../review/roles";
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
// Vercel rejects request bodies above about 4.5 MB, so the browser sends a PDF in
// parts of 3 MB and the server joins them (see startUpload below).
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const PART_BYTES = 3 * 1024 * 1024;
const UPLOAD_TOO_LARGE = "Upload a PDF of up to 32 MB.";

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

const STORAGE_FULL =
  "The document storage budget is full. Ask the administrator to free space or raise the limit.";
const maxOriginalBytes = () =>
  Number(process.env.TAX_MAX_ORIGINAL_BYTES || 134217728);
async function storedOriginalBytes(db: Pick<typeof prisma, "$queryRaw">) {
  const [usage] = await db.$queryRaw<
    { bytes: bigint }[]
  >`SELECT COALESCE(sum(octet_length(original)), 0)::bigint AS bytes FROM "TaxVersion"`;
  return Number(usage.bytes);
}

type Details = { title: string; officialUrl: string; issuedAt?: string };

function checkedDetails(input: Details) {
  const title = input.title.trim();
  if (!title || title.length > 500)
    throw new HttpError(
      400,
      "Give the document a title of up to 500 characters.",
    );
  const url = officialCitationUrl(input.officialUrl);
  let issuedAt: Date | null = null;
  if (input.issuedAt) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.issuedAt) ||
      Number.isNaN(Date.parse(input.issuedAt))
    )
      throw new HttpError(400, "Enter the issue date as a date.");
    issuedAt = new Date(input.issuedAt);
  }
  return { title, url, issuedAt };
}

export async function uploadDocument(input: Details & { bytes: Uint8Array }) {
  const { title, url, issuedAt } = checkedDetails(input);
  const bytes = Buffer.from(input.bytes);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, UPLOAD_TOO_LARGE);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new HttpError(415, "That file is not a PDF.");
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
      if ((await storedOriginalBytes(tx)) + bytes.length > maxOriginalBytes())
        throw new HttpError(507, STORAGE_FULL);
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
    { timeout: 60000 },
  );
}

// ---- Uploading in parts ------------------------------------------------------
//
// 1. startUpload checks the details and reserves an upload for the declared size
//    and SHA-256. 2. The browser sends each part of PART_BYTES (the last one
//    shorter). 3. completeUpload joins the parts, checks size, hash and that it is
//    a PDF, adds it to the library like any upload, and removes the parts.

const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_OPEN_UPLOADS = 3;

export async function requireUploader(userId: string) {
  const access = await requireReviewer(userId);
  if (!access.admin && !access.extraction)
    throw new HttpError(
      403,
      "Text review or administrator access is required.",
    );
}

export async function startUpload(
  userId: string,
  input: Details & { size: unknown; sha256: unknown },
) {
  await requireUploader(userId);
  const { title, url } = checkedDetails(input);
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES)
    throw new HttpError(413, UPLOAD_TOO_LARGE);
  const sha256 = String(input.sha256 ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new HttpError(400, "The file's checksum is missing.");
  // Unfinished uploads are cleared after a day.
  await prisma.pendingUpload.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - UPLOAD_LIFETIME_MS) } },
  });
  if (
    (await prisma.pendingUpload.count({ where: { userId } })) >=
    MAX_OPEN_UPLOADS
  )
    throw new HttpError(
      429,
      "You have three unfinished uploads. Wait for one to finish, or try again tomorrow.",
    );
  if (await prisma.taxDocument.findUnique({ where: { url } }))
    throw new HttpError(
      409,
      "That official address is already in the library. Review it from the queue.",
    );
  // Checked again, under the lock, when the upload completes.
  if ((await storedOriginalBytes(prisma)) + size > maxOriginalBytes())
    throw new HttpError(507, STORAGE_FULL);
  const parts = Math.ceil(size / PART_BYTES);
  const upload = await prisma.pendingUpload.create({
    data: {
      userId,
      title,
      officialUrl: url,
      issuedAt: input.issuedAt || null,
      size,
      parts,
      sha256,
    },
    select: { id: true },
  });
  return { uploadId: upload.id, parts, partBytes: PART_BYTES };
}

async function ownUpload(userId: string, uploadId: string) {
  await requireUploader(userId);
  const upload = await prisma.pendingUpload.findUnique({
    where: { id: uploadId },
  });
  if (
    !upload ||
    upload.userId !== userId ||
    upload.createdAt.getTime() < Date.now() - UPLOAD_LIFETIME_MS
  )
    throw new HttpError(404, "That upload has expired. Start it again.");
  return upload;
}

export function partSize(size: number, index: number) {
  const parts = Math.ceil(size / PART_BYTES);
  return index === parts - 1 ? size - PART_BYTES * (parts - 1) : PART_BYTES;
}

export async function putUploadPart(
  userId: string,
  uploadId: string,
  index: number,
  data: Uint8Array,
) {
  const upload = await ownUpload(userId, uploadId);
  if (!Number.isSafeInteger(index) || index < 0 || index >= upload.parts)
    throw new HttpError(400, "That part is not part of this upload.");
  if (data.length !== partSize(upload.size, index))
    throw new HttpError(400, "That part has the wrong size. Start again.");
  const bytes = Buffer.from(data);
  await prisma.uploadPart.upsert({
    where: { uploadId_index: { uploadId, index } },
    create: { uploadId, index, data: bytes },
    update: { data: bytes },
  });
  return { index };
}

export async function completeUpload(userId: string, uploadId: string) {
  const upload = await ownUpload(userId, uploadId);
  const parts = await prisma.uploadPart.findMany({
    where: { uploadId },
    orderBy: { index: "asc" },
  });
  if (
    parts.length !== upload.parts ||
    parts.some((part, i) => part.index !== i)
  )
    throw new HttpError(409, "Some parts of the file have not arrived yet.");
  const bytes = Buffer.concat(parts.map((part) => Buffer.from(part.data)));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== upload.size || hash !== upload.sha256) {
    await prisma.pendingUpload.delete({ where: { id: uploadId } });
    throw new HttpError(
      400,
      "The file arrived damaged (its checksum does not match). Upload it again.",
    );
  }
  try {
    return await uploadDocument({
      bytes,
      title: upload.title,
      officialUrl: upload.officialUrl,
      issuedAt: upload.issuedAt ?? undefined,
    });
  } finally {
    // Done or refused: either way the parts are no longer needed.
    await prisma.pendingUpload.deleteMany({ where: { id: uploadId } });
  }
}
