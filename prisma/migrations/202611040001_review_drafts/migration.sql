CREATE TABLE "TaxReviewDraft" (
  "versionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxReviewDraft_pkey" PRIMARY KEY ("versionId", "userId"),
  CONSTRAINT "TaxReviewDraft_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaxReviewDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
