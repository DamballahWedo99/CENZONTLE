import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  deriveEpicLogEntries,
  type EpicLogRow,
  type ForgeLogsResponse,
} from './log-events';

/**
 * Stream de logs del Forge para `/factory/logs`, derivado 100% de Prisma —
 * sin GitHub, sin archivos, sin estado in-memory. Cada request reconstruye
 * los eventos desde los batches recientes; el polling del dashboard (15s)
 * solo paga un SELECT acotado por MAX_BATCHES.
 *
 * Por qué derivar en vez de persistir una tabla de eventos: el worker ya
 * reporta todo lo relevante a `AgentRun` (lifecycle, criteriaProgress,
 * dodVerification) en cada POST /progress — duplicarlo en una tabla append
 * habría agregado un write path nuevo que mantener consistente. La
 * derivación es idempotente y se corrige sola si el run se actualiza
 * (retry, sweeper, complete tardío).
 */
@Injectable()
export class ForgeLogsService {
  /** Batches más recientes a considerar — misma ventana que /factory/prs. */
  private static readonly MAX_BATCHES = 20;
  /**
   * Tope de entries en la respuesta. La ventana de 20 batches puede generar
   * miles de eventos (runs × criterios × attempts); el LogViewer no
   * virtualiza filas, así que el cap protege payload y DOM. Se descartan
   * los MÁS VIEJOS (la vista es un stream reciente-primero).
   */
  private static readonly MAX_ENTRIES = 1000;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ForgeLogsService.name) private readonly logger: PinoLogger,
  ) {}

  async listLogs(user: AuthenticatedUser): Promise<ForgeLogsResponse> {
    // Pod gating consistente con listPrs/listQueue/getBatchDetail (CWE-639):
    // no-AltaGerencia solo ve los batches de sus pods.
    const where: Record<string, unknown> = {
      enqueuedBatchId: { not: null },
    };
    if (user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      if (userPodIds.length === 0) {
        return { logs: [] };
      }
      where.pods = { some: { podId: { in: userPodIds } } };
    }

    const epics = await this.prisma.epic.findMany({
      where,
      orderBy: { enqueuedAt: 'desc' },
      take: ForgeLogsService.MAX_BATCHES,
      select: {
        id: true,
        title: true,
        enqueuedAt: true,
        enqueuedBatchId: true,
        forgeBranch: true,
        forgeBranchCreatedAt: true,
        consolidatedPrNumber: true,
        consolidatedPrCreatedAt: true,
        consolidatedPrMergedAt: true,
        stagingApprovedAt: true,
        stagingApprovedByName: true,
        stories: {
          select: {
            id: true,
            title: true,
            agentRuns: {
              select: {
                id: true,
                status: true,
                attempts: true,
                prNumber: true,
                exitCode: true,
                errorMessage: true,
                startedAt: true,
                completedAt: true,
                lastProgressAt: true,
                criteriaProgress: true,
                dodVerification: true,
                node: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const all = (epics as EpicLogRow[]).flatMap(deriveEpicLogEntries);
    all.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const logs = all.slice(0, ForgeLogsService.MAX_ENTRIES);

    this.logger.info(
      `[forge-logs] listed: batches=${epics.length} events=${all.length}` +
        (all.length > logs.length ? ` capped=${logs.length}` : ''),
    );

    return { logs };
  }
}
