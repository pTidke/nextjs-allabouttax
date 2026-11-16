-- Additive only: new nullable or defaulted columns and one index. No existing
-- data changes. Applied before the code that uses it: Prisma reads every column
-- it knows.
--
-- Chunks rebuilt from reviewed lines get a metadata section: the last page they
-- reach (a paragraph can run onto the next page), what kind of text they are
-- (text, proviso, explanation, table, heading), the provisions they name
-- ("section 10(23FE)", "rule 34", "Form 10-IG") and a context line, the heading
-- path and paragraph ("Annexure A › para 2"), which is searched with the text.

-- AlterTable
ALTER TABLE "TaxChunk" ADD COLUMN "pageEnd" INTEGER,
ADD COLUMN "kind" TEXT,
ADD COLUMN "provisions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "context" TEXT;

-- CreateIndex
CREATE INDEX "TaxChunk_context_search_idx" ON "TaxChunk" USING GIN (to_tsvector('english', coalesce("context", '') || ' ' || "text"));
