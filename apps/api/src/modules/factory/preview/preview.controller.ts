import {
  Controller,
  Param,
  Post,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FactoryAuthzService } from '../authz/factory-authz.service';
import { PreviewService, type PreviewStatus } from './preview.service';

/**
 * REST endpoints para spawn/stop/status del local dev server preview de
 * un sprint-batch branch. Operador-triggered desde el dashboard del Forge
 * cuando quiere ver el código generado por el agente sin clonear manual.
 *
 * SECURITY (security-reviewer 2026-05-17 — Vuln 2):
 * Todos los handlers requieren rol AltaGerencia via `assertCanManageFleet`.
 * Antes, solo el `JwtAuthGuard` global aplicaba — cualquier usuario
 * autenticado (incluso Viewer) podía gatillar un spawn de pnpm install +
 * pnpm run dev de código agent-generated, lo que combinado con la herencia
 * de env del backend permitía exfiltración de secrets (VAULT_ENCRYPTION_KEY,
 * DATABASE_URL, etc.). El gate de Alta Gerencia espeja el patrón de los
 * otros controllers admin (`DodController`, `BranchStrategyController`,
 * `OrgAnthropicConfigController`) que tocan estado del Forge sensible.
 *
 * Lifecycle típico:
 *   1. UI POST /preview/start → 201 con status='starting'
 *   2. UI poll GET /preview cada 1-2s → status='running' + url
 *   3. UI abre url en nueva tab + muestra "Preview running" badge
 *   4. UI POST /preview/stop cuando termina inspección → cleanup
 */
@ApiTags('Factory Preview')
@Controller('factory/batch/:batchId/preview')
export class PreviewController {
  constructor(
    private readonly preview: PreviewService,
    private readonly authz: FactoryAuthzService,
  ) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Inicia el preview del sprint-batch branch (clone + spawn dev server)',
    description:
      'Retorna inmediatamente con status=starting. El caller debe polling GET ' +
      'hasta que status=running para obtener la URL accesible. Si ya hay un ' +
      'preview running para este batch, retorna ese (idempotente). Si está ' +
      'starting o error, tira 409 — operador debe stop primero. Requiere rol ' +
      'AltaGerencia: el spawn ejecuta código agent-generated con acceso al ' +
      'filesystem del API host.',
  })
  @ApiParam({ name: 'batchId', description: 'enqueuedBatchId del epic' })
  @ApiCreatedResponse({
    description: 'Preview started — poll GET /preview para esperar a running',
  })
  @ApiNotFoundResponse({ description: 'Batch no encontrado' })
  @ApiBadRequestResponse({ description: 'No hay puertos disponibles o repo no accesible' })
  @ApiForbiddenResponse({ description: 'Solo Alta Gerencia puede gestionar el factory' })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
  ): Promise<{
    batchId: string;
    status: PreviewStatus;
    url: string;
    port: number;
    branch: string;
  }> {
    this.authz.assertCanManageFleet(user);
    const instance = await this.preview.startPreview(batchId);
    return {
      batchId: instance.batchId,
      status: instance.status,
      url: instance.url,
      port: instance.port,
      branch: instance.branch,
    };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Detiene el preview del sprint-batch (kill proceso + cleanup tmpdir)',
    description:
      'Idempotente: si no hay preview activo, retorna stopped=false. El caller ' +
      'puede llamarlo sin verificar status primero. Requiere rol AltaGerencia ' +
      '(consistente con start — quien puede iniciar puede detener).',
  })
  @ApiParam({ name: 'batchId', description: 'enqueuedBatchId del epic' })
  @ApiOkResponse({ description: 'Preview detenido (o nunca existía)' })
  @ApiForbiddenResponse({ description: 'Solo Alta Gerencia puede gestionar el factory' })
  async stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
  ): Promise<{ stopped: boolean }> {
    this.authz.assertCanManageFleet(user);
    return this.preview.stopPreview(batchId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estado actual del preview de este batch',
    description:
      'Retorna status, url, port, branch, projectType, startedAt, error si ' +
      'aplica, y últimas 20 lines de logs para diagnóstico. Si no hay preview ' +
      'activo, retorna status=stopped (NO 404, friendlier para polling). ' +
      'Requiere rol AltaGerencia: los logs pueden contener nombres de files ' +
      'agent-generated y metadata del repo target.',
  })
  @ApiParam({ name: 'batchId', description: 'enqueuedBatchId del epic' })
  @ApiOkResponse({ description: 'Estado actual del preview' })
  @ApiForbiddenResponse({ description: 'Solo Alta Gerencia puede gestionar el factory' })
  getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
  ): {
    status: PreviewStatus;
    url?: string;
    port?: number;
    branch?: string;
    projectType?: 'static' | 'node';
    startedAt?: Date;
    error?: string;
    logsTail?: string[];
  } {
    this.authz.assertCanManageFleet(user);
    return this.preview.getPreviewStatus(batchId);
  }
}
