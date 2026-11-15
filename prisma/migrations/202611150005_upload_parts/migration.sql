-- Additive only: two new tables for PDFs uploaded in parts. No existing data changes.
-- A part holds at most 4 MB, because Vercel rejects larger request bodies; the
-- parts are joined, checked and removed when the upload completes.
-- CreateTable
CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "officialUrl" TEXT NOT NULL,
    "issuedAt" TEXT,
    "size" INTEGER NOT NULL,
    "parts" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadPart" (
    "uploadId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "UploadPart_pkey" PRIMARY KEY ("uploadId","index")
);

-- CreateIndex
CREATE INDEX "PendingUpload_createdAt_idx" ON "PendingUpload"("createdAt");

-- AddForeignKey
ALTER TABLE "UploadPart" ADD CONSTRAINT "UploadPart_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PendingUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
