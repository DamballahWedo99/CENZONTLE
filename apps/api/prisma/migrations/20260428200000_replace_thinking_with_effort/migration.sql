-- Migración a adaptive thinking + effort levels (Sonnet 4.6+).
-- Reemplaza el campo numérico `*Thinking` (budget en tokens del thinking
-- modo "enabled") por `*Effort` (string enum: 'low'|'medium'|'high').
-- 'max' solo soportado en Opus — no se agrega como default ahora.
--
-- No preservamos el valor numérico viejo: la conversión budget→effort no
-- es 1:1 y los defaults nuevos son razonables. Los tokens settings son
-- configuración operativa, no data crítica.

ALTER TABLE "agent_token_settings" DROP COLUMN "storyPoThinking";
ALTER TABLE "agent_token_settings" DROP COLUMN "storyTlThinking";
ALTER TABLE "agent_token_settings" DROP COLUMN "storyQaThinking";
ALTER TABLE "agent_token_settings" DROP COLUMN "epicThinking";
ALTER TABLE "agent_token_settings" DROP COLUMN "diagramThinking";

ALTER TABLE "agent_token_settings" ADD COLUMN "storyPoEffort"  TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "agent_token_settings" ADD COLUMN "storyTlEffort"  TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "agent_token_settings" ADD COLUMN "storyQaEffort"  TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "agent_token_settings" ADD COLUMN "epicEffort"     TEXT NOT NULL DEFAULT 'high';
ALTER TABLE "agent_token_settings" ADD COLUMN "diagramEffort"  TEXT NOT NULL DEFAULT 'high';
