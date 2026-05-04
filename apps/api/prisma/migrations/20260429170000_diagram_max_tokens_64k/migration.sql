-- Sube el `max_tokens` del agente de diagramas de 32000 → 64000 (max nativo
-- de Sonnet 4). Razón: el agente gastaba mucho del budget en thinking interno
-- validando estructura del diagrama (ciclos, layer assignments, edge labels)
-- y se quedaba sin tokens antes de estructurar el submit_diagram final.
-- Observado: iter 4 con 645 thinking_deltas (46K chars) y 0 text_deltas,
-- terminando con `stop_reason='max_tokens'`. El user veía error genérico
-- "se excedió de tokens" sin output útil.

-- 1. Cambia el default de la columna para nuevos rows.
ALTER TABLE "agent_token_settings" ALTER COLUMN "diagramMaxTokens" SET DEFAULT 64000;

-- 2. Actualiza el row existente SOLO si el user no lo ha modificado del default
--    anterior. Si el user había bajado a 16000 (caso raro pero posible vía UI
--    de settings), respetamos su elección — no asumimos que quería 64000.
UPDATE "agent_token_settings" SET "diagramMaxTokens" = 64000 WHERE "diagramMaxTokens" = 32000;
