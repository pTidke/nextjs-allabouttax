-- Additive only: one nullable column and two new tables. No existing data changes.
-- AlterTable
ALTER TABLE "TaxMessage" ADD COLUMN     "outcome" TEXT;

-- CreateTable
CREATE TABLE "TaxContentGap" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "releaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxContentGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxContentGap_messageId_key" ON "TaxContentGap"("messageId");

-- CreateIndex
CREATE INDEX "TaxContentGap_createdAt_idx" ON "TaxContentGap"("createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_email_createdAt_idx" ON "ContactMessage"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "TaxContentGap" ADD CONSTRAINT "TaxContentGap_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TaxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

