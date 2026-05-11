import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DodVerificationEntry } from '@cenzontle/shared';

/**
 * Body que el worker envía periódicamente durante la ejecución de Claude
 * Code para refrescar `lastProgressAt` y reportar las últimas N líneas de
 * stdout/stderr para audit trail.
 *
 * El `lastOutput` está limitado a 8KB (≈100-200 líneas) para no inflar el
 * row del AgentRun con MB de logs. El sweeper cron solo necesita saber
 * que el run está vivo — los logs detallados (sprint 3) irán a object
 * storage o syslog.
 *
 * `criteriaProgress` es la timeline de milestones del worker + criterios
 * custom del agente. El worker la actualiza cada vez que cumple un milestone
 * técnico (clone, commit, push) y la lee del archivo
 * `/workspace/.cenzontle-criteria.json` si el agente reporta criterios custom.
 */
export class RunProgressDto {
  @ApiPropertyOptional({
    description: 'Últimas líneas de output capturadas (stdout+stderr trimmed)',
    maxLength: 8000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  lastOutput?: string;

  @ApiPropertyOptional({
    description:
      'Timeline de criterios/milestones del run. Array de CriterionEvent. ' +
      'Se persiste en agent_runs.criteriaProgress (sobreescribe el anterior).',
  })
  @IsOptional()
  @IsArray()
  criteriaProgress?: unknown[];

  @ApiPropertyOptional({
    description:
      'URL del ttyd del worker (e.g. http://localhost:8745/). El primer ' +
      'progress después de arrancar ttyd reporta esta URL para que el ' +
      'frontend pueda renderear el iframe del terminal en vivo.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ttydUrl?: string;

  @ApiPropertyOptional({
    description:
      'Tier 1 Harness — verdicts parciales del DoD verifier durante el run. ' +
      'Shape: array de DodVerificationEntry (@cenzontle/shared). Idéntico al ' +
      'que persiste /complete. El worker lo envía en cada POST /progress ' +
      'después de verificar cada criterio individual, para que la UI muestre ' +
      'progreso incremental (1/7, 2/7, ...) en lugar del salto 0/N → N/N al ' +
      'final del run. Validación runtime es @IsArray() shallow — el shape ' +
      'profundo se valida en el frontend con type guards (mismo patrón que ' +
      'criteriaProgress).',
  })
  @IsOptional()
  @IsArray()
  dodVerification?: DodVerificationEntry[];
}
