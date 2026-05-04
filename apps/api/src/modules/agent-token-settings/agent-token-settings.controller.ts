import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  constructor(private readonly settings: AgentTokenSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Obtener la configuración actual de tokens por agente IA',
  })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Permissions(Permission.MANAGE_AGENT_TOKENS)
  @ApiOperation({
    summary:
      'Actualizar parcialmente los tokens por agente (requiere MANAGE_AGENT_TOKENS, solo Alta Gerencia)',
  })
  update(
    @Body() dto: UpdateAgentTokenSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.update(dto, user?.sub ?? null);
  }
}
