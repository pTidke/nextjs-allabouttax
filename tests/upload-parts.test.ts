import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { parseRange } from "../src/lib/http";

const database = new PGlite();
const db = new PrismaClient({ adapter: new PrismaPGlite(database) });
let upload: typeof import("../src/lib/tax/upload");
let workflow: typeof import("../src/lib/review/workflow");
let reviewer: string;
before(async () => {
  for (const name of (await readdir("prisma/migrations")).sort())
    if (!name.endsWith(".toml"))
      await database.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  upload = await import("../src/lib/tax/upload");
  workflow = await import("../src/lib/review/workflow");
  reviewer = (await db.user.create({ data: { email: "r@example.test" } })).id;
  await db.reviewerGrant.create({
    data: { userId: reviewer, role: "EXTRACTION", grantedBy: reviewer },
  });
});
after(async () => {
  await db.$disconnect();
  await database.close();
});

// A "PDF" of 7 MB: three parts of 3, 3 and 1 MB. It has no text layer, so it
// arrives as a scan waiting for OCR.
const file = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  randomBytes(7 * 1024 * 1024 - 9),
]);
const sha256 = createHash("sha256").update(file).digest("hex");
const details = {
  title: "A long scanned circular",
  officialUrl: "https://www.incometaxindia.gov.in/circular-big.pdf",
};
const part = (i: number) =>
  file.subarray(i * upload.PART_BYTES, (i + 1) * upload.PART_BYTES);

let versionId: string;
test("a PDF larger than one request arrives in parts, checked by size and SHA-256", async () => {
  const outsider = (await db.user.create({ data: { email: "o@example.test" } }))
    .id;
  await assert.rejects(
    upload.startUpload(outsider, { ...details, size: file.length, sha256 }),
    { status: 403 },
  );
  await assert.rejects(
    upload.startUpload(reviewer, {
      ...details,
      size: 33 * 1024 * 1024,
      sha256,
    }),
    { status: 413 },
  );
  await assert.rejects(
    upload.startUpload(reviewer, {
      ...details,
      size: file.length,
      sha256: "x",
    }),
    { status: 400 },
  );
  const started = await upload.startUpload(reviewer, {
    ...details,
    size: file.length,
    sha256,
  });
  assert.equal(started.parts, 3);
  const id = started.uploadId;
  // Only its owner can add to it; parts must have their exact size.
  await assert.rejects(upload.putUploadPart(outsider, id, 0, part(0)), {
    status: 403,
  });
  await assert.rejects(upload.putUploadPart(reviewer, id, 3, part(2)), {
    status: 400,
  });
  await assert.rejects(upload.putUploadPart(reviewer, id, 0, part(2)), {
    status: 400,
  });
  await upload.putUploadPart(reviewer, id, 2, part(2));
  await upload.putUploadPart(reviewer, id, 0, part(0));
  await assert.rejects(upload.completeUpload(reviewer, id), { status: 409 });
  // A part sent again replaces the earlier copy.
  await upload.putUploadPart(reviewer, id, 1, part(0));
  await upload.putUploadPart(reviewer, id, 1, part(1));
  const done = await upload.completeUpload(reviewer, id);
  assert.equal(done.needsOcr, true);
  versionId = done.versionId;
  const stored = await db.taxVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  assert.equal(Buffer.compare(Buffer.from(stored.original), file), 0);
  assert.equal(await db.pendingUpload.count(), 0, "the parts are removed");
  assert.equal(await db.uploadPart.count(), 0);
});

test("a damaged upload is refused and cleared", async () => {
  const other = { ...details, officialUrl: "https://egazette.gov.in/x.pdf" };
  const small = Buffer.from("%PDF-1.4\n% small\n%%EOF");
  const started = await upload.startUpload(reviewer, {
    ...other,
    size: small.length,
    sha256: "0".repeat(64),
  });
  await upload.putUploadPart(reviewer, started.uploadId, 0, small);
  await assert.rejects(upload.completeUpload(reviewer, started.uploadId), {
    status: 400,
    message: /checksum/,
  });
  assert.equal(await db.pendingUpload.count(), 0);
  // The address of a document already in the library is refused at the start.
  await assert.rejects(
    upload.startUpload(reviewer, { ...details, size: 10, sha256 }),
    { status: 409 },
  );
});

test("originals are read in slices and served in ranges", async () => {
  assert.deepEqual(await workflow.originalInfo(reviewer, versionId), {
    size: file.length,
    contentType: "application/pdf",
  });
  const slice = await workflow.originalSlice(versionId, 3_000_000, 1000);
  assert.equal(
    Buffer.compare(Buffer.from(slice), file.subarray(3_000_000, 3_001_000)),
    0,
  );
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=0-1,5-6", 100), null, "one range only");
});
