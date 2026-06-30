import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { QA_STALE_LENS_MS } from './qa-config';

/** Una campaña que lleva demasiado tiempo "activa" sin completar se considera
 *  huérfana (típicamente tras un restart del API que perdió el set in-memory). */
const QA_STALE_RUN_MS = 45 * 60 * 1000;

/**
 * Cron del pipeline QA (espejo de FleetSweeperService):
 *  - autoTriggerQa: arranca QA automáticamente para batches recién mergeados
 *    a DEV, y drena las campañas pendientes hasta el cap de concurrencia.
 *  - sweepStale: marca lentes/campañas huérfanas para que no queden colgadas.
 *
 * No importa ScheduleModule: FleetModule ya llamó ScheduleModule.forRoot(), así
 * que los @Cron se descubren globalmente.
 */
@Injectable()
export class QaSweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: QaOrchestratorService,
    @InjectPinoLogger(QaSweepService.name)
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'qa-auto-trigger' })
  async autoTriggerQa(): Promise<void> {
    // Batches mergeados a DEV que aún no entraron a QA.
    const eligible = await this.prisma.epic.findMany({
      where: {
        enqueuedBatchId: { not: null },
        consolidatedPrMergedAt: { not: null },
        qaStartedAt: null,
      },
      select: { id: true },
    });
    for (const epic of eligible) {
      try {
        const id = await this.orchestrator.spawnQaRun({ epicId: epic.id, trigger: 'sweep' });
        if (id) {
          this.logger.info(
            { event: 'qa.sweep.spawned', epicId: epic.id, qaRunId: id },
            `[qa-sweep] campaña QA arrancada para epic ${epic.id}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          { event: 'qa.sweep.spawn_failed', epicId: epic.id },
          `[qa-sweep] no se pudo arrancar QA para epic ${epic.id}: ${(err as Error).message}`,
        );
      }
    }
    // Drena pendientes (las que no arrancaron por backpressure).
    await this.orchestrator.drainPending();
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'qa-sweep-stale' })
  async sweepStale(): Promise<void> {
    const now = Date.now();
    const lensCutoff = new Date(now - QA_STALE_LENS_MS);
    const runCutoff = new Date(now - QA_STALE_RUN_MS);

    const staleLenses = await this.prisma.qaLensRun.updateMany({
      where: { status: 'running', lastProgressAt: { lt: lensCutoff } },
      data: { status: 'abandoned', errorMessage: 'sweeper: sin progreso', completedAt: new Date() },
    });
    // Solo running/synthesizing — NO 'pending'. Una campaña pending espera
    // legítimamente a ser drenada por el backpressure (drainPending la tomará
    // en cuanto haya slot); marcarla failed por antigüedad descartaría trabajo
    // válido en bursts (qa-reviewer BUG-05). Las running/synthesizing viejas SÍ
    // son huérfanas (típicamente restart del API que perdió el set in-memory).
    const staleRuns = await this.prisma.qaRun.updateMany({
      where: {
        status: { in: ['running', 'synthesizing'] },
        startedAt: { lt: runCutoff },
      },
      data: { status: 'failed', completedAt: new Date() },
    });

    if (staleLenses.count > 0 || staleRuns.count > 0) {
      this.logger.warn(
        { event: 'qa.sweep.stale', staleLenses: staleLenses.count, staleRuns: staleRuns.count },
        `[qa-sweep] marcó ${staleLenses.count} lentes y ${staleRuns.count} campañas huérfanas`,
      );
    }
  }
}
