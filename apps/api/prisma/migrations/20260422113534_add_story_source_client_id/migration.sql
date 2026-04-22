-- AlterTable
ALTER TABLE "stories" ADD COLUMN "sourceClientId" TEXT;

-- CreateIndex
CREATE INDEX "stories_sourceClientId_idx" ON "stories"("sourceClientId");
