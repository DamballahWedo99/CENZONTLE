-- Tier 1 Harness — DoD enforcement loop. Agrega tracking de attempts y
-- log estructurado del veredicto por criterio en cada iteración del retry.
--
-- attempts: 1 = primer intento (default), 2+ = re-spawns por DoD failure.
--   Visible en UI para distinguir runs limpios vs que requirieron retry.
-- dodVerification: log estructurado de qué criterios pasaron/fallaron en
--   cada attempt. Frontend lo usa para timeline detallada del loop.

ALTER TABLE "agent_runs" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "agent_runs" ADD COLUMN "dodVerification" JSONB;
