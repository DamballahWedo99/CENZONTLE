-- Singleton row con defaults equivalentes a las constantes hardcoded
-- previas en story-generation.service, epic-generation.service y
-- diagram-generation.service. La tabla queda lista para que el service
-- haga upsert(id="singleton") al primer request.

CREATE TABLE "agent_token_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "storyPoThinking" INTEGER NOT NULL DEFAULT 10000,
    "storyPoMaxTokens" INTEGER NOT NULL DEFAULT 28000,
    "storyTlThinking" INTEGER NOT NULL DEFAULT 12000,
    "storyTlMaxTokens" INTEGER NOT NULL DEFAULT 44000,
    "storyQaThinking" INTEGER NOT NULL DEFAULT 12000,
    "storyQaMaxTokens" INTEGER NOT NULL DEFAULT 44000,
    "epicThinking" INTEGER NOT NULL DEFAULT 10000,
    "epicMaxTokens" INTEGER NOT NULL DEFAULT 64000,
    "diagramThinking" INTEGER NOT NULL DEFAULT 10000,
    "diagramMaxTokens" INTEGER NOT NULL DEFAULT 32000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "agent_token_settings_pkey" PRIMARY KEY ("id")
);
