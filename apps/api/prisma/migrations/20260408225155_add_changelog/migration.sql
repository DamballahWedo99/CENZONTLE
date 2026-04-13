-- CreateTable
CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityTitle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedByName" TEXT,

    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "changelog_entries_entityType_entityId_idx" ON "changelog_entries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "changelog_entries_timestamp_idx" ON "changelog_entries"("timestamp");
