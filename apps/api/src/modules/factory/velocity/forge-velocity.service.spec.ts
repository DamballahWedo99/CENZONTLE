import { UserRole, type AuthenticatedUser } from '@cenzontle/shared';

import { ForgeVelocityService } from './forge-velocity.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PinoLogger } from 'nestjs-pino';

describe('ForgeVelocityService.getVelocityAnalytics', () => {
  const altaGerencia: AuthenticatedUser = {
    sub: 'auth0|ag',
    email: 'ag@test.com',
    name: 'AG',
    role: UserRole.AltaGerencia,
    podIds: [],
  };

  const epicFindMany = jest.fn();
  const changelogFindMany = jest.fn();

  const makeService = () =>
    new ForgeVelocityService(
      {
        epic: { findMany: epicFindMany },
        changelogEntry: { findMany: changelogFindMany },
      } as unknown as PrismaService,
      { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );

  /** Run completed con costo solo en generator — $1 y 30 min por default. */
  const fullRun = (over: Record<string, unknown> = {}) => ({
    generatorUsage: { totalCostUsd: 1 },
    dodVerification: null,
    plannerUsage: null,
    attempts: 1,
    status: 'completed',
    startedAt: new Date('2026-06-10T09:00:00Z'),
    completedAt: new Date('2026-06-10T09:30:00Z'),
    ...over,
  });

  const storyFixture = (over: Record<string, unknown> = {}) => ({
    id: 'story-1',
    title: 'Login form',
    status: 'done',
    storyPoints: 3,
    updatedAt: new Date('2026-06-10T12:00:00Z'),
    agentRuns: [fullRun()],
    ...over,
  });

  const epicFixture = (over: Record<string, unknown> = {}) => ({
    id: 'epic-1',
    title: 'Checkout épico',
    enqueuedBatchId: 'batch-1',
    enqueuedAt: new Date('2026-06-09T08:00:00Z'),
    stories: [storyFixture()],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    changelogFindMany.mockResolvedValue([]);
  });

  // ─── Pod gating (CWE-639, consistente con cost/listQueue/listPrs) ──────

  it('no-AltaGerencia sin pods → response vacío sin tocar Prisma', async () => {
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: [],
    };

    const res = await makeService().getVelocityAnalytics(user);

    expect(epicFindMany).not.toHaveBeenCalled();
    expect(changelogFindMany).not.toHaveBeenCalled();
    expect(res.batches).toEqual([]);
    expect(res.stories).toEqual([]);
    expect(res.weekly).toEqual([]);
    expect(res.calibration).toEqual([]);
    expect(res.totals).toEqual({
      pointsPlanned: 0,
      pointsDelivered: 0,
      last30DaysPointsDelivered: 0,
      avgWeeklyVelocity4w: 0,
      calibratedPct: 0,
      globalRatio: null,
      sampleSize: 0,
      medians: null,
    });
  });

  it('no-AltaGerencia con pods → filtra epics por pod intersection', async () => {
    epicFindMany.mockResolvedValue([]);
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: ['pod-1', 'pod-2'],
    };

    await makeService().getVelocityAnalytics(user);

    expect(epicFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pods: { some: { podId: { in: ['pod-1', 'pod-2'] } } },
        }),
      }),
    );
  });

  it('AltaGerencia → sin filtro de pods, ventana DESC de 50 batches', async () => {
    epicFindMany.mockResolvedValue([]);

    await makeService().getVelocityAnalytics(altaGerencia);

    const args = epicFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    };
    expect(args.where.pods).toBeUndefined();
    expect(args.where.enqueuedBatchId).toEqual({ not: null });
    expect(args.orderBy).toEqual({ enqueuedAt: 'desc' });
    expect(args.take).toBe(50);
  });

  // ─── Fallback de completedAt vía changelog ──────────────────────────────

  it('historia done sin run completed → completedAt del ChangelogEntry status→done', async () => {
    const closedAt = new Date('2026-06-08T15:00:00Z');
    epicFindMany.mockResolvedValue([
      epicFixture({
        stories: [
          storyFixture({
            // Run failed: costó dinero pero NO marca entrega.
            agentRuns: [fullRun({ status: 'failed' })],
          }),
        ],
      }),
    ]);
    changelogFindMany.mockResolvedValue([
      { entityId: 'story-1', timestamp: closedAt },
      // Cierre más viejo de la misma historia — DESC + first-wins lo ignora.
      { entityId: 'story-1', timestamp: new Date('2026-06-01T10:00:00Z') },
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(changelogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: 'story',
          entityId: { in: ['story-1'] },
          field: 'status',
          newValue: 'done',
        },
        orderBy: { timestamp: 'desc' },
      }),
    );
    expect(res.stories[0].completedAt).toBe(closedAt.toISOString());
  });

  it('historia done sin run completed ni changelog → cae a story.updatedAt', async () => {
    epicFindMany.mockResolvedValue([
      epicFixture({ stories: [storyFixture({ agentRuns: [] })] }),
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.stories[0].completedAt).toBe('2026-06-10T12:00:00.000Z');
  });

  it('con run completed NO consulta el changelog (prioridad 1 resuelve)', async () => {
    epicFindMany.mockResolvedValue([epicFixture()]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(changelogFindMany).not.toHaveBeenCalled();
    expect(res.stories[0].completedAt).toBe('2026-06-10T09:30:00.000Z');
  });

  // ─── Población mínima ────────────────────────────────────────────────────

  it('población < MIN_SAMPLES → todo no-data, medians null y calibración vacía', async () => {
    // Solo 2 historias done con costo — bajo el umbral de 3.
    epicFindMany.mockResolvedValue([
      epicFixture({
        stories: [
          storyFixture({ id: 'story-1' }),
          storyFixture({ id: 'story-2' }),
        ],
      }),
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.totals.medians).toBeNull();
    expect(res.totals.sampleSize).toBe(2);
    expect(res.totals.globalRatio).toBeNull();
    expect(res.totals.calibratedPct).toBe(0);
    expect(res.calibration).toEqual([]);
    for (const story of res.stories) {
      expect(story.effortScore).toBeNull();
      expect(story.ratio).toBeNull();
      expect(story.classification).toBe('no-data');
    }
    // El esfuerzo crudo SÍ se reporta aunque no haya score.
    expect(res.stories[0].costUsd).toBe(1);
  });

  // ─── Agregación de esfuerzo ──────────────────────────────────────────────

  it('runs failed suman costo y duración al esfuerzo de la historia', async () => {
    epicFindMany.mockResolvedValue([
      epicFixture({
        stories: [
          storyFixture({
            agentRuns: [
              fullRun({ attempts: 2 }),
              fullRun({
                status: 'failed',
                generatorUsage: { totalCostUsd: 0.5 },
                startedAt: new Date('2026-06-10T08:00:00Z'),
                completedAt: new Date('2026-06-10T08:15:00Z'),
                attempts: 1,
              }),
            ],
          }),
        ],
      }),
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.stories[0]).toMatchObject({
      costUsd: 1.5,
      durationMs: 45 * 60 * 1000,
      totalAttempts: 3,
      runsCount: 2,
    });
  });

  // ─── Pipeline completo con población suficiente ──────────────────────────

  it('población ≥ MIN_SAMPLES → medianas, scores, weekly y calibración', async () => {
    // 3 historias done idénticas (3 SP, $1, 30 min, 1 attempt) + 1 backlog.
    epicFindMany.mockResolvedValue([
      epicFixture({
        stories: [
          storyFixture({ id: 'story-1' }),
          storyFixture({ id: 'story-2' }),
          storyFixture({ id: 'story-3' }),
          storyFixture({
            id: 'story-4',
            status: 'backlog',
            storyPoints: 5,
            agentRuns: [],
          }),
        ],
      }),
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.totals.medians).toEqual({
      costUsd: 1,
      durationMs: 30 * 60 * 1000,
      attempts: 1,
      storyPoints: 3,
    });
    expect(res.totals.sampleSize).toBe(3);
    expect(res.totals.pointsPlanned).toBe(14); // 3+3+3+5
    expect(res.totals.pointsDelivered).toBe(9);
    expect(res.totals.globalRatio).toBeCloseTo(1, 10);
    expect(res.totals.calibratedPct).toBe(100);

    // Historias done idénticas a la mediana → score 1, calibradas.
    const done = res.stories.filter((s) => s.status === 'done');
    for (const story of done) {
      expect(story.effortScore).toBeCloseTo(1, 10);
      expect(story.ratio).toBeCloseTo(1, 10);
      expect(story.classification).toBe('calibrated');
    }
    // La backlog no se puntúa aunque la población tenga medianas.
    const backlog = res.stories.find((s) => s.storyId === 'story-4');
    expect(backlog).toMatchObject({
      effortScore: null,
      ratio: null,
      classification: 'no-data',
      completedAt: null,
    });

    // Weekly: las 3 entregas caen en la semana del lunes 2026-06-08.
    expect(res.weekly).toEqual([
      { weekStart: '2026-06-08', pointsDelivered: 9, storiesDone: 3 },
    ]);

    // Calibración: un solo bucket (3 SP) con las 3 muestras.
    expect(res.calibration).toHaveLength(1);
    expect(res.calibration[0]).toMatchObject({
      storyPoints: 3,
      samples: 3,
      avgCostUsd: 1,
      avgAttempts: 1,
    });
    expect(res.calibration[0].ratioVsExpected).toBeCloseTo(1, 10);

    // Batch: presupuesto vs entrega + effort agregado.
    expect(res.batches[0]).toMatchObject({
      batchId: 'batch-1',
      storiesCount: 4,
      storiesDone: 3,
      pointsPlanned: 14,
      pointsDelivered: 9,
      costUsd: 3,
    });
    expect(res.batches[0].effortTotal).toBeCloseTo(3, 10);
    expect(res.batches[0].ratio).toBeCloseTo(1, 10);
    expect(res.batches[0].completedAt).toBe('2026-06-10T09:30:00.000Z');
  });

  it('multi-epic: revierte la ventana DESC a ASC cronológico', async () => {
    const older = epicFixture();
    const newer = epicFixture({
      id: 'epic-2',
      enqueuedBatchId: 'batch-2',
      enqueuedAt: new Date('2026-06-10T08:00:00Z'),
      stories: [storyFixture({ id: 'story-2' })],
    });
    // El mock simula el wire real: DESC por enqueuedAt.
    epicFindMany.mockResolvedValue([newer, older]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.batches.map((b) => b.batchId)).toEqual(['batch-1', 'batch-2']);
  });

  it('batch encolado sin runs → se emite con ceros y ratio null', async () => {
    epicFindMany.mockResolvedValue([
      epicFixture({
        stories: [storyFixture({ status: 'backlog', agentRuns: [] })],
      }),
    ]);

    const res = await makeService().getVelocityAnalytics(altaGerencia);

    expect(res.batches[0]).toMatchObject({
      pointsPlanned: 3,
      pointsDelivered: 0,
      costUsd: 0,
      effortTotal: null,
      ratio: null,
      completedAt: null,
    });
    expect(res.totals.sampleSize).toBe(0);
  });
});
