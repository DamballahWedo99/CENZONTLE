import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import {
  AuthenticatedUser,
  UserRole,
  epicMarkdownHasAllHeadings,
  type DoomLoopKind,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { ChangelogService } from '../../proyectos/changelog/changelog.service';
import { assertUserCanAccessEpicPods } from '../../proyectos/epics/epic-access.util';
import { BranchStrategyService } from '../branch-strategy/branch-strategy.service';
import { GitHubService } from '../github/github.service';
import { extractFailureInfo } from './failure-info';
import { isAwaitingHumanGate } from './gate-readiness';
import { computeRunStats } from './run-stats';
import { classifyStoryRetryability } from './retry-eligibility';

/**
 * Detail completo de un batch — usado por el dashboard `/factory/batch/:id`.
 * Reemplaza el shape mock previo. Conecta Epic + Stories + AgentRuns reales.
 */
export interface BatchDetailResponse {
  batchId: string;
  epicId: string;
  epicTitle: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  forgeBranch: string | null;
  /** URL del repo activo en GitHub (ej. `https://github.com/owner/repo`). NULL
   *  si no hay code repository forgeWritable configurado (sandbox mode).
   *  El frontend lo combina con `forgeBranch` para construir el link
   *  clickeable a la branch — antes esto estaba hardcoded en el cliente. */
  repoUrl: string | null;
  /** ISO timestamp del approval del Tech Lead, NULL si no aprobado. El
   *  frontend lo usa para derivar `currentLayer = Staging` (sin esto, el
   *  batch se queda visualmente en Forge incluso después del approval). */
  stagingApprovedAt: string | null;
  /** Nombre legible del aprobador (mismo valor que persistimos en DB). */
  stagingApprovedByName: string | null;
  /** Número del consolidated PR a DEV — NULL si nunca se abrió (sandbox
   *  real, branch no existía, etc.). */
  consolidatedPrNumber: number | null;
  /** ISO timestamp del merge del consolidated PR a DEV. NULL si el PR existe
   *  pero aún no se mergeó (conflict, branch protection, retry pendiente). */
  consolidatedPrMergedAt: string | null;
  enqueuedAt: string;
  /** Earliest startedAt across all AgentRuns del batch. Null si nunca corrió. */
  runStartedAt: string | null;
  storiesCount: number;
  storiesDone: number;
  storiesInProgress: number;
  /** Misma señal que listQueue — true cuando todas las stories están done
   *  pero la épica sigue en queue (esperando approval humano). */
  awaitingHumanGate: boolean;
  /** Cost agregado en USD — suma de `dodVerification[].verdicts[].usage.totalCostUsd`
   *  across all runs. Es un estimate client-side del SDK Anthropic (Tier 1
   *  Harness) — no billing autoritativo. */
  totalCostUsd: number;
  /** Tokens agregados (suma de new + cached) across all runs. Legacy field
   *  para clientes que aún consumen el conteo plano. UI nueva usa el split. */
  totalTokens: number;
  /** Tokens "nuevos" — input + output + cache_creation. Billable a precio
   *  completo. Para Haiku 4.5 típicamente <10% del total. */
  totalTokensNew: number;
  /** Tokens "cached" — cache_read solamente. Re-lecturas del cache, billable
   *  a $0.10/1M (10x más barato). Típicamente >85% del total. Separamos para
   *  evitar el efecto "1.5M tokens" engañoso en el UI cuando la mayoría son
   *  re-lecturas que no representan trabajo nuevo del modelo. */
  totalTokensCached: number;
  stories: BatchStoryDetail[];
  /** Número total de waves topológicas del DAG (`waves[0..waveCount)`). */
  waveCount: number;
}

export interface BatchStoryDetail {
  id: string;
  title: string;
  /** StoryStatus enum value (string en el wire). */
  status: string;
  storyPoints: number;
  /** Índice de la wave topológica (0-based) que el algoritmo asigna esta
   *  story según sus dependencies hard. */
  waveNumber: number;
  /** IDs de stories que bloquean a ésta (hard deps). El frontend reconstruye
   *  edges del DAG con esto. */
  blockedByIds: string[];
  /** AgentRun más reciente de la story (incluye el activo si lo hay).
   *  Null si la story nunca fue claimed. */
  latestRun: BatchStoryRun | null;
}

export interface BatchStoryRun {
  id: string;
  /** AgentRunStatus enum value (string en el wire). */
  status: string;
  branch: string;
  nodeId: string;
  prNumber: number | null;
  exitCode: number | null;
  errorMessage: string | null;
  /** ISO timestamp del inicio del run, o null durante la ventana entre
   *  INSERT (status='claimed') y transición a 'running'. El mapper hace
   *  `?.toISOString() ?? null` — el wire CAN return null (qa-reviewer
   *  2026-05-19; type lie pre-existente corregido). */
  startedAt: string | null;
  completedAt: string | null;
  /** Cost del run en USD — suma del generator + sus verifier calls. */
  costUsd: number;
  /** Tokens "nuevos" del run (input + output + cache_creation, billable a
   *  precio full). NO incluye cache_read porque inflaría el conteo con
   *  re-lecturas que no representan trabajo nuevo del modelo. */
  tokensNew: number;
  /** Archivos modificados en el diff base..HEAD calculado por el worker
   *  post-push. NULL si el run no llegó a push (sandbox, push falló). */
  filesModified: number | null;
  /** Cuántos attempts del DoD enforcement loop ejecutó el worker.
   *  1 = primer intento clean. 2-3 = el agente necesitó retries tras fallar
   *  verificación. NULL si el run nunca llegó al verifier (claimed→failed
   *  por error temprano). UI lo usa para distinguir "fallo limpio" vs
   *  "agente atorado". */
  attempts: number | null;
  /** Si el worker abortó por doom loop, qué tipo:
   *  - 'regression': passedCount bajó entre attempts (agente rompió criterios
   *    que antes pasaban — daño activo, escalación inmediata)
   *  - 'stagnation': passedCount no aumentó (atorado en mismos criterios)
   *  - null: no fue doom loop (otro tipo de fallo, o no falló)
   *  Detección centralizada en `detectDoomLoopKind` de @cenzontle/shared
   *  para que worker y queue compartan el mismo contrato del errorMessage. */
  doomLoopKind: DoomLoopKind | null;
  /** Checklist COMPLETA del DoD — todos los criterios con su veredicto final
   *  (passed/failed/skipped), merge-ado across attempts con last-wins por
   *  criterionId. Vacío solo si el run nunca llegó al verifier o
   *  dodVerification es null. El merge view la renderiza como checklist para
   *  que el TechLead vea qué se cumplió y qué no — no solo los fallos.
   *  `reason` lleva el motivo en los failed/skipped; vacío en los passed. */
  criteria: Array<{
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'skipped';
    reason: string;
  }>;
}

export interface EnqueuedBatch {
  batchId: string;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  enqueuedAt: string;
  enqueuedBy: string;
  enqueuedByName: string;
  // Runtime data — necesario para que el frontend renderice el card como
  // "active" cuando la épica está siendo procesada por el Forge:
  /** Priority del Epic (mapeado de Prisma `Priority` enum). */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Stories en status='done' (ya procesadas por Forge — sandbox o post-merge). */
  storiesDone: number;
  /** Stories actualmente reclamadas/corriendo en algún worker. */
  storiesInProgress: number;
  /** Number de AgentRuns activos asociados a esta epic (= storiesInProgress). */
  agentCount: number;
  /** ISO timestamp del primer run activo (start of "active" period). Null si nunca corrió. */
  runStartedAt: string | null;
  /** Branch de integración del Forge si ya fue creada. */
  forgeBranch: string | null;
  /** True cuando todas las stories están done (`storiesDone === storiesCount`)
   *  pero la épica sigue en queue (enqueuedAt set). Significa que el flow del
   *  Forge terminó y la épica está esperando approval humano antes de pasar
   *  a Staged. El frontend usa este campo para mantenerla en la columna FORGE
   *  del Pipeline Board (no regresarla a IN QUEUE cuando ya no hay agentes
   *  activos). Cuando se implemente el modelo real de HumanGate, este campo
   *  se derivará del gate.decision en vez de storiesDone — la semántica del
   *  consumer no cambia. */
  awaitingHumanGate: boolean;
  /** ISO timestamp del momento en que la última story de la épica terminó
   *  (max de stories.agentRuns[0].completedAt cuando TODAS están done). NULL
   *  mientras hay stories sin terminar. Permite que el card del Pipeline
   *  congele el reloj cuando la épica completa, en lugar de seguir tickeando. */
  completedAt: string | null;
  /** Cost agregado en USD across todos los runs de la épica (generator +
   *  verifier). Para mostrar en el card del Pipeline sin tener que abrir el
   *  batch detail. */
  totalCostUsd: number;
  /** Tokens "nuevos" agregados (input + output + cache_creation). NO incluye
   *  cache_reads para evitar el efecto engañoso "1.5M tokens" en re-lecturas. */
  totalTokensNew: number;
  /** Tokens cached (cache_read) agregados, separados para transparencia. */
  totalTokensCached: number;
  /** ISO timestamp del approval del Tech Lead — derivamos `currentLayer =
   *  Staging` cuando este campo está set. Sin esto, el Pipeline Board mantiene
   *  el batch en la columna Forge incluso después del approval persistido,
   *  porque el synthetic batch hardcoded `currentLayer: Forge`. */
  stagingApprovedAt: string | null;
  /** ISO timestamp del arranque de la campaña QA — el frontend mueve el batch
   *  a la columna QA TESTING cuando está set (precedencia sobre Staged). */
  qaStartedAt: string | null;
  /** ISO timestamp del fin de la campaña QA (QAReport listo). */
  qaCompletedAt: string | null;
  /** Estado de la campaña QA más reciente (para el card en QA Testing). */
  qaStatus: string | null;
  /** Recomendación del QAReport (rollout/rollback). */
  qaRecommendation: string | null;
  /** Confianza 0-100 del QAReport. */
  qaConfidence: number | null;
  /** ISO timestamp del approval del release gate — el frontend mueve el batch
   *  a la columna RELEASED cuando está set (precedencia sobre QA Testing). */
  releaseApprovedAt: string | null;
}

/**
 * Service para gestionar la cola "in queue" del Forge — paso 0 del roadmap
 * de software factory. Responsabilidad:
 *
 *  - Encolar épicas completas (con los 3 VoBos approved + artefactos completos).
 *  - Listar épicas en cola para el dashboard del Factory.
 *
 * Modelo KISS: por ahora solo seteamos `epic.enqueuedAt` y `epic.enqueuedBatchId`
 * directamente en la fila de la épica. En el Mes 1 del roadmap esto migrará
 * a una tabla `SprintBatch` con relación many-to-one para soportar wave
 * planning y reintentos.
 */
@Injectable()
export class FactoryQueueService {
  constructor(
    private prisma: PrismaService,
    private changelog: ChangelogService,
    private branchStrategy: BranchStrategyService,
    private github: GitHubService,
    private auth: AuthService,
    // Logger general del service. Para logs específicos del ensure de
    // integration branches usamos `forgeEnsureLogger` con namespace separado
    // (`forge.ensure.*`) queryables como events independientes en Loki.
    @InjectPinoLogger(FactoryQueueService.name)
    private readonly logger: PinoLogger,
    @InjectPinoLogger('forge.ensure')
    private readonly forgeEnsureLogger: PinoLogger,
  ) {}

  /**
   * Encola una épica al Forge. Validaciones:
   *  1. Épica existe y user tiene acceso (pod intersection).
   *  2. Épica está completa: 9 headings + diagrama negocio + ≥1 historia.
   *  3. Los 3 VoBos están approved (PO, TL, QA).
   *  4. Idempotency: si ya está encolada, lanza Conflict.
   *
   * Side effects:
   *  - Setea epic.enqueuedAt = now, epic.enqueuedBatchId = nuevo UUID.
   *  - Crea ChangelogEntry con action='created' field='enqueuedAt' para
   *    trazabilidad — cualquier auditor puede ver quién encoló qué y cuándo.
   */
  async enqueueEpic(
    epicId: string,
    user: AuthenticatedUser,
  ): Promise<EnqueuedBatch> {
    this.logger.info(`[enqueue] START epicId=${epicId} userId=${user.sub}`);

    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        pods: { select: { podId: true } },
        stories: { select: { id: true, storyPoints: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    // 1. Pod intersection
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    // 2. Idempotency — épica ya encolada
    if (epic.enqueuedAt) {
      throw new ConflictException(
        `La épica ya fue enviada al Forge el ${epic.enqueuedAt.toISOString()} (batch ${epic.enqueuedBatchId})`,
      );
    }

    // 3. Validar artefactos: definición + diagrama + historias
    if (!epicMarkdownHasAllHeadings(epic.markdown)) {
      throw new BadRequestException(
        'La épica no tiene la definición completa (faltan headings obligatorios)',
      );
    }
    const diagrams = (epic.diagrams as Array<{ type?: string }> | null) ?? [];
    const hasBusinessDiagram = diagrams.some((d) => d?.type === 'business');
    if (!hasBusinessDiagram) {
      throw new BadRequestException('La épica no tiene diagrama de negocio generado');
    }
    if (epic.stories.length === 0) {
      throw new BadRequestException(
        'La épica no tiene historias de usuario generadas',
      );
    }

    // 4. Validar los 3 VoBos approved
    const po = epic.poApproval as { status?: string } | null;
    const tl = epic.tlApproval as { status?: string } | null;
    const qa = epic.qaApproval as { status?: string } | null;
    if (po?.status !== 'approved') {
      throw new BadRequestException('Falta el VoBo del Product Owner');
    }
    if (tl?.status !== 'approved') {
      throw new BadRequestException('Falta el VoBo del Tech Lead');
    }
    if (qa?.status !== 'approved') {
      throw new BadRequestException('Falta el VoBo de QA');
    }

    // 5. Crear integration branch en GitHub (Sprint 4 Fase 2).
    // Estrategia: ANTES del transaction de DB. Si la creación falla, el
    // operador no debería tener una épica enqueued sin branch — eso causa
    // que workers reclamen y fallen al pushear. Mejor fail-fast con error
    // accionable.
    //
    // Fallback graceful: si NO hay repo configurado (ej. dashboard recién
    // instalado o user testing en sandbox mode), seguimos sin branch.
    // El AgentRunService maneja `forgeBranch=null` igual que antes.
    const now = new Date();
    const batchId = randomUUID();
    const userName = user.name || user.email || user.sub;

    let forgeBranchData: {
      forgeBranch: string;
      forgeBranchCreatedAt: Date;
      forgeBranchBaseSha: string;
    } | null = null;

    try {
      const strategy = await this.branchStrategy.getOrInitDefault();
      const branchName = `${strategy.forgeBranchPrefix}${epicId.slice(0, 8)}`;
      const result = await this.github.createIntegrationBranch({
        branchName,
        devBranch: strategy.devBranch,
        epicId,
      });
      forgeBranchData = {
        forgeBranch: result.branchName,
        forgeBranchCreatedAt: now,
        forgeBranchBaseSha: result.baseSha,
      };
      this.logger.info(
        `[enqueue] integration branch ready: ${result.branchName} @${result.baseSha.slice(0, 7)} (alreadyExisted=${result.alreadyExisted})`,
      );
    } catch (err) {
      // Sandbox mode: si NO hay repo configurado (NotFoundException con
      // mensaje específico), loggeamos warn y seguimos sin branch. El
      // claim/run flow funciona sin push (agent-run sandbox mode — exit 0
      // sin PR avanza la story a 'done').
      const isNoRepoConfigured =
        err instanceof NotFoundException &&
        (err as Error).message?.includes('No hay code repository enabled');

      if (isNoRepoConfigured) {
        this.logger.warn(
          `[enqueue] No hay code repository configurado — encolando en SANDBOX MODE (sin integration branch). ` +
            `Configura un repo en /factory/settings → Código para flow real con PRs.`,
        );
      } else {
        // Otra falla (auth GitHub, devBranch no existe, etc.) → throw con
        // mensaje del GitHubService que ya es accionable.
        throw err;
      }
    }

    await this.prisma.$transaction([
      this.prisma.epic.update({
        where: { id: epicId },
        data: {
          enqueuedAt: now,
          enqueuedBatchId: batchId,
          ...(forgeBranchData ?? {}),
          updatedAt: now,
        },
      }),
      this.prisma.changelogEntry.create({
        data: {
          entityType: 'epic',
          entityId: epicId,
          entityTitle: epic.title,
          action: 'created',
          field: 'enqueuedAt',
          oldValue: null,
          newValue: forgeBranchData
            ? `Enviada al Forge por ${userName} (batch ${batchId.slice(0, 8)}, branch ${forgeBranchData.forgeBranch})`
            : `Enviada al Forge por ${userName} (batch ${batchId.slice(0, 8)}, sandbox mode sin branch)`,
          changedById: user.sub,
          changedByName: userName,
        },
      }),
    ]);

    const totalStoryPoints = epic.stories.reduce(
      (sum, s) => sum + (s.storyPoints ?? 0),
      0,
    );

    this.logger.info(
      `[enqueue] OK epicId=${epicId} batchId=${batchId} storiesCount=${epic.stories.length}`,
    );

    return {
      batchId,
      epicId: epic.id,
      epicTitle: epic.title,
      storiesCount: epic.stories.length,
      totalStoryPoints,
      enqueuedAt: now.toISOString(),
      // Campos runtime — recién encolada, ningún run aún:
      priority: epic.priority as 'critical' | 'high' | 'medium' | 'low',
      storiesDone: 0,
      storiesInProgress: 0,
      agentCount: 0,
      runStartedAt: null,
      forgeBranch: forgeBranchData?.forgeBranch ?? null,
      // awaitingHumanGate: false al enqueue inicial — la épica acaba de
      // entrar al flow, ninguna story está done todavía. Solo se vuelve true
      // cuando listQueue() recalcula y todas las stories completaron.
      awaitingHumanGate: false,
      // Aggregates iniciales: 0 hasta que listQueue() los recalcule con
      // datos reales de los runs.
      completedAt: null,
      totalCostUsd: 0,
      totalTokensNew: 0,
      totalTokensCached: 0,
      // Staging gate aún no aprobado al enqueue — siempre null inicial.
      stagingApprovedAt: null,
      // QA/Release aún no arrancados al enqueue — siempre null inicial.
      qaStartedAt: null,
      qaCompletedAt: null,
      qaStatus: null,
      qaRecommendation: null,
      qaConfidence: null,
      releaseApprovedAt: null,
      enqueuedBy: user.sub,
      enqueuedByName: userName,
    };
  }

  /**
   * Lista las épicas actualmente en cola para el dashboard del Factory.
   * Filtra por pods del usuario (no-AltaGerencia ven solo sus pods).
   * Orden: las más antiguas primero (FIFO de procesamiento).
   */
  async listQueue(user: AuthenticatedUser): Promise<EnqueuedBatch[]> {
    const where: Record<string, unknown> = {
      enqueuedAt: { not: null },
    };

    // Pod gating consistente con el listing de épicas (CWE-639).
    if (user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      if (userPodIds.length === 0) return [];
      where.pods = { some: { podId: { in: userPodIds } } };
    }

    const epics = await this.prisma.epic.findMany({
      where,
      include: {
        stories: {
          select: {
            id: true,
            storyPoints: true,
            status: true,
            // Traemos TODOS los runs (no solo activos) para poder agregar
            // cost/tokens/completedAt en el listing del Pipeline. El extra
            // overhead es marginal (~3-10 rows por epic) y evita una query
            // separada o que el frontend tenga que llamar batch-detail
            // por cada card del Pipeline solo para ver el cost agregado.
            agentRuns: {
              select: {
                id: true,
                startedAt: true,
                completedAt: true,
                status: true,
                generatorUsage: true,
                dodVerification: true,
                plannerUsage: true,
              },
              orderBy: { startedAt: 'desc' },
            },
          },
        },
        // Última campaña QA — el frontend muestra su estado/recomendación en el
        // card de la columna QA TESTING.
        qaRuns: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { status: true, recommendation: true, confidence: true },
        },
      },
      orderBy: { enqueuedAt: 'asc' },
    });

    return epics
      .filter((e) => e.enqueuedAt && e.enqueuedBatchId)
      .map((e) => {
        // Cuenta stories por estado para que el frontend muestre el
        // progress bar correcto cuando la épica está activa en Forge.
        const storiesDone = e.stories.filter((s) => s.status === 'done').length;
        // 'in_review': PR abierto esperando merge humano. El Forge ya
        // terminó su parte (claude generó, verifier validó, PR abierto) —
        // pendiente del operador. Cuenta como "progress" del epic en la
        // columna FORGE (fix 2026-05-13: sin esto las épicas con stories
        // en in_review caen a IN QUEUE cuando los slots se liberan, lo cual
        // confunde al operador porque hay trabajo del Forge ya hecho).
        const storiesInReview = e.stories.filter((s) => s.status === 'in_review').length;
        // storiesInProgress: solo claimed/running (los slots ocupados).
        // Antes el query filtraba por status, ahora traemos todos y filtramos
        // acá porque también necesitamos los runs completados para agregar
        // cost/tokens/completedAt del epic.
        const storiesInProgress = e.stories.reduce(
          (sum, s) =>
            sum +
            s.agentRuns.filter((r) => r.status === 'claimed' || r.status === 'running').length,
          0,
        );
        // Earliest startedAt across runs — "epic empezó a procesarse" para
        // el duration calc del card (start time del card timer).
        let earliestRunStartedAt: Date | null = null;
        // Latest completedAt across runs cuando TODAS las stories están done —
        // permite que el reloj del card se congele cuando termina el batch.
        let latestRunCompletedAt: Date | null = null;
        // Aggregates de cost/tokens iterando los Json fields de cada run.
        let totalCostUsd = 0;
        let totalTokensNew = 0;
        let totalTokensCached = 0;
        for (const s of e.stories) {
          for (const r of s.agentRuns) {
            if (!earliestRunStartedAt || r.startedAt < earliestRunStartedAt) {
              earliestRunStartedAt = r.startedAt;
            }
            if (r.completedAt && (!latestRunCompletedAt || r.completedAt > latestRunCompletedAt)) {
              latestRunCompletedAt = r.completedAt;
            }
            // Generator usage (Json column del worker)
            const gen = r.generatorUsage as Record<string, unknown> | null;
            if (gen && typeof gen === 'object') {
              if (typeof gen.totalCostUsd === 'number') totalCostUsd += gen.totalCostUsd;
              if (typeof gen.totalInputTokens === 'number') totalTokensNew += gen.totalInputTokens;
              if (typeof gen.totalOutputTokens === 'number') totalTokensNew += gen.totalOutputTokens;
              if (typeof gen.totalCacheCreationInputTokens === 'number')
                totalTokensNew += gen.totalCacheCreationInputTokens;
              if (typeof gen.totalCacheReadInputTokens === 'number')
                totalTokensCached += gen.totalCacheReadInputTokens;
            }
            // Verifier usage (dodVerification[].verdicts[].usage)
            const dod = r.dodVerification as unknown;
            if (Array.isArray(dod)) {
              for (const attemptEntry of dod) {
                const verdicts = (attemptEntry as { verdicts?: unknown } | null)?.verdicts;
                if (!Array.isArray(verdicts)) continue;
                for (const v of verdicts) {
                  const usage = (v as { usage?: unknown } | null)?.usage;
                  if (!usage || typeof usage !== 'object') continue;
                  const u = usage as Record<string, unknown>;
                  if (typeof u.totalCostUsd === 'number') totalCostUsd += u.totalCostUsd;
                  if (typeof u.inputTokens === 'number') totalTokensNew += u.inputTokens;
                  if (typeof u.outputTokens === 'number') totalTokensNew += u.outputTokens;
                  if (typeof u.cacheCreationInputTokens === 'number')
                    totalTokensNew += u.cacheCreationInputTokens;
                  if (typeof u.cacheReadInputTokens === 'number')
                    totalTokensCached += u.cacheReadInputTokens;
                }
              }
            }
            // Planner usage (Json column del backend, agregado 2026-05-18).
            // Sumamos executor (Sonnet) + advisor (Opus) tokens al "new" bucket
            // y el totalCostUsd ya viene calculado con price tables Anthropic.
            const planner = r.plannerUsage as Record<string, unknown> | null;
            if (planner && typeof planner === 'object') {
              if (typeof planner.totalCostUsd === 'number') totalCostUsd += planner.totalCostUsd;
              if (typeof planner.executorTokensIn === 'number') totalTokensNew += planner.executorTokensIn;
              if (typeof planner.executorTokensOut === 'number') totalTokensNew += planner.executorTokensOut;
              if (typeof planner.advisorTokensIn === 'number') totalTokensNew += planner.advisorTokensIn;
              if (typeof planner.advisorTokensOut === 'number') totalTokensNew += planner.advisorTokensOut;
            }
          }
        }

        // awaitingHumanGate: todas las stories en estado terminal (done,
        // in_review o blocked). Lógica unificada con getBatchDetail en
        // `isAwaitingHumanGate` — ver gate-readiness.ts para el detalle.
        const storiesCount = e.stories.length;
        const awaitingHumanGate = isAwaitingHumanGate(
          e.stories.map((s) => s.status),
        );

        // completedAt: el momento de cierre del batch — congela el reloj del
        // card del Pipeline. El Forge "terminó" cuando todas las stories
        // están en estado terminal (= awaitingHumanGate), INCLUIDAS las
        // `blocked`. Antes la condición era solo `done`, así que un batch con
        // una story bloqueada dejaba el reloj corriendo para siempre
        // (bug 2026-05-20). latestRunCompletedAt ya incluye los runs `failed`.
        const completedAtIso =
          awaitingHumanGate && latestRunCompletedAt
            ? latestRunCompletedAt.toISOString()
            : null;

        return {
          batchId: e.enqueuedBatchId!,
          epicId: e.id,
          epicTitle: e.title,
          storiesCount,
          totalStoryPoints: e.stories.reduce(
            (sum, s) => sum + (s.storyPoints ?? 0),
            0,
          ),
          enqueuedAt: e.enqueuedAt!.toISOString(),
          // No exponemos enqueuedBy en el listing — viene del changelog
          // si se necesita auditar.
          enqueuedBy: '',
          enqueuedByName: '',
          priority: e.priority as 'critical' | 'high' | 'medium' | 'low',
          storiesDone,
          storiesInReview,
          storiesInProgress,
          agentCount: storiesInProgress,
          runStartedAt: earliestRunStartedAt?.toISOString() ?? null,
          forgeBranch: e.forgeBranch,
          awaitingHumanGate,
          completedAt: completedAtIso,
          totalCostUsd,
          totalTokensNew,
          totalTokensCached,
          // Staging approval state — el frontend lo usa para mover el batch
          // de la columna Forge a Staged del Pipeline Board. Sin esto, el
          // synthetic batch quedaba siempre en Forge incluso después del
          // approval persistido.
          stagingApprovedAt: e.stagingApprovedAt?.toISOString() ?? null,
          // QA/Release state — el frontend deriva las columnas QA TESTING y
          // RELEASED de estos timestamps (precedencia: released > qa > staged).
          qaStartedAt: e.qaStartedAt?.toISOString() ?? null,
          qaCompletedAt: e.qaCompletedAt?.toISOString() ?? null,
          qaStatus: e.qaRuns[0]?.status ?? null,
          qaRecommendation: e.qaRuns[0]?.recommendation ?? null,
          qaConfidence: e.qaRuns[0]?.confidence ?? null,
          releaseApprovedAt: e.releaseApprovedAt?.toISOString() ?? null,
        };
      });
  }

  /**
   * Detail completo de un batch para el dashboard `/factory/batch/:id`.
   * Reemplaza el dashboard previo que usaba `mockEpics`/`mockInitiatives` —
   * ahora devuelve datos reales del Epic + Stories + AgentRuns asociados.
   *
   * Incluye:
   *  - Epic metadata (id, title, priority, forgeBranch)
   *  - Stories con su status + agentRun activo si hay + dependencies
   *  - Wave DAG derivado del story DAG (topological grouping por
   *    StoryDependency hard) — sin tabla nueva ni model nuevo
   *  - Cost agregado: suma de `dodVerification[].verdicts[].usage.totalCostUsd`
   *    across all AgentRuns del batch (el cost tracking ya emitido por el
   *    Tier 1 Harness se materializa acá en agregación read-time)
   *  - awaitingHumanGate: misma señal que listQueue
   *
   * NO incluye HumanGate persistido — todavía es decisión de producto.
   * El frontend muestra UI honesta "Approvals flow en diseño" en vez de
   * mock que finge funcionalidad.
   */
  async getBatchDetail(
    batchId: string,
    user: AuthenticatedUser,
  ): Promise<BatchDetailResponse> {
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      include: {
        pods: { select: { podId: true } },
        stories: {
          orderBy: { createdAt: 'asc' },
          include: {
            agentRuns: {
              orderBy: { startedAt: 'desc' },
              select: {
                id: true,
                status: true,
                branch: true,
                nodeId: true,
                prNumber: true,
                exitCode: true,
                errorMessage: true,
                startedAt: true,
                completedAt: true,
                dodVerification: true,
                generatorUsage: true,
                plannerUsage: true,
                filesModified: true,
              },
            },
            blockedBy: {
              where: { hardness: 'hard' },
              select: { blockedById: true },
            },
          },
        },
      },
    });

    if (!epic) {
      throw new NotFoundException(`Batch ${batchId} no encontrado`);
    }

    // Pod gating consistente con listQueue (CWE-639).
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    // Cost + tokens agregados. Sumamos DOS fuentes:
    //  1. dodVerification[].verdicts[].usage — del verifier Sonnet, persisted
    //     por verdict (cada criterio del DoD que se verificó via Layer 3).
    //  2. generatorUsage — del agente generator Haiku que escribe el código,
    //     persisted como summary across DoD attempts del run.
    //
    // Antes solo sumábamos #1, lo que dejaba el card "Cost" en $0.00 hasta
    // que el verifier corriera — y aun después, sub-reportaba porque omitía
    // el costo del generator (que es típicamente 60-80% del total del run).
    // Read-time sum en vez de columna materializada por ahora; si las queries
    // se vuelven hot path, podemos cachear en epic.totalCostUsd.
    // Trackeamos breakdown separado para forensics — el log final muestra
    // qué fuente aportó cuánto, permitiendo diagnosticar si una capa del
    // pipeline falla (ej. verifier cost = $0 implica que el worker no envió
    // dodVerification, mientras generator = $0 implica gap del stream-json
    // capture en runner.ts).
    let verifierCostUsd = 0;
    // Split: "new" = input + output + cache_creation (tokens procesados por
    // primera vez, billable a full price). "cached" = cache_read (re-lecturas
    // del contexto cacheado, billable a $0.10/1M, 10x más barato).
    // Mostrar el split en la UI evita el efecto "1.5M tokens" engañoso cuando
    // el 90% son re-lecturas del cache.
    let verifierTokensNew = 0;
    let verifierTokensCached = 0;
    let generatorCostUsd = 0;
    let generatorTokensNew = 0;
    let generatorTokensCached = 0;
    // Planner (Sonnet executor + Opus advisor) — fuente nueva 2026-05-18.
    // Trackeamos separado para que el log de forensics distinga las 3 fuentes.
    let plannerCostUsd = 0;
    let plannerTokensNew = 0;
    let runsWithVerifierData = 0;
    let runsWithGeneratorData = 0;
    let runsWithPlannerData = 0;
    let earliestRunStartedAt: Date | null = null;

    for (const story of epic.stories) {
      for (const run of story.agentRuns) {
        if (run.startedAt && (!earliestRunStartedAt || run.startedAt < earliestRunStartedAt)) {
          earliestRunStartedAt = run.startedAt;
        }
        // === Fuente 1: verifier (dodVerification[].verdicts[].usage) ===
        const dod = run.dodVerification as unknown;
        let runHasVerifier = false;
        if (Array.isArray(dod)) {
          for (const attemptEntry of dod) {
            if (!attemptEntry || typeof attemptEntry !== 'object') continue;
            const verdicts = (attemptEntry as { verdicts?: unknown }).verdicts;
            if (!Array.isArray(verdicts)) continue;
            for (const v of verdicts) {
              if (!v || typeof v !== 'object') continue;
              const usage = (v as { usage?: unknown }).usage;
              if (!usage || typeof usage !== 'object') continue;
              const u = usage as Record<string, unknown>;
              if (typeof u.totalCostUsd === 'number') {
                verifierCostUsd += u.totalCostUsd;
                runHasVerifier = true;
              }
              // Split: tokens "new" (billable a precio completo) vs "cached"
              // (re-lecturas del cache, $0.10/1M). El UI muestra ambos para
              // evitar confusión por re-lecturas inflando el total.
              if (typeof u.inputTokens === 'number') verifierTokensNew += u.inputTokens;
              if (typeof u.outputTokens === 'number') verifierTokensNew += u.outputTokens;
              if (typeof u.cacheCreationInputTokens === 'number')
                verifierTokensNew += u.cacheCreationInputTokens;
              if (typeof u.cacheReadInputTokens === 'number')
                verifierTokensCached += u.cacheReadInputTokens;
            }
          }
        }
        if (runHasVerifier) runsWithVerifierData++;
        // === Fuente 2: generator (generatorUsage summary across attempts) ===
        const gen = run.generatorUsage as unknown;
        if (gen && typeof gen === 'object') {
          const g = gen as Record<string, unknown>;
          if (typeof g.totalCostUsd === 'number') {
            generatorCostUsd += g.totalCostUsd;
            runsWithGeneratorData++;
          }
          if (typeof g.totalInputTokens === 'number') generatorTokensNew += g.totalInputTokens;
          if (typeof g.totalOutputTokens === 'number') generatorTokensNew += g.totalOutputTokens;
          if (typeof g.totalCacheCreationInputTokens === 'number')
            generatorTokensNew += g.totalCacheCreationInputTokens;
          if (typeof g.totalCacheReadInputTokens === 'number')
            generatorTokensCached += g.totalCacheReadInputTokens;
        }
        // === Fuente 3: planner (plannerUsage del backend, pre-CLI) ===
        const planner = run.plannerUsage as unknown;
        if (planner && typeof planner === 'object') {
          const p = planner as Record<string, unknown>;
          if (typeof p.totalCostUsd === 'number') {
            plannerCostUsd += p.totalCostUsd;
            runsWithPlannerData++;
          }
          // Executor + advisor tokens son todos "new" — el planner no usa cache_read
          // hoy (single-shot, sin reuso de conversación). Si en futuro se agrega
          // caching: { type: 'ephemeral' } al tool, agregar split aquí.
          if (typeof p.executorTokensIn === 'number') plannerTokensNew += p.executorTokensIn;
          if (typeof p.executorTokensOut === 'number') plannerTokensNew += p.executorTokensOut;
          if (typeof p.advisorTokensIn === 'number') plannerTokensNew += p.advisorTokensIn;
          if (typeof p.advisorTokensOut === 'number') plannerTokensNew += p.advisorTokensOut;
        }
      }
    }
    const totalCostUsd = verifierCostUsd + generatorCostUsd + plannerCostUsd;
    const totalTokensNew = verifierTokensNew + generatorTokensNew + plannerTokensNew;
    const totalTokensCached = verifierTokensCached + generatorTokensCached;
    // totalTokens se mantiene como suma de ambos para backwards compatibility
    // con clientes que aún consuman el campo legacy. UI nueva usa los splits.
    const totalTokens = totalTokensNew + totalTokensCached;
    const totalRuns = epic.stories.reduce((s, st) => s + st.agentRuns.length, 0);

    // ════════════════════════════════════════════════════════════════════
    // DEBUG: log testigo del cost aggregation. Permite diagnosticar el caso
    // "Cost card = $0.00" mostrando si la causa es:
    //   - 0 runs (epic sin actividad)
    //   - runs sin verifier data (cost.received del worker no incluyó dodVerification)
    //   - runs sin generator data (stream-json result event no se capturó)
    //   - todo presente pero suma a 0 (data corrupta — investigar)
    // ════════════════════════════════════════════════════════════════════
    this.logger.info(
      `[getBatchDetail:${batchId.slice(0, 8)}] cost.aggregated: ` +
        `totalRuns=${totalRuns} ` +
        `verifier(runs=${runsWithVerifierData}/${totalRuns}, cost=$${verifierCostUsd.toFixed(4)}, ` +
        `tokens_new=${verifierTokensNew}, tokens_cached=${verifierTokensCached}) ` +
        `generator(runs=${runsWithGeneratorData}/${totalRuns}, cost=$${generatorCostUsd.toFixed(4)}, ` +
        `tokens_new=${generatorTokensNew}, tokens_cached=${generatorTokensCached}) ` +
        `planner(runs=${runsWithPlannerData}/${totalRuns}, cost=$${plannerCostUsd.toFixed(4)}, ` +
        `tokens_new=${plannerTokensNew}) ` +
        `→ TOTAL=$${totalCostUsd.toFixed(4)} tokens_new=${totalTokensNew} tokens_cached=${totalTokensCached}`,
    );

    // Wave DAG: agrupación topológica por StoryDependency hard. Wave 0 =
    // stories sin deps; wave N+1 = stories cuyas deps están todas en
    // waves ≤ N. Algoritmo simple Kahn-like sin librerías externas.
    const storyToWave = new Map<string, number>();
    const remaining = new Set(epic.stories.map((s) => s.id));
    let currentWave = 0;
    while (remaining.size > 0) {
      const thisWave: string[] = [];
      for (const story of epic.stories) {
        if (!remaining.has(story.id)) continue;
        const allDepsResolved = story.blockedBy.every(
          (d) => !remaining.has(d.blockedById),
        );
        if (allDepsResolved) {
          thisWave.push(story.id);
          storyToWave.set(story.id, currentWave);
        }
      }
      if (thisWave.length === 0) {
        // Ciclo en el DAG — defensa, no debería pasar (validado al crear).
        // Asignamos las restantes a la wave actual para no infinito-loopear.
        for (const id of remaining) storyToWave.set(id, currentWave);
        break;
      }
      for (const id of thisWave) remaining.delete(id);
      currentWave++;
    }

    // Construir stories del response con su wave + estado del agentRun
    // más reciente (el array viene ordered desc por startedAt).
    const stories: BatchStoryDetail[] = epic.stories.map((s) => {
      const latestRun = s.agentRuns[0] ?? null;
      const runStats = latestRun ? computeRunStats(latestRun) : null;
      const failureInfo = latestRun
        ? extractFailureInfo(latestRun.dodVerification, latestRun.errorMessage)
        : null;
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        storyPoints: s.storyPoints ?? 0,
        waveNumber: storyToWave.get(s.id) ?? 0,
        blockedByIds: s.blockedBy.map((d) => d.blockedById),
        latestRun:
          latestRun && runStats
            ? {
                id: latestRun.id,
                status: latestRun.status,
                branch: latestRun.branch,
                nodeId: latestRun.nodeId,
                prNumber: latestRun.prNumber,
                exitCode: latestRun.exitCode,
                errorMessage: latestRun.errorMessage,
                // `startedAt` puede ser null durante la ventana entre
                // INSERT del run (status='claimed', enqueuedAt set) y la
                // transición a 'running' (startedAt se setea). Sin optional
                // chaining, el GET /queue/{id}/detail explota con 500
                // "Cannot read properties of null" durante esa ventana —
                // visible si el frontend pollea entre claim y start del run.
                // (bug 2026-05-15, epic e4aee910.)
                startedAt: latestRun.startedAt?.toISOString() ?? null,
                completedAt: latestRun.completedAt?.toISOString() ?? null,
                costUsd: runStats.costUsd,
                tokensNew: runStats.tokensNew,
                filesModified: runStats.filesModified,
                attempts: failureInfo?.attempts ?? null,
                doomLoopKind: failureInfo?.doomLoopKind ?? null,
                criteria: failureInfo?.criteria ?? [],
              }
            : null,
      };
    });

    // Stories counts agregados (idénticos a listQueue para consistencia).
    const storiesDone = epic.stories.filter((s) => s.status === 'done').length;
    const storiesInProgress = epic.stories.reduce(
      (sum, s) =>
        sum +
        s.agentRuns.filter((r) => r.status === 'claimed' || r.status === 'running').length,
      0,
    );
    const storiesCount = epic.stories.length;
    // awaitingHumanGate: lógica unificada con listQueue en isAwaitingHumanGate
    // (gate-readiness.ts). Antes este callsite divergía — contaba solo `done`.
    const awaitingHumanGate = isAwaitingHumanGate(
      epic.stories.map((s) => s.status),
    );

    // Lazy ensure de la integration branch en GitHub. Hay épicas (caso
    // descubierto en producción) que fueron encoladas cuando el repo aún no
    // estaba `forgeWritable=true` — el `enqueueEpic` cayó al graceful catch
    // y dejó `epic.forgeBranch === null` aunque los workers posteriormente
    // pushean a la convention `${prefix}${epic.id.slice(0,8)}`. Sin ensure
    // aquí, el badge "Forge branch" del frontend mostraría el name pero
    // el link a GitHub iría a 404.
    //
    // Best-effort: si no podemos crear/recuperar la branch (no hay repo
    // writable, GitHub down, devBranch missing), retornamos forgeBranch=null
    // y el frontend muestra el name sin link clickeable.
    const ensured = await this.ensureForgeBranch(epic.id, epic.title);
    const effectiveForgeBranch = ensured?.forgeBranch ?? epic.forgeBranch;

    // Repo URL para construir el link "ver branch en GitHub" en el frontend
    // sin hardcodear owner/repo. NULL si no hay repo writable configurado.
    const repoInfo = await this.github.getActiveRepoInfo();
    const repoUrl = repoInfo?.htmlUrl ?? null;

    return {
      batchId,
      epicId: epic.id,
      epicTitle: epic.title,
      priority: epic.priority as 'critical' | 'high' | 'medium' | 'low',
      forgeBranch: effectiveForgeBranch,
      repoUrl,
      // Staging approval state — el frontend deriva `currentLayer` y el
      // estado del gate de estos campos. Sin esto, el batch se queda
      // visualmente en "Awaiting Approval" / "Forge" incluso después del
      // approval persistido en DB.
      stagingApprovedAt: epic.stagingApprovedAt?.toISOString() ?? null,
      stagingApprovedByName: epic.stagingApprovedByName,
      consolidatedPrNumber: epic.consolidatedPrNumber,
      consolidatedPrMergedAt: epic.consolidatedPrMergedAt?.toISOString() ?? null,
      // `enqueuedAt` puede ser null si:
      //  (a) La epic fue descolada manualmente vía queue-cleanup.js pero el
      //      frontend mantiene el batchId en memoria/URL y sigue polleando.
      //  (b) Race transient entre INSERT de epic (sin enqueuedAt) y el cron
      //      que setea enqueuedAt al promocionar a Forge.
      // Sin el optional chaining, ambos casos hacen 500 silenciosamente.
      // Fallback a `new Date(0).toISOString()` (epoch) como sentinel —
      // mejor que null porque el response type requiere `string`. El
      // frontend puede detectar epoch sentinel y mostrar "Descolada".
      // (bug 2026-05-16, epic 62c82fbc.)
      enqueuedAt: epic.enqueuedAt?.toISOString() ?? new Date(0).toISOString(),
      runStartedAt: earliestRunStartedAt?.toISOString() ?? null,
      storiesCount,
      storiesDone,
      storiesInProgress,
      awaitingHumanGate,
      totalCostUsd,
      totalTokens,
      totalTokensNew,
      totalTokensCached,
      stories,
      waveCount: currentWave,
    };
  }

  /**
   * Asegura que la integration branch del Forge exista en GitHub y esté
   * persistida en `epic.forgeBranch`. Idempotente:
   *  - Si `epic.forgeBranch` ya está set, no-op (la branch ya fue creada).
   *  - Si no, intenta `createIntegrationBranch` (que ya es idempotente —
   *    422 "already exists" retorna la branch existente) y persiste el
   *    nombre + SHA en DB.
   *
   * Llamado desde `getBatchDetail` lazy para arreglar épicas legacy que
   * fueron encoladas antes de tener `forgeWritable=true` en el repo (caso
   * descubierto en producción: `epic.forgeBranch=null` pero la branch
   * `${prefix}${epic.id.slice(0,8)}` SÍ existe en GitHub porque los workers
   * la crearon en sus pushes).
   *
   * Returns null si:
   *  - No hay code repository writable (sandbox real).
   *  - El devBranch no existe en remote (config error).
   *  - GitHub API falla (rate limit, auth).
   *
   * NO throw — quien llama solo necesita el nombre del branch si está
   * disponible. Es defense-in-depth, no critical path.
   */
  private async ensureForgeBranch(
    epicId: string,
    epicTitle: string,
  ): Promise<{ forgeBranch: string; forgeBranchCreatedAt: Date } | null> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      select: {
        forgeBranch: true,
        forgeBranchCreatedAt: true,
      },
    });

    // Si ya está persistido, no hay nada que hacer.
    if (epic?.forgeBranch && epic.forgeBranchCreatedAt) {
      return {
        forgeBranch: epic.forgeBranch,
        forgeBranchCreatedAt: epic.forgeBranchCreatedAt,
      };
    }

    try {
      const strategy = await this.branchStrategy.getOrInitDefault();
      const branchName = `${strategy.forgeBranchPrefix}${epicId.slice(0, 8)}`;
      const result = await this.github.createIntegrationBranch({
        branchName,
        devBranch: strategy.devBranch,
        epicId,
      });

      const now = new Date();
      await this.prisma.epic.update({
        where: { id: epicId },
        data: {
          forgeBranch: result.branchName,
          forgeBranchCreatedAt: now,
          forgeBranchBaseSha: result.baseSha,
        },
      });

      this.forgeEnsureLogger.info(
        {
          event: 'forge.ensure.branch.ok',
          epicId,
          epicTitle,
          branch: result.branchName,
          alreadyExisted: result.alreadyExisted,
          baseSha: result.baseSha,
        },
        `ensure.branch.ok epic=${epicId.slice(0, 8)} branch=${result.branchName} ${result.alreadyExisted ? 'already-existed' : 'created'}`,
      );

      return { forgeBranch: result.branchName, forgeBranchCreatedAt: now };
    } catch (err) {
      // No-throw graceful. Casos esperados:
      //  - NotFoundException("No hay code repository ... habilitada") — sandbox real.
      //  - NotFoundException("DEV branch ... no existe") — config error.
      //  - Network/rate-limit transitorio — siguiente refresh lo retry.
      this.forgeEnsureLogger.warn(
        {
          event: 'forge.ensure.branch.failed',
          epicId,
          error: (err as Error).message,
        },
        `ensure.branch.failed epic=${epicId.slice(0, 8)} — ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Aprueba el staging gate de un batch del Forge — mergea el consolidated
   * PR del integration branch (`forge/sprint-batch-{epicId}`) a DEV y marca
   * el epic con `stagingApprovedAt` para que `getBatchDetail`/`listQueue`
   * deriven `currentLayer: Staging` y el batch se mueva a la columna Staged.
   *
   * Validaciones en orden:
   *   1. Pod access (CWE-639 — user solo aprueba épicas de sus pods).
   *   2. Rol: TechLead estricto, o AltaGerencia (admin override).
   *   3. Step-up auth: password contra Auth0.
   *   4. Estado: awaitingHumanGate (stories done o in_review).
   *   5. Idempotency: 409 si stagingApprovedAt ya está set.
   *
   * Effects:
   *   - Mergea consolidated PR a DEV via Octokit (si existe y aún OPEN).
   *   - Persiste stagingApprovedAt/By/ByName en el epic.
   *   - Persiste ChangelogEntry para audit trail.
   *
   * Errores tipados (frontend mapea a UI):
   *   - 400: batch no listo (stories pendientes)
   *   - 401: password incorrecta
   *   - 403: rol no autorizado
   *   - 404: batchId no existe
   *   - 409: ya aprobado
   *   - 502: merge a DEV falló (GitHub error)
   */
  async approveStagingGate(
    batchId: string,
    user: AuthenticatedUser,
    input: { password: string; notes?: string },
  ): Promise<{
    batchId: string;
    epicId: string;
    approvedAt: string;
    approvedBy: string;
    approvedByName: string;
    consolidatedPrNumber: number | null;
    consolidatedPrMergedAt: string | null;
  }> {
    // 1. Cargar el epic con pod info para validar acceso y estado.
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      include: {
        pods: { select: { podId: true } },
        stories: { select: { id: true, status: true } },
      },
    });
    if (!epic) {
      throw new NotFoundException(`Batch ${batchId} no encontrado`);
    }

    // Pod access (consistente con getBatchDetail).
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    // 2. Role check: solo TechLead o AltaGerencia (admin override).
    if (user.role !== UserRole.TechLead && user.role !== UserRole.AltaGerencia) {
      throw new ForbiddenException(
        'Solo Tech Lead puede aprobar el merge a DEV (staging gate). ' +
          `Tu rol actual es ${user.role}.`,
      );
    }

    // 3. Idempotency parcial: 409 SOLO si approval Y merge ya están terminales.
    //    Si únicamente el approval persistió pero el merge falló (PR no abierto
    //    todavía, GitHub down, conflict transitorio), permitimos retry — el
    //    aprobador original se preserva intacto y solo se reintenta la parte
    //    operacional (open + merge). Sin esto, un fallo del merge dejaba al
    //    batch atascado: aprobado pero sin ramificar a DEV, y sin manera de
    //    re-triggerar desde la UI sin un workaround en DB.
    if (epic.stagingApprovedAt && epic.consolidatedPrMergedAt) {
      throw new ConflictException(
        `El batch ya fue aprobado el ${epic.stagingApprovedAt.toISOString()} ` +
          `por ${epic.stagingApprovedByName ?? epic.stagingApprovedBy ?? 'unknown'} ` +
          `y mergeado a DEV el ${epic.consolidatedPrMergedAt.toISOString()}.`,
      );
    }
    const isRetryAfterPartialApproval = epic.stagingApprovedAt !== null;

    // 4. Estado: TODAS las stories deben estar en estado TERMINAL — done,
    //    in_review o blocked (= awaitingHumanGate). Una story `blocked` (su
    //    run falló) NO impide aprobar: se mergea a DEV CON su deuda técnica
    //    (se resuelve en staging) — el frontend exige un checkbox de
    //    confirmación explícita cuando hay stories blocked. Lo que SÍ bloquea
    //    el approve es trabajo aún EN CURSO (claimed/running) o sin arrancar
    //    (backlog/todo/in_progress) — el Forge debe terminar de procesarlas.
    //    Solo verificamos esto en el approval ORIGINAL — en retries asumimos
    //    que el batch ya fue evaluado como completo (la decisión humana se
    //    persistió en el primer intento). Si stories retroceden post-approval
    //    por revert manual u otra causa, NO bloqueamos el retry del merge
    //    porque el TechLead ya autorizó y el commit en remote es la verdad
    //    source-of-truth — el operador tiene la opción de bloquear via
    //    GitHub branch protection si lo necesita.
    if (!isRetryAfterPartialApproval) {
      const storiesCount = epic.stories.length;
      const terminalCount = epic.stories.filter(
        (s) =>
          s.status === 'done' ||
          s.status === 'in_review' ||
          s.status === 'blocked',
      ).length;
      if (storiesCount === 0 || terminalCount !== storiesCount) {
        throw new BadRequestException(
          `El batch no está listo para aprobar: ${terminalCount}/${storiesCount} ` +
            `stories en estado terminal (done, in_review o blocked). ` +
            `El Forge debe terminar de procesar las stories en curso primero.`,
        );
      }
      // Modelo "merge con deuda": NO hay floor de "al menos 1 story done".
      // El Forge mergea a DEV todo lo que produjo —incluso un batch donde
      // todas las stories llevan deuda técnica— y esa deuda (criterios DoD
      // sin cerrar) se resuelve en la etapa de STAGING, no antes. Bloquear
      // el merge por deuda detendría el flujo, que es justo lo contrario
      // del diseño. El único gate es que el Forge haya TERMINADO (el
      // terminalCount check de arriba), no que haya tenido éxito.
    }

    // 5. Step-up auth: password contra Auth0. Throw UnauthorizedException
    //    si falla — el frontend mapea a 401 "Contraseña incorrecta".
    //    Re-verificamos también en retries: cualquier intento de mover un
    //    batch a Staged requiere step-up fresco, incluso si el approval ya
    //    existe en DB (defensa en profundidad — sesión robada no debería
    //    poder spam el endpoint).
    await this.auth.assertPasswordValid(user, input.password);

    // 6. Merge del consolidated PR a DEV. Estrategia: confiar en GitHub como
    //    source-of-truth — si el branch existe, abrimos PR; si no, GitHub
    //    devuelve 404/422 y caemos al catch graceful. NO pre-detectamos
    //    "sandbox mode" desde campos DB (`epic.forgeBranch === null`) porque
    //    descubrimos en producción que esos campos pueden estar desincronizados
    //    con la realidad de remote: el worker crea el branch via push directo
    //    pero `epic.forgeBranch` solo se popula vía `createIntegrationBranch`
    //    en enqueue, que falla cuando el repo no estaba `forgeWritable` al
    //    momento de encolar. Resultado: branch real en GitHub + DB null →
    //    sandbox detection falsa positiva → PR nunca abierto.
    const branchConfig = await this.branchStrategy.getOrInitDefault();
    const devBranch = branchConfig.devBranch;
    let consolidatedPrNumber: number | null = epic.consolidatedPrNumber;
    let consolidatedPrMergedAt: Date | null = epic.consolidatedPrMergedAt;
    // SHA del merge commit cuando el PR mergee. NULL hasta que mergeamos en
    // este request (o si el epic ya estaba mergeado antes y persistimos NULL
    // por una versión anterior del backend — el preview cae al fallback de
    // lookup vía PR API en ese caso).
    let consolidatedMergeSha: string | null = epic.consolidatedMergeSha;

    // Nombre de la integration branch del Forge — computado acá (scope outer)
    // para que esté disponible tanto al abrir el PR consolidado como al
    // cleanup post-merge (`deleteBranch` best-effort si autoDeleteForgeBranch).
    // Fallback dinámico cuando `epic.forgeBranch` está null: matchea lo que el
    // worker creó via push usando el mismo prefix de la strategy config.
    const integrationBranchName =
      epic.forgeBranch ??
      `${branchConfig.forgeBranchPrefix}${epic.id.slice(0, 8)}`;

    // 6a. Si ya hay un consolidatedPrNumber persistido pero sin merge timestamp,
    //     consultamos GitHub para ver el estado real. Casos posibles:
    //       - merged=true Y baseBranch === devBranch: out-of-band merge legítimo.
    //         Seteamos consolidatedPrMergedAt usando el `merged_at` REAL de
    //         GitHub (no `new Date()`) para preservar precisión del audit.
    //       - merged=true Y baseBranch !== devBranch: admin mergeó al branch
    //         WRONG (main, staging por error). NO marcamos como "merged to DEV"
    //         — eso corrompería el pipeline downstream. Descartamos el PR
    //         (consolidatedPrNumber=null) y abrimos uno nuevo contra devBranch.
    //       - state='closed' && merged=false (cerrado manualmente sin merge):
    //         olvidamos este PR y abrimos uno nuevo. Sin esto, intentar
    //         mergear un PR cerrado lanza 405 y el loop del retry queda
    //         atrapado contra un PR muerto.
    //       - state='open': proseguimos al merge normal.
    if (consolidatedPrNumber && !consolidatedPrMergedAt) {
      try {
        const status = await this.github.getPullRequestStatus(consolidatedPrNumber);
        if (status.merged && status.baseBranch === devBranch) {
          consolidatedPrMergedAt = status.mergedAt
            ? new Date(status.mergedAt)
            : new Date();
          this.logger.info(
            `[staging.approve:${batchId}] PR #${consolidatedPrNumber} ya estaba merged a ${devBranch} en GitHub (out-of-band @ ${status.mergedAt ?? 'unknown'}). Sincronizamos DB.`,
          );
        } else if (status.merged && status.baseBranch !== devBranch) {
          // Merged al branch wrong — defensa contra corrupt pipeline state.
          this.logger.warn(
            `[staging.approve:${batchId}] PR #${consolidatedPrNumber} fue merged a '${status.baseBranch}' (≠ ${devBranch}). ` +
              `NO lo aceptamos como staging merge. Descartamos y abrimos uno nuevo contra ${devBranch}.`,
          );
          consolidatedPrNumber = null;
        } else if (status.state === 'closed') {
          this.logger.warn(
            `[staging.approve:${batchId}] PR #${consolidatedPrNumber} fue cerrado manualmente sin merge. ` +
              `Lo descartamos y abrimos uno nuevo contra ${devBranch} en este retry.`,
          );
          consolidatedPrNumber = null;
        }
      } catch (err) {
        // Si no podemos leer status (404 — PR borrado, network), seguimos al
        // flow normal: si está null abrimos uno; si tiene número intentamos
        // mergear y dejamos que GitHub devuelva 405 explícito. No silenciamos.
        this.logger.warn(
          `[staging.approve:${batchId}] getPullRequestStatus PR #${consolidatedPrNumber} failed: ${(err as Error).message}. Proseguimos con flow normal.`,
        );
      }
    }

    if (!consolidatedPrNumber) {
      // No hay PR consolidado abierto todavía — intentamos abrirlo contra DEV
      // usando `integrationBranchName` (computado en scope outer).
      try {
        const pr = await this.github.openStoryPullRequest({
          headBranch: integrationBranchName,
          baseBranch: devBranch,
          title: `[Staging] ${epic.title}`,
          body:
            `## Consolidated PR — Staging Gate Approved\n\n` +
            `**Epic:** ${epic.title}\n` +
            `**Batch:** \`${batchId}\`\n` +
            `**Approved by:** ${user.name ?? user.email ?? user.sub} (Tech Lead)\n` +
            `**Approved at:** ${new Date().toISOString()}\n\n` +
            (input.notes ? `### Notas\n${input.notes}\n\n` : '') +
            `Este PR consolida todas las stories del Forge para esta épica y ` +
            `fue aprobado para merge a \`${devBranch}\` por el Tech Lead.`,
        });
        consolidatedPrNumber = pr.prNumber;
        this.logger.info(
          `[staging.approve:${batchId}] consolidated PR #${pr.prNumber} ` +
            `${pr.alreadyExisted ? 'recuperado (ya existía)' : 'abierto'} ` +
            `contra ${devBranch} (head=${integrationBranchName})`,
        );
      } catch (err) {
        // Best-effort: si el branch no existe en remote (sandbox real — repo
        // sin configurar, push del worker nunca llegó, épica legacy), no
        // abortamos el approval. La decisión humana del TechLead se persiste
        // y el batch se mueve a Staged. El operador puede abrir el PR
        // manualmente en GitHub y reintentar el endpoint cuando esté listo.
        //
        // openStoryPullRequest ahora es idempotente para 422 "ya existe" — si
        // caemos aquí, es un error real (branch no existe, permisos, etc.).
        this.logger.warn(
          `[staging.approve:${batchId}] consolidated PR no abierto contra head='${integrationBranchName}': ${(err as Error).message}. ` +
            `Posibles causas: branch no existe en remote (sandbox real), repo sin permisos, conflicto con base. ` +
            `Persistimos el approval del TechLead; el merge a ${devBranch} queda pending para retry.`,
        );
        // consolidatedPrNumber queda null — el endpoint reporta el estado real
        // y el frontend puede mostrar "PR no abierto — reintenta o merge manual".
      }
    }

    // Merge del PR consolidado (idempotente — si ya está merged, GitHub
    // retorna `merged=false` y caemos al catch sin marcar como merged-now).
    if (consolidatedPrNumber && !consolidatedPrMergedAt) {
      try {
        const result = await this.github.mergePullRequest({
          prNumber: consolidatedPrNumber,
          commitTitle: `[Staging] ${epic.title} (#${consolidatedPrNumber})`,
          commitMessage:
            `Approved by Tech Lead (${user.name ?? user.email ?? user.sub}).\n` +
            (input.notes ? `\nNotes: ${input.notes}\n` : ''),
        });
        if (result.merged) {
          consolidatedPrMergedAt = new Date();
          // Captura el SHA del merge commit para el preview post-cleanup
          // (defense-in-depth: branch puede borrarse, SHA persiste en DB).
          consolidatedMergeSha = result.sha;
          this.logger.info(
            `[staging.approve:${batchId}] PR #${consolidatedPrNumber} merged a ${devBranch} (sha=${result.sha?.slice(0, 7) ?? 'null'})`,
          );
          // Cleanup best-effort de la integration branch tras merge exitoso a
          // DEV. Si autoDelete está off (override del operador) o el delete
          // falla (network, permisos), seguimos sin romper el approval — el
          // merge ya está consolidado y el operador puede borrar manualmente.
          // `deleteBranch` es idempotente con 404/422.
          if (branchConfig.autoDeleteForgeBranch) {
            try {
              await this.github.deleteBranch(integrationBranchName);
              this.logger.info(
                { event: 'staging.cleanup.branch_deleted', batchId, branchName: integrationBranchName },
                `[staging.approve:${batchId}] integration branch '${integrationBranchName}' eliminada tras merge a ${devBranch}`,
              );
            } catch (cleanupErr) {
              this.logger.warn(
                { event: 'staging.cleanup.branch_delete_failed', batchId, branchName: integrationBranchName, err: (cleanupErr as Error).message },
                `[staging.approve:${batchId}] deleteBranch '${integrationBranchName}' falló (non-fatal): ${(cleanupErr as Error).message}. ` +
                  `El merge a ${devBranch} está consolidado; la branch puede borrarse manualmente desde GitHub.`,
              );
            }
          }
        } else {
          this.logger.warn(
            `[staging.approve:${batchId}] GitHub returned merged=false para PR #${consolidatedPrNumber}. ` +
              `Probablemente conflict o branch protection. Persistimos el approval pero el merge queda pending.`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[staging.approve:${batchId}] PR #${consolidatedPrNumber} merge FAILED: ${(err as Error).message}. ` +
            `Persistimos el approval para que el frontend muestre el batch en Staged; ` +
            `el merge a DEV queda pending manual.`,
        );
        // No throw — el approval del TechLead persiste aunque el merge falle.
        // El operador puede re-intentar el merge desde GitHub directamente.
      }
    }

    // 7. Persistir approval + PR metadata + ChangelogEntry en transacción CAS.
    //    En retries (cuando isRetryAfterPartialApproval) NO sobreescribimos
    //    los campos del aprobador original — la decisión humana se preserva
    //    intacta y el changelog refleja el original. Solo actualizamos lo
    //    que cambia: PR metadata + merge timestamp si avanzaron.
    //
    //    CAS (Compare-And-Swap): el `updateMany` exige que los valores en DB
    //    sigan siendo los que leímos en el findFirst inicial. Si otro request
    //    concurrente (segundo TechLead aprobando al mismo tiempo, o un retry
    //    en paralelo) modificó algo, recibimos `count === 0` y abortamos con
    //    409 sin haber dejado el row corrompido. Esto previene el caso
    //    last-writer-wins donde dos aprobaciones simultáneas se sobreescriben
    //    una a otra y el aprobador en DB queda incoherente con el merge real
    //    en GitHub.
    const now = new Date();
    const newApproverName = user.name ?? user.email ?? user.sub;
    const effectiveApprovedAt = epic.stagingApprovedAt ?? now;
    const effectiveApprovedBy = epic.stagingApprovedBy ?? user.sub;
    const effectiveApprovedByName = epic.stagingApprovedByName ?? newApproverName;

    const dataPatch = {
      ...(isRetryAfterPartialApproval
        ? {}
        : {
            stagingApprovedAt: now,
            stagingApprovedBy: user.sub,
            stagingApprovedByName: newApproverName,
          }),
      ...(consolidatedPrNumber !== epic.consolidatedPrNumber
        ? {
            consolidatedPrNumber,
            consolidatedPrCreatedAt: epic.consolidatedPrCreatedAt ?? now,
          }
        : {}),
      ...(consolidatedPrMergedAt && !epic.consolidatedPrMergedAt
        ? { consolidatedPrMergedAt }
        : {}),
      // Persistir el merge SHA junto con el merge timestamp. Solo seteamos
      // si lo capturamos en este request — retries que ya tenían el merge
      // (epic.consolidatedPrMergedAt set) no necesitan re-escribir.
      ...(consolidatedMergeSha && !epic.consolidatedMergeSha
        ? { consolidatedMergeSha }
        : {}),
    };

    // Changelog content: en retries identificamos quién ejecutó el retry
    // (para que el audit refleje las dos decisiones — original y retry),
    // separado del aprobador original que se preserva en epic.stagingApprovedBy.
    const changelogValue = input.notes
      ? input.notes
      : isRetryAfterPartialApproval
        ? `PR #${consolidatedPrNumber ?? 'pending'}${consolidatedPrMergedAt ? ' merged' : ''} retry by ${newApproverName}`
        : `PR #${consolidatedPrNumber ?? 'pending'}${consolidatedPrMergedAt ? ' merged' : ''}`;

    await this.prisma.$transaction(async (tx) => {
      // CAS: el row debe estar EXACTAMENTE en el estado que vimos al inicio.
      // Esto cierra la ventana de race entre findFirst y update.
      const result = await tx.epic.updateMany({
        where: {
          id: epic.id,
          stagingApprovedAt: epic.stagingApprovedAt,
          consolidatedPrNumber: epic.consolidatedPrNumber,
          consolidatedPrMergedAt: epic.consolidatedPrMergedAt,
        },
        data: dataPatch,
      });

      if (result.count === 0) {
        // Otro request modificó el row entre nuestro read y nuestro write.
        // Throw dentro del transaction callback hace rollback automático.
        throw new ConflictException(
          'El estado del batch cambió mientras procesabamos el approval ' +
            '(probablemente otro Tech Lead aprobó en paralelo). Recarga y reintenta.',
        );
      }

      // Changelog dentro del transaction: si falla, el approval no persiste.
      // Esto garantiza que NO hay state aprobado sin audit trail.
      await tx.changelogEntry.create({
        data: {
          entityType: 'epic',
          entityId: epic.id,
          entityTitle: epic.title,
          action: isRetryAfterPartialApproval
            ? 'staging_merge_retried'
            : 'staging_approved',
          newValue: changelogValue,
          changedById: user.sub,
          changedByName: newApproverName,
        },
      });
    });

    this.logger.info(
      `[staging.approve:${batchId}] OK ` +
        `retry=${isRetryAfterPartialApproval} ` +
        `approver=${effectiveApprovedByName} ` +
        `prNumber=${consolidatedPrNumber ?? 'null'} ` +
        `merged=${consolidatedPrMergedAt !== null}`,
    );

    return {
      batchId,
      epicId: epic.id,
      approvedAt: effectiveApprovedAt.toISOString(),
      approvedBy: effectiveApprovedBy,
      approvedByName: effectiveApprovedByName,
      consolidatedPrNumber,
      consolidatedPrMergedAt: consolidatedPrMergedAt?.toISOString() ?? null,
    };
  }

  /**
   * Reintenta una story que terminó con deuda técnica (run failed / doom loop /
   * criterios DoD sin cerrar). La dispara un humano desde el merge view del
   * dashboard, después de corregir la causa raíz del fallo — por ejemplo:
   * vincular un secreto externo faltante en /factory/settings, o arreglar la
   * branch base del repo.
   *
   * Es el equivalente UI del script `reset-story-status.js`:
   *  - story.status → 'backlog', claimedAt → null  ⇒ el worker la re-claim en
   *    el próximo poll y re-ejecuta el flujo COMPLETO del Forge (el agente la
   *    re-implementa + corre el DoD). Consume tokens reales de la API.
   *  - los AgentRun activos (claimed/running) de esa story se cierran a
   *    'failed' para no dejar runs zombie en la queue.
   *
   * NO es un re-verify barato: el worker no tiene modo "solo DoD" — cada
   * attempt del runner es spawn-claude → verify. Por eso el retry es una
   * acción humana explícita (gateada por un ConfirmDialog en el frontend),
   * consistente con el comentario de `completeRun` en agent-run.service.ts:
   * "NO hay re-claim automático: el retry ... es una acción humana explícita".
   *
   * Validaciones:
   *  - el batch existe y el user tiene acceso al pod del epic (CWE-639).
   *  - la story pertenece a ESE batch — no se puede reintentar una story de
   *    otro epic pasando un storyId arbitrario.
   *  - la story está en un estado reintentable — ni 'done' (terminal-exitoso)
   *    ni 'backlog' idle (ya en cola). Ver `classifyStoryRetryability`.
   *
   * Concurrencia: el reset de la story usa CAS (compare-and-swap) dentro de la
   * transacción — si un worker la claimea/completa, o un retry corre en
   * paralelo, entre el read y el write, el CAS falla con 409 sin corromper el
   * row. Mismo patrón que `approveStagingGate`.
   */
  async retryStory(
    batchId: string,
    storyId: string,
    user: AuthenticatedUser,
  ): Promise<{
    storyId: string;
    storyTitle: string;
    previousStatus: string;
    status: string;
    abandonedRunCount: number;
  }> {
    // 1. Cargar el epic del batch + SOLO la story target (el `where` filtra
    //    in-query para no traer todas las stories del epic).
    const epic = await this.prisma.epic.findFirst({
      where: { enqueuedBatchId: batchId },
      include: {
        pods: { select: { podId: true } },
        stories: {
          where: { id: storyId },
          select: { id: true, title: true, status: true, claimedAt: true },
        },
      },
    });
    if (!epic) {
      throw new NotFoundException(`Batch ${batchId} no encontrado`);
    }

    // 2. Pod access — consistente con getBatchDetail / approveStagingGate.
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    // 3. La story debe pertenecer a este batch. Si no existe, o el storyId es
    //    de otro epic, el `where` anidado no la trajo → 404 (sin distinguir
    //    el caso para no leakear existencia de stories de otros pods).
    const story = epic.stories[0];
    if (!story) {
      throw new NotFoundException(
        `Story ${storyId} no encontrada en el batch ${batchId}`,
      );
    }

    // 4. Validar que la story está en un estado reintentable. La lógica pura
    //    vive en `classifyStoryRetryability` (unit-testeada): rechaza 'done'
    //    (terminal-exitoso) y 'backlog' idle (ya en cola — un retry sería un
    //    no-op que ensuciaría el changelog con una entrada fantasma). El botón
    //    del frontend solo aparece para stories con deuda, pero el endpoint se
    //    valida igual (defensa contra llamadas directas a la API).
    const eligibility = classifyStoryRetryability(story.status, story.claimedAt);
    if (!eligibility.retryable) {
      throw new ConflictException(
        eligibility.reason ?? 'La story no se puede reintentar.',
      );
    }

    // 5. Reset + cierre de runs zombie en una transacción: o todo o nada.
    const abandonMessage =
      `Run abandonado: retry manual de la story disparado por ` +
      `${user.email ?? user.sub} desde el dashboard.`;
    let abandonedRunCount = 0;

    await this.prisma.$transaction(async (tx) => {
      // 5a. Reset la story → claimable, vía CAS (compare-and-swap). El `where`
      //     exige que el row siga EXACTAMENTE como lo leímos (status +
      //     claimedAt): si un worker la claimeó/completó, o un retry paralelo
      //     ya la reseteó entre el read y este write, `count===0` → 409 +
      //     rollback. El UPDATE además toma el row lock por el resto de la tx,
      //     serializando contra claims concurrentes. Va PRIMERO: si el CAS
      //     falla no tocamos runs ni changelog. Mismo patrón anti-race que
      //     approveStagingGate. backlog + claimedAt=null es la única
      //     combinación que la query de claim acepta:
      //     status NOT IN (done,in_review,blocked) AND claimedAt IS NULL.
      const reset = await tx.story.updateMany({
        where: {
          id: story.id,
          status: story.status,
          claimedAt: story.claimedAt,
        },
        data: { status: 'backlog', claimedAt: null },
      });
      if (reset.count === 0) {
        throw new ConflictException(
          `El estado de la story "${story.title}" cambió mientras se ` +
            `procesaba el retry (¿un worker la tomó, o ya se reintentó en ` +
            `paralelo?). Recargá el batch y revisá.`,
        );
      }

      // 5b. Cerrar AgentRuns activos (claimed/running) → failed. Sin esto un
      //     run en vuelo quedaría zombie y su completeRun() posterior chocaría
      //     contra el run nuevo. (Mismo recipe que reset-story-status.js.)
      const abandoned = await tx.agentRun.updateMany({
        where: {
          storyId: story.id,
          status: { in: ['running', 'claimed'] },
        },
        data: {
          status: 'failed',
          errorMessage: abandonMessage,
          completedAt: new Date(),
        },
      });
      abandonedRunCount = abandoned.count;

      // 5c. ChangelogEntry para audit — el retry reabre un estado terminal y
      //     consume tokens; debe quedar registrado quién lo disparó. Dentro
      //     del tx: si el changelog falla, el reset se revierte (no hay reset
      //     sin audit trail) — mismo invariante que approveStagingGate.
      await tx.changelogEntry.create({
        data: {
          entityType: 'story',
          entityId: story.id,
          entityTitle: story.title,
          action: 'retried',
          field: 'status',
          oldValue: story.status,
          newValue: 'backlog',
          changedById: user.sub,
          changedByName: user.name ?? user.email ?? user.sub,
        },
      });
    });

    this.logger.info(
      `[story.retry:${batchId}] story=${storyId} ` +
        `"${story.title}" ${story.status} → backlog ` +
        `requestedBy=${user.email ?? user.sub} ` +
        `abandonedRuns=${abandonedRunCount}`,
    );

    return {
      storyId: story.id,
      storyTitle: story.title,
      previousStatus: story.status,
      status: 'backlog',
      abandonedRunCount,
    };
  }
}

// extractFailureInfo + FailureInfo se movieron a `./failure-info.ts`
// (2026-05-19) para que sean unit-testeables sin arrastrar la cadena de
// imports pesada de este service (GitHub/Octokit ESM que Jest no transpila).
