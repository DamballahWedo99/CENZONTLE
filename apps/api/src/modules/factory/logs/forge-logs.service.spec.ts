import { UserRole, type AuthenticatedUser } from '@cenzontle/shared';
import { ForgeLogsService } from './forge-logs.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PinoLogger } from 'nestjs-pino';

describe('ForgeLogsService.listLogs', () => {
  const altaGerencia: AuthenticatedUser = {
    sub: 'auth0|ag',
    email: 'ag@test.com',
    name: 'AG',
    role: UserRole.AltaGerencia,
    podIds: [],
  };

  const techLead: AuthenticatedUser = {
    sub: 'auth0|tl',
    email: 'tl@test.com',
    name: 'TL',
    role: UserRole.TechLead,
    podIds: ['pod-1', 'pod-2'],
  };

  const findMany = jest.fn();

  const makeService = () =>
    new ForgeLogsService(
      { epic: { findMany } } as unknown as PrismaService,
      { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );

  /** Epic con lifecycle de cola + 1 run terminado — genera varios eventos. */
  const epicFixture = (over: Record<string, unknown> = {}) => ({
    id: 'epic-1',
    title: 'Checkout épico',
    enqueuedAt: new Date('2026-06-10T08:00:00Z'),
    enqueuedBatchId: 'batch-1',
    forgeBranch: 'forge/sprint-batch-epic1',
    forgeBranchCreatedAt: new Date('2026-06-10T08:00:05Z'),
    consolidatedPrNumber: null,
    consolidatedPrCreatedAt: null,
    consolidatedPrMergedAt: null,
    stagingApprovedAt: null,
    stagingApprovedByName: null,
    stories: [
      {
        id: 'story-1',
        title: 'Login form',
        agentRuns: [
          {
            id: 'run-1',
            status: 'completed',
            attempts: 1,
            prNumber: 101,
            exitCode: 0,
            errorMessage: null,
            startedAt: new Date('2026-06-10T09:00:00Z'),
            completedAt: new Date('2026-06-10T09:30:00Z'),
            lastProgressAt: new Date('2026-06-10T09:29:00Z'),
            criteriaProgress: null,
            dodVerification: null,
            node: { name: 'mac-mini-01' },
          },
        ],
      },
    ],
    ...over,
  });

  beforeEach(() => {
    findMany.mockReset();
  });

  it('AltaGerencia: sin filtro de pods en el where', async () => {
    findMany.mockResolvedValue([]);
    await makeService().listLogs(altaGerencia);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ enqueuedBatchId: { not: null } });
    expect(args.take).toBe(20);
  });

  it('no-AltaGerencia: filtra por sus pods (CWE-639)', async () => {
    findMany.mockResolvedValue([]);
    await makeService().listLogs(techLead);

    const args = findMany.mock.calls[0][0];
    expect(args.where.pods).toEqual({
      some: { podId: { in: ['pod-1', 'pod-2'] } },
    });
  });

  it('no-AltaGerencia sin pods: responde vacío sin tocar la BD', async () => {
    const result = await makeService().listLogs({ ...techLead, podIds: [] });
    expect(result).toEqual({ logs: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('deriva eventos y los ordena descendente por timestamp', async () => {
    findMany.mockResolvedValue([epicFixture()]);
    const { logs } = await makeService().listLogs(altaGerencia);

    expect(logs.length).toBeGreaterThanOrEqual(4);
    const times = logs.map((l) => new Date(l.timestamp).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // El evento más reciente es el cierre del run; el más viejo, el enqueue.
    expect(logs[0].id).toBe('run-1:completed');
    expect(logs[logs.length - 1].id).toBe('epic-1:enqueued');
  });

  it('capea la respuesta a 1000 entries descartando los más viejos', async () => {
    // 60 stories × 1 run × ~18 veredictos DoD ≈ 1140+ eventos.
    const verdicts = Array.from({ length: 18 }, (_, i) => ({
      criterionId: `crit-${i}`,
      label: `crit-${i}`,
      kind: null,
      command: null,
      exitCode: null,
      output: null,
      status: 'passed',
    }));
    const stories = Array.from({ length: 60 }, (_, i) => ({
      id: `story-${i}`,
      title: `Story ${i}`,
      agentRuns: [
        {
          id: `run-${i}`,
          status: 'completed',
          attempts: 1,
          prNumber: null,
          exitCode: 0,
          errorMessage: null,
          // Cierres escalonados — los runs bajos son los más viejos.
          startedAt: new Date(Date.UTC(2026, 5, 10, 9, 0, 0)),
          completedAt: new Date(Date.UTC(2026, 5, 10, 10, 0, i)),
          lastProgressAt: new Date(Date.UTC(2026, 5, 10, 10, 0, i)),
          criteriaProgress: null,
          dodVerification: [{ attempt: 1, verdicts }],
          node: null,
        },
      ],
    }));
    findMany.mockResolvedValue([epicFixture({ stories })]);

    const { logs } = await makeService().listLogs(altaGerencia);
    expect(logs).toHaveLength(1000);
    // Los descartados son los más viejos: el enqueue del epic (08:00) no
    // sobrevive al cap, el cierre más reciente sí.
    expect(logs.some((l) => l.id === 'epic-1:enqueued')).toBe(false);
    expect(logs.some((l) => l.id === 'run-59:completed')).toBe(true);
  });

  it('run sin node usa el placeholder de worker desconocido', async () => {
    const epic = epicFixture();
    (epic.stories[0].agentRuns[0] as { node: unknown }).node = null;
    findMany.mockResolvedValue([epic]);

    const { logs } = await makeService().listLogs(altaGerencia);
    expect(logs.find((l) => l.id === 'run-1:started')?.message).toContain(
      'worker desconocido',
    );
  });
});
