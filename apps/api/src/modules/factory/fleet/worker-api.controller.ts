import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators';
import { FleetService } from './fleet.service';
import { AgentRunService } from './agent-run.service';
import { WorkerAuthGuard } from './worker-auth.guard';
import { WorkerRoute, WorkerNode } from './worker-route.decorator';
import { WorkerRegisterDto } from './dto/worker-register.dto';
import { WorkerHeartbeatDto } from './dto/worker-heartbeat.dto';
import { RunProgressDto } from './dto/run-progress.dto';
import { RunCompleteDto } from './dto/run-complete.dto';

/**
 * Endpoints WORKER — autenticados con Bearer worker_xxx (no JWT Auth0).
 *
 * Cada endpoint:
 *  - `@Public()` — skipea el JwtAuthGuard global de Auth0
 *  - `@WorkerRoute()` — activa el WorkerAuthGuard (que valida el token)
 *  - `@UseGuards(WorkerAuthGuard)` — registra el guard en este controller
 *
 * El `@WorkerNode()` param decorator inyecta `{ id, tokenId }` resuelto por
 * el guard.
 */
@ApiTags('Factory Workers')
@ApiBearerAuth()
@Controller('factory/workers')
@UseGuards(WorkerAuthGuard)
export class WorkerApiController {
  constructor(
    private readonly fleet: FleetService,
    private readonly runs: AgentRunService,
  ) {}

  // Throttle en register/heartbeat — un atacante con token leakeado podría
  // inundar estos endpoints generando UPDATE storm (CWE-770). Worker legítimo
  // registra 1 vez al boot + heartbeat cada 30s = 2/min en steady state.
  // 30/min = 15x el uso normal — defensivo contra abuso pero tolerante a
  // dev iterativo (kill+restart frecuente sin esperar 60s entre cada uno).
  @Public()
  @WorkerRoute()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Handshake inicial del worker. Reporta os/hostname/totalSlots y marca el nodo como online. Límite 30/min.',
  })
  async register(
    @WorkerNode() node: { id: string },
    @Body() dto: WorkerRegisterDto,
  ) {
    return this.fleet.registerWorker(node.id, dto);
  }

  @Public()
  @WorkerRoute()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Heartbeat periódico (cada 30s). Refresca lastHeartbeat y mantiene el nodo en estado online. Límite 30/min.',
  })
  async heartbeat(
    @WorkerNode() node: { id: string },
    @Body() dto: WorkerHeartbeatDto,
  ) {
    return this.fleet.heartbeat(node.id, dto);
  }

  // ── Story claim / run lifecycle (Sprint 2) ───────────────────────────

  /**
   * Long-poll endpoint — el worker llama cada 5s en idle (1 request/tick =
   * 12/min). En peak, el worker drena queue serialmente: hasta N requests
   * rápidos en un tick (N = freeSlots) cuando hay trabajo, después idle.
   *
   * Throttle 60/min cubre worst-case con drain serial: worker de 12 slots
   * que recibe 12 stories de golpe gasta 12 unidades en un tick, después
   * 12/min steady. Total ~24/min en peak. 60/min da 2.5x headroom.
   */
  @Public()
  @WorkerRoute()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('claim-story')
  @ApiOperation({
    summary:
      'Reclama atómicamente la próxima historia ready respetando DAG hard. 200 con payload o 204 si nada claimable. Límite 60/min.',
  })
  async claimStory(
    @WorkerNode() node: { id: string; tokenId: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Plumb tokenId al service para el audit trail (security-reviewer
    // F-03 2026-05-06). El guard ya lo expone via req.workerNode.tokenId
    // — antes el controller lo descartaba.
    const claimed = await this.runs.claimStory(node.id, node.tokenId);
    if (claimed === null) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return claimed;
  }

  @Public()
  @WorkerRoute()
  // Throttle alto — workers reportan progress cada N líneas de output.
  // 60/min es 1/seg — más rápido es probablemente bug.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('runs/:runId/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Reporta progress de un run en curso. Refresca lastProgressAt + opcionalmente lastOutput. 410 Gone si el run ya está terminal.',
  })
  async runProgress(
    @WorkerNode() node: { id: string },
    @Param('runId') runId: string,
    @Body() dto: RunProgressDto,
  ): Promise<void> {
    await this.runs.reportProgress(runId, node.id, dto);
  }

  @Public()
  @WorkerRoute()
  // Throttle 30/min — un worker con N slots paralelos puede tener N runs
  // terminando ~simultáneamente (todos haciendo POST complete en ~1s).
  // 30/min cubre 12 slots paralelos terminando juntos con headroom.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('runs/:runId/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Reporta finalización del run. exitCode 0 + prNumber → completed. exitCode ≠ 0 → failed. 409 si ya terminal.',
  })
  async runComplete(
    @WorkerNode() node: { id: string },
    @Param('runId') runId: string,
    @Body() dto: RunCompleteDto,
  ): Promise<void> {
    await this.runs.completeRun(runId, node.id, dto);
  }
}
