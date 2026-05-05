-- Migration: default effort 'high' -> 'medium' for ALL agent token settings.
--
-- Justificación (2026-05-04): el effort 'high' duplica los thinking tokens
-- del adaptive thinking de Sonnet 4.6 sin un beneficio proporcional en
-- calidad para la mayoría de los runs. 'medium' balancea costo y calidad —
-- y para los runs que sí necesiten razonamiento profundo, el advisor tool
-- (Opus 4.6) puede ser invocado a demanda.
--
-- Strategy:
--   1. UPDATE de registros existentes con 'high' -> 'medium'.
--   2. ALTER TABLE para cambiar el DEFAULT de cada columna 'effort'.
--   3. Si el operator quiere mantener 'high' en algún agente, puede
--      actualizarlo via /factory/settings UI tras este deploy.

-- Step 1: Update existing rows with effort='high' to 'medium'.
UPDATE "agent_token_settings"
SET "storyPoEffort"  = 'medium' WHERE "storyPoEffort"  = 'high';

UPDATE "agent_token_settings"
SET "storyTlEffort"  = 'medium' WHERE "storyTlEffort"  = 'high';

UPDATE "agent_token_settings"
SET "storyQaEffort"  = 'medium' WHERE "storyQaEffort"  = 'high';

UPDATE "agent_token_settings"
SET "epicEffort"     = 'medium' WHERE "epicEffort"     = 'high';

UPDATE "agent_token_settings"
SET "diagramEffort"  = 'medium' WHERE "diagramEffort"  = 'high';

-- Step 2: Change column DEFAULT to 'medium' for future inserts.
ALTER TABLE "agent_token_settings"
  ALTER COLUMN "storyPoEffort"  SET DEFAULT 'medium';

ALTER TABLE "agent_token_settings"
  ALTER COLUMN "storyTlEffort"  SET DEFAULT 'medium';

ALTER TABLE "agent_token_settings"
  ALTER COLUMN "storyQaEffort"  SET DEFAULT 'medium';

ALTER TABLE "agent_token_settings"
  ALTER COLUMN "epicEffort"     SET DEFAULT 'medium';

ALTER TABLE "agent_token_settings"
  ALTER COLUMN "diagramEffort"  SET DEFAULT 'medium';
