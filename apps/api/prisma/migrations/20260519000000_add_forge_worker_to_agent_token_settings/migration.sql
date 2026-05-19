-- Agrega configuración del Forge Worker (coder agent) al singleton
-- `AgentTokenSettings`. Reemplaza el approach de env vars (CLAUDE_MODEL,
-- CLAUDE_EFFORT) que requería redeploy del worker para cambiar.
--
-- forgeWorkerModel: ID del modelo Anthropic que el worker pasa a Claude
--   Code CLI via `--model`. Valores válidos (validados en DTO):
--     - 'claude-haiku-4-5-20251001'  ($1 in / $5 out  per 1M tokens)
--     - 'claude-sonnet-4-6'          ($3 in / $15 out per 1M tokens)
--     - 'claude-opus-4-7'            ($15 in / $75 out per 1M tokens)
--
-- forgeWorkerEffort: Nivel de extended thinking que el CLI activa
--   automáticamente al detectar Sonnet/Opus. Valores válidos:
--     - 'low'    — sin thinking
--     - 'medium' — thinking moderado
--     - 'high'   — thinking activado (DEFAULT, recomendado)
--     - 'xhigh'  — thinking generoso
--     - 'max'    — thinking máximo (solo en Opus 4.6+)
--   Para Haiku, cualquier valor != 'low' es no-op (Haiku no soporta
--   extended thinking nativo).
--
-- Cuando el worker hace claim-story, el backend incluye estos valores en
-- la respuesta (ver ClaimedStory.forgeWorkerModel/Effort). El worker los
-- usa con prioridad sobre las env vars (que quedan como fallback legacy).

ALTER TABLE "agent_token_settings"
  ADD COLUMN "forgeWorkerModel" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "forgeWorkerEffort" TEXT NOT NULL DEFAULT 'high';
