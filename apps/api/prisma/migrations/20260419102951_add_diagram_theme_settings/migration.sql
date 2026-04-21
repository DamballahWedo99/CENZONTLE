-- CreateTable
CREATE TABLE "diagram_theme_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "groupColors" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "diagram_theme_settings_pkey" PRIMARY KEY ("id")
);
