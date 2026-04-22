-- CreateTable
CREATE TABLE "story_dependencies" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "blockedById" TEXT NOT NULL,
    "hardness" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_dependencies_storyId_blockedById_key" ON "story_dependencies"("storyId", "blockedById");

-- CreateIndex
CREATE INDEX "story_dependencies_storyId_idx" ON "story_dependencies"("storyId");

-- CreateIndex
CREATE INDEX "story_dependencies_blockedById_idx" ON "story_dependencies"("blockedById");

-- AddForeignKey
ALTER TABLE "story_dependencies" ADD CONSTRAINT "story_dependencies_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_dependencies" ADD CONSTRAINT "story_dependencies_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
