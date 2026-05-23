import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  CriterionEventDto,
  DodVerificationEntryDto,
  GeneratorUsageDto,
} from './dod-verification.dto';

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
 *
 * Validación profunda (post-fix MEDIUM sec): tanto `criteriaProgress` como
 * `dodVerification` usan @ValidateNested + @ArrayMaxSize. Antes era @IsArray()
 * shallow — un worker token leakeado podía POSTear arrays de 10MB con shapes
 * arbitrarios que el backend persistía como Json y reventaban el frontend.
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
      'URL del ttyd del worker (e.g. http://localhost:8745/). El primer ' +
      'progress después de arrancar ttyd reporta esta URL para que el ' +
      'frontend pueda renderear el iframe del terminal en vivo.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  // SEC (security-reviewer 2026-05-22, Finding 2 / CWE-601, CWE-1021): el
  // frontend embebe este valor en `<iframe src>`. Sin restricción de scheme,
  // un worker comprometido podía reportar `javascript:…` o `data:text/html,…`
  // y conseguir phishing/clickjacking en el origen del dashboard. @IsUrl con
  // protocols allowlist bloquea esos schemes; la validación de host (que
  // sea interno: loopback/RFC 1918/link-local) corre en el service como
  // segunda barrera — ver `isInternalTtydUrl` en agent-run.service.ts.
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_host: true,
    require_tld: false, // permite localhost / IPs directas
  })
  ttydUrl?: string;

  @ApiPropertyOptional({
    description:
      'Tier 1 Harness — verdicts parciales del DoD verifier durante el run. ' +
      'Shape: array de DodVerificationEntry. Idéntico al que persiste /complete. ' +
      'El worker lo envía en cada POST /progress después de verificar cada ' +
      'criterio individual, para que la UI muestre progreso incremental ' +
      '(1/7, 2/7, ...) en lugar del salto 0/N → N/N al final del run. ' +
      'Validación deep con @ValidateNested + @ArrayMaxSize=10 attempts.',
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
      'Cost/tokens del agente generator acumulado hasta este attempt. El worker ' +
      'lo envía inmediatamente después de cada `result` event del CLI claude ' +
      '(en lugar de esperar al /complete final) para que la UI muestre cost en ' +
      'tiempo real attempt-por-attempt. Backend persiste en agent_runs.generatorUsage; ' +
      'getBatchDetail lo lee y suma con el verifier cost.',
    type: () => GeneratorUsageDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneratorUsageDto)
  generatorUsage?: GeneratorUsageDto;
}
