import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuthenticatedUser,
  UserRole,
  type VelocityAnalyticsResponse,
  type VelocityBatch,
  type VelocityStoryBreakdown,
  type VelocityTotals,
  type VelocityWeeklyPoint,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AGENT_RUN_EFFORT_SELECT,
  buildCalibrationTable,
  classifyRatio,
  computeEffortScore,
  computeMedians,
  computeStoryEffortInputs,
  MAX_BATCHES,
  median,
  MIN_SAMPLES,
  weekStartIso,
  type StoryEffortInputs,
  type VelocityMedians,
} from './velocity-stats';

// ════════════════════════════════════════════════════════════════════════
// Forge velocity analytics — ¿la historia de 5 SP efectivamente valió 5 SP?
// ════════════════════════════════════════════════════════════════════════
//
// Derivado 100% read-time desde Prisma (sin tablas nuevas), mismo patrón,
// ventana y pod gating que /factory/cost. Cruza Story.storyPoints contra
// el esfuerzo real medido de los AgentRuns (costo + duración + attempts) y
// clasifica cada historia como over/calibrated/under vs su presupuesto.
// La matemática vive en velocity-stats.ts (puros, compartidos con la
// calibración del PO agent) — este service solo orquesta queries y arma
// el response.

/** Ventana del KPI de entrega reciente: SP entregados en 30 días. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Las últimas N semanas calendario del promedio de velocity. */
const VELOCITY_AVG_WEEKS = 4;

/** Acumulador interno por historia, previo a scoring. */
interface StoryAggregate {
  storyId: string;
  storyTitle: string;
  batchId: string;
  epicId: string;
  epicTitle: string;
  status: string;
  storyPoints: number;
  updatedAt: Date;
  inputs: StoryEffortInputs;
  /** Resuelto en 3 niveles — ver resolveCompletedAt. Solo historias done. */
  completedAt: Date | null;
}

/** Acumulador interno por batch (épica encolada). */
interface BatchAggregate {
  batchId: string;
  epicId: string;
  epicTitle: string;
  enqueuedAt: Date;
  stories: StoryAggregate[];
}

@Injectable()
export class ForgeVelocityService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ForgeVelocityService.name) private readonly logger: PinoLogger,
  ) {}

  async getVelocityAnalytics(user: AuthenticatedUser): Promise<VelocityAnalyticsResponse> {
    // Pod gating consistente con listQueue/listPrs/cost (CWE-639):
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
      // temporal directo sin re-sort client-side (mismo patrón que cost).
      orderBy: { enqueuedAt: 'desc' },
      take: MAX_BATCHES,
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
            storyPoints: true,
            updatedAt: true,
            agentRuns: AGENT_RUN_EFFORT_SELECT,
          },
        },
      },
    });

    const epics = epicsDesc.reverse();

    // ─── Pass 1: agregación de esfuerzo por historia ───────────────────
    const batchAggs: BatchAggregate[] = [];
    for (const epic of epics) {
      // El where garantiza enqueuedBatchId, pero el tipo de Prisma no lo
      // sabe; enqueuedAt null es estado inconsistente que omitimos antes
      // que inventarle fecha (mismo criterio que cost).
      const batchId = epic.enqueuedBatchId;
      if (!batchId || !epic.enqueuedAt) continue;

      batchAggs.push({
        batchId,
        epicId: epic.id,
        epicTitle: epic.title,
        enqueuedAt: epic.enqueuedAt,
        stories: epic.stories.map((story) => {
          const inputs = computeStoryEffortInputs(story.agentRuns);
          return {
            storyId: story.id,
            storyTitle: story.title,
            batchId,
            epicId: epic.id,
            epicTitle: epic.title,
            status: story.status,
            storyPoints: story.storyPoints,
            updatedAt: story.updatedAt,
            inputs,
            // Prioridad 1: max completedAt de runs 'completed'. Solo
            // aplica a historias done — un run completed sobre una
            // historia reabierta no es una entrega.
            completedAt: story.status === 'done' ? inputs.latestRunCompletedAt : null,
          };
        }),
      });
    }

    const allStories = batchAggs.flatMap((b) => b.stories);
    await this.resolveCompletedAtFallbacks(allStories);

    // ─── Población de referencia y medianas ─────────────────────────────
    // Historias done con costo medible Y storyPoints > 0: SP=0 es el
    // default de Prisma para historias sin estimar, no una estimación real
    // — dejarlas entrar contaminaría las medianas (medianSP podría caer a
    // 0 y el frontend dividiría por cero). Bajo MIN_SAMPLES las medianas
    // son ruido: todo se reporta no-data y la calibración queda vacía.
    const population = allStories.filter(
      (s) => s.status === 'done' && s.inputs.costUsd > 0 && s.storyPoints > 0,
    );
    const medians: VelocityMedians | null =
      population.length >= MIN_SAMPLES
        ? computeMedians(
            population.map((s) => ({
              costUsd: s.inputs.costUsd,
              durationMs: s.inputs.durationMs,
              totalAttempts: s.inputs.totalAttempts,
              storyPoints: s.storyPoints,
            })),
          )
        : null;

    // ─── Pass 2: scoring y breakdown por historia ───────────────────────
    const scoreByStoryId = new Map<string, { effortScore: number | null; ratio: number | null }>();
    const stories: VelocityStoryBreakdown[] = allStories.map((s) => {
      // Score solo para historias done: las no-done aún acumulan esfuerzo
      // (runs en curso/fallidos) pero compararlas contra el presupuesto
      // completo de sus SP las haría ver falsamente "baratas".
      const effortScore =
        medians && s.status === 'done' ? computeEffortScore(s.inputs, medians) : null;
      // ratio = effortScore / esfuerzo esperado (sp/medianSP). Sin SP (0)
      // o sin medianSP no existe presupuesto contra el cual comparar.
      const ratio =
        effortScore !== null && medians && medians.storyPoints > 0 && s.storyPoints > 0
          ? effortScore / (s.storyPoints / medians.storyPoints)
          : null;
      scoreByStoryId.set(s.storyId, { effortScore, ratio });

      return {
        storyId: s.storyId,
        storyTitle: s.storyTitle,
        batchId: s.batchId,
        epicId: s.epicId,
        epicTitle: s.epicTitle,
        status: s.status,
        storyPoints: s.storyPoints,
        costUsd: s.inputs.costUsd,
        durationMs: s.inputs.durationMs,
        totalAttempts: s.inputs.totalAttempts,
        runsCount: s.inputs.runsCount,
        effortScore,
        ratio,
        classification: classifyRatio(ratio),
        completedAt: s.completedAt?.toISOString() ?? null,
      };
    });

    // ─── Batches ────────────────────────────────────────────────────────
    const batches: VelocityBatch[] = batchAggs.map((b) => {
      const done = b.stories.filter((s) => s.status === 'done');
      const pointsDelivered = done.reduce((sum, s) => sum + s.storyPoints, 0);
      const scores = b.stories
        .map((s) => scoreByStoryId.get(s.storyId)?.effortScore ?? null)
        .filter((v): v is number => v !== null);
      const effortTotal = scores.length > 0 ? scores.reduce((sum, v) => sum + v, 0) : null;
      let latestCompletedAt: Date | null = null;
      for (const s of b.stories) {
        if (s.completedAt && (!latestCompletedAt || s.completedAt > latestCompletedAt)) {
          latestCompletedAt = s.completedAt;
        }
      }

      return {
        batchId: b.batchId,
        epicId: b.epicId,
        epicTitle: b.epicTitle,
        enqueuedAt: b.enqueuedAt.toISOString(),
        completedAt: latestCompletedAt?.toISOString() ?? null,
        storiesCount: b.stories.length,
        storiesDone: done.length,
        pointsPlanned: b.stories.reduce((sum, s) => sum + s.storyPoints, 0),
        pointsDelivered,
        costUsd: b.stories.reduce((sum, s) => sum + s.inputs.costUsd, 0),
        durationMs: b.stories.reduce((sum, s) => sum + s.inputs.durationMs, 0),
        totalAttempts: b.stories.reduce((sum, s) => sum + s.inputs.totalAttempts, 0),
        effortTotal,
        // effortTotal vs presupuesto entregado del batch, en la misma
        // unidad que el ratio per-story (normalizado por medianSP).
        ratio:
          effortTotal !== null && medians && medians.storyPoints > 0 && pointsDelivered > 0
            ? effortTotal / (pointsDelivered / medians.storyPoints)
            : null,
      };
    });

    // ─── Weekly trend (buckets por lunes UTC de completedAt) ────────────
    const weeklyMap = new Map<string, VelocityWeeklyPoint>();
    for (const s of allStories) {
      if (s.status !== 'done' || !s.completedAt) continue;
      const weekStart = weekStartIso(s.completedAt);
      const point = weeklyMap.get(weekStart) ?? { weekStart, pointsDelivered: 0, storiesDone: 0 };
      point.pointsDelivered += s.storyPoints;
      point.storiesDone += 1;
      weeklyMap.set(weekStart, point);
    }
    const weekly = [...weeklyMap.values()].sort((a, b) =>
      a.weekStart.localeCompare(b.weekStart),
    );

    // ─── Calibración (mismos puros que VelocityCalibrationService) ──────
    const calibration = medians
      ? buildCalibrationTable(
          population
            .map((s) => ({
              costUsd: s.inputs.costUsd,
              durationMs: s.inputs.durationMs,
              totalAttempts: s.inputs.totalAttempts,
              storyPoints: s.storyPoints,
              effortScore: scoreByStoryId.get(s.storyId)?.effortScore,
            }))
            .filter((s): s is typeof s & { effortScore: number } => s.effortScore != null),
          medians,
        )
      : [];

    // ─── Totals ─────────────────────────────────────────────────────────
    const now = Date.now();
    const last30DaysPointsDelivered = allStories
      .filter(
        (s) =>
          s.status === 'done' &&
          s.completedAt &&
          now - s.completedAt.getTime() <= THIRTY_DAYS_MS,
      )
      .reduce((sum, s) => sum + s.storyPoints, 0);

    // Promedio de las últimas 4 semanas CALENDARIO desde hoy: las semanas
    // sin entrega cuentan como 0 — un promedio solo sobre semanas activas
    // inflaría la velocity de un equipo que entrega cada mes.
    let sum4w = 0;
    for (let i = 0; i < VELOCITY_AVG_WEEKS; i++) {
      const week = weekStartIso(new Date(now - i * 7 * 24 * 60 * 60 * 1000));
      sum4w += weeklyMap.get(week)?.pointsDelivered ?? 0;
    }

    const scored = stories.filter((s) => s.effortScore !== null);
    const ratios = stories
      .map((s) => s.ratio)
      .filter((r): r is number => r !== null);

    const totals: VelocityTotals = {
      pointsPlanned: allStories.reduce((sum, s) => sum + s.storyPoints, 0),
      pointsDelivered: allStories
        .filter((s) => s.status === 'done')
        .reduce((sum, s) => sum + s.storyPoints, 0),
      last30DaysPointsDelivered,
      avgWeeklyVelocity4w: sum4w / VELOCITY_AVG_WEEKS,
      calibratedPct:
        scored.length > 0
          ? (scored.filter((s) => s.classification === 'calibrated').length / scored.length) * 100
          : 0,
      globalRatio: ratios.length > 0 ? median(ratios) : null,
      sampleSize: population.length,
      medians,
    };

    this.logger.info(
      `[forge-velocity] aggregated: batches=${batches.length} stories=${stories.length} ` +
        `sampleSize=${population.length} calibratedPct=${totals.calibratedPct.toFixed(1)}`,
    );

    return {
      generatedAt: new Date().toISOString(),
      totals,
      weekly,
      batches,
      stories,
      calibration,
    };
  }

  /**
   * Fallbacks de completedAt para historias done sin run 'completed'
   * (cierres manuales, historias completadas antes del Forge, runs
   * abandonados con merge humano posterior):
   *
   * 2. ChangelogEntry status→done más reciente — el momento real en que
   *    un humano (o el pipeline) movió la historia a done.
   * 3. story.updatedAt — última escritura conocida; impreciso pero mejor
   *    que excluir la entrega del trend semanal.
   *
   * Una sola query batch con `in` para no hacer N+1 contra el changelog.
   */
  private async resolveCompletedAtFallbacks(stories: StoryAggregate[]): Promise<void> {
    const pending = stories.filter((s) => s.status === 'done' && !s.completedAt);
    if (pending.length === 0) return;

    const entries = await this.prisma.changelogEntry.findMany({
      where: {
        entityType: 'story',
        entityId: { in: pending.map((s) => s.storyId) },
        field: 'status',
        newValue: 'done',
      },
      orderBy: { timestamp: 'desc' },
      select: { entityId: true, timestamp: true },
    });

    // DESC + first-wins = el cierre MÁS RECIENTE por historia (una
    // historia reabierta y vuelta a cerrar cuenta por su último cierre).
    const latestByStoryId = new Map<string, Date>();
    for (const entry of entries) {
      if (!latestByStoryId.has(entry.entityId)) {
        latestByStoryId.set(entry.entityId, entry.timestamp);
      }
    }

    for (const story of pending) {
      story.completedAt = latestByStoryId.get(story.storyId) ?? story.updatedAt;
    }
  }

  /** Response vacío válido — user sin pods no ve nada, pero el contrato se cumple. */
  private emptyResponse(): VelocityAnalyticsResponse {
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        pointsPlanned: 0,
        pointsDelivered: 0,
        last30DaysPointsDelivered: 0,
        avgWeeklyVelocity4w: 0,
        calibratedPct: 0,
        globalRatio: null,
        sampleSize: 0,
        medians: null,
      },
      weekly: [],
      batches: [],
      stories: [],
      calibration: [],
    };
  }
}
