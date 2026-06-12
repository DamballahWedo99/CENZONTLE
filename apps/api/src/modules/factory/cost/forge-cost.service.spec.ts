import { UserRole, type AuthenticatedUser } from '@cenzontle/shared';

import { ForgeCostService } from './forge-cost.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PinoLogger } from 'nestjs-pino';

describe('ForgeCostService.getCostAnalytics', () => {
  const altaGerencia: AuthenticatedUser = {
    sub: 'auth0|ag',
    email: 'ag@test.com',
    name: 'AG',
    role: UserRole.AltaGerencia,
    podIds: [],
  };

  const findMany = jest.fn();

  const makeService = () =>
    new ForgeCostService(
      { epic: { findMany } } as unknown as PrismaService,
      { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );

  /** Run con usage completo: generator 0.5 + verifier 0.25 + planner 0.25 = $1. */
  const fullRun = (over: Record<string, unknown> = {}) => ({
    generatorUsage: {
      totalCostUsd: 0.5,
      totalInputTokens: 1000,
      totalOutputTokens: 2000,
      totalCacheCreationInputTokens: 300,
      totalCacheReadInputTokens: 4000,
    },
    dodVerification: [
      {
        attempt: 1,
        verdicts: [
          {
            criterionId: 'build',
            usage: {
              totalCostUsd: 0.25,
              inputTokens: 100,
              outputTokens: 50,
              cacheCreationInputTokens: 25,
              cacheReadInputTokens: 500,
            },
          },
        ],
      },
    ],
    plannerUsage: {
      totalCostUsd: 0.25,
      executorTokensIn: 10,
      executorTokensOut: 20,
      advisorTokensIn: 30,
      advisorTokensOut: 40,
    },
    attempts: 1,
    status: 'completed',
    startedAt: new Date('2026-06-10T09:00:00Z'),
    completedAt: new Date('2026-06-10T09:30:00Z'),
    ...over,
  });

  const epicFixture = (over: Record<string, unknown> = {}) => ({
    id: 'epic-1',
    title: 'Checkout épico',
    enqueuedBatchId: 'batch-1',
    enqueuedAt: new Date('2026-06-09T08:00:00Z'),
    stories: [
      {
        id: 'story-1',
        title: 'Login form',
        status: 'done',
        agentRuns: [fullRun()],
      },
    ],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Pod gating (CWE-639, consistente con listQueue/listPrs) ───────────

  it('no-AltaGerencia sin pods → response vacío con totales 0 sin tocar Prisma', async () => {
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: [],
    };

    const res = await makeService().getCostAnalytics(user);

    expect(findMany).not.toHaveBeenCalled();
    expect(res.batches).toEqual([]);
    expect(res.stories).toEqual([]);
    expect(res.totals).toEqual({
      costUsd: 0,
      tokensNew: 0,
      tokensCached: 0,
      batchesCount: 0,
      storiesWithCost: 0,
      last30DaysCostUsd: 0,
      byComponent: {
        planner: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
        generator: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
        verifier: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
      },
    });
  });

  it('no-AltaGerencia con pods → filtra epics por pod intersection', async () => {
    findMany.mockResolvedValue([]);
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: ['pod-1', 'pod-2'],
    };

    await makeService().getCostAnalytics(user);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pods: { some: { podId: { in: ['pod-1', 'pod-2'] } } },
        }),
      }),
    );
  });

  it('AltaGerencia → sin filtro de pods, ventana de los batches más recientes', async () => {
    findMany.mockResolvedValue([]);

    await makeService().getCostAnalytics(altaGerencia);

    const args = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    };
    expect(args.where.pods).toBeUndefined();
    expect(args.where.enqueuedBatchId).toEqual({ not: null });
    // Cap CWE-770: DESC + take trae los más recientes; el service revierte
    // a ASC cronológico (ver test multi-epic).
    expect(args.orderBy).toEqual({ enqueuedAt: 'desc' });
    expect(args.take).toBe(50);
  });

  // ─── Agregación ─────────────────────────────────────────────────────────

  it('batch con generator+verifier+planner → desglose y totales exactos', async () => {
    findMany.mockResolvedValue([epicFixture()]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.batches).toHaveLength(1);
    const batch = res.batches[0];
    expect(batch).toMatchObject({
      batchId: 'batch-1',
      epicId: 'epic-1',
      epicTitle: 'Checkout épico',
      enqueuedAt: '2026-06-09T08:00:00.000Z',
      completedAt: '2026-06-10T09:30:00.000Z',
      storiesCount: 1,
      storiesDone: 1,
      storiesWithCost: 1,
      costUsd: 1,
      // generator 3300 + verifier 175 + planner 100
      tokensNew: 3575,
      // generator 4000 + verifier 500
      tokensCached: 4500,
      runsCount: 1,
      retriedRuns: 0,
    });
    expect(batch.byComponent).toEqual({
      planner: { costUsd: 0.25, tokensNew: 100, tokensCached: 0 },
      generator: { costUsd: 0.5, tokensNew: 3300, tokensCached: 4000 },
      verifier: { costUsd: 0.25, tokensNew: 175, tokensCached: 500 },
    });

    expect(res.totals).toMatchObject({
      costUsd: 1,
      tokensNew: 3575,
      tokensCached: 4500,
      batchesCount: 1,
      storiesWithCost: 1,
    });
    expect(res.totals.byComponent).toEqual(batch.byComponent);

    expect(res.stories).toEqual([
      {
        storyId: 'story-1',
        storyTitle: 'Login form',
        batchId: 'batch-1',
        epicTitle: 'Checkout épico',
        status: 'done',
        costUsd: 1,
        tokensNew: 3575,
        attempts: 1,
      },
    ]);
  });

  it('agrega TODOS los runs de una story — los retries también costaron', async () => {
    const epic = epicFixture();
    // orderBy startedAt desc del query: el más nuevo viene primero.
    epic.stories[0].agentRuns = [
      fullRun({ attempts: 2, startedAt: new Date('2026-06-10T10:00:00Z') }),
      fullRun({ attempts: 1, startedAt: new Date('2026-06-10T09:00:00Z') }),
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.batches[0]).toMatchObject({ costUsd: 2, runsCount: 2, retriedRuns: 1 });
    // attempts de la story = run más reciente (agentRuns[0]).
    expect(res.stories[0]).toMatchObject({ costUsd: 2, attempts: 2 });
  });

  it('runs con Json null/malformado no rompen y suman 0', async () => {
    const epic = epicFixture();
    epic.stories[0].agentRuns = [
      fullRun({
        generatorUsage: null,
        dodVerification: { verdicts: 'no soy un array' },
        plannerUsage: 'garbage',
      }),
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.batches[0]).toMatchObject({
      costUsd: 0,
      tokensNew: 0,
      tokensCached: 0,
      runsCount: 1,
      storiesWithCost: 0,
    });
    // Sin costo > 0 la story no entra al ranking.
    expect(res.stories).toEqual([]);
    expect(res.totals.costUsd).toBe(0);
  });

  it('retriedRuns cuenta solo runs con attempts > 1 (null legacy = 1 intento)', async () => {
    const epic = epicFixture();
    epic.stories[0].agentRuns = [
      fullRun({ attempts: 3, startedAt: new Date('2026-06-10T11:00:00Z') }),
      fullRun({ attempts: 1, startedAt: new Date('2026-06-10T10:00:00Z') }),
      fullRun({ attempts: null, startedAt: new Date('2026-06-10T09:00:00Z') }),
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.batches[0]).toMatchObject({ runsCount: 3, retriedRuns: 1 });
  });

  it('stories ordenadas DESC por costo y excluye las de costo 0', async () => {
    const epic = epicFixture();
    epic.stories = [
      {
        id: 'story-cheap',
        title: 'Barata',
        status: 'done',
        agentRuns: [
          fullRun({
            generatorUsage: { totalCostUsd: 0.25 },
            dodVerification: null,
            plannerUsage: null,
          }),
        ],
      },
      {
        id: 'story-free',
        title: 'Sin costo',
        status: 'backlog',
        agentRuns: [],
      },
      {
        id: 'story-expensive',
        title: 'Cara',
        status: 'done',
        agentRuns: [
          fullRun({
            generatorUsage: { totalCostUsd: 2 },
            dodVerification: null,
            plannerUsage: null,
          }),
        ],
      },
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.stories.map((s) => s.storyId)).toEqual(['story-expensive', 'story-cheap']);
    expect(res.batches[0]).toMatchObject({
      storiesCount: 3,
      storiesWithCost: 2,
      costUsd: 2.25,
    });
    expect(res.totals.storiesWithCost).toBe(2);
  });

  it('last30DaysCostUsd solo incluye runs con startedAt dentro de la ventana', async () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now - 40 * 24 * 60 * 60 * 1000);

    const epic = epicFixture();
    epic.stories[0].agentRuns = [
      fullRun({
        generatorUsage: { totalCostUsd: 0.5 },
        dodVerification: null,
        plannerUsage: null,
        startedAt: oneDayAgo,
      }),
      fullRun({
        generatorUsage: { totalCostUsd: 2 },
        dodVerification: null,
        plannerUsage: null,
        startedAt: fortyDaysAgo,
      }),
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    // El total histórico incluye ambos; el run-rate solo el reciente.
    expect(res.totals.costUsd).toBe(2.5);
    expect(res.totals.last30DaysCostUsd).toBe(0.5);
  });

  it('multi-epic: acumula totales globales y revierte la ventana desc a ASC cronológico', async () => {
    const older = epicFixture(); // enqueued 2026-06-09, $1
    const newer = epicFixture({
      id: 'epic-2',
      title: 'Pagos épicos',
      enqueuedBatchId: 'batch-2',
      enqueuedAt: new Date('2026-06-10T08:00:00Z'),
      stories: [
        {
          id: 'story-2',
          title: 'Webhook de pagos',
          status: 'done',
          agentRuns: [
            fullRun({
              generatorUsage: { totalCostUsd: 2, totalInputTokens: 500 },
              dodVerification: null,
              plannerUsage: null,
            }),
          ],
        },
      ],
    });
    // El mock simula el wire real: DESC por enqueuedAt (más nuevo primero).
    findMany.mockResolvedValue([newer, older]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    // Reverse a ASC: el más viejo primero para la serie temporal del chart.
    expect(res.batches.map((b) => b.batchId)).toEqual(['batch-1', 'batch-2']);
    expect(res.totals.costUsd).toBe(3);
    expect(res.totals.batchesCount).toBe(2);
    // Una story costosa por epic — protege contra doble conteo del array
    // de stories entre batches (qa-reviewer 2026-06-11).
    expect(res.totals.storiesWithCost).toBe(2);
    // generator: 0.5 (older) + 2 (newer); planner/verifier solo del older.
    expect(res.totals.byComponent.generator.costUsd).toBe(2.5);
  });

  it('run con startedAt null no aporta al run-rate de 30 días y no rompe', async () => {
    const epic = epicFixture();
    epic.stories[0].agentRuns = [
      fullRun({
        generatorUsage: { totalCostUsd: 1.5 },
        dodVerification: null,
        plannerUsage: null,
        startedAt: null,
        completedAt: null,
      }),
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.totals.costUsd).toBe(1.5);
    expect(res.totals.last30DaysCostUsd).toBe(0);
    expect(res.batches[0].completedAt).toBeNull();
  });

  it('batch encolado sin runs → se emite con ceros y completedAt null', async () => {
    const epic = epicFixture();
    epic.stories = [
      { id: 'story-1', title: 'Pendiente', status: 'backlog', agentRuns: [] },
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().getCostAnalytics(altaGerencia);

    expect(res.batches[0]).toMatchObject({
      costUsd: 0,
      completedAt: null,
      storiesCount: 1,
      storiesDone: 0,
      storiesWithCost: 0,
      runsCount: 0,
      retriedRuns: 0,
    });
    // batchesCount cuenta TODOS los encolados visibles, gasten o no.
    expect(res.totals.batchesCount).toBe(1);
  });
});
