-- Preserve existing approvals as exact single-period reviews.
ALTER TABLE "TaxVersion"
  ADD COLUMN "periodMode" TEXT NOT NULL DEFAULT 'SINGLE_PERIOD',
  ADD COLUMN "applicabilityNote" TEXT,
  ADD COLUMN "entityName" TEXT,
  ADD COLUMN "investmentFrom" TIMESTAMP(3),
  ADD COLUMN "investmentThrough" TIMESTAMP(3);
ALTER TABLE "TaxVersion" ADD CONSTRAINT "TaxVersion_periodMode_check"
  CHECK ("periodMode" IN ('SINGLE_PERIOD', 'MULTI_PERIOD'));
