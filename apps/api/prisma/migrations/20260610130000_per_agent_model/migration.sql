-- Modelo Claude por agente de Proyectos (PO/TL/QA/épicas/diagramas/asistente).
-- Reemplaza el campo global org_anthropic_config.model (revertido): cada
-- agente elige su modelo junto a su esfuerzo. Whitelist PROJECT_AGENT_MODELS
-- validada en el DTO/service (adaptive thinking + effort).
ALTER TABLE "org_anthropic_config" DROP COLUMN IF EXISTS "model";

ALTER TABLE "agent_token_settings"
  ADD COLUMN "storyPoModel"   TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "storyTlModel"   TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "storyQaModel"   TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "epicModel"      TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "diagramModel"   TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "assistantModel" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "assistantEffort" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "assistantMaxTokens" INTEGER NOT NULL DEFAULT 32000,
  ADD COLUMN "assistantThinkingEnabled" BOOLEAN NOT NULL DEFAULT true;
