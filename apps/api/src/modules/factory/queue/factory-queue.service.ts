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

export interface EnqueuedBatch {
  batchId: string;
  epicId: string;
  epicTitle: string;
  storiesCount: number;
  totalStoryPoints: number;
  enqueuedAt: string;
  enqueuedBy: string;
  enqueuedByName: string;
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

    // 5. Persistir + changelog en transacción atómica.
    const now = new Date();
    const batchId = randomUUID();
    const userName = user.name || user.email || user.sub;

    await this.prisma.$transaction([
      this.prisma.epic.update({
        where: { id: epicId },
        data: {
          enqueuedAt: now,
          enqueuedBatchId: batchId,
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
          newValue: `Enviada al Forge por ${userName} (batch ${batchId.slice(0, 8)})`,
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
        stories: { select: { id: true, storyPoints: true } },
      },
      orderBy: { enqueuedAt: 'asc' },
    });

    return epics
      .filter((e) => e.enqueuedAt && e.enqueuedBatchId)
      .map((e) => ({
        batchId: e.enqueuedBatchId!,
        epicId: e.id,
        epicTitle: e.title,
        storiesCount: e.stories.length,
        totalStoryPoints: e.stories.reduce(
          (sum, s) => sum + (s.storyPoints ?? 0),
          0,
        ),
        enqueuedAt: e.enqueuedAt!.toISOString(),
        // No exponemos enqueuedBy en el listing — viene del changelog si se
        // necesita auditar. En el dashboard típicamente no se muestra.
        enqueuedBy: '',
        enqueuedByName: '',
      }));
  }
}
