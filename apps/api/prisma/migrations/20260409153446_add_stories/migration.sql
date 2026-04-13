-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done', 'blocked');

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "StoryStatus" NOT NULL DEFAULT 'backlog',
    "storyPoints" INTEGER NOT NULL DEFAULT 0,
    "epicId" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "productOwnerId" TEXT,
    "sprintId" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tracker" JSONB,
    "vaultPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stories_epicId_idx" ON "stories"("epicId");

-- CreateIndex
CREATE INDEX "stories_podId_idx" ON "stories"("podId");

-- CreateIndex
CREATE INDEX "stories_sprintId_idx" ON "stories"("sprintId");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_podId_fkey" FOREIGN KEY ("podId") REFERENCES "pods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
