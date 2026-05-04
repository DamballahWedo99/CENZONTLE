import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AGENT_EFFORT_LEVELS, AGENT_TOKEN_BOUNDS, type AgentEffortLevel } from '@cenzontle/shared';

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
}
