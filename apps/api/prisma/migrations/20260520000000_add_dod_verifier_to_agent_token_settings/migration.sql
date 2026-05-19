-- Agrega configuración del DoD Verifier (reviewer agent) al singleton
-- AgentTokenSettings. Reemplaza el approach de env vars (DOD_VERIFIER_MODEL,
-- DOD_VERIFIER_EFFORT) que requería redeploy del worker para cambiar.
--
-- dodVerifierModel: ID del modelo Anthropic que usa el verifier (Layer 3
--   semantic check). Default Haiku 4.5 — barato para verificaciones binarias
--   passed/failed. Subir a Sonnet 4.6 cuando se requiera detectar bypass
--   sycophantic del coder generator. Opus 4.7 es overkill para verifier
--   pero útil en debugging puntual.
--
-- dodVerifierEffort: Nivel de razonamiento del verifier. Default 'low' —
--   el verifier hace checks atómicos ("¿existe el archivo X?", "¿el código
--   contiene endpoint POST /Y?"), no razonamiento complejo. 'low' reduce
--   ~40% latency vs 'medium' sin sacrificar accuracy. 'high' solo si se
--   observan false-positives por análisis superficial.

ALTER TABLE "agent_token_settings"
  ADD COLUMN "dodVerifierModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  ADD COLUMN "dodVerifierEffort" TEXT NOT NULL DEFAULT 'low';
