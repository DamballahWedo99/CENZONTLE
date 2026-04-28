-- CreateTable
CREATE TABLE "story_technical_dependencies" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "vendor" TEXT,
    "requiresCredential" BOOLEAN NOT NULL DEFAULT false,
    "linkedSecretId" TEXT,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "targetExternalName" TEXT,
    "targetEpicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'identified',
    "owner" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3),
    "resolutionNotes" TEXT NOT NULL DEFAULT '',
    "mdContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_technical_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_technical_dependencies_storyId_idx" ON "story_technical_dependencies"("storyId");

-- CreateIndex
CREATE INDEX "story_technical_dependencies_category_idx" ON "story_technical_dependencies"("category");

-- AddForeignKey
ALTER TABLE "story_technical_dependencies" ADD CONSTRAINT "story_technical_dependencies_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
