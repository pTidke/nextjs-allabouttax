-- Additive only: one new table. No existing data changes.
-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "policyVersion" TEXT,
    "configSha" TEXT,
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "document" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractionRun_versionId_createdAt_idx" ON "ExtractionRun"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_status_check" CHECK ("status" IN ('OK', 'FAILED'));
