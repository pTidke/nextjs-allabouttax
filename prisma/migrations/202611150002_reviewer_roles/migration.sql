-- Additive only: two new tables. No existing data changes.
-- CreateTable
CREATE TABLE "ReviewerGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewerGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerGrant_userId_role_key" ON "ReviewerGrant"("userId", "role");

-- CreateIndex
CREATE INDEX "ExtractionReview_versionId_createdAt_idx" ON "ExtractionReview"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewerGrant" ADD CONSTRAINT "ReviewerGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionReview" ADD CONSTRAINT "ExtractionReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Roles and decisions are limited to known values.
ALTER TABLE "ReviewerGrant" ADD CONSTRAINT "ReviewerGrant_role_check" CHECK ("role" IN ('EXTRACTION', 'TAX'));
ALTER TABLE "ExtractionReview" ADD CONSTRAINT "ExtractionReview_decision_check" CHECK ("decision" IN ('ACCEPTED', 'NEEDS_CHANGES'));
