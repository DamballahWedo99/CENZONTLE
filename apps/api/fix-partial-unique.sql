-- ═════════════════════════════════════════════════════════════════════
-- FIX: agent_runs unique constraint debe ser PARTIAL (solo activos)
-- ═════════════════════════════════════════════════════════════════════
-- Problema: el constraint actual `@@unique([storyId, status])` aplica a
-- TODOS los estados, incluyendo terminales (completed/failed/abandoned).
-- Eso causa que el sweeper falle cuando intenta marcar un run como
-- 'abandoned' si la story ya tiene OTRO run histórico abandoned.
--
-- Diseño correcto: el constraint debe garantizar atomicidad solo en los
-- estados ACTIVOS — solo puede haber UN run claimed|running por story
-- a la vez. Múltiples runs históricos terminales son válidos (representan
-- intentos previos: failed → retry → completed, etc.).
--
-- Solución: drop el constraint actual + crear partial unique index que
-- solo aplica a claimed|running. Postgres lo soporta nativo; Prisma no
-- lo expresa en schema (limitación conocida) — lo manejamos como
-- migration manual.
-- ═════════════════════════════════════════════════════════════════════

-- 1. Drop constraint actual
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_story_active_unique;
DROP INDEX IF EXISTS agent_runs_story_active_unique;

-- 2. Partial unique index — solo claimed|running
-- Garantiza que NO puede haber 2 runs activos para la misma story,
-- pero permite N runs terminales históricos.
CREATE UNIQUE INDEX agent_runs_story_active_unique
  ON agent_runs ("storyId", status)
  WHERE status IN ('claimed', 'running');
