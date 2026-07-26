import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser, StoryTechnicalDependency } from '@cenzontle/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertUserCanAccessStoryByEpic } from '../../epics/epic-access.util';
import type { CreateStoryDependencyDto } from './dto/create-story-dependency.dto';
import type { UpdateStoryDependencyDto } from './dto/update-story-dependency.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

type StoryTechnicalDependencyRow = NonNullable<
  Awaited<ReturnType<PrismaService['storyTechnicalDependency']['findUnique']>>
>;

/**
 * CRUD para `StoryTechnicalDependency` + helpers de query.
 *
 * `findByEpic` hace un JOIN implicit via Prisma (`where: { story: { epicId }}`)
 * y devuelve las deps de TODAS las stories del epic. Usado por la tab del epic
 * como roll-up read-only y por `EpicsService.publishToTracker` para enviar
 * cada conjunto a Linear bajo el Issue correspondiente.
 *
 * Las mutaciones (update/remove) requieren `storyId` para hacer scope check
 * (IDOR protection): la dep debe pertenecer a la story de la URL.
 */
@Injectable()
export class StoryDependenciesService {
  constructor(private readonly prisma: PrismaService,
    @InjectPinoLogger(StoryDependenciesService.name) private readonly logger: PinoLogger,
  ) {}

  async findByStory(storyId: string): Promise<StoryTechnicalDependency[]> {
    const rows = await this.prisma.storyTechnicalDependency.findMany({
      where: { storyId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async findByEpic(epicId: string): Promise<StoryTechnicalDependency[]> {
    const rows = await this.prisma.storyTechnicalDependency.findMany({
      where: { story: { epicId } },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    storyId: string,
    dto: CreateStoryDependencyDto,
    user: AuthenticatedUser,
  ): Promise<StoryTechnicalDependency> {
    // Validar que la story exista para fail-fast con mensaje útil
    // (sin esto, FK violation lanza error genérico de Prisma).
    // Cargamos epic.pods + podId para el check de pod intersection (CWE-639).
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        podId: true,
        epic: { select: { pods: { select: { podId: true } } } },
      },
    });
    if (!story) throw new NotFoundException('Historia no encontrada');

    // CWE-639 BOLA — fix de security-reviewer MEDIUM 2026-05-04. Sin este
    // check, cualquier user con EDIT_STORY podía POSTear deps en historias
    // de otros pods, polucionando el rollup cross-pod consumido por
    // EpicsService.publishToTracker.
    assertUserCanAccessStoryByEpic(user, {
      epicPodIds: story.epic?.pods?.map((p) => p.podId) ?? [],
      storyPodId: story.podId ?? null,
    });

    // Si trae linkedSecretId, validar que el secret existe — sin esto el
    // frontend muestra "Secret provisto" para un UUID inventado y leakea
    // metadata de existencia inverso. La validación es de existencia, no
    // de ownership: los secrets son globales en CENZONTLE.
    if (dto.linkedSecretId) {
      await this.assertSecretExists(dto.linkedSecretId);
    }

    const dueDate = this.parseDueDate(dto.dueDate);

    const created = await this.prisma.storyTechnicalDependency.create({
      data: {
        storyId,
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category,
        severity: dto.severity ?? 'medium',
        source: dto.source ?? 'manual',
        vendor: dto.vendor ?? null,
        requiresCredential: dto.requiresCredential ?? false,
        linkedSecretId: dto.linkedSecretId ?? null,
        isBlocking: dto.isBlocking ?? false,
        targetExternalName: dto.targetExternalName ?? null,
        targetEpicId: dto.targetEpicId ?? null,
        status: dto.status ?? 'identified',
        owner: dto.owner ?? '',
        dueDate,
        resolutionNotes: dto.resolutionNotes ?? '',
        mdContent: dto.mdContent ?? null,
      },
    });
    this.logger.info(
      `[create] story=${storyId} category=${created.category} title="${this.sanitizeForLog(created.title).slice(0, 50)}"`,
    );
    return this.toResponse(created);
  }

  async update(
    storyId: string,
    depId: string,
    dto: UpdateStoryDependencyDto,
    user: AuthenticatedUser,
  ): Promise<StoryTechnicalDependency> {
    const existing = await this.prisma.storyTechnicalDependency.findUnique({
      where: { id: depId },
    });
    if (!existing) throw new NotFoundException('Dependencia no encontrada');
    // IDOR scope check: la dep debe pertenecer a la story de la URL.
    // Sin esto, un caller puede mutar deps de cualquier story usando un
    // path que apunta a otra story.
    if (existing.storyId !== storyId) {
      throw new NotFoundException('Dependencia no encontrada');
    }

    // CWE-639 BOLA — pod intersection contra la story padre. Mismo patrón
    // que `create`. Cargamos epic.pods solo después del scope check para
    // evitar la query si el dep no pertenece a la story.
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        podId: true,
        epic: { select: { pods: { select: { podId: true } } } },
      },
    });
    if (!story) throw new NotFoundException('Historia no encontrada');
    assertUserCanAccessStoryByEpic(user, {
      epicPodIds: story.epic?.pods?.map((p) => p.podId) ?? [],
      storyPodId: story.podId ?? null,
    });

    if (dto.linkedSecretId) {
      await this.assertSecretExists(dto.linkedSecretId);
    }

    const updated = await this.prisma.storyTechnicalDependency.update({
      where: { id: depId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.source !== undefined && { source: dto.source }),
        ...(dto.vendor !== undefined && { vendor: dto.vendor }),
        ...(dto.requiresCredential !== undefined && { requiresCredential: dto.requiresCredential }),
        ...(dto.linkedSecretId !== undefined && { linkedSecretId: dto.linkedSecretId }),
        ...(dto.isBlocking !== undefined && { isBlocking: dto.isBlocking }),
        ...(dto.targetExternalName !== undefined && { targetExternalName: dto.targetExternalName }),
        ...(dto.targetEpicId !== undefined && { targetEpicId: dto.targetEpicId }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.owner !== undefined && { owner: dto.owner }),
        ...(dto.dueDate !== undefined && { dueDate: this.parseDueDate(dto.dueDate) }),
        ...(dto.resolutionNotes !== undefined && { resolutionNotes: dto.resolutionNotes }),
        ...(dto.mdContent !== undefined && { mdContent: dto.mdContent }),
      },
    });
    return this.toResponse(updated);
  }

  async remove(storyId: string, depId: string, user: AuthenticatedUser): Promise<void> {
    // CWE-639 BOLA — pod intersection contra la story padre. Hacemos el check
    // antes del deleteMany porque queremos 403 explícito (no 404) cuando el
    // user no tiene acceso. Si la story no existe → 404 normal.
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        podId: true,
        epic: { select: { pods: { select: { podId: true } } } },
      },
    });
    if (!story) throw new NotFoundException('Historia no encontrada');
    assertUserCanAccessStoryByEpic(user, {
      epicPodIds: story.epic?.pods?.map((p) => p.podId) ?? [],
      storyPodId: story.podId ?? null,
    });

    // deleteMany permite TOCTOU-safe idempotency — si dos requests llegan en
    // paralelo, ambas pasan a delete pero solo una afecta filas; la otra
    // recibe count=0 que mapeamos a 404 en vez de explotar con P2025 (500).
    // El `storyId` en el where también enforce IDOR scope.
    const result = await this.prisma.storyTechnicalDependency.deleteMany({
      where: { id: depId, storyId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Dependencia no encontrada');
    }
    this.logger.info({ storyId, depId }, `[remove] story=${storyId} dep=${depId}`);
  }

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * Convierte una fila de Prisma al tipo compartido. Lanza si recibe null
   * para fail-fast — el caller debe asegurarse de pasar filas existentes.
   * En producción nunca se llama con null: `findMany` devuelve [] y los
   * paths de `findUnique` chequean antes de pasar.
   */
  private toResponse(row: StoryTechnicalDependencyRow): StoryTechnicalDependency {
    return {
      id: row.id,
      storyId: row.storyId,
      title: row.title,
      description: row.description,
      category: row.category as StoryTechnicalDependency['category'],
      severity: row.severity as StoryTechnicalDependency['severity'],
      source: row.source as StoryTechnicalDependency['source'],
      vendor: row.vendor,
      requiresCredential: row.requiresCredential,
      linkedSecretId: row.linkedSecretId,
      isBlocking: row.isBlocking,
      targetExternalName: row.targetExternalName,
      targetEpicId: row.targetEpicId,
      status: row.status as StoryTechnicalDependency['status'],
      owner: row.owner,
      dueDate: row.dueDate?.toISOString() ?? null,
      resolutionNotes: row.resolutionNotes,
      mdContent: row.mdContent,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Validación estricta de fecha: rechaza inputs como `"2026"` (año suelto)
   * o `"garbage"` que `IsISO8601` o `new Date()` aceptarían silenciosamente.
   * Devuelve null si el input es null/undefined/vacío.
   */
  private parseDueDate(input?: string | null): Date | null {
    if (!input) return null;
    // Exigir al menos formato YYYY-MM-DD para evitar `"2026"` → 1 de enero.
    const isoLike = /^\d{4}-\d{2}-\d{2}/.test(input);
    if (!isoLike) {
      throw new BadRequestException(
        `Formato de fecha inválido (se espera YYYY-MM-DD o ISO 8601 completo).`,
      );
    }
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Fecha inválida: "${input}".`);
    }
    return d;
  }

  private async assertSecretExists(secretId: string): Promise<void> {
    try {
      const found = await this.prisma.externalSecret.findUnique({
        where: { id: secretId },
        select: { id: true },
      });
      if (!found) {
        throw new BadRequestException(`Secret externo no existe: ${secretId}`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Prisma puede lanzar P2023 (UUID malformado) o validation error.
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(`Secret externo inválido: ${secretId}`);
      }
      throw err;
    }
  }

  /**
   * Neutraliza caracteres de control (newlines, ANSI escapes) en logs para
   * prevenir log injection cuando el sink interpreta esos chars.
   */
  private sanitizeForLog(s: string): string {
    // Los caracteres de control SON el objetivo del match: neutralizarlos es
    // justamente lo que previene el log injection (CR/LF y escapes ANSI).
    // Quitar el rango C0 anula la protección.
    // eslint-disable-next-line no-control-regex -- rango C0 intencional (saneo)
    return s.replace(/[\r\n\x00-\x1f]/g, ' ');
  }
}
