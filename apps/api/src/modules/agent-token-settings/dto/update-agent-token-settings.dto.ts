import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  AGENT_EFFORT_LEVELS,
  AGENT_TOKEN_BOUNDS,
  FORGE_WORKER_EFFORT_LEVELS,
  FORGE_WORKER_MODELS,
  PROJECT_AGENT_MODELS,
  type AgentEffortLevel,
  type ForgeWorkerEffortLevel,
  type ForgeWorkerModel,
  type ProjectAgentModel,
} from '@cenzontle/shared';

const T = AGENT_TOKEN_BOUNDS;

/**
 * PATCH parcial: cualquier subset de campos.
 *
 * Reemplaza el shape v1 (que tenía `*Thinking: number` para budget_tokens
 * del modo thinking-enabled legacy). El nuevo shape usa `*Effort: enum` del
 * adaptive thinking de Anthropic.
 */
export class UpdateAgentTokenSettingsDto {
  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude del agente PO' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  storyPoModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente PO' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyPoEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyPoMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente PO' })
  @IsOptional() @IsBoolean()
  storyPoThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude del agente TL' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  storyTlModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente TL' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyTlEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyTlMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente TL' })
  @IsOptional() @IsBoolean()
  storyTlThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude del agente QA' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  storyQaModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente QA' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyQaEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyQaMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente QA' })
  @IsOptional() @IsBoolean()
  storyQaThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude del agente de épicas' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  epicModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente de épicas' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  epicEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  epicMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente de épicas' })
  @IsOptional() @IsBoolean()
  epicThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude de los agentes de diagramas' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  diagramModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking de los agentes de diagramas' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  diagramEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  diagramMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking de los agentes de diagramas' })
  @IsOptional() @IsBoolean()
  diagramThinkingEnabled?: boolean;

  // ════════════════════════════════════════════════════════════════════
  // Assistant (chatbot lateral de edición — iniciativas/épicas/historias)
  // ════════════════════════════════════════════════════════════════════

  @ApiPropertyOptional({ enum: PROJECT_AGENT_MODELS, description: 'Modelo Claude del asistente de edición' })
  @IsOptional() @IsIn(PROJECT_AGENT_MODELS as unknown as string[])
  assistantModel?: ProjectAgentModel;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del asistente de edición' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  assistantEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  assistantMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del asistente de edición' })
  @IsOptional() @IsBoolean()
  assistantThinkingEnabled?: boolean;

  // ════════════════════════════════════════════════════════════════════
  // Forge Worker (coder agent — Claude Code CLI)
  // ════════════════════════════════════════════════════════════════════

  @ApiPropertyOptional({
    enum: FORGE_WORKER_MODELS,
    description: 'Modelo Anthropic que usa el Claude Code CLI del worker (--model). Cambio aplica al próximo claim-story.',
  })
  @IsOptional() @IsIn(FORGE_WORKER_MODELS as unknown as string[])
  forgeWorkerModel?: ForgeWorkerModel;

  @ApiPropertyOptional({
    enum: FORGE_WORKER_EFFORT_LEVELS,
    description: 'Nivel de extended thinking del CLI (--effort). low|medium|high|xhigh|max. Para Sonnet/Opus high+ activa thinking blocks.',
  })
  @IsOptional() @IsIn(FORGE_WORKER_EFFORT_LEVELS as unknown as string[])
  forgeWorkerEffort?: ForgeWorkerEffortLevel;

  @ApiPropertyOptional({
    minimum: 300_000,
    maximum: 7_200_000,
    description:
      'Max wall-clock duration (ms) que el worker espera al CLI del Forge antes de matar el proceso. Default 1800000 (30 min). Stories con muchos componentes UI o suites de tests grandes pueden necesitar 3600000-5400000 (60-90 min). Min 300000 (5 min). Max 7200000 (2h) — más allá usualmente significa que la story es demasiado grande y deberia dividirse en chunks más chicos antes de subir el timeout.',
  })
  @IsOptional() @IsInt() @Min(300_000) @Max(7_200_000)
  forgeWorkerMaxRunDurationMs?: number;

  // ════════════════════════════════════════════════════════════════════
  // DoD Verifier (reviewer agent — Claude Code CLI con --output-format json)
  // ════════════════════════════════════════════════════════════════════

  @ApiPropertyOptional({
    enum: FORGE_WORKER_MODELS,
    description: 'Modelo Anthropic que usa el verifier del DoD. Default Haiku 4.5 para checks atómicos baratos; Sonnet 4.6 cuando se requiera detectar bypass del coder.',
  })
  @IsOptional() @IsIn(FORGE_WORKER_MODELS as unknown as string[])
  dodVerifierModel?: ForgeWorkerModel;

  @ApiPropertyOptional({
    enum: FORGE_WORKER_EFFORT_LEVELS,
    description: 'Effort del verifier. Default low (checks binarios atómicos no requieren thinking). high+ solo para debug puntual.',
  })
  @IsOptional() @IsIn(FORGE_WORKER_EFFORT_LEVELS as unknown as string[])
  dodVerifierEffort?: ForgeWorkerEffortLevel;

  // ════════════════════════════════════════════════════════════════════
  // DoD retry loop
  // ════════════════════════════════════════════════════════════════════

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 3,
    description:
      'Máximo de intentos del DoD enforcement loop del worker. 1 = una sola pasada (verificador no-bloqueante, criterios sin cumplir = warn). >1 activa los reintentos ante error duro o criterios sin cumplir. El doom loop (cortar el run tras 2 turnos seguidos estancado o con regresión) SOLO opera con dodMaxAttempts=3 — con cap=2 nunca llega a ejecutarse porque el último attempt detiene el loop antes de que el contador de turnos malos consecutivos alcance el threshold.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(3)
  dodMaxAttempts?: number;
}
