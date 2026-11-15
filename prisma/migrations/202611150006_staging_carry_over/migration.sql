-- Additive only: one new table. No existing data changes.
-- One row per staging candidate carried into the live review records (R3), and
-- per engine run its line decisions were written against; '' when the engine had
-- not read the document yet, so only the history was kept.
-- CreateTable
CREATE TABLE "StagingCarryOver" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "headAction" TEXT,
    "history" JSONB NOT NULL,
    "lineDecisions" INTEGER NOT NULL DEFAULT 0,
    "textAccepted" BOOLEAN NOT NULL DEFAULT false,
    "taxDrafts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagingCarryOver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StagingCarryOver_candidateId_runId_key" ON "StagingCarryOver"("candidateId", "runId");

-- CreateIndex
CREATE INDEX "StagingCarryOver_versionId_idx" ON "StagingCarryOver"("versionId");

-- AddForeignKey
ALTER TABLE "StagingCarryOver" ADD CONSTRAINT "StagingCarryOver_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
