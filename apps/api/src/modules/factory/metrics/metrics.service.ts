import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FactoryMetricsResponseDto,
  MetricsBucketDto,
} from './dto/timeseries-response.dto';

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;

interface RunForMetrics {
  startedAt: Date;
  completedAt: Date | null;
  lastProgressAt: Date;
  status: string;
  generatorUsage: unknown;
  plannerUsage: unknown;
  dodVerification: unknown;
}

@Injectable()
export class FactoryMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(FactoryMetricsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getTimeseries(): Promise<FactoryMetricsResponseDto> {
    const now = new Date();
    // Bucket actual = hora redondeada hacia abajo. Ej: si now=14:23, el bucket
    // actual cubre [14:00, 15:00). El array de 24 buckets va de [now-23h, now].
    const currentBucketStart = new Date(now);
    currentBucketStart.setUTCMinutes(0, 0, 0);
    const windowStart = new Date(
      currentBucketStart.getTime() - (WINDOW_HOURS - 1) * HOUR_MS,
    );

    // Cargamos en una sola query los runs que pueden contribuir a CUALQUIER
    // bucket. Dos branches:
    //  - completedAt ≥ windowStart  → terminaron dentro de la ventana
    //  - status ∈ {claimed,running} ∧ lastProgressAt ≥ windowStart
    //    → in-flight con actividad reciente. EXCLUYE zombies de meses atrás
    //    (rows con completedAt = null que nunca fueron sweepeadas a
    //    abandoned). Sin este filtro, el findMany cargaba todo el historial
    //    de runs no terminales — DoS por OOM cuando el sweeper se atrasa
    //    (security-reviewer 2026-05-19, CWE-400).
    const [runs, nodes] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: {
          OR: [
            { completedAt: { gte: windowStart } },
            {
              completedAt: null,
              status: { in: ['claimed', 'running'] },
              lastProgressAt: { gte: windowStart },
            },
          ],
        },
        select: {
          startedAt: true,
          completedAt: true,
          lastProgressAt: true,
          status: true,
          generatorUsage: true,
          plannerUsage: true,
          dodVerification: true,
        },
      }),
      this.prisma.computeNode.findMany({
        where: { retiredAt: null },
        select: { totalSlots: true, status: true, lastHeartbeat: true },
      }),
    ]);

    // currentCapacityUsed se deriva del mismo snapshot `runs` para evitar
    // un segundo COUNT que pueda race con findMany (security-reviewer
    // CWE-209 low). Filtramos in-memory en lugar de query separada.
    const activeRunCount = runs.filter(
      (r) => r.status === 'claimed' || r.status === 'running',
    ).length;

    const currentCapacityTotal = nodes
      .filter((n) => this.isNodeOnline(n.status, n.lastHeartbeat, now))
      .reduce((s, n) => s + n.totalSlots, 0);
    const onlineNodeCount = nodes.filter((n) =>
      this.isNodeOnline(n.status, n.lastHeartbeat, now),
    ).length;

    // Construimos los 24 buckets en orden cronológico ascendente.
    const buckets: MetricsBucketDto[] = [];
    for (let i = WINDOW_HOURS - 1; i >= 0; i--) {
      const bucketStart = new Date(currentBucketStart.getTime() - i * HOUR_MS);
      const bucketEnd = new Date(bucketStart.getTime() + HOUR_MS);
      buckets.push(
        this.buildBucket(
          bucketStart,
          bucketEnd,
          now,
          runs,
          currentCapacityTotal,
        ),
      );
    }

    this.logger.info(
      `metrics.timeseries: runs_in_window=${runs.length} ` +
        `current_used=${activeRunCount}/${currentCapacityTotal} ` +
        `total_tokens_new_24h=${buckets.reduce((s, b) => s + b.tokensNew, 0)} ` +
        `total_tokens_cached_24h=${buckets.reduce((s, b) => s + b.tokensCached, 0)}`,
    );

    return {
      generatedAt: now.toISOString(),
      bucketsCount: WINDOW_HOURS,
      bucketDurationMs: HOUR_MS,
      buckets,
      currentCapacityUsed: activeRunCount,
      currentCapacityTotal,
      onlineNodeCount,
    };
  }

  private buildBucket(
    bucketStart: Date,
    bucketEnd: Date,
    now: Date,
    runs: RunForMetrics[],
    capCap: number,
  ): MetricsBucketDto {
    const isCurrentBucket = bucketEnd > now;
    const bucketUpperBound = isCurrentBucket ? now : bucketEnd;

    let capacityUsed = 0;
    let tokensNew = 0;
    let tokensCached = 0;

    for (const run of runs) {
      // Run efectivamente "terminó" cuando completedAt está set; si sigue
      // activo, usamos `now` como upper bound (sweep line abierta).
      const runEnd = run.completedAt ?? now;
      const overlapsBucket =
        run.startedAt < bucketUpperBound && runEnd > bucketStart;
      if (overlapsBucket) {
        capacityUsed++;
      }

      // Tokens: para horas pasadas solo los runs con completedAt en bucket;
      // para la hora actual, también in-flight (capturan usage parcial via
      // /progress reports).
      const completedInBucket =
        run.completedAt &&
        run.completedAt >= bucketStart &&
        run.completedAt < bucketEnd;
      const inFlightInCurrentBucket =
        isCurrentBucket && !run.completedAt && run.startedAt < now;

      if (completedInBucket || inFlightInCurrentBucket) {
        const tokens = extractTokens(run);
        tokensNew += tokens.new;
        tokensCached += tokens.cached;
      }
    }

    // Cap: capacityUsed no puede exceder totalSlots — si hay 7 runs que
    // tocaron la hora con 5 slots, claramente algunos no corrieron simultáneo.
    // Esta aproximación da upper bound; para exactitud sería sweep-line por
    // minuto, deferimos a iteración futura.
    if (capCap > 0) capacityUsed = Math.min(capacityUsed, capCap);

    return {
      time: bucketStart.toISOString(),
      capacityUsed,
      tokensNew,
      tokensCached,
    };
  }

  /** Online: status='online' AND heartbeat fresco (<10min). Espejo del derive
   *  que hace el frontend en useEffectiveResourcePool. */
  private isNodeOnline(
    status: string,
    lastHeartbeat: Date | null,
    now: Date,
  ): boolean {
    if (status !== 'online') return false;
    if (!lastHeartbeat) return false;
    return now.getTime() - lastHeartbeat.getTime() < 10 * 60 * 1000;
  }
}

/**
 * Extrae tokens-new y tokens-cached de un AgentRun consolidando las 3 fuentes
 * (generator + planner + verifier). MISMA lógica que computeRunStats en
 * factory-queue.service.ts:815-859 — duplicada acá para evitar dependencia
 * circular module → module y para que MetricsService sea autónomo.
 *
 * Si la lógica diverge entre ambos lugares, el dashboard mostraría números
 * distintos en /factory y en /factory/batch/:id, lo cual sería confuso. Si
 * cambia la forma de calcular tokens, refactorear ambos en un helper shared.
 */
function extractTokens(run: RunForMetrics): { new: number; cached: number } {
  let tokensNew = 0;
  let tokensCached = 0;

  const gen = run.generatorUsage as Record<string, unknown> | null;
  if (gen && typeof gen === 'object') {
    if (typeof gen.totalInputTokens === 'number') tokensNew += gen.totalInputTokens;
    if (typeof gen.totalOutputTokens === 'number') tokensNew += gen.totalOutputTokens;
    if (typeof gen.totalCacheCreationInputTokens === 'number')
      tokensNew += gen.totalCacheCreationInputTokens;
    if (typeof gen.totalCacheReadInputTokens === 'number')
      tokensCached += gen.totalCacheReadInputTokens;
  }

  const planner = run.plannerUsage as Record<string, unknown> | null;
  if (planner && typeof planner === 'object') {
    if (typeof planner.executorTokensIn === 'number') tokensNew += planner.executorTokensIn;
    if (typeof planner.executorTokensOut === 'number') tokensNew += planner.executorTokensOut;
    if (typeof planner.advisorTokensIn === 'number') tokensNew += planner.advisorTokensIn;
    if (typeof planner.advisorTokensOut === 'number') tokensNew += planner.advisorTokensOut;
  }

  const dod = run.dodVerification;
  if (Array.isArray(dod)) {
    for (const attemptEntry of dod) {
      const verdicts = (attemptEntry as { verdicts?: unknown } | null)?.verdicts;
      if (!Array.isArray(verdicts)) continue;
      for (const v of verdicts) {
        const usage = (v as { usage?: unknown } | null)?.usage;
        if (!usage || typeof usage !== 'object') continue;
        const u = usage as Record<string, unknown>;
        if (typeof u.inputTokens === 'number') tokensNew += u.inputTokens;
        if (typeof u.outputTokens === 'number') tokensNew += u.outputTokens;
        if (typeof u.cacheCreationInputTokens === 'number') tokensNew += u.cacheCreationInputTokens;
        if (typeof u.cacheReadInputTokens === 'number') tokensCached += u.cacheReadInputTokens;
      }
    }
  }

  return { new: tokensNew, cached: tokensCached };
}
