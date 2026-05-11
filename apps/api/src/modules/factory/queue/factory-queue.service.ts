import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AuthenticatedUser,
  UserRole,
  epicMarkdownHasAllHeadings,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangelogService } from '../../proyectos/changelog/changelog.service';
import { assertUserCanAccessEpicPods } from '../../proyectos/epics/epic-access.util';
import { BranchStrategyService } from '../branch-strategy/branch-strategy.service';
import { GitHubService } from '../github/github.service';

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
  private readonly logger = new Logger(FactoryQueueService.name);

  constructor(
    private prisma: PrismaService,
    private changelog: ChangelogService,
    private branchStrategy: BranchStrategyService,
    private github: GitHubService,
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
    this.logger.log(`[enqueue] START epicId=${epicId} userId=${user.sub}`);

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
      this.logger.log(
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

    this.logger.log(
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
            agentRuns: {
              where: { status: { in: ['claimed', 'running'] } },
              select: { id: true, startedAt: true },
              orderBy: { startedAt: 'asc' },
              take: 1,
            },
          },
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
        const storiesInProgress = e.stories.reduce(
          (sum, s) => sum + s.agentRuns.length,
          0,
        );
        // Earliest startedAt de cualquier run activo en cualquier story
        // de la épica — sirve como "epic empezó a procesarse" para el
        // duration calc del card.
        let earliestRunStartedAt: Date | null = null;
        for (const s of e.stories) {
          for (const r of s.agentRuns) {
            if (!earliestRunStartedAt || r.startedAt < earliestRunStartedAt) {
              earliestRunStartedAt = r.startedAt;
            }
          }
        }

        return {
          batchId: e.enqueuedBatchId!,
          epicId: e.id,
          epicTitle: e.title,
          storiesCount: e.stories.length,
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
          storiesInProgress,
          agentCount: storiesInProgress,
          runStartedAt: earliestRunStartedAt?.toISOString() ?? null,
          forgeBranch: e.forgeBranch,
        };
      });
  }
}
