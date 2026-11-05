-- CreateTable
CREATE TABLE "TaxSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "TaxSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "latestVersionId" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "original" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "documentType" TEXT,
    "legalStatus" TEXT,
    "publishedAt" TIMESTAMP(3),
    "period" TEXT,
    "jurisdiction" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "TaxVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxChunk" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TaxChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRelease" (
    "sequence" SERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "versionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "releaseId" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxSource_url_key" ON "TaxSource"("url");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_url_key" ON "TaxDocument"("url");

-- CreateIndex
CREATE UNIQUE INDEX "TaxVersion_documentId_hash_key" ON "TaxVersion"("documentId", "hash");

-- CreateIndex
CREATE INDEX "TaxChunk_versionId_idx" ON "TaxChunk"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRelease_sequence_key" ON "KnowledgeRelease"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionJob_dedupeKey_key" ON "IngestionJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "IngestionJob_status_availableAt_idx" ON "IngestionJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "TaxConversation_userId_idx" ON "TaxConversation"("userId");

-- CreateIndex
CREATE INDEX "TaxMessage_conversationId_createdAt_idx" ON "TaxMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TaxSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxVersion" ADD CONSTRAINT "TaxVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TaxDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxChunk" ADD CONSTRAINT "TaxChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TaxVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TaxSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxConversation" ADD CONSTRAINT "TaxConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxMessage" ADD CONSTRAINT "TaxMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "TaxConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TaxChunk_search_idx" ON "TaxChunk" USING GIN (to_tsvector('english', text));
CREATE UNIQUE INDEX "IngestionJob_active_source" ON "IngestionJob" ("sourceId") WHERE status = 'RUNNING';
