import {
  Injectable,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FleetService } from './fleet.service';
import { AgentRunService } from './agent-run.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Cron service que ejecuta dos tareas periódicas críticas:
 *
 *  1. **Sweep nodos stale** — marca `offline` los `ComputeNode` con
 *     `lastHeartbeat` viejo. Otros sistemas leen `status` de DB para
 *     decidir asignación; sin sweeper, un nodo zombie queda `online`
 *     perpetuo y recibe trabajo que nunca procesa.
 *
 *  2. **Sweep runs abandonados** — marca `abandoned` los `AgentRun` con
 *     `lastProgressAt` > 10min sin update, y resetea `story.claimedAt = NULL`
 *     para que otro worker pueda re-claim.
 *
 * Frecuencia: cada minuto. Trade-off entre detección rápida y carga DB.
 */
@Injectable()
export class FleetSweeperService {
  constructor(
    private readonly fleet: FleetService,
    private readonly runs: AgentRunService,
    @InjectPinoLogger(FleetSweeperService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sweep-stale-nodes' })
  async sweepStaleNodes(): Promise<void> {
    try {
      const count = await this.fleet.sweepStaleNodes();
      if (count > 0) {
        this.logger.info({ count }, `[sweeper:nodes] cycle completed, markedOffline=${count}`);
      }
    } catch (err) {
      this.logger.error(
        `[sweeper:nodes] cycle failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sweep-stale-runs' })
  async sweepStaleRuns(): Promise<void> {
    try {
      const count = await this.runs.sweepStaleRuns();
      if (count > 0) {
        this.logger.warn({ count }, `[sweeper:runs] cycle completed, abandoned=${count}`);
      }
    } catch (err) {
      this.logger.error(
        `[sweeper:runs] cycle failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
