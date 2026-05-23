import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FactoryQueueService } from './factory-queue.service';
import { ApproveStagingGateDto } from './dto/approve-staging-gate.dto';

@ApiTags('Factory Queue')
@Controller('factory/queue')
export class FactoryQueueController {
  constructor(private readonly queueService: FactoryQueueService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista las épicas actualmente en la cola "in queue" del Forge. Filtra por pods del usuario para no-AltaGerencia.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.queueService.listQueue(user);
  }

  @Post('enqueue/:epicId')
  @HttpCode(HttpStatus.OK)
  // Write endpoint que dispara gasto real de tokens al spawnear runs del
  // worker — cap estricto por usuario (5/min) encima del throttle global
  // de 60/min, mismo patrón que `retryStory`. El enqueue es una acción
  // humana deliberada; 5/min es holgado y corta amplificación accidental
  // (doble click, bots, repintado de UI con auto-retry, etc.).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary:
      'Envía una épica al Forge (la encola). Valida pod intersection, artefactos completos (definición/diagrama/historias) y los 3 VoBos approved.',
  })
  enqueue(
    @Param('epicId') epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queueService.enqueueEpic(epicId, user);
  }

  @Get(':batchId/detail')
  @ApiOperation({
    summary:
      'Detalle completo de un batch del Forge para el dashboard /factory/batch/:id. Incluye stories con sus statuses + agentRuns activos + cost agregado + Wave DAG derivado de story dependencies. Reemplaza el dashboard mock previo.',
  })
  detail(
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queueService.getBatchDetail(batchId, user);
  }

  @Post(':batchId/approve-staging')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Aprueba el staging gate de un batch — mergea el consolidated PR a DEV y mueve el batch a Staged. Requiere step-up auth (password + role TechLead).',
  })
  approveStaging(
    @Param('batchId') batchId: string,
    @Body() dto: ApproveStagingGateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queueService.approveStagingGate(batchId, user, {
      password: dto.password,
      notes: dto.notes,
    });
  }

  @Post(':batchId/stories/:storyId/retry')
  @HttpCode(HttpStatus.OK)
  // Write endpoint que dispara gasto real de tokens — cap estricto por usuario
  // (5/min) encima del throttle global de 60/min, siguiendo la convención de
  // app.module.ts ("writes con un cap más estricto vía @Throttle()"). El retry
  // es una acción humana deliberada; 5/min es holgado y corta ~12x cualquier
  // amplificación de gasto. Mismo patrón que el endpoint de login.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary:
      'Reintenta una story con deuda técnica del batch — la resetea a backlog + claimedAt=null para que el worker la re-claim y re-ejecute el flujo completo del Forge (implementación + DoD). Acción humana explícita: consume tokens reales de la API.',
  })
  retryStory(
    @Param('batchId') batchId: string,
    @Param('storyId') storyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.queueService.retryStory(batchId, storyId, user);
  }
}
