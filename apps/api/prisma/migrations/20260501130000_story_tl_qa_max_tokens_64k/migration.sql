-- Sube el `max_tokens` de los agentes Story TL y Story QA de 44000 → 64000
-- (max nativo de Sonnet 4.6). Razón: ambos agentes alcanzaban
-- `stop_reason='max_tokens'` antes de poder emitir el `submit_*` terminal
-- tool, forzando retries que acumulaban hasta el hard-timeout de 30 min.
-- Observado: run con `events=1699 proposals=0` abortado por el circuit
-- breaker porque el QA nunca convergía dentro del cap.
--
-- Paritario al patrón usado en `20260429170000_diagram_max_tokens_64k`.
-- El `STORIES_HARD_TIMEOUT_MS` también se subió a 45 min en el mismo
-- batch de cambios para dar margen adicional.

-- 1. Cambia el default de las columnas para nuevos rows.
ALTER TABLE "agent_token_settings" ALTER COLUMN "storyTlMaxTokens" SET DEFAULT 64000;
ALTER TABLE "agent_token_settings" ALTER COLUMN "storyQaMaxTokens" SET DEFAULT 64000;

-- 2. Actualiza rows existentes SOLO si el user no los ha modificado del
--    default anterior. Si bajaron manualmente a otro valor (caso raro
--    pero posible vía UI de settings), respetamos su elección — no
--    asumimos que querían 64000.
UPDATE "agent_token_settings" SET "storyTlMaxTokens" = 64000 WHERE "storyTlMaxTokens" = 44000;
UPDATE "agent_token_settings" SET "storyQaMaxTokens" = 64000 WHERE "storyQaMaxTokens" = 44000;
