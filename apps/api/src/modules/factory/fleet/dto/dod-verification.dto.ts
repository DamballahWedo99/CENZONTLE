import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Validación runtime profunda para los payloads `dodVerification` y
 * `criteriaProgress` que el worker envía en POST /progress y /complete.
 *
 * Defensa contra DB pollution via worker token leakeado (sec MEDIUM): antes
 * los DTOs validaban solo `@IsArray()` shallow, así que un atacante podía
 * inyectar arrays gigantes / objects malformados que el backend persistía
 * como Json y reventaban el frontend al leer.
 *
 * Caps elegidos:
 *  - ArrayMaxSize en verdicts/criteriaProgress: 100 (la realidad son 5-15;
 *    100 es 6x el upper-bound observado, suficiente para edge cases sin
 *    permitir abuse)
 *  - MaxLength en strings: alineados con el shape esperado del worker
 *    (criterionId ≤ 2000, label ≤ 500, command ≤ 500, output ≤ 4000,
 *    reason ≤ 2000). El cap de criterionId se amplió de 200 → 2000 tras
 *    el incidente del 2026-05-25 (run 162dc9f9): el verifier Layer 3 emite
 *    criterionIds que son DESCRIPCIONES completas del criterio, no slugs
 *    cortos. 2000 chars cubre cualquier descripción razonable.
 *  - attempt 1..10, exitCode -1..255 (POSIX range con sentinel -1)
 */

class CriterionUsageDto {
  @ApiProperty({ description: 'Tokens enviados al modelo', minimum: 0 })
  @IsInt()
  @Min(0)
  inputTokens!: number;

  @ApiProperty({ description: 'Tokens generados por el modelo', minimum: 0 })
  @IsInt()
  @Min(0)
  outputTokens!: number;

  @ApiProperty({ description: 'Tokens escritos a la prompt cache', minimum: 0 })
  @IsInt()
  @Min(0)
  cacheCreationInputTokens!: number;

  @ApiProperty({ description: 'Tokens leídos de la prompt cache', minimum: 0 })
  @IsInt()
  @Min(0)
  cacheReadInputTokens!: number;

  @ApiProperty({ description: 'Costo estimado USD', minimum: 0 })
  @IsNumber()
  @Min(0)
  totalCostUsd!: number;

  @ApiProperty({ description: 'Duración total wall clock (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  durationMs!: number;

  @ApiProperty({ description: 'Duración solo API call (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  apiDurationMs!: number;
}

export class CriterionVerdictDto {
  @ApiProperty({ description: 'Identificador del criterio', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  criterionId!: string;

  @ApiProperty({ description: 'Label legible para UI', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  label!: string;

  @ApiPropertyOptional({
    description: 'Kind canónico o null para custom',
    nullable: true,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  kind!: string | null;

  @ApiPropertyOptional({
    description: 'Comando ejecutado por el verifier; null si trust/skipped',
    nullable: true,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  command!: string | null;

  @ApiPropertyOptional({
    description: 'Exit code del subprocess; null si skipped',
    nullable: true,
    minimum: -1,
    maximum: 255,
  })
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(255)
  exitCode!: number | null;

  @ApiPropertyOptional({
    description: 'Output capturado (últimas ~2KB, redacted by caller); null si no aplica',
    nullable: true,
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  output!: string | null;

  @ApiProperty({
    description: 'Veredicto final',
    enum: ['passed', 'failed', 'skipped'],
  })
  @IsIn(['passed', 'failed', 'skipped'])
  status!: 'passed' | 'failed' | 'skipped';

  @ApiPropertyOptional({ description: 'Razón de skip o fail', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Usage del verifier agent (Layer 3)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CriterionUsageDto)
  usage?: CriterionUsageDto;
}

export class DodVerificationEntryDto {
  @ApiProperty({ description: 'Número de attempt (1-indexed)', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  attempt!: number;

  @ApiProperty({
    description: 'Verdicts producidos por el verifier en este attempt',
    type: () => CriterionVerdictDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CriterionVerdictDto)
  verdicts!: CriterionVerdictDto[];
}

/**
 * Usage de UN attempt del generator (claude -p stream-json). Shape derivado
 * de SDKResultMessage (doc oficial Claude Agent SDK).
 */
class GeneratorAttemptUsageDto {
  @ApiProperty({ description: 'Número de attempt (1-indexed)', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  attempt!: number;

  @ApiProperty({ description: 'Input tokens del API call', minimum: 0 })
  @IsInt()
  @Min(0)
  inputTokens!: number;

  @ApiProperty({ description: 'Output tokens generados', minimum: 0 })
  @IsInt()
  @Min(0)
  outputTokens!: number;

  @ApiProperty({ description: 'Tokens escritos a cache', minimum: 0 })
  @IsInt()
  @Min(0)
  cacheCreationInputTokens!: number;

  @ApiProperty({ description: 'Tokens leídos de cache', minimum: 0 })
  @IsInt()
  @Min(0)
  cacheReadInputTokens!: number;

  @ApiProperty({ description: 'Costo estimado USD', minimum: 0 })
  @IsNumber()
  @Min(0)
  totalCostUsd!: number;

  @ApiProperty({ description: 'Duración total wall clock (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  durationMs!: number;

  @ApiProperty({ description: 'Duración solo API call (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  durationApiMs!: number;

  @ApiProperty({ description: 'Número de turnos agentic (tool-use round trips)', minimum: 0 })
  @IsInt()
  @Min(0)
  numTurns!: number;

  @ApiPropertyOptional({ description: 'is_error del result event' })
  @IsOptional()
  isError?: boolean;

  @ApiPropertyOptional({ description: 'subtype del result event (success | error_max_turns | ...)', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subtype?: string;
}

/**
 * Summary del generator agregado across DoD attempts. Lo mismo que cada
 * GeneratorAttemptUsageDto pero con los totales sumados + array per-attempt.
 *
 * Backend persiste en agent_runs.generatorUsage (Json column) y suma su
 * totalCostUsd con el del verifier en getBatchDetail.
 */
export class GeneratorUsageDto {
  @ApiProperty({ description: 'Total de attempts (= length de perAttempt)', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  callsCount!: number;

  @ApiProperty({ description: 'Suma de input tokens across attempts', minimum: 0 })
  @IsInt()
  @Min(0)
  totalInputTokens!: number;

  @ApiProperty({ description: 'Suma de output tokens across attempts', minimum: 0 })
  @IsInt()
  @Min(0)
  totalOutputTokens!: number;

  @ApiProperty({ description: 'Suma de cache creation tokens', minimum: 0 })
  @IsInt()
  @Min(0)
  totalCacheCreationInputTokens!: number;

  @ApiProperty({ description: 'Suma de cache read tokens', minimum: 0 })
  @IsInt()
  @Min(0)
  totalCacheReadInputTokens!: number;

  @ApiProperty({ description: 'Suma del costo USD across attempts', minimum: 0 })
  @IsNumber()
  @Min(0)
  totalCostUsd!: number;

  @ApiProperty({ description: 'Suma duración wall clock (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  totalDurationMs!: number;

  @ApiProperty({ description: 'Suma duración solo API call (ms)', minimum: 0 })
  @IsInt()
  @Min(0)
  totalDurationApiMs!: number;

  @ApiProperty({ description: 'Suma número de turnos', minimum: 0 })
  @IsInt()
  @Min(0)
  totalNumTurns!: number;

  @ApiProperty({
    description: 'Detalle per-attempt para forensics y per-attempt cost analysis',
    type: () => GeneratorAttemptUsageDto,
    isArray: true,
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GeneratorAttemptUsageDto)
  perAttempt!: GeneratorAttemptUsageDto[];
}

export class CriterionEventDto {
  @ApiProperty({ description: 'ID estable del criterio', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  id!: string;

  @ApiProperty({ description: 'Texto humano para mostrar en UI', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  label!: string;

  @ApiProperty({
    description: 'Estado del milestone',
    enum: ['pending', 'in_progress', 'completed', 'failed'],
  })
  @IsIn(['pending', 'in_progress', 'completed', 'failed'])
  status!: 'pending' | 'in_progress' | 'completed' | 'failed';

  @ApiProperty({
    description: 'Origen del milestone',
    enum: ['worker', 'agent', 'story'],
  })
  @IsIn(['worker', 'agent', 'story'])
  source!: 'worker' | 'agent' | 'story';

  @ApiPropertyOptional({
    description: 'ISO 8601 cuando entró a in_progress',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  startedAt?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 cuando entró a completed/failed',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  completedAt?: string;
}
