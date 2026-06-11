import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser, UserRole } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubService } from '../github/github.service';
import { BranchStrategyService } from '../branch-strategy/branch-strategy.service';
import { deriveDodStatus } from './dod-status';

/**
 * Un PR del flujo Forge para el dashboard `/factory/prs`.
 *
 * Dos kinds:
 *  - `story`: PR de una story branch (`forge/epic-X/story-Y`) contra la
 *    integration branch del batch (`forge/sprint-batch-X`). Nace en
 *    `AgentRunService.completeRun` (server-side, nunca en el worker) y su
 *    número autoritativo vive en `AgentRun.prNumber`.
 *  - `staging`: PR consolidado de la integration branch contra el branch
 *    de staging elegido (`BranchStrategyConfig.devBranch`). Nace lazy en
 *    `approveStagingGate`; su número vive en `Epic.consolidatedPrNumber`.
 */
export interface ForgePrItem {
  /** `run-<runId>` para story PRs, `staging-<epicId>` para consolidados. */
  id: string;
  kind: 'story' | 'staging';
  number: number;
  /** Link directo al PR en GitHub. NULL en sandbox (sin repo writable). */
  url: string | null;
  title: string;
  batchId: string;
  epicId: string;
  epicTitle: string;
  storyId: string | null;
  storyTitle: string | null;
  /** Nombre del ComputeNode que corrió la story. NULL para staging. */
  agentName: string | null;
  /** Head branch del PR. */
  branch: string;
  /** Base branch del PR (integration branch o stagingBranch). */
  targetBranch: string;
  status: 'draft' | 'open' | 'merged' | 'closed';
  /**
   * true = el status viene de un snapshot vivo de GitHub. false = inferido
   * de la BD (sandbox sin repo, o el fetch a GitHub falló para este PR).
   * El estado merged/open de story PRs NO se persiste en Prisma — el
   * auto-merge solo loggea — así que sin GitHub solo podemos inferir:
   * story done ⇒ probablemente merged.
   */
  live: boolean;
  additions: number | null;
  deletions: number | null;
  files: number | null;
  /**
   * Veredicto del DoD verifier del run que produjo el PR — el "CI" real
   * del Forge. Merge across attempts con last-wins por criterionId (misma
   * semántica que la UI del run detail). NULL para staging PRs.
   */
  dodStatus: 'pending' | 'passed' | 'failed' | null;
  /** Attempts del DoD loop (1 = clean). NULL para staging. */
  attempts: number | null;
  createdAt: string;
  mergedAt: string | null;
}

export interface ForgePrsResponse {
  /** URL del repo activo (ej. https://github.com/owner/repo). NULL sandbox. */
  repoUrl: string | null;
  /** Branch destino del staging (BranchStrategyConfig.devBranch). */
  stagingBranch: string;
  /** Todos los PRs del flujo Forge, ordenados por createdAt desc. */
  prs: ForgePrItem[];
}

type PrSnapshot = Awaited<ReturnType<GitHubService['getPullRequestSnapshot']>>;

interface CachedSnapshot {
  snap: PrSnapshot;
  fetchedAt: number;
}

/**
 * Lista los PRs reales del flujo Forge combinando dos fuentes:
 *
 *  1. Prisma (autoritativo sobre QUÉ PRs existen y su contexto de dominio):
 *     `AgentRun.prNumber` por story, `Epic.consolidatedPrNumber` por batch.
 *  2. GitHub (autoritativo sobre el ESTADO de cada PR): merged/open/closed/
 *     draft + diffstat, vía `pulls.get` — porque el estado de story PRs no
 *     se persiste (gotcha conocida del auto-merge).
 *
 * Cache in-memory con TTL asimétrico para sobrevivir el polling del
 * dashboard sin quemar rate limit de GitHub: los PRs merged/closed son
 * inmutables en la práctica (TTL 10 min), los open son los que cambian
 * (TTL 20 s). Stale-while-error: si el fetch falla y hay cache vencida,
 * se sirve la vencida antes que degradar al fallback de BD.
 */
@Injectable()
export class ForgePrsService {
  /** Batches más recientes a considerar — acota las llamadas a GitHub. */
  private static readonly MAX_BATCHES = 20;
  /** PRs consultados a GitHub en paralelo por lote. */
  private static readonly GITHUB_CONCURRENCY = 8;
  private static readonly TTL_TERMINAL_MS = 10 * 60_000;
  private static readonly TTL_OPEN_MS = 20_000;
  /**
   * Tope de la cache — el working set real es ~MAX_BATCHES × stories por
   * batch (decenas), pero sin tope el Map crecería de por vida del proceso
   * a medida que los batches rotan fuera de la ventana de 20 (qa-reviewer
   * 2026-06-11). 500 da holgura de sobra sin riesgo de memoria.
   */
  private static readonly MAX_CACHE_ENTRIES = 500;

  /**
   * Clave compuesta `owner/repo#number` — defensa contra el cambio del
   * repo activo (hoy "primer forgeWritable gana"): si el operador cambia
   * el repo, los snapshots del repo anterior no contaminan al nuevo.
   */
  private readonly snapshotCache = new Map<string, CachedSnapshot>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly branchStrategy: BranchStrategyService,
    @InjectPinoLogger(ForgePrsService.name) private readonly logger: PinoLogger,
  ) {}

  async listPrs(user: AuthenticatedUser): Promise<ForgePrsResponse> {
    const branchCfg = await this.branchStrategy.getOrInitDefault();
    const repoInfo = await this.github.getActiveRepoInfo();

    // Pod gating consistente con listQueue/getBatchDetail (CWE-639):
    // no-AltaGerencia solo ve los batches de sus pods.
    const where: Record<string, unknown> = {
      enqueuedBatchId: { not: null },
    };
    if (user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      if (userPodIds.length === 0) {
        return {
          repoUrl: repoInfo?.htmlUrl ?? null,
          stagingBranch: branchCfg.devBranch,
          prs: [],
        };
      }
      where.pods = { some: { podId: { in: userPodIds } } };
    }

    const epics = await this.prisma.epic.findMany({
      where,
      orderBy: { enqueuedAt: 'desc' },
      take: ForgePrsService.MAX_BATCHES,
      select: {
        id: true,
        title: true,
        enqueuedBatchId: true,
        forgeBranch: true,
        consolidatedPrNumber: true,
        consolidatedPrCreatedAt: true,
        consolidatedPrMergedAt: true,
        stagingApprovedAt: true,
        stories: {
          select: {
            id: true,
            title: true,
            status: true,
            agentRuns: {
              where: { prNumber: { not: null } },
              // Más reciente primero — en el dedupe por prNumber (retries
              // que reúsan la misma story branch) gana el run más nuevo.
              orderBy: { startedAt: 'desc' },
              select: {
                id: true,
                prNumber: true,
                branch: true,
                attempts: true,
                dodVerification: true,
                filesModified: true,
                startedAt: true,
                completedAt: true,
                node: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // ── 1. Items base desde la BD ────────────────────────────────────────
    type BaseItem = Omit<
      ForgePrItem,
      'url' | 'title' | 'status' | 'live' | 'additions' | 'deletions' | 'files' | 'createdAt' | 'mergedAt'
    > & {
      fallbackTitle: string;
      fallbackStatus: 'open' | 'merged';
      fallbackFiles: number | null;
      fallbackCreatedAt: string;
      fallbackMergedAt: string | null;
    };

    const baseItems: BaseItem[] = [];
    for (const epic of epics) {
      // enqueuedBatchId nunca es null por el where, pero el tipo de Prisma
      // no lo sabe — narrow defensivo.
      const batchId = epic.enqueuedBatchId;
      if (!batchId) continue;

      // Mismo fallback que approveStagingGate: la integration branch puede
      // existir en remote aunque epic.forgeBranch sea NULL (enqueue en
      // sandbox + worker pushó después).
      const integrationBranch =
        epic.forgeBranch ?? `${branchCfg.forgeBranchPrefix}${epic.id.slice(0, 8)}`;

      // Dedupe por prNumber a nivel ÉPICA: retries reúsan la story branch
      // determinística (`forge/epic-X/story-Y`), así que dos runs pueden
      // apuntar al mismo PR (openStoryPullRequest es idempotente). Scope
      // per-epic y no per-story — si un bug upstream asignara el mismo
      // prNumber a dos stories, con scope per-story emitiríamos dos cards
      // idénticas en silencio (qa-reviewer 2026-06-11). Gana el run más
      // reciente (el orderBy desc garantiza que se procesa primero).
      const seenPrNumbers = new Set<number>();
      for (const story of epic.stories) {
        for (const run of story.agentRuns) {
          if (run.prNumber === null || seenPrNumbers.has(run.prNumber)) continue;
          seenPrNumbers.add(run.prNumber);
          baseItems.push({
            id: `run-${run.id}`,
            kind: 'story',
            number: run.prNumber,
            batchId,
            epicId: epic.id,
            epicTitle: epic.title,
            storyId: story.id,
            storyTitle: story.title,
            agentName: run.node?.name ?? null,
            branch: run.branch,
            targetBranch: integrationBranch,
            dodStatus: deriveDodStatus(run.dodVerification),
            attempts: run.attempts ?? null,
            fallbackTitle: `[Forge] ${story.title}`,
            // Sin GitHub solo podemos inferir: el auto-merge corre en
            // completeRun y la story queda 'done' — merged probable.
            fallbackStatus: story.status === 'done' ? 'merged' : 'open',
            fallbackFiles: run.filesModified ?? null,
            // El PR nace en completeRun ⇒ completedAt es la mejor
            // aproximación local a su creación.
            fallbackCreatedAt: (run.completedAt ?? run.startedAt ?? new Date(0)).toISOString(),
            fallbackMergedAt: null,
          });
        }
      }

      if (epic.consolidatedPrNumber !== null) {
        baseItems.push({
          id: `staging-${epic.id}`,
          kind: 'staging',
          number: epic.consolidatedPrNumber,
          batchId,
          epicId: epic.id,
          epicTitle: epic.title,
          storyId: null,
          storyTitle: null,
          agentName: null,
          branch: integrationBranch,
          targetBranch: branchCfg.devBranch,
          dodStatus: null,
          attempts: null,
          fallbackTitle: `[Staging] ${epic.title}`,
          fallbackStatus: epic.consolidatedPrMergedAt ? 'merged' : 'open',
          fallbackFiles: null,
          fallbackCreatedAt: (
            epic.consolidatedPrCreatedAt ??
            epic.stagingApprovedAt ??
            new Date(0)
          ).toISOString(),
          fallbackMergedAt: epic.consolidatedPrMergedAt?.toISOString() ?? null,
        });
      }
    }

    // ── 2. Snapshots vivos de GitHub (solo si hay repo activo) ──────────
    const snapshots = repoInfo
      ? await this.fetchSnapshots(
          repoInfo,
          [...new Set(baseItems.map((i) => i.number))],
        )
      : new Map<number, PrSnapshot>();

    // ── 3. Merge BD + GitHub ────────────────────────────────────────────
    const prs: ForgePrItem[] = baseItems.map((item) => {
      const snap = snapshots.get(item.number);
      const {
        fallbackTitle,
        fallbackStatus,
        fallbackFiles,
        fallbackCreatedAt,
        fallbackMergedAt,
        ...rest
      } = item;
      if (!snap) {
        return {
          ...rest,
          url: repoInfo ? `${repoInfo.htmlUrl}/pull/${item.number}` : null,
          title: fallbackTitle,
          status: fallbackStatus,
          live: false,
          additions: null,
          deletions: null,
          files: fallbackFiles,
          createdAt: fallbackCreatedAt,
          mergedAt: fallbackMergedAt,
        };
      }
      return {
        ...rest,
        url: snap.htmlUrl,
        title: snap.title,
        // El branch real de GitHub gana sobre el reconstruido de BD —
        // cubre renames y el caso integration branch con prefix viejo.
        branch: snap.headBranch,
        targetBranch: snap.baseBranch,
        status: this.mapStatus(snap),
        live: true,
        additions: snap.additions,
        deletions: snap.deletions,
        files: snap.changedFiles,
        createdAt: snap.createdAt,
        mergedAt: snap.mergedAt,
      };
    });

    prs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    this.logger.info(
      `[forge-prs] listed: batches=${epics.length} prs=${prs.length} ` +
        `live=${prs.filter((p) => p.live).length} repo=${repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : 'sandbox'}`,
    );

    return {
      repoUrl: repoInfo?.htmlUrl ?? null,
      stagingBranch: branchCfg.devBranch,
      prs,
    };
  }

  /**
   * Resuelve snapshots para una lista de PR numbers: cache fresca → hit;
   * vencida o ausente → fetch en lotes de GITHUB_CONCURRENCY; fetch fallido
   * → stale-while-error (sirve la entrada vencida si existe).
   */
  private async fetchSnapshots(
    repoInfo: { owner: string; repo: string },
    numbers: number[],
  ): Promise<Map<number, PrSnapshot>> {
    this.pruneCacheIfNeeded();
    const now = Date.now();
    const result = new Map<number, PrSnapshot>();
    const toFetch: number[] = [];

    for (const number of numbers) {
      const cached = this.snapshotCache.get(this.cacheKey(repoInfo, number));
      if (cached && now - cached.fetchedAt < this.ttlFor(cached.snap)) {
        result.set(number, cached.snap);
      } else {
        toFetch.push(number);
      }
    }

    let fetchErrors = 0;
    for (let i = 0; i < toFetch.length; i += ForgePrsService.GITHUB_CONCURRENCY) {
      const batch = toFetch.slice(i, i + ForgePrsService.GITHUB_CONCURRENCY);
      await Promise.all(
        batch.map(async (number) => {
          const key = this.cacheKey(repoInfo, number);
          try {
            const snap = await this.github.getPullRequestSnapshot(number);
            this.snapshotCache.set(key, { snap, fetchedAt: Date.now() });
            result.set(number, snap);
          } catch (err) {
            fetchErrors++;
            // Stale-while-error: una snapshot vencida sigue siendo más
            // fiel que el fallback de BD (que no tiene diffstat ni título).
            const stale = this.snapshotCache.get(key);
            if (stale) result.set(number, stale.snap);
            this.logger.warn(
              `[forge-prs] snapshot #${number} falló (${(err as Error).message}) — ` +
                (stale ? 'sirviendo cache vencida' : 'degradando a fallback BD'),
            );
          }
        }),
      );
    }

    if (toFetch.length > 0) {
      this.logger.info(
        `[forge-prs] github snapshots: requested=${numbers.length} ` +
          `cacheHits=${numbers.length - toFetch.length} fetched=${toFetch.length - fetchErrors} errors=${fetchErrors}`,
      );
    }
    return result;
  }

  /**
   * Poda la cache cuando supera el tope: primero las entradas vencidas
   * (TTL cumplido), y si no basta, las más viejas por fetchedAt hasta
   * volver al tope. Llamada al inicio de cada fetchSnapshots — coste
   * O(n log n) solo cuando se excede, n acotado por el tope mismo.
   */
  private pruneCacheIfNeeded(): void {
    if (this.snapshotCache.size <= ForgePrsService.MAX_CACHE_ENTRIES) return;

    const now = Date.now();
    for (const [key, cached] of this.snapshotCache) {
      if (now - cached.fetchedAt >= this.ttlFor(cached.snap)) {
        this.snapshotCache.delete(key);
      }
    }
    if (this.snapshotCache.size <= ForgePrsService.MAX_CACHE_ENTRIES) return;

    const oldestFirst = [...this.snapshotCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt,
    );
    const excess = this.snapshotCache.size - ForgePrsService.MAX_CACHE_ENTRIES;
    for (const [key] of oldestFirst.slice(0, excess)) {
      this.snapshotCache.delete(key);
    }
  }

  private cacheKey(repoInfo: { owner: string; repo: string }, number: number): string {
    return `${repoInfo.owner}/${repoInfo.repo}#${number}`;
  }

  private ttlFor(snap: PrSnapshot): number {
    return snap.merged || snap.state === 'closed'
      ? ForgePrsService.TTL_TERMINAL_MS
      : ForgePrsService.TTL_OPEN_MS;
  }

  private mapStatus(snap: PrSnapshot): ForgePrItem['status'] {
    if (snap.merged) return 'merged';
    if (snap.state === 'closed') return 'closed';
    if (snap.draft) return 'draft';
    return 'open';
  }
}
