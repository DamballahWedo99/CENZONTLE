import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, Permission } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AgentTokenSettingsService } from './agent-token-settings.service';
import { UpdateAgentTokenSettingsDto } from './dto/update-agent-token-settings.dto';

/**
 * Endpoints para configuración singleton de tokens por agente IA.
 *
 * - GET: cualquier usuario autenticado (la UI de settings lo lee para mostrar
 *   los valores actuales; los services del backend lo consumen vía DI).
 * - PATCH: restringido a MANAGE_AGENT_TOKENS (Alta Gerencia) — toca presupuesto
 *   Anthropic, valores excesivos pueden inflar costos por orden de magnitud.
 */
@ApiTags('Agent Token Settings')
@Controller('agent-token-settings')
export class AgentTokenSettingsController {
  constructor(
    private readonly settings: AgentTokenSettingsService,
    @InjectPinoLogger(AgentTokenSettingsController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Obtener la configuración actual de tokens por agente IA',
  })
  async get() {
    const settings = await this.settings.get();
    // Log resumido — para forensics de "qué valores está leyendo la UI" sin
    // imprimir el objeto completo. Útil para validar cache hits.
    this.logger.debug(
      {
        event: 'agent_token_settings.get',
        forgeWorkerModel: settings.forgeWorkerModel,
        forgeWorkerEffort: settings.forgeWorkerEffort,
        dodVerifierModel: settings.dodVerifierModel,
        dodVerifierEffort: settings.dodVerifierEffort,
        updatedAt: settings.updatedAt,
      },
      `[agent-token-settings] GET — coder=${settings.forgeWorkerModel}/${settings.forgeWorkerEffort} verifier=${settings.dodVerifierModel}/${settings.dodVerifierEffort}`,
    );
    return settings;
  }

  @Patch()
  @Permissions(Permission.MANAGE_AGENT_TOKENS)
  @ApiOperation({
    summary:
      'Actualizar parcialmente los tokens por agente (requiere MANAGE_AGENT_TOKENS, solo Alta Gerencia)',
  })
  async update(
    @Body() dto: UpdateAgentTokenSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Log INCOMING del patch — antes de tocar DB. Permite trazar exactamente
    // qué request llegó del frontend (útil cuando la UI cambia sin que se
    // refleje en DB → posible bug del wrapper API client).
    this.logger.info(
      {
        event: 'agent_token_settings.update.received',
        userId: user?.sub ?? 'anon',
        forgeWorkerModel: dto.forgeWorkerModel ?? null,
        forgeWorkerEffort: dto.forgeWorkerEffort ?? null,
        dodVerifierModel: dto.dodVerifierModel ?? null,
        dodVerifierEffort: dto.dodVerifierEffort ?? null,
        fields: Object.keys(dto),
      },
      `[agent-token-settings] PATCH received from user=${user?.sub ?? 'anon'} fields=[${Object.keys(dto).join(',')}]`,
    );
    let result;
    try {
      result = await this.settings.update(dto, user?.sub ?? null);
    } catch (err) {
      // Log estructurado del error con stack — sin esto, el global exception
      // filter de NestJS solo loggea un genérico "Internal server error" y
      // el operador no puede diagnosticar (Prisma desync, validation interna,
      // null en columna NOT NULL, etc.). Log + rethrow.
      const errorObj = err as Error & { code?: string; meta?: unknown };
      this.logger.error(
        {
          event: 'agent_token_settings.update.failed',
          userId: user?.sub ?? 'anon',
          errorName: errorObj.name,
          errorMessage: errorObj.message,
          errorCode: errorObj.code,
          errorMeta: errorObj.meta,
          dtoFields: Object.keys(dto),
          stack: errorObj.stack?.split('\n').slice(0, 10).join('\n'),
        },
        `[agent-token-settings] PATCH FAILED — ${errorObj.name}: ${errorObj.message} (code=${errorObj.code ?? 'none'})`,
      );
      throw err;
    }
    // Log RESPONSE — confirma que el patch se aplicó y qué valor quedó en DB.
    // Diferencia útil: si el INCOMING tiene forgeWorkerModel='claude-opus-4-7'
    // pero el RESPONSE tiene 'claude-sonnet-4-6', algo en el service descartó
    // el valor (DTO validation, defense in depth, etc.).
    this.logger.info(
      {
        event: 'agent_token_settings.update.applied',
        userId: user?.sub ?? 'anon',
        forgeWorkerModel: result.forgeWorkerModel,
        forgeWorkerEffort: result.forgeWorkerEffort,
        dodVerifierModel: result.dodVerifierModel,
        dodVerifierEffort: result.dodVerifierEffort,
        updatedAt: result.updatedAt,
      },
      `[agent-token-settings] PATCH applied — coder=${result.forgeWorkerModel}/${result.forgeWorkerEffort} verifier=${result.dodVerifierModel}/${result.dodVerifierEffort}`,
    );
    return result;
  }
}
