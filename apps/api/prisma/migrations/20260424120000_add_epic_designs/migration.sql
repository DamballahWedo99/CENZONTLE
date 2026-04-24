-- AlterTable
ALTER TABLE "epics" ADD COLUMN "designs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "epics" ADD COLUMN "designSkipped" BOOLEAN NOT NULL DEFAULT false;
