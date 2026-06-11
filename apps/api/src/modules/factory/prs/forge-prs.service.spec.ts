import { UserRole, type AuthenticatedUser } from '@cenzontle/shared';

// Corta los imports ESM de @octokit (github.service) y su cadena
// (branch-strategy importa github.service) — patrón estándar de los specs
// del API. Los services se inyectan como mocks planos vía constructor.
jest.mock('../github/github.service', () => ({ GitHubService: class {} }));
jest.mock('../branch-strategy/branch-strategy.service', () => ({
  BranchStrategyService: class {},
}));

import { ForgePrsService } from './forge-prs.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { GitHubService } from '../github/github.service';
import type { BranchStrategyService } from '../branch-strategy/branch-strategy.service';
import type { PinoLogger } from 'nestjs-pino';

type Snapshot = Awaited<ReturnType<GitHubService['getPullRequestSnapshot']>>;

describe('ForgePrsService.listPrs', () => {
  const altaGerencia: AuthenticatedUser = {
    sub: 'auth0|ag',
    email: 'ag@test.com',
    name: 'AG',
    role: UserRole.AltaGerencia,
    podIds: [],
  };

  const findMany = jest.fn();
  const getActiveRepoInfo = jest.fn();
  const getPullRequestSnapshot = jest.fn();
  const getOrInitDefault = jest.fn();

  const makeService = () =>
    new ForgePrsService(
      { epic: { findMany } } as unknown as PrismaService,
      { getActiveRepoInfo, getPullRequestSnapshot } as unknown as GitHubService,
      { getOrInitDefault } as unknown as BranchStrategyService,
      { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
    );

  const branchCfg = {
    id: 'global',
    devBranch: 'dev',
    mainBranch: 'main',
    forgeBranchPrefix: 'forge/sprint-batch-',
    autoDeleteForgeBranch: true,
  };

  const repoInfo = {
    owner: 'acme',
    repo: 'product',
    htmlUrl: 'https://github.com/acme/product',
  };

  const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
    number: 101,
    title: '[Forge] Login form',
    state: 'open',
    merged: false,
    draft: false,
    additions: 120,
    deletions: 30,
    changedFiles: 7,
    headBranch: 'forge/epic-aaaa/story-bbbb',
    baseBranch: 'forge/sprint-batch-aaaa',
    htmlUrl: 'https://github.com/acme/product/pull/101',
    createdAt: '2026-06-10T10:00:00Z',
    mergedAt: null,
    ...over,
  });

  /** Epic mínimo con 1 story + 1 run con PR #101. */
  const epicFixture = (over: Record<string, unknown> = {}) => ({
    id: 'aaaa1111-2222-3333-4444-555566667777',
    title: 'Checkout épico',
    enqueuedBatchId: 'batch-1',
    forgeBranch: 'forge/sprint-batch-aaaa1111',
    consolidatedPrNumber: null,
    consolidatedPrCreatedAt: null,
    consolidatedPrMergedAt: null,
    stagingApprovedAt: null,
    stories: [
      {
        id: 'story-1',
        title: 'Login form',
        status: 'done',
        agentRuns: [
          {
            id: 'run-1',
            prNumber: 101,
            branch: 'forge/epic-aaaa/story-bbbb',
            attempts: 2,
            dodVerification: [
              {
                attempt: 1,
                verdicts: [
                  {
                    criterionId: 'build',
                    label: 'build',
                    kind: null,
                    command: null,
                    exitCode: 0,
                    output: null,
                    status: 'passed',
                  },
                ],
              },
            ],
            filesModified: 5,
            startedAt: new Date('2026-06-10T09:00:00Z'),
            completedAt: new Date('2026-06-10T09:30:00Z'),
            // Union explícita: los tests de "run sin node" asignan null.
            node: { name: 'mac-mini-01' } as { name: string } | null,
          },
        ],
      },
    ],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getOrInitDefault.mockResolvedValue(branchCfg);
  });

  // ─── Pod gating (CWE-639, consistente con listQueue) ──────────────────

  it('no-AltaGerencia sin pods → lista vacía sin tocar Prisma', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: [],
    };

    const res = await makeService().listPrs(user);

    expect(res.prs).toEqual([]);
    expect(res.stagingBranch).toBe('dev');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('no-AltaGerencia con pods → filtra epics por pod intersection', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
    const user: AuthenticatedUser = {
      ...altaGerencia,
      role: UserRole.TechLead,
      podIds: ['pod-1', 'pod-2'],
    };

    await makeService().listPrs(user);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pods: { some: { podId: { in: ['pod-1', 'pod-2'] } } },
        }),
      }),
    );
  });

  it('AltaGerencia → sin filtro de pods', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([]);

    await makeService().listPrs(altaGerencia);

    const where = findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.pods).toBeUndefined();
    expect(where.enqueuedBatchId).toEqual({ not: null });
  });

  // ─── Sandbox (sin repo writable) → fallback BD ────────────────────────

  it('sandbox: items live=false con status inferido de la story', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([epicFixture()]);

    const res = await makeService().listPrs(altaGerencia);

    expect(getPullRequestSnapshot).not.toHaveBeenCalled();
    expect(res.repoUrl).toBeNull();
    expect(res.prs).toHaveLength(1);
    const pr = res.prs[0];
    expect(pr).toMatchObject({
      id: 'run-run-1',
      kind: 'story',
      number: 101,
      url: null,
      title: '[Forge] Login form',
      // story done ⇒ el auto-merge corrió ⇒ merged inferido
      status: 'merged',
      live: false,
      additions: null,
      deletions: null,
      files: 5, // fallback a run.filesModified
      dodStatus: 'passed',
      attempts: 2,
      agentName: 'mac-mini-01',
      targetBranch: 'forge/sprint-batch-aaaa1111',
    });
  });

  it('sandbox: story NO done → status open inferido', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    const epic = epicFixture();
    epic.stories[0].status = 'in_review';
    findMany.mockResolvedValue([epic]);

    const res = await makeService().listPrs(altaGerencia);
    expect(res.prs[0].status).toBe('open');
  });

  it('run sin node asignado → agentName null (claim sin dispatch o worker muerto)', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    const epic = epicFixture();
    epic.stories[0].agentRuns[0].node = null;
    findMany.mockResolvedValue([epic]);

    const res = await makeService().listPrs(altaGerencia);
    expect(res.prs[0].agentName).toBeNull();
  });

  it('epic sin stories pero con consolidatedPrNumber → solo el item staging', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([
      epicFixture({
        stories: [],
        consolidatedPrNumber: 300,
        consolidatedPrCreatedAt: new Date('2026-06-10T15:00:00Z'),
      }),
    ]);

    const res = await makeService().listPrs(altaGerencia);

    expect(res.prs).toHaveLength(1);
    expect(res.prs[0]).toMatchObject({ kind: 'staging', number: 300 });
  });

  it('forgeBranch NULL → reconstruye la integration branch con el prefix (mismo fallback que approveStagingGate)', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([epicFixture({ forgeBranch: null })]);

    const res = await makeService().listPrs(altaGerencia);
    expect(res.prs[0].targetBranch).toBe('forge/sprint-batch-aaaa1111');
  });

  // ─── Staging PR (consolidado forge → dev) ─────────────────────────────

  it('epic con consolidatedPrNumber → item staging hacia devBranch', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([
      epicFixture({
        consolidatedPrNumber: 200,
        consolidatedPrCreatedAt: new Date('2026-06-10T12:00:00Z'),
        consolidatedPrMergedAt: new Date('2026-06-10T12:05:00Z'),
      }),
    ]);

    const res = await makeService().listPrs(altaGerencia);

    const staging = res.prs.find((p) => p.kind === 'staging');
    expect(staging).toMatchObject({
      id: 'staging-aaaa1111-2222-3333-4444-555566667777',
      number: 200,
      title: '[Staging] Checkout épico',
      branch: 'forge/sprint-batch-aaaa1111',
      targetBranch: 'dev',
      status: 'merged',
      live: false,
      dodStatus: null,
      attempts: null,
      storyId: null,
      mergedAt: '2026-06-10T12:05:00.000Z',
    });
  });

  it('staging sin consolidatedPrCreatedAt ni stagingApprovedAt → createdAt epoch (cae al fondo del sort)', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([
      epicFixture({
        consolidatedPrNumber: 200,
        consolidatedPrCreatedAt: null,
        stagingApprovedAt: null,
      }),
    ]);

    const res = await makeService().listPrs(altaGerencia);

    const staging = res.prs.find((p) => p.kind === 'staging');
    expect(staging?.createdAt).toBe('1970-01-01T00:00:00.000Z');
    // Con createdAt epoch, el staging ordena DESPUÉS de la story (sort desc).
    expect(res.prs[res.prs.length - 1].kind).toBe('staging');
  });

  // ─── Dedupe por prNumber (retries reúsan la story branch) ─────────────

  it('dos runs de la misma story con el mismo prNumber → un solo item (gana el run más reciente)', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    const epic = epicFixture();
    // orderBy startedAt desc del query: el más nuevo viene primero.
    epic.stories[0].agentRuns = [
      { ...epic.stories[0].agentRuns[0], id: 'run-new', attempts: 3 },
      { ...epic.stories[0].agentRuns[0], id: 'run-old', attempts: 1 },
    ];
    findMany.mockResolvedValue([epic]);

    const res = await makeService().listPrs(altaGerencia);

    expect(res.prs).toHaveLength(1);
    expect(res.prs[0].id).toBe('run-run-new');
    expect(res.prs[0].attempts).toBe(3);
  });

  // ─── Enriquecimiento GitHub ───────────────────────────────────────────

  it('con repo activo: snapshot de GitHub gana sobre el fallback BD', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);
    getPullRequestSnapshot.mockResolvedValue(
      snapshot({ merged: true, mergedAt: '2026-06-10T09:31:00Z', title: 'Título real de GitHub' }),
    );

    const res = await makeService().listPrs(altaGerencia);

    expect(getPullRequestSnapshot).toHaveBeenCalledWith(101);
    expect(res.prs[0]).toMatchObject({
      status: 'merged',
      live: true,
      title: 'Título real de GitHub',
      additions: 120,
      deletions: 30,
      files: 7,
      url: 'https://github.com/acme/product/pull/101',
      mergedAt: '2026-06-10T09:31:00Z',
    });
  });

  it.each([
    [{ merged: true }, 'merged'],
    [{ state: 'closed' as const, merged: false }, 'closed'],
    [{ draft: true }, 'draft'],
    [{}, 'open'],
  ])('mapeo de status GitHub %j → %s', async (over, expected) => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);
    getPullRequestSnapshot.mockResolvedValue(snapshot(over));

    const res = await makeService().listPrs(altaGerencia);
    expect(res.prs[0].status).toBe(expected);
  });

  it('fetch de GitHub falla sin cache → degrada a fallback BD (live=false)', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);
    getPullRequestSnapshot.mockRejectedValue(new Error('rate limited'));

    const res = await makeService().listPrs(altaGerencia);

    expect(res.prs[0]).toMatchObject({
      live: false,
      status: 'merged', // story done
      // En fallback con repo activo el link igual se construye — el PR existe.
      url: 'https://github.com/acme/product/pull/101',
    });
  });

  // ─── Cache TTL asimétrico + stale-while-error ─────────────────────────

  it('PR terminal (merged): segunda llamada dentro del TTL no re-fetchea', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);
    getPullRequestSnapshot.mockResolvedValue(snapshot({ merged: true }));

    const service = makeService();
    await service.listPrs(altaGerencia);
    await service.listPrs(altaGerencia);

    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
  });

  it('PR open: re-fetchea cuando el TTL de 20s venció', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);
    getPullRequestSnapshot.mockResolvedValue(snapshot());

    const service = makeService();
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(base);
    await service.listPrs(altaGerencia);
    nowSpy.mockReturnValue(base + 21_000);
    await service.listPrs(altaGerencia);

    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('stale-while-error: fetch falla con cache vencida → sirve la vencida (live=true)', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    findMany.mockResolvedValue([epicFixture()]);

    const service = makeService();
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(base);
    getPullRequestSnapshot.mockResolvedValueOnce(snapshot({ title: 'Snapshot viejo' }));
    await service.listPrs(altaGerencia);

    nowSpy.mockReturnValue(base + 21_000); // TTL open vencido
    getPullRequestSnapshot.mockRejectedValueOnce(new Error('GitHub caído'));
    const res = await service.listPrs(altaGerencia);

    expect(res.prs[0]).toMatchObject({ live: true, title: 'Snapshot viejo' });
    nowSpy.mockRestore();
  });

  it('poda la cache cuando rotan working sets distintos → bound respetado (anti memory leak)', async () => {
    getActiveRepoInfo.mockResolvedValue(repoInfo);
    // El snapshot responde según el número pedido — todos merged (TTL
    // terminal, así la poda NO los descarta por vencimiento sino por
    // exceso, que es el camino que valida el bound).
    getPullRequestSnapshot.mockImplementation((n: number) =>
      Promise.resolve(snapshot({ number: n, merged: true })),
    );

    // Épica con N stories, cada una con un prNumber distinto.
    const bulkEpic = (suffix: string, prNumbers: number[]) => ({
      ...epicFixture(),
      id: `epic-${suffix}`,
      enqueuedBatchId: `batch-${suffix}`,
      stories: prNumbers.map((n) => ({
        id: `story-${n}`,
        title: `Story ${n}`,
        status: 'done',
        agentRuns: [
          {
            ...epicFixture().stories[0].agentRuns[0],
            id: `run-${n}`,
            prNumber: n,
          },
        ],
      })),
    });

    const range = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => start + i);

    const service = makeService();
    // Working set A: PRs 1000-1299 (300 entradas).
    findMany.mockResolvedValueOnce([bulkEpic('a', range(1000, 300))]);
    await service.listPrs(altaGerencia);
    // Working set B: PRs 2000-2299 (300 entradas) — sin poda aún (300 ≤ 500),
    // la cache crece a 600.
    findMany.mockResolvedValueOnce([bulkEpic('b', range(2000, 300))]);
    await service.listPrs(altaGerencia);
    // Re-pide B: la poda corre al inicio (600 > 500), evicta las 100 más
    // viejas (parte del set A) y la cache vuelve al bound.
    findMany.mockResolvedValueOnce([bulkEpic('b', range(2000, 300))]);
    await service.listPrs(altaGerencia);

    const cache = (
      service as unknown as { snapshotCache: Map<string, unknown> }
    ).snapshotCache;
    expect(cache.size).toBeLessThanOrEqual(500);
    // Las entradas más viejas (set A) fueron las evictadas; B se preserva.
    expect(cache.has('acme/product#2000')).toBe(true);
    expect(cache.has('acme/product#1000')).toBe(false);

    getPullRequestSnapshot.mockReset();
  });

  // ─── Orden ────────────────────────────────────────────────────────────

  it('ordena por createdAt desc (staging más nuevo primero)', async () => {
    getActiveRepoInfo.mockResolvedValue(null);
    findMany.mockResolvedValue([
      epicFixture({
        consolidatedPrNumber: 200,
        consolidatedPrCreatedAt: new Date('2026-06-11T08:00:00Z'),
      }),
    ]);

    const res = await makeService().listPrs(altaGerencia);

    expect(res.prs.map((p) => p.kind)).toEqual(['staging', 'story']);
  });
});
