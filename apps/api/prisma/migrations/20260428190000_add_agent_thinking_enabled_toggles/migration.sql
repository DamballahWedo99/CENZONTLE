-- Toggle on/off del extended thinking por agente. Default `true` mantiene
-- el comportamiento histórico (thinking activo) — un cambio en UI puede
-- desactivar el thinking de un agente específico sin tocar BD ni código.
-- Reemplaza el env var DIAGRAM_AGENT_THINKING que tenía el mismo propósito
-- pero solo para diagramas.

ALTER TABLE "agent_token_settings" ADD COLUMN "storyPoThinkingEnabled"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agent_token_settings" ADD COLUMN "storyTlThinkingEnabled"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agent_token_settings" ADD COLUMN "storyQaThinkingEnabled"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agent_token_settings" ADD COLUMN "epicThinkingEnabled"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agent_token_settings" ADD COLUMN "diagramThinkingEnabled"  BOOLEAN NOT NULL DEFAULT true;
