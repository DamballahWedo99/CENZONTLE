-- AlterTable
ALTER TABLE "integration_configs"
  ADD COLUMN "apiKeyMasked" TEXT,
  ADD COLUMN "lastModifiedBy" TEXT;
