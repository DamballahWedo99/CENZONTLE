import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CriterionEventDto,
  DodVerificationEntryDto,
  GeneratorUsageDto,
} from './dod-verification.dto';

/**
 * Body que el worker envía cuando un run termina (exitoso o fallido).
 *
 *  - exitCode 0 + prBranchPushed=true → backend abre PR via Octokit, status='completed'
 *  - exitCode 0 + prBranchPushed=false → sandbox mode: story.status='done' directo
 *  - exitCode ≠ 0 → status='failed' (errorMessage explica)
 *  - El sweeper cron marca status='abandoned' si no llega este complete
 *    en 10min sin progress
 */
export class RunCompleteDto {
  @ApiProperty({ description: 'Exit code del proceso claude', minimum: 0, maximum: 255 })
  @IsInt()
  @Min(0)
  @Max(255)
  exitCode!: number;

  @ApiPropertyOptional({
    description:
      'true si el worker hizo `git push` exitoso de la story branch al remote. ' +
      'El backend usa esto para decidir si abrir PR via Octokit (HITO 5).',
  })
  @IsOptional()
  @IsBoolean()
  prBranchPushed?: boolean;

  @ApiPropertyOptional({
    description: 'SHA del último commit pusheado por el worker (40 chars hex)',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  commitSha?: string;

  @ApiPropertyOptional({ description: 'PR creado al completar exitosamente (legacy, ahora lo crea el backend)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  prNumber?: number;

  @ApiPropertyOptional({
    description:
      'Dev-only flag. Si true (y exitCode=0), el backend (a) marca la story como ' +
      "'done' inmediatamente en vez de 'in_review' aunque haya PR, y " +
      '(b) AUTO-MERGEA el PR al integration branch del epic vía Octokit ' +
      '(squash merge). Esto preserva la consistencia DAG-vs-git-graph: stories ' +
      'de waves siguientes clonan un base actualizado con los outputs previos. ' +
      'Permite que el flow E2E corra sin gate humano cuando el worker está en ' +
      'DOD_VERIFIER_MOCK=1. NUNCA usar en producción: bypaseando el human gate ' +
      'también realiza una mutación irreversible en GitHub (squash merge real).',
  })
  @IsOptional()
  @IsBoolean()
  forceCompletion?: boolean;

  @ApiPropertyOptional({
    description: 'Mensaje de error si exit ≠ 0 (truncado a 2000 chars)',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Últimas líneas de output (igual que progress)',
    maxLength: 8000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  lastOutput?: string;

  @ApiPropertyOptional({
    description:
      'Estado FINAL de criterios/milestones (worker + agente). Mismo formato ' +
      'que en RunProgressDto. El backend lo persiste en agent_runs.criteriaProgress ' +
      'sobrescribiendo lo que vino en el último progress — por si el último ' +
      'milestone (auto.commit, branch.pushed) no alcanzó a salir antes del complete.',
    type: () => CriterionEventDto,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CriterionEventDto)
  criteriaProgress?: CriterionEventDto[];

  @ApiPropertyOptional({
    description:
      'Tier 1 Harness — total de attempts del DoD enforcement loop. 1 = primer ' +
      'intento limpio (no hubo retries). 2-3 = el agente necesitó correcciones ' +
      'tras DoD verification fail. Backend lo persiste en agent_runs.attempts ' +
      'para visibility en UI (distinguir runs limpios de runs con retries).',
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  attempts?: number;

  @ApiPropertyOptional({
    description:
      'Tier 1 Harness — log estructurado del veredicto por criterio en cada ' +
      'attempt del loop. Shape: array de DodVerificationEntry. Backend lo ' +
      'persiste en agent_runs.dodVerification para timeline en UI. Validación ' +
      'deep con @ValidateNested + @ArrayMaxSize=10 attempts.',
    type: () => DodVerificationEntryDto,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DodVerificationEntryDto)
  dodVerification?: DodVerificationEntryDto[];

  @ApiPropertyOptional({
    description:
      'Cost/tokens del agente generator (claude -p stream-json) acumulado ' +
      'across DoD attempts. Shape: GeneratorUsageDto. Backend lo persiste en ' +
      'agent_runs.generatorUsage y suma `totalCostUsd` con el del verifier ' +
      '(dodVerification[].verdicts[].usage) en getBatchDetail.',
    type: () => GeneratorUsageDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneratorUsageDto)
  generatorUsage?: GeneratorUsageDto;

  @ApiPropertyOptional({
    description:
      'Número de archivos modificados en el diff base..HEAD calculado por el ' +
      'worker post-push (`git diff --name-only origin/<base>..HEAD`). Visible ' +
      'en el AgentCard como métrica de alcance del cambio. Cap defensivo ' +
      'de 10,000 para prevenir spam de un worker comprometido.',
    minimum: 0,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  filesModified?: number;

  /**
   * Lista de paths relativos del repo que el worker tocó en este run
   * (mismo diff que `filesModified` pero como array de paths). El backend
   * lo persiste en `AgentRun.filesModifiedPaths` y lo usa al materializar
   * el claim de stories del DAG dependientes: el próximo agente recibe en
   * su prompt los paths concretos producidos por stories previas para
   * leerlos antes de implementar (respeta contratos en lugar de improvisar
   * duplicados — caso histórico: epic 9311b334 con README re-creando API.md).
   *
   * Cap defensivo: 200 entries. Cada path cap 256 chars (filesystem limit).
   * Defensa contra workers comprometidos que pudieran enviar payloads gigantes.
   * Si el worker no envía este campo (versión legacy), el backend persiste
   * `[]` y los consumers degradan a usar el count `filesModified`.
   */
  @ApiPropertyOptional({
    type: [String],
    description:
      'Paths relativos modificados en el diff base..HEAD. Cap a 200 entries.',
    maxItems: 200,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  filesModifiedPaths?: string[];
}
