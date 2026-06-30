-- Pipeline de QA automático multi-agente. Inserta la etapa QA TESTING entre
-- STAGED y RELEASED del Pipeline Board. Un sweep cron arranca una campaña QA
-- al mergear un batch a DEV; el orquestador fan-outea lentes en paralelo,
-- verifica adversarialmente los fallos, sintetiza un QAReport y lo presenta
-- en un release gate humano.

-- === Enums ===
CREATE TYPE "QaRunStatus" AS ENUM ('pending', 'running', 'synthesizing', 'completed', 'failed', 'superseded');
CREATE TYPE "QaLensKind" AS ENUM ('test_suite', 'e2e', 'security_diff', 'perf_a11y');
CREATE TYPE "QaLensStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'abandoned');
CREATE TYPE "QaVerdict" AS ENUM ('rollout', 'rollback');

-- === Campos de etapa QA/Release en epics (escalares/terminales, espejo de staging) ===
ALTER TABLE "epics"
  ADD COLUMN "qaStartedAt"           TIMESTAMP(3),
  ADD COLUMN "qaCompletedAt"         TIMESTAMP(3),
  ADD COLUMN "releaseApprovedAt"     TIMESTAMP(3),
  ADD COLUMN "releaseApprovedBy"     TEXT,
  ADD COLUMN "releaseApprovedByName" TEXT;

-- === qa_runs ===
CREATE TABLE "qa_runs" (
  "id"                  TEXT NOT NULL,
  "epicId"              TEXT NOT NULL,
  "enqueuedBatchId"     TEXT NOT NULL,
  "status"              "QaRunStatus" NOT NULL DEFAULT 'pending',
  "trigger"             TEXT NOT NULL DEFAULT 'sweep',
  "triggeredBy"         TEXT,
  "stagingSha"          TEXT,
  "qaReport"            JSONB,
  "recommendation"      "QaVerdict",
  "confidence"          INTEGER,
  "autoRollbackAdvised" BOOLEAN NOT NULL DEFAULT false,
  "startedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"         TIMESTAMP(3),
  CONSTRAINT "qa_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qa_runs_epicId_status_idx" ON "qa_runs" ("epicId", "status");
CREATE INDEX "qa_runs_status_startedAt_idx" ON "qa_runs" ("status", "startedAt");
ALTER TABLE "qa_runs"
  ADD CONSTRAINT "qa_runs_epicId_fkey"
  FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique: una sola campaña no-terminal por épica a la vez. Prisma no
-- expresa partial indexes en schema syntax — se crea aquí en SQL raw (mismo
-- patrón que agent_runs_story_active_unique). Evita que el sweep cron y el
-- trigger manual dupliquen una campaña para el mismo batch. Si se hace
-- `prisma db push` y este índice desaparece, re-ejecutar este CREATE.
CREATE UNIQUE INDEX "qa_runs_epic_active_unique"
  ON "qa_runs" ("epicId")
  WHERE "status" IN ('pending', 'running', 'synthesizing');

-- === qa_lens_runs ===
CREATE TABLE "qa_lens_runs" (
  "id"               TEXT NOT NULL,
  "qaRunId"          TEXT NOT NULL,
  "nodeId"           TEXT,
  "lens"             "QaLensKind" NOT NULL,
  "status"           "QaLensStatus" NOT NULL DEFAULT 'pending',
  "lastProgressAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "branch"           TEXT NOT NULL DEFAULT '',
  "envUrl"           TEXT,
  "rawResults"       JSONB,
  "reportedFindings" JSONB DEFAULT '[]',
  "lensUsage"        JSONB,
  "exitCode"         INTEGER,
  "errorMessage"     TEXT,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  CONSTRAINT "qa_lens_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qa_lens_runs_qaRunId_status_idx" ON "qa_lens_runs" ("qaRunId", "status");
CREATE INDEX "qa_lens_runs_status_lastProgressAt_idx" ON "qa_lens_runs" ("status", "lastProgressAt");
ALTER TABLE "qa_lens_runs"
  ADD CONSTRAINT "qa_lens_runs_qaRunId_fkey"
  FOREIGN KEY ("qaRunId") REFERENCES "qa_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique: un solo lente activo por (qaRunId, lens).
CREATE UNIQUE INDEX "qa_lens_runs_active_unique"
  ON "qa_lens_runs" ("qaRunId", "lens")
  WHERE "status" IN ('pending', 'running');

-- === qa_finding_verifications ===
CREATE TABLE "qa_finding_verifications" (
  "id"          TEXT NOT NULL,
  "qaLensRunId" TEXT NOT NULL,
  "findingId"   TEXT NOT NULL,
  "refuterIndex" INTEGER NOT NULL,
  "model"       TEXT NOT NULL,
  "vote"        TEXT NOT NULL,
  "reasoning"   TEXT NOT NULL DEFAULT '',
  "usage"       JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qa_finding_verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qa_finding_verifications_qaLensRunId_findingId_idx" ON "qa_finding_verifications" ("qaLensRunId", "findingId");
ALTER TABLE "qa_finding_verifications"
  ADD CONSTRAINT "qa_finding_verifications_qaLensRunId_fkey"
  FOREIGN KEY ("qaLensRunId") REFERENCES "qa_lens_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
