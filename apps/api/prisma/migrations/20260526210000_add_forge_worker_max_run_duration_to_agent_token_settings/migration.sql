-- Agrega `forgeWorkerMaxRunDurationMs` a la tabla AgentTokenSettings.
--
-- Default: 1800000ms (30 min) — mismo valor del MAX_RUN_DURATION_MS
-- previo en runner.ts:145. La columna reemplaza la constante hardcoded;
-- a partir de esta migration el worker lee el timeout del backend.
--
-- Para stories grandes (muchos componentes UI, suites de tests), subir
-- desde /factory/settings → tab "Factory" hasta 7200000ms (2h).

ALTER TABLE "agent_token_settings"
  ADD COLUMN "forgeWorkerMaxRunDurationMs" INTEGER NOT NULL DEFAULT 1800000;
