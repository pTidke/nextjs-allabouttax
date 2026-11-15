-- Additive only: one new table. No existing data changes.
-- CreateTable
CREATE TABLE "LineReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "text" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineReview_runId_lineId_createdAt_idx" ON "LineReview"("runId", "lineId", "createdAt");

-- AddForeignKey
ALTER TABLE "LineReview" ADD CONSTRAINT "LineReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineReview" ADD CONSTRAINT "LineReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "LineReview" ADD CONSTRAINT "LineReview_decision_check" CHECK ("decision" IN ('CONFIRMED', 'CORRECTED', 'UNREADABLE'));
ALTER TABLE "LineReview" ADD CONSTRAINT "LineReview_text_check" CHECK (("decision" = 'CORRECTED') = ("text" IS NOT NULL));
