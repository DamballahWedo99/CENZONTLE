import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { QaReadService } from './qa-read.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { QaGateService } from './qa-gate.service';
import { ApproveReleaseGateDto } from './dto/approve-release-gate.dto';

/**
 * Endpoints del pipeline de QA automático del Forge.
 *  - GET  /factory/tests                  → dashboard (derive-from-Prisma)
 *  - POST /factory/tests/:batchId/rerun   → re-correr la campaña QA (manual)
 *  - POST /factory/tests/:batchId/approve → release gate (rollout, step-up auth)
 *
 * Auth: JwtAuthGuard global. Pod gating + role checks viven en los services
 * (mismo patrón que /factory/cost, /factory/logs y el staging gate).
 */
@ApiTags('Factory QA')
@Controller('factory/tests')
export class QaController {
  constructor(
    private readonly read: QaReadService,
    private readonly orchestrator: QaOrchestratorService,
    private readonly gate: QaGateService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Resultados de QA automático por batch — campaña, lentes (suite/e2e/seguridad/perf-a11y), ' +
      'fallos verificados adversarialmente y el QAReport sintetizado. Derivado de Prisma. ' +
      'Filtra por pods del usuario para no-AltaGerencia.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.read.listTests(user);
  }

  @Post(':batchId/rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-corre la campaña de QA de un batch (supersede la previa). Requiere rol ' +
      'TechLead/AltaGerencia y acceso al pod de la épica.',
  })
  @ApiParam({ name: 'batchId', description: 'enqueuedBatchId del epic' })
  @ApiCreatedResponse({ description: 'Campaña QA re-encolada' })
  @ApiForbiddenResponse({ description: 'Rol o pod sin acceso' })
  @ApiNotFoundResponse({ description: 'Batch no encontrado' })
  async rerun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
  ): Promise<{ qaRunId: string | null }> {
    const qaRunId = await this.orchestrator.rerunForBatch(batchId, user);
    return { qaRunId };
  }

  @Post(':batchId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Release gate — aprueba el rollout del batch tras revisar el QAReport. Mueve el ' +
      'batch a RELEASED. Requiere step-up auth (password) + rol TechLead/AltaGerencia.',
  })
  @ApiParam({ name: 'batchId', description: 'enqueuedBatchId del epic' })
  @ApiOkResponse({ description: 'Batch liberado' })
  @ApiBadRequestResponse({ description: 'La campaña QA aún no completa' })
  @ApiUnauthorizedResponse({ description: 'Contraseña incorrecta' })
  @ApiForbiddenResponse({ description: 'Rol o pod sin acceso' })
  @ApiNotFoundResponse({ description: 'Batch no encontrado' })
  @ApiConflictResponse({ description: 'El batch ya fue liberado' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
    @Body() dto: ApproveReleaseGateDto,
  ) {
    return this.gate.approveReleaseGate(batchId, user, { password: dto.password, notes: dto.notes });
  }
}
