import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COST_COMPONENT_KEYS,
  computeRunComponentStats,
  emptyByComponent,
  emptyComponentTotals,
  type CostComponentKey,
  type CostComponentTotals,
} from './cost-stats';

// ════════════════════════════════════════════════════════════════════════
// Forge cost analytics — agregación read-time de los usage Json de AgentRun
// ════════════════════════════════════════════════════════════════════════
//
// Todos los números son estimates client-side del SDK de Anthropic, NO
// billing oficial — el dashboard los presenta como orden de magnitud para
// decisiones operativas (¿cuánto cuesta un batch?, ¿cuánto cuestan los
// retries?), no para conciliación contable.

export type { CostComponentKey, CostComponentTotals } from './cost-stats';

export interface CostAnalyticsBatch {
  batchId: string;
  epicId: string;
  epicTitle: string;
  /** ISO. */
  enqueuedAt: string;
  /** Max completedAt across runs del batch. NULL si ningún run completó. */
  completedAt: string | null;
  storiesCount: number;
  storiesDone: number;
  /** Stories cuyo(s) run(s) aportaron costo > 0. */
  storiesWithCost: number;
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
  byComponent: Record<CostComponentKey, CostComponentTotals>;
  /** Total de AgentRuns del batch (todos, no solo el más reciente por story). */
  runsCount: number;
  /** Runs con attempts > 1 — el DoD verifier rechazó al menos un intento. */
  retriedRuns: number;
}

export interface CostAnalyticsStory {
  storyId: string;
  storyTitle: string;
  batchId: string;
  epicTitle: string;
  /** StoryStatus en el wire. */
  status: string;
  /** Suma across TODOS los runs de la story (los retries cuestan dinero real). */
  costUsd: number;
  tokensNew: number;
  /** Attempts del run más reciente (orderBy startedAt desc). NULL sin runs. */
  attempts: number | null;
}

export interface CostAnalyticsTotals {
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
  /** Batches visibles dentro de la ventana (últimos MAX_BATCHES), hayan gastado o no. */
  batchesCount: number;
  storiesWithCost: number;
  /** Suma de costo de runs con startedAt >= now - 30 días — run-rate mensual real. */
  last30DaysCostUsd: number;
  byComponent: Record<CostComponentKey, CostComponentTotals>;
}

export interface CostAnalyticsResponse {
  /** ISO now. */
  generatedAt: string;
  totals: CostAnalyticsTotals;
  /** Orden cronológico ASC por enqueuedAt. */
  batches: CostAnalyticsBatch[];
  /** Solo stories con costUsd > 0, orden DESC por costUsd. */
  stories: CostAnalyticsStory[];
}

/** Ventana del run-rate mensual: runs iniciados en los últimos 30 días. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Analytics de costo del Forge: agregación por batch (épica encolada) y
 * por story de los usage Json de cada AgentRun. Solo Prisma — sin GitHub
 * y sin cache: una sola query con includes, costo de cómputo lineal en
 * número de runs (decenas/cientos por ahora).
 */
@Injectable()
export class ForgeCostService {
  /**
   * Cap defensivo (CWE-770, security-reviewer 2026-06-11): sin tope, payload
   * y agregación crecen sin límite con el histórico (dodVerification puede
   * ser pesado) bajo polling 30s por usuario. Más holgado que el MAX_BATCHES
   * = 20 de forge-prs porque analytics quiere serie histórica y no paga
   * llamadas a GitHub por batch.
   */
  private static readonly MAX_BATCHES = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ForgeCostService.name) private readonly logger: PinoLogger,
  ) {}

  async getCostAnalytics(user: AuthenticatedUser): Promise<CostAnalyticsResponse> {
    // Pod gating consistente con listQueue/listPrs (CWE-639):
    // no-AltaGerencia solo ve los batches de sus pods.
    const where: Record<string, unknown> = {
      enqueuedBatchId: { not: null },
    };
    if (user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      if (userPodIds.length === 0) return this.emptyResponse();
      where.pods = { some: { podId: { in: userPodIds } } };
    }

    const epicsDesc = await this.prisma.epic.findMany({
      where,
      // DESC + take = ventana de los batches MÁS RECIENTES; abajo se
      // revierte a ASC cronológico para que el chart lea la serie en orden
      // temporal directo sin re-sort client-side.
      orderBy: { enqueuedAt: 'desc' },
      take: ForgeCostService.MAX_BATCHES,
      select: {
        id: true,
        title: true,
        enqueuedBatchId: true,
        enqueuedAt: true,
        stories: {
          select: {
            id: true,
            title: true,
            status: true,
            agentRuns: {
              select: {
                generatorUsage: true,
                dodVerification: true,
                plannerUsage: true,
                attempts: true,
                status: true,
                startedAt: true,
                completedAt: true,
              },
              // Más reciente primero — el `attempts` de la story sale del
              // run más nuevo (agentRuns[0]).
              orderBy: { startedAt: 'desc' },
            },
          },
        },
      },
    });

    const epics = epicsDesc.reverse();

    const now = Date.now();
    const batches: CostAnalyticsBatch[] = [];
    const stories: CostAnalyticsStory[] = [];
    const totalsByComponent = emptyByComponent();
    let last30DaysCostUsd = 0;

    for (const epic of epics) {
      // El where garantiza enqueuedBatchId, pero el tipo de Prisma no lo
      // sabe; enqueuedAt null es un estado inconsistente (encolado sin
      // timestamp) que preferimos omitir a inventarle fecha.
      const batchId = epic.enqueuedBatchId;
      if (!batchId || !epic.enqueuedAt) continue;

      const batchByComponent = emptyByComponent();
      let latestCompletedAt: Date | null = null;
      let runsCount = 0;
      let retriedRuns = 0;
      let storiesWithCost = 0;

      for (const story of epic.stories) {
        let storyCostUsd = 0;
        let storyTokensNew = 0;

        // TODOS los runs, no solo el más reciente — los retries también
        // costaron dinero y el dashboard debe reflejarlo.
        for (const run of story.agentRuns) {
          runsCount++;
          if ((run.attempts ?? 1) > 1) retriedRuns++;
          if (
            run.completedAt &&
            (!latestCompletedAt || run.completedAt > latestCompletedAt)
          ) {
            latestCompletedAt = run.completedAt;
          }

          const runStats = computeRunComponentStats(run);
          let runCostUsd = 0;
          for (const key of COST_COMPONENT_KEYS) {
            const src = runStats[key];
            runCostUsd += src.costUsd;
            batchByComponent[key].costUsd += src.costUsd;
            batchByComponent[key].tokensNew += src.tokensNew;
            batchByComponent[key].tokensCached += src.tokensCached;
            storyTokensNew += src.tokensNew;
          }
          storyCostUsd += runCostUsd;

          // Run-rate mensual: el gasto se atribuye al momento en que el run
          // ARRANCÓ (cuando se consumieron los tokens), no al enqueue.
          if (run.startedAt && now - run.startedAt.getTime() <= THIRTY_DAYS_MS) {
            last30DaysCostUsd += runCostUsd;
          }
        }

        if (storyCostUsd > 0) {
          storiesWithCost++;
          stories.push({
            storyId: story.id,
            storyTitle: story.title,
            batchId,
            epicTitle: epic.title,
            status: story.status,
            costUsd: storyCostUsd,
            tokensNew: storyTokensNew,
            attempts: story.agentRuns[0]?.attempts ?? null,
          });
        }
      }

      const batchTotals = emptyComponentTotals();
      for (const key of COST_COMPONENT_KEYS) {
        batchTotals.costUsd += batchByComponent[key].costUsd;
        batchTotals.tokensNew += batchByComponent[key].tokensNew;
        batchTotals.tokensCached += batchByComponent[key].tokensCached;
        totalsByComponent[key].costUsd += batchByComponent[key].costUsd;
        totalsByComponent[key].tokensNew += batchByComponent[key].tokensNew;
        totalsByComponent[key].tokensCached += batchByComponent[key].tokensCached;
      }

      // Los batches sin runs o sin costo SÍ se emiten (con ceros): el
      // dashboard muestra el batch encolado aunque aún no haya gastado.
      batches.push({
        batchId,
        epicId: epic.id,
        epicTitle: epic.title,
        enqueuedAt: epic.enqueuedAt.toISOString(),
        completedAt: latestCompletedAt?.toISOString() ?? null,
        storiesCount: epic.stories.length,
        storiesDone: epic.stories.filter((s) => s.status === 'done').length,
        storiesWithCost,
        costUsd: batchTotals.costUsd,
        tokensNew: batchTotals.tokensNew,
        tokensCached: batchTotals.tokensCached,
        byComponent: batchByComponent,
        runsCount,
        retriedRuns,
      });
    }

    stories.sort((a, b) => b.costUsd - a.costUsd);

    const grandTotals = emptyComponentTotals();
    for (const key of COST_COMPONENT_KEYS) {
      grandTotals.costUsd += totalsByComponent[key].costUsd;
      grandTotals.tokensNew += totalsByComponent[key].tokensNew;
      grandTotals.tokensCached += totalsByComponent[key].tokensCached;
    }

    const totals: CostAnalyticsTotals = {
      costUsd: grandTotals.costUsd,
      tokensNew: grandTotals.tokensNew,
      tokensCached: grandTotals.tokensCached,
      batchesCount: batches.length,
      storiesWithCost: stories.length,
      last30DaysCostUsd,
      byComponent: totalsByComponent,
    };

    this.logger.info(
      `[forge-cost] aggregated: batches=${batches.length} stories=${stories.length} ` +
        `totalUsd=${totals.costUsd.toFixed(4)}`,
    );

    return {
      generatedAt: new Date().toISOString(),
      totals,
      batches,
      stories,
    };
  }

  /** Response vacío válido — user sin pods no ve nada, pero el contrato se cumple. */
  private emptyResponse(): CostAnalyticsResponse {
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        costUsd: 0,
        tokensNew: 0,
        tokensCached: 0,
        batchesCount: 0,
        storiesWithCost: 0,
        last30DaysCostUsd: 0,
        byComponent: emptyByComponent(),
      },
      batches: [],
      stories: [],
    };
  }
}
