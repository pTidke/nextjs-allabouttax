ALTER TABLE "TaxDocument" ADD COLUMN "lastError" TEXT, ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "IngestionJob" ADD COLUMN "documentUrl" TEXT, ADD COLUMN "documentTitle" TEXT, ADD COLUMN "issuedAt" TIMESTAMP(3), ADD COLUMN "result" TEXT;
CREATE TABLE "TaxWorkerState" ("id" TEXT NOT NULL PRIMARY KEY, "heartbeatAt" TIMESTAMP(3) NOT NULL, "mode" TEXT NOT NULL);
