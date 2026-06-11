import { Body, Controller, Get, Put, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../auth/decorators';
import { FactoryAuthzService } from '../factory/authz/factory-authz.service';
import { OrgAnthropicConfigService } from './org-anthropic-config.service';
import { SetAnthropicKeyDto } from './dto/set-anthropic-key.dto';

/**
 * Endpoints HUMANOS para administrar la API key de Anthropic a nivel de
 * organización. Solo Alta Gerencia (validado vía `FactoryAuthzService`) puede
 * leer/escribir.
 *
 *  - `GET /factory/anthropic-config` → metadata pública (configured?, masked, updatedAt)
 *  - `PUT /factory/anthropic-config` → setea/rota la key (encripta server-side)
 *
 * El plaintext NUNCA se devuelve en GET — solo el masked (`sk-...XXXX`).
 * Si se pierde el plaintext en el cliente, el operador debe rotar (set
 * nuevo) en vez de recuperar.
 *
 * Authz: inyecta `FactoryAuthzService` directamente (módulo standalone sin
 * dependencias hacia el Factory). Antes este controller dependía de
 * `FleetService.assertCanManageFleet` cuando vivía en FleetModule — al
 * mudar el módulo a top-level se rompió esa dependencia inversa
 * (config → fleet) reemplazándola por la dependencia directa hacia
 * `FactoryAuthzService`, que es el punto canónico de authz del Factory.
 */
@ApiTags('Factory Anthropic Config')
@Controller('factory/anthropic-config')
export class OrgAnthropicConfigController {
  constructor(
    private readonly authz: FactoryAuthzService,
    private readonly service: OrgAnthropicConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Devuelve metadata de la API key de Anthropic configurada (sin plaintext). Solo Alta Gerencia.',
  })
  async get(@CurrentUser() user: AuthenticatedUser) {
    this.authz.assertCanManageFleet(user);
    return this.service.getPublicConfig();
  }

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Setea o rota la API key de Anthropic. Encripta con AES-256-GCM y persiste solo el ciphertext + IV + authTag. Solo Alta Gerencia.',
  })
  async set(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetAnthropicKeyDto,
  ): Promise<void> {
    this.authz.assertCanManageFleet(user);
    await this.service.setApiKey(dto.plaintext, user.sub);
  }

  @Get('models')
  @ApiOperation({
    summary:
      'Catálogo de modelos Claude para los selectores por agente: catálogo curado (pricing, descripciones, compatibilidad) verificado en vivo contra GET /v1/models cuando hay key. La elección por agente se persiste vía /agent-token-settings. Solo Alta Gerencia.',
  })
  async listModels(@CurrentUser() user: AuthenticatedUser) {
    this.authz.assertCanManageFleet(user);
    return this.service.listAvailableModels();
  }
}
