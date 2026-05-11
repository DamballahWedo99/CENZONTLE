import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { DodVerificationEntry } from '@cenzontle/shared';

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
  })
  @IsOptional()
  @IsArray()
  criteriaProgress?: unknown[];

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
      'attempt del loop. Shape: array de DodVerificationEntry (@cenzontle/shared). ' +
      'Backend lo persiste en agent_runs.dodVerification para timeline en UI.',
  })
  @IsOptional()
  @IsArray()
  dodVerification?: DodVerificationEntry[];
}
