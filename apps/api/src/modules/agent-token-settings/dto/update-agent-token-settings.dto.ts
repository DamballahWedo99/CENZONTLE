import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  AGENT_EFFORT_LEVELS,
  AGENT_TOKEN_BOUNDS,
  FORGE_WORKER_EFFORT_LEVELS,
  FORGE_WORKER_MODELS,
  type AgentEffortLevel,
  type ForgeWorkerEffortLevel,
  type ForgeWorkerModel,
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
  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente PO' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyPoEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyPoMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente PO' })
  @IsOptional() @IsBoolean()
  storyPoThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente TL' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyTlEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyTlMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente TL' })
  @IsOptional() @IsBoolean()
  storyTlThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente QA' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  storyQaEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  storyQaMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente QA' })
  @IsOptional() @IsBoolean()
  storyQaThinkingEnabled?: boolean;

  @ApiPropertyOptional({ enum: AGENT_EFFORT_LEVELS, description: 'Esfuerzo del adaptive thinking del agente de épicas' })
  @IsOptional() @IsIn(AGENT_EFFORT_LEVELS as unknown as string[])
  epicEffort?: AgentEffortLevel;

  @ApiPropertyOptional({ minimum: T.maxTokens.min, maximum: T.maxTokens.max })
  @IsOptional() @IsInt() @Min(T.maxTokens.min) @Max(T.maxTokens.max)
  epicMaxTokens?: number;

  @ApiPropertyOptional({ description: 'Activar/desactivar adaptive thinking del agente de épicas' })
  @IsOptional() @IsBoolean()
  epicThinkingEnabled?: boolean;

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
}
