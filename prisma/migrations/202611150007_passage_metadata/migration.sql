-- Additive only: new nullable or defaulted columns. No existing data changes.
-- Passages get the page they come from, the headings they sit under and the
-- income years they name; versions get the document facts a tax reviewer
-- confirms (number, Gazette number, issuing authority, issue date).
-- Applied before the code that uses it: Prisma reads every column it knows.

-- AlterTable
ALTER TABLE "TaxChunk" ADD COLUMN "page" INTEGER,
ADD COLUMN "headings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "incomeYears" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TaxVersion" ADD COLUMN "documentNumber" TEXT,
ADD COLUMN "gazetteNumber" TEXT,
ADD COLUMN "issuingAuthority" TEXT,
ADD COLUMN "issuedOn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TaxChunk_incomeYears_idx" ON "TaxChunk" USING GIN ("incomeYears");
