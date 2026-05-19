-- Agrega `plannerPlan` y `plannerUsage` al modelo AgentRun — observabilidad
-- del pseudo-advisor pre-CLI introducido en 2026-05-18.
--
-- plannerPlan: texto completo del plan generado por ForgePlannerService
--   (Sonnet 4.6 + Opus 4.7 advisor). NULL cuando:
--     - El planner falló (API down, rate limit, timeout, sin API key)
--     - El planner emitió 0 text blocks
--     - Pre-deploy del planner: agentRuns viejos no tienen plan
--   Persistido para forensics: si una story falla, el operador puede leer
--   el plan que recibió el coder y diagnosticar si el plan estaba mal,
--   si el coder lo ignoró, o si la falla es por otra razón.
--
-- plannerUsage: breakdown del costo/tokens del planner por run. Shape:
--   {
--     executorTokensIn: number,
--     executorTokensOut: number,
--     advisorTokensIn: number,
--     advisorTokensOut: number,
--     advisorCalls: number,
--     executorCostUsd: number,
--     advisorCostUsd: number,
--     totalCostUsd: number,
--     elapsedMs: number
--   }
--   El frontend lo agrega a `totalCostUsd` del batch para que el dashboard
--   refleje el cost real (planner + generator + verifier). Sin esto el
--   dashboard subreportaría ~$0.12 por story.

ALTER TABLE "agent_runs" ADD COLUMN "plannerPlan" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "plannerUsage" JSONB;
