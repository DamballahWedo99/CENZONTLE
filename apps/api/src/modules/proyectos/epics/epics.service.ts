import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  AuthenticatedUser,
  DiscoveredDependency,
  EpicDependency,
  StoryTechnicalDependency,
  TrackerReference,
} from '@cenzontle/shared';
import {
  UserRole,
  epicMarkdownHasAllHeadings,
} from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { DocumentsService } from '../../documents/documents.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { AuthService } from '../../auth/auth.service';
import { InitiativesService } from '../initiatives/initiatives.service';
import { StoriesService } from '../stories/stories.service';
import { StoryDependenciesService } from '../stories/dependencies/story-dependencies.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicQueryDto } from './dto/epic-query.dto';
import { ApproveEpicDto } from './dto/approve-epic.dto';
import {
  epicFolderPath,
  epicIndexPath,
  epicDefinitionPath,
  epicDiagramPath,
  epicDependencyPath,
  epicDesignPath,
  epicDesignBundleFolderPath,
  epicDocumentPath,
  epicMatrixPath,
  isLegacyVaultPath,
  isNewFormatVaultPath,
  type InitiativeRef,
  type EpicRef,
  type EpicDiagramKind,
} from '../vault-paths';
import {
  syncDocumentsToVault,
  toSyncDocuments,
  noteSlugSource,
} from '../document-vault-sync';
import { DesignBundleService } from './design-bundle.service';
import {
  assertUserCanAccessEpicPods,
  assertUserCanAssignPods,
} from './epic-access.util';
import {
  buildDiagramMarkdown,
  buildDependencyMarkdown,
  buildDesignMarkdown,
  buildQAMatrixMarkdown,
  buildEpicQAMatrixMarkdown,
  parseDiscoveredDependencyMarkdown,
} from './epic-markdown-builders';
import { buildFrontmatter } from '../vault-frontmatter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const EPIC_INCLUDE = {
  initiative: { select: { id: true, name: true, status: true } },
  pods: {
    include: { pod: { select: { id: true, name: true, color: true } } },
  },
} as const;

// Los 9 headings obligatorios del markdown de épica viven ahora en
// @cenzontle/shared (REQUIRED_EPIC_HEADINGS + epicMarkdownHasAllHeadings).
// Single source of truth con el frontend; el comentario JSDoc previo decía
// que la constante era "solo informativa", pero realmente es load-bearing
// para validar pre-aprobación. Centralizada para evitar drift.

/**
 * Invalida punteros stale a archivos del vault en formato legacy.
 *
 * El endpoint admin de limpieza de roots legacy (commit e89b796) borro los
 * folders `epics/`, `initiatives/` y `stories/` que existian antes del
 * rewrite de paths a la estructura anidada `iniciativas/.../epics/.../`.
 * Los diagramas generados antes de ese rewrite guardaron su
 * `integrationFlowDocPath` apuntando a rutas legacy (ej:
 * `epics/<id>-<slug>/diagrams/business.md`). Esos archivos ya no existen,
 * pero el puntero quedo en el JSONB del epic.
 *
 * Al mapear el epic, detectamos esos paths y los invalidamos (omitimos
 * `integrationFlowDocPath` + `integrationFlowGeneratedAt` del objeto
 * devuelto). Asi el frontend muestra "Sin documento de flujo" en vez de
 * un link "Ver documento completo" que 404. El user puede entonces
 * disparar el backfill que re-escribe al path canonico nuevo.
 */
function sanitizeDiagramPaths(diagrams: unknown): unknown {
  if (!Array.isArray(diagrams)) return diagrams;
  return diagrams.map((d) => {
    if (!d || typeof d !== 'object') return d;
    const diag = d as { integrationFlowDocPath?: string };
    if (isLegacyVaultPath(diag.integrationFlowDocPath)) {
      const {
        integrationFlowDocPath: _path,
        integrationFlowGeneratedAt: _generatedAt,
        ...rest
      } = d as Record<string, unknown>;
      return rest;
    }
    return d;
  });
}

function mapEpic(raw: any) {
  const { pods, diagrams, ...epic } = raw;
  return {
    ...epic,
    diagrams: sanitizeDiagramPaths(diagrams),
    podIds: pods.map((p: any) => p.podId),
    pods: pods.map((p: any) => p.pod),
  };
}

// Sentinel placeholder usado para implementar lock atómico vía CAS sobre
// `epic.tracker`. Si dos requests intentan publicar la misma épica, solo uno
// gana el `updateMany` con `where: tracker = null`; el otro ve este sentinel
// y aborta con ConflictException en vez de duplicar el issue en Linear.
const PENDING_TRACKER_SENTINEL = '__pending__';

@Injectable()
export class EpicsService {
  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private vaultFolder: VaultFolderService,
    private documents: DocumentsService,
    private integrationsService: IntegrationsService,
    private initiativesService: InitiativesService,
    private storiesService: StoriesService,
    private storyDependenciesService: StoryDependenciesService,
    private designBundle: DesignBundleService,
    private authService: AuthService,
    @InjectPinoLogger(EpicsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Publica la épica + sus historias en el tracker externo (Linear).
   *
   * Cascade hacia arriba: si la iniciativa padre NO tiene tracker en Linear,
   * primero la publica como Linear Initiative. Después crea el Linear Project
   * para la épica (asociado a esa Initiative) y los Linear Issues para cada
   * historia dentro del Project — sin sub-issues, los agentes los harán después.
   *
   * Garantías:
   *  - Idempotente a nivel épica: si `epic.tracker.externalId` ya es real,
   *    devuelve el actual sin tocar Linear.
   *  - Lock atómico contra doble-click vía CAS sobre `epic.tracker`.
   *  - Resource authz: el caller debe ser AltaGerencia O compartir un pod
   *    con la épica.
   *  - Errores parciales por story → reportados en `partialFailures`. El
   *    Project + las stories que sí pasaron se persisten igual.
   */
  async publishToTracker(
    epicId: string,
    provider: 'linear' | 'jira',
    user: AuthenticatedUser,
  ): Promise<{
    alreadyPublished: boolean;
    initiativeTracker?: TrackerReference;
    initiativeAlreadyPublished?: boolean;
    epicTracker: TrackerReference;
    storyTrackers: Array<{ storyId: string; tracker: TrackerReference }>;
    partialFailures: Array<{ storyId: string; error: string }>;
  }> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        stories: { orderBy: { createdAt: 'asc' } },
        pods: { select: { podId: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    // Resource-scoped authz: AltaGerencia bypass, otros deben compartir pod.
    const isAdmin = user.role === UserRole.AltaGerencia;
    const epicPodIds = epic.pods.map((p) => p.podId);
    const sharesPod = (user.podIds ?? []).some((p) => epicPodIds.includes(p));
    if (!isAdmin && !sharesPod) {
      throw new ForbiddenException(
        'No autorizado: solo AltaGerencia o miembros de un pod asignado pueden publicar esta épica.',
      );
    }

    const existingTracker = epic.tracker as unknown as TrackerReference | null;
    if (existingTracker?.externalId && existingTracker.externalId !== PENDING_TRACKER_SENTINEL) {
      this.logger.info(
        `[publishToTracker] epic=${epicId} already published → ${existingTracker.externalKey}`,
      );
      return {
        alreadyPublished: true,
        epicTracker: existingTracker,
        storyTrackers: epic.stories
          .filter((s) => (s.tracker as unknown as TrackerReference | null)?.externalId)
          .map((s) => ({
            storyId: s.id,
            tracker: s.tracker as unknown as TrackerReference,
          })),
        partialFailures: [],
      };
    }

    // Si OTRA request ya está publicando la épica, esperamos al ganador.
    if (existingTracker?.externalId === PENDING_TRACKER_SENTINEL) {
      const waited = await this.waitForEpicTrackerOrFreed(epicId);
      if (waited.kind === 'ready') {
        // Re-cargar el estado completo (con stories actualizadas) para devolver
        // un payload consistente al cliente que llegó tarde.
        return this.publishToTracker(epicId, provider, user);
      }
      if (waited.kind === 'timeout') {
        throw new ConflictException(
          'Otra publicación de esta épica lleva mucho tiempo. Reintenta en unos segundos.',
        );
      }
      // 'freed' → caemos al CAS de abajo y reintentamos el claim.
    }

    // Cascade hacia arriba: garantizar que la Initiative tenga tracker antes
    // de crear el Project. Si falla acá, el lock de la épica no se ha tomado
    // todavía, así que es seguro propagar la excepción.
    const initiativeResult = await this.initiativesService.ensureTracker(
      epic.initiativeId,
      provider,
      user,
    );

    // Atomic CAS sobre epic.tracker — previene la race entre requests
    // concurrentes que ambas pasarían el `if (existingTracker)` check.
    const placeholder = {
      provider,
      externalId: PENDING_TRACKER_SENTINEL,
      externalKey: PENDING_TRACKER_SENTINEL,
      externalUrl: '',
    };
    const claimed = await this.prisma.epic.updateMany({
      where: { id: epicId, tracker: { equals: Prisma.DbNull } },
      data: { tracker: placeholder as unknown as Prisma.InputJsonValue },
    });
    if (claimed.count === 0) {
      // Perdimos la carrera. Esperar al ganador — si termina OK retornamos
      // recursivamente para entregar el shape completo. Si el ganador falla
      // y libera el lock (`freed`), reintentar el flujo entero.
      const waited = await this.waitForEpicTrackerOrFreed(epicId);
      if (waited.kind === 'ready' || waited.kind === 'freed') {
        return this.publishToTracker(epicId, provider, user);
      }
      throw new ConflictException(
        'Otra publicación de esta épica lleva mucho tiempo. Reintenta en unos segundos.',
      );
    }

    // Cargar el contenido completo (PO + Technical + QA) del vault + las
    // dependencias técnicas de la story (StoryTechnicalDependency) en paralelo.
    // Failures individuales NO abortan — caemos al payload mínimo para que la
    // story se cree en Linear de todos modos, sin contexto.
    const storyPayloads = await Promise.all(
      epic.stories.map(async (s) => {
        const [content, technicalDependencies] = await Promise.all([
          s.vaultPath
            ? this.storiesService.readStoryContent(s.vaultPath).catch((err) => {
                this.logger.warn(
                  `[publishToTracker] failed to read vault content for story=${s.id}: ${(err as Error)?.message ?? err}`,
                );
                return null;
              })
            : Promise.resolve(null),
          this.storyDependenciesService.findByStory(s.id).catch((err) => {
            this.logger.warn(
              `[publishToTracker] failed to load tech deps for story=${s.id}: ${(err as Error)?.message ?? err}`,
            );
            return [];
          }),
        ]);
        return {
          id: s.id,
          title: s.title,
          storyPoints: s.storyPoints,
          labels: s.labels,
          content,
          technicalDependencies,
        };
      }),
    );

    // Las dependencias técnicas viven a nivel story (StoryTechnicalDependency)
    // y se incluyen en el body de cada Issue. El payload del Project ya no
    // lleva el campo `dependencies` — el legado JSONB Epic.dependencies queda
    // inerte hasta migración manual.

    // Resolver el provider UNA sola vez y reutilizar la instancia para
    // publishEpic + publishStoryRelations. Cargar el provider dos veces
    // abriría una ventana donde una rotación de config entre llamadas dejaría
    // el DAG sin materializar silenciosamente (el primer call ya commiteó).
    const trackerProvider = await this.integrationsService.getProvider(provider);

    let result;
    try {
      result = await trackerProvider.publishEpic(
        {
          id: epic.id,
          title: epic.title,
          markdown: epic.markdown,
          priority: epic.priority,
          startDate: epic.startDate,
          targetDate: epic.targetDate,
          stories: storyPayloads,
        },
        { initiativeExternalId: initiativeResult.tracker.externalId },
      );
    } catch (err) {
      // Liberar el lock si Linear falló — sin esto la épica quedaría
      // permanentemente bloqueada en estado "pending".
      await this.prisma.epic.update({
        where: { id: epicId },
        data: { tracker: Prisma.DbNull },
      });
      throw err;
    }

    // Persistir trackers en transacción atómica. CRÍTICO: el update del
    // epic.tracker va al FINAL — si una story fue eliminada entre la lectura
    // de payloads (T1) y la transacción (T2), el `story.update` lanza P2025,
    // toda la transacción hace rollback (incluido epic.tracker), y el lock
    // queda liberado en su estado "pending" (Prisma.DbNull) sin tracker
    // huérfano. Catch externo libera el lock para reabrir el flujo.
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { storyId, tracker } of result.storyTrackers) {
          await tx.story.update({
            where: { id: storyId },
            data: { tracker: tracker as unknown as Prisma.InputJsonValue },
          });
        }
        await tx.epic.update({
          where: { id: epicId },
          data: { tracker: result.epicTracker as unknown as Prisma.InputJsonValue },
        });
      });
    } catch (err) {
      // Cualquier fallo durante persist (story eliminada, conflicto, etc):
      // el tracker de la épica está aún en estado pending → liberarlo para
      // permitir reintento. Los Issues en Linear quedan huérfanos pero el
      // siguiente publish los reusará por idempotencia del provider.
      await this.prisma.epic.update({
        where: { id: epicId },
        data: { tracker: Prisma.DbNull },
      });
      throw err;
    }

    // Después de que TODOS los Issues existen en Linear, materializar el DAG
    // hard del epic como Linear IssueRelations type='blocks'. Best-effort:
    // failures parciales se reportan en logs pero no abortan el publish.
    // Permitimos edges cross-epic: el filtro de pertenencia a `epicId` se hace
    // post-query mediante `storyTrackerById` (solo procesamos edges donde
    // AMBAS stories tienen tracker en este publish — el resto se materializará
    // cuando se publique la otra épica).
    try {
      const storyTrackerById = new Map(
        result.storyTrackers.map((s) => [s.storyId, s.tracker.externalId]),
      );
      const dagEdges = await this.prisma.storyDependency.findMany({
        where: {
          hardness: 'hard',
          OR: [
            { story: { epicId } },
            { blockedBy: { epicId } },
          ],
        },
        select: { storyId: true, blockedById: true },
      });
      const linearEdges = dagEdges
        .map((e) => {
          const blocked = storyTrackerById.get(e.storyId);
          const blocking = storyTrackerById.get(e.blockedById);
          return blocked && blocking
            ? { blockedExternalId: blocked, blockingExternalId: blocking }
            : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      if (linearEdges.length > 0) {
        const relResult = await trackerProvider.publishStoryRelations(linearEdges);
        this.logger.info(
          `[publishToTracker] story relations: ok=${relResult.ok} failed=${relResult.failed.length}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[publishToTracker] failed to publish story relations (non-fatal): ${(err as Error)?.message ?? err}`,
      );
    }

    await this.integrationsService.markSyncedAt(provider);

    this.logger.info(
      `[publishToTracker] actor=${user.sub} epic=${epicId} → ${result.epicTracker.externalKey} ` +
        `(initiative=${initiativeResult.tracker.externalKey}${initiativeResult.alreadyPublished ? ' [reused]' : ' [new]'} ` +
        `stories ok=${result.storyTrackers.length} fail=${result.partialFailures.length})`,
    );

    return {
      alreadyPublished: false,
      initiativeTracker: initiativeResult.tracker,
      initiativeAlreadyPublished: initiativeResult.alreadyPublished,
      epicTracker: result.epicTracker,
      storyTrackers: result.storyTrackers,
      partialFailures: result.partialFailures,
    };
  }

  /**
   * Polling corto sobre `epic.tracker` para esperar a que otra request
   * concurrente termine antes de fallar con 409. Mismo patrón que en
   * InitiativesService.waitForTrackerOrFreed.
   */
  private async waitForEpicTrackerOrFreed(
    epicId: string,
  ): Promise<
    | { kind: 'ready'; tracker: TrackerReference }
    | { kind: 'freed' }
    | { kind: 'timeout' }
  > {
    const POLL_INTERVAL_MS = 250;
    const WAIT_BUDGET_MS = 30_000;
    const start = Date.now();
    while (Date.now() - start < WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const row = await this.prisma.epic.findUnique({
        where: { id: epicId },
        select: { tracker: true },
      });
      const t = row?.tracker as unknown as TrackerReference | null;
      if (!t) return { kind: 'freed' };
      if (t.externalId !== PENDING_TRACKER_SENTINEL) {
        return { kind: 'ready', tracker: t };
      }
    }
    return { kind: 'timeout' };
  }

  async findAll(query: EpicQueryDto, user?: AuthenticatedUser) {
    const where: Prisma.EpicWhereInput = {};
    if (query.initiativeId) where.initiativeId = query.initiativeId;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.podId) where.pods = { some: { podId: query.podId } };

    // CWE-639 — restringir listing a pods del user para no-admins. Sin esto
    // cualquier autenticado podía enumerar todas las épicas cross-pod, lo que
    // habilitaba ataques downstream sobre los IDs descubiertos. AltaGerencia
    // y callers internos (sin user) ven todo. Fix de security-reviewer
    // MEDIUM 2026-05-04.
    if (user && user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      // Si el user no pertenece a ningún pod, no ve nada — fail-closed.
      if (userPodIds.length === 0) return [];
      where.pods = {
        ...(where.pods as Prisma.EpicPodListRelationFilter | undefined),
        some: { podId: { in: userPodIds } },
      };
    }

    const epics = await this.prisma.epic.findMany({
      where,
      include: EPIC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return epics.map(mapEpic);
  }

  async findOne(id: string, includeContent = false, user?: AuthenticatedUser) {
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: EPIC_INCLUDE,
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    const mapped = mapEpic(epic);

    if (includeContent && epic.vaultPath) {
      // CWE-639 — gate del markdown narrativo (que vive en el vault y puede
      // contener design notes, dependencias, referencias inline a credenciales)
      // detrás de pod intersection. Metadata básica (id/title/status/...) sigue
      // accesible cross-pod para flows como dashboards de tracker. Fix de
      // security-reviewer MEDIUM 2026-05-04.
      if (user) {
        assertUserCanAccessEpicPods(
          user,
          epic.pods.map((ep) => ep.podId),
        );
      }
      // En formato nuevo, el markdown narrativo vive en `definicion.md` dentro
      // del folder de la épica. En legacy flat, vive en el archivo único.
      // El vault es la fuente de verdad — sobreescribe el `markdown` que viene
      // de PG si está disponible.
      const narrativeNote = await this.readNarrativeNote(epic.vaultPath);
      if (narrativeNote) {
        const markdown = this.parseEpicMarkdown(narrativeNote.content);
        return { ...mapped, markdown };
      }
    }

    return mapped;
  }

  async create(dto: CreateEpicDto, user: AuthenticatedUser) {
    this.logger.info({ title: dto.title, initiativeId: dto.initiativeId }, `[create] START title="${dto.title}" initiativeId=${dto.initiativeId}`);

    // Resource-scoped authz (CWE-639/BOLA, cerrado 2026-05-28): el caller solo
    // puede crear una épica asignándola a pods a los que pertenece. Sin esto,
    // un rol con CREATE_EPIC del pod A podía crear épicas en el pod B (write
    // cross-pod). `update`/`remove` ya enforzaban pod-intersection; `create` no.
    assertUserCanAssignPods(user, dto.podIds ?? []);

    // Necesitamos la iniciativa padre para construir el epic folder anidado.
    const parent = await this.prisma.initiative.findUnique({
      where: { id: dto.initiativeId },
      select: { id: true, name: true },
    });
    if (!parent) throw new NotFoundException('Iniciativa padre no encontrada');

    const id = randomUUID();
    const iniRef: InitiativeRef = { id: parent.id, name: parent.name };
    const epicRef: EpicRef = { id, title: dto.title };

    const indexPath = epicIndexPath(iniRef, epicRef);
    const definitionPath = epicDefinitionPath(iniRef, epicRef);
    this.logger.info({ indexPath }, `[create] Generated vaultPath=${indexPath}`);

    const markdown = dto.markdown ?? '';
    const indexMd = this.buildEpicIndexMarkdown({
      id,
      title: dto.title,
      initiativeId: dto.initiativeId,
    });
    const definitionMd = this.buildEpicDefinitionMarkdown({
      id,
      title: dto.title,
      initiativeId: dto.initiativeId,
      markdown,
    });

    // 1. Escribir los 2 archivos al vault. Si el segundo falla, rollback del primero.
    await this.vault.writeNote(
      indexPath,
      indexMd,
      `feat(epic): create "${dto.title}" [${id}]`,
    );
    try {
      await this.vault.writeNote(
        definitionPath,
        definitionMd,
        `docs(epic): narrative definition [${id}]`,
      );
    } catch (err: any) {
      this.logger.error({ err }, `[create] definicion.md failed, rolling back index.md`);
      await this.vault.deleteNote(indexPath, `revert(epic): rollback [${id}]`).catch(() => {});
      throw err;
    }
    this.logger.info(`[create] Vault writes OK (index + definicion)`);

    // 2. Create PG row (rollback ambos archivos on failure).
    try {
      const { podIds, startDate, targetDate, diagrams, designs: rawDesigns, ...data } = dto;
      // `diagrams` y `designs` se extraen del spread y se reasignan como JSON.
      // El DTO valida solo `id` de cada item (critico para seguridad path
      // traversal en epicDiagramPath / epicDesignPath); el resto del shape
      // es free-form y se persiste as-is en el campo JSONB. Prisma requiere
      // `InputJsonValue` — cast via `unknown` porque un class-validator
      // DTO no declara la index signature de InputJsonObject.

      // SECURITY: bundleVaultPath y bundleKey son server-only — solo
      // `addDesignBundle` los setea (post-create, tras subir un ZIP). Stripamos
      // cualquier valor enviado por el cliente en create para prevenir
      // persistencia de paths atacker-controlled (que `deleteDesign` podría
      // luego usar como sink de path traversal).
      const designs = rawDesigns?.map((d) => {
        const cleaned = { ...d };
        delete (cleaned as { bundleVaultPath?: string }).bundleVaultPath;
        delete (cleaned as { bundleKey?: string }).bundleKey;
        return cleaned;
      });

      const epic = await this.prisma.$transaction(async (tx) => {
        const created = await tx.epic.create({
          data: {
            id,
            ...data,
            ...(diagrams !== undefined
              ? { diagrams: diagrams as unknown as Prisma.InputJsonValue }
              : {}),
            ...(designs !== undefined
              ? { designs: designs as unknown as Prisma.InputJsonValue }
              : {}),
            startDate: new Date(startDate),
            targetDate: new Date(targetDate),
            vaultPath: indexPath,
          },
        });
        if (podIds?.length) {
          await tx.epicPod.createMany({
            data: podIds.map((podId) => ({ epicId: created.id, podId })),
          });
        }
        return tx.epic.findUniqueOrThrow({ where: { id: created.id }, include: EPIC_INCLUDE });
      });
      this.logger.info({ id: epic.id }, `[create] PG insert OK id=${epic.id}`);
      return mapEpic(epic);
    } catch (err) {
      this.logger.error({ err }, `[create] PG insert FAILED, rolling back vault files`);
      await this.vault.deleteNote(definitionPath, `revert(epic): rollback [${id}]`).catch(() => {});
      await this.vault.deleteNote(indexPath, `revert(epic): rollback [${id}]`).catch(() => {});
      throw err;
    }
  }

  async update(id: string, dto: UpdateEpicDto, user: AuthenticatedUser) {
    this.logger.info({ id }, `[update] START id=${id} fields=${Object.keys(dto).join(',')}`);

    const existing = await this.prisma.epic.findUnique({
      where: { id },
      include: {
        initiative: { select: { id: true, name: true } },
        pods: { select: { podId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Épica no encontrada');

    // CWE-639 BOLA — fix de security-reviewer HIGH 2026-05-04. TechLead/PO
    // tienen EDIT_EPIC global; sin este check podían mutar épicas de otros
    // pods (overwrite de markdown, rename de folder, reasignación de podIds).
    assertUserCanAccessEpicPods(
      user,
      existing.pods.map((p) => p.podId),
    );

    // El check de arriba valida los pods ACTUALES (¿puede tocar esta épica?),
    // pero NO los pods de DESTINO de un reassignment. Sin esto, un PO de pod-A
    // podía tomar una épica que comparte pod-A y PATCH-reasignarla a pod-B
    // (CWE-639 vía reassignment, security-reviewer HIGH 2026-05-28). El destino
    // debe ser subconjunto de los pods del caller.
    if (dto.podIds !== undefined) {
      assertUserCanAssignPods(user, dto.podIds);
    }

    const incomingMarkdown = dto.markdown;
    const hasMarkdownChanges = incomingMarkdown !== undefined && incomingMarkdown !== existing.markdown;
    const titleChanged = dto.title !== undefined && dto.title !== existing.title;

    const newTitle = dto.title ?? existing.title;
    const newMarkdown = dto.markdown ?? existing.markdown;

    // ── Vault updates ──
    if (existing.vaultPath) {
      const isNewFormat = isNewFormatVaultPath(existing.vaultPath);
      const isLegacy = isLegacyVaultPath(existing.vaultPath);

      if (titleChanged && isNewFormat) {
        // Rename del titulo → mover folder completo y cascadear historias hijas.
        const iniRef: InitiativeRef = {
          id: existing.initiative.id,
          name: existing.initiative.name,
        };
        const oldEpicRef: EpicRef = { id: existing.id, title: existing.title };
        const newEpicRef: EpicRef = { id: existing.id, title: newTitle };
        const oldFolder = epicFolderPath(iniRef, oldEpicRef);
        const newFolder = epicFolderPath(iniRef, newEpicRef);

        this.logger.info({ oldFolder, newFolder }, `[update] Renaming folder: ${oldFolder} → ${newFolder}`);

        // Reescribimos index + definicion con el contenido actualizado ANTES de mover.
        await this.rewriteEpicFilesBeforeMove(
          existing,
          newTitle,
          newMarkdown,
        );

        const result = await this.vaultFolder.moveFolder(
          oldFolder,
          newFolder,
          `refactor(epic): rename folder [${id}]`,
          `refactor(epic): cleanup old folder [${id}]`,
        );

        if (result.copyErrors.length > 0) {
          this.logger.error(
            `[update] moveFolder had ${result.copyErrors.length} copy failures. Reverting rename.`,
          );
          throw new Error(
            'Rename de epica fallo parcialmente. Los archivos originales quedaron intactos.',
          );
        }

        // Cascadear historias hijas.
        await this.cascadeStoryVaultPaths(existing.id, oldFolder, newFolder);
      } else if (hasMarkdownChanges && (isNewFormat || isLegacy)) {
        // Sin rename: solo reescribir index.md y/o definicion.md según lo que cambió.
        await this.updateEpicVaultContent(
          existing,
          newTitle,
          newMarkdown,
        );
      }
    }

    // ── Serializar artefactos JSONB al vault (diagramas, dependencias, matrices) ──
    if (existing.vaultPath && isNewFormatVaultPath(existing.vaultPath)) {
      const iniRef: InitiativeRef = {
        id: existing.initiative.id,
        name: existing.initiative.name,
      };
      // Usar el nuevo título si cambió (el folder ya fue renombrado arriba)
      const epicRef: EpicRef = { id: existing.id, title: newTitle };
      await this.writeEpicArtifacts(existing.id, existing, dto, iniRef, epicRef);
    }

    // ── PG update ──
    const { podIds, startDate, targetDate, designs: rawDesigns, ...data } = dto;

    // SECURITY: bundleVaultPath y bundleKey son server-only. Para cada design
    // del input, stripamos los valores user-supplied y RESTAURAMOS los del
    // existing.designs por `id` (round-trip-safe — los users PATCH la lista
    // completa pero no deben poder reescribir estos campos). Designs nuevos
    // (sin id existente) se persisten sin bundle — `addDesignBundle` los
    // settea legítimamente después.
    let sanitizedDesigns: typeof rawDesigns | undefined;
    if (rawDesigns !== undefined) {
      const existingArr = Array.isArray(existing.designs)
        ? (existing.designs as Array<{ id: string; bundleVaultPath?: string; bundleKey?: string }>)
        : [];
      const existingById = new Map(existingArr.map((d) => [d.id, d]));
      sanitizedDesigns = rawDesigns.map((d) => {
        const cleaned = { ...d };
        delete (cleaned as { bundleVaultPath?: string }).bundleVaultPath;
        delete (cleaned as { bundleKey?: string }).bundleKey;
        const prev = existingById.get(d.id);
        if (prev?.bundleVaultPath) (cleaned as { bundleVaultPath?: string }).bundleVaultPath = prev.bundleVaultPath;
        if (prev?.bundleKey) (cleaned as { bundleKey?: string }).bundleKey = prev.bundleKey;
        return cleaned;
      });
    }

    const updateData: Prisma.EpicUpdateInput = {
      ...data,
      ...(sanitizedDesigns !== undefined
        ? { designs: sanitizedDesigns as unknown as Prisma.InputJsonValue }
        : {}),
    } as Prisma.EpicUpdateInput;
    if (startDate) updateData.startDate = new Date(startDate);
    if (targetDate) updateData.targetDate = new Date(targetDate);
    // Si renombraste y esta en formato nuevo, actualizar vaultPath al nuevo index.md.
    if (titleChanged && existing.vaultPath && isNewFormatVaultPath(existing.vaultPath)) {
      const iniRef: InitiativeRef = {
        id: existing.initiative.id,
        name: existing.initiative.name,
      };
      updateData.vaultPath = epicIndexPath(iniRef, { id: existing.id, title: newTitle });
    }

    const epic = await this.prisma.$transaction(async (tx) => {
      await tx.epic.update({ where: { id }, data: updateData });
      if (podIds !== undefined) {
        await tx.epicPod.deleteMany({ where: { epicId: id } });
        if (podIds.length) {
          await tx.epicPod.createMany({
            data: podIds.map((podId) => ({ epicId: id, podId })),
          });
        }
      }
      return tx.epic.findUniqueOrThrow({ where: { id }, include: EPIC_INCLUDE });
    });

    // ── Dual-write de documentos al vault ──
    // Si el update tocó `documents`, sincronizamos las notas markdown del vault
    // (frontmatter + texto extraído). Paritario con InitiativesService.update.
    // FAIL-SOFT total dentro de syncDocumentsToVault. Solo aplica en formato
    // nuevo (el folder anidado donde viven `documentos/`). El path usa
    // `newTitle` porque, si hubo rename, el folder ya se movió.
    if (
      dto.documents !== undefined &&
      existing.vaultPath &&
      isNewFormatVaultPath(existing.vaultPath)
    ) {
      const iniRef: InitiativeRef = {
        id: existing.initiative.id,
        name: existing.initiative.name,
      };
      const epicRef: EpicRef = { id: existing.id, title: newTitle };
      const oldDocs = toSyncDocuments(existing.documents);
      const newDocs = toSyncDocuments(epic.documents);
      await syncDocumentsToVault(
        oldDocs,
        newDocs,
        { documents: this.documents, vault: this.vault, logger: this.logger },
        {
          // El slug de la nota combina nombre + sufijo del `id` (storage key)
          // para que dos docs con el mismo `name` no colisionen en el path.
          buildNotePath: (doc) =>
            epicDocumentPath(iniRef, epicRef, noteSlugSource(doc)),
          commitScope: 'docs(epic-doc)',
          entityId: id,
          failedEvent: 'epic.document_vault_sync.failed',
        },
      );
    }

    this.logger.info({ id }, `[update] DONE id=${id}`);
    return mapEpic(epic);
  }

  async remove(id: string, user: AuthenticatedUser) {
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: {
        initiative: { select: { id: true, name: true } },
        stories: { select: { id: true, title: true, vaultPath: true } },
        pods: { select: { podId: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    // CWE-639 BOLA — fix de security-reviewer HIGH 2026-05-04. DELETE_EPIC
    // está limitado a roles más altos, pero igual aplicamos el check para que
    // un AltaGerencia ↔ podOwner futuro siga el mismo patrón canónico.
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    if (epic.vaultPath && isNewFormatVaultPath(epic.vaultPath)) {
      // Formato nuevo: deleteFolder recursivo limpia TODO el folder del epic
      // (incluye index + definicion + diagramas/ + docs/ + deps/ + matrices/ +
      // historias/ con su contenido).
      const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
      const folder = epicFolderPath(iniRef, { id: epic.id, title: epic.title });
      this.logger.info({ folder }, `[remove] Deleting folder (new format): ${folder}`);
      await this.vaultFolder.deleteFolder(
        folder,
        `feat(epic): delete "${epic.title}" [${id}]`,
      );
    } else {
      // Legacy: borrado archivo por archivo (historias primero, luego epic).
      for (const story of epic.stories) {
        if (story.vaultPath) {
          await this.vault
            .deleteNote(
              story.vaultPath,
              `feat(story): delete "${story.title}" [${story.id}] (cascade from epic)`,
            )
            .catch((err) =>
              this.logger.warn({ vaultPath: story.vaultPath, message: err?.message }, `Failed to delete vault note ${story.vaultPath}: ${err?.message}`),
            );
        }
      }
      if (epic.vaultPath) {
        await this.vault
          .deleteNote(epic.vaultPath, `feat(epic): delete "${epic.title}" [${id}]`)
          .catch((err) =>
            this.logger.warn({ vaultPath: epic.vaultPath, message: err?.message }, `Failed to delete vault note ${epic.vaultPath}: ${err?.message}`),
          );
      }
    }

    await this.prisma.epic.delete({ where: { id } });
    this.logger.info({ id, length: epic.stories.length }, `[remove] epic=${id} done (${epic.stories.length} stories cascaded)`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Helpers internos
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Lee el archivo de contenido narrativo. En formato nuevo es `definicion.md`
   * junto al `index.md`; en legacy es el propio `vaultPath`. Si no se encuentra,
   * retorna null.
   */
  private async readNarrativeNote(vaultPath: string) {
    if (isNewFormatVaultPath(vaultPath)) {
      // vaultPath = .../epics/<slug-id6>/index.md → definicion.md es hermano.
      const folder = vaultPath.slice(0, vaultPath.lastIndexOf('/'));
      return this.vault.readNote(`${folder}/definicion.md`).catch(() => null);
    }
    // Legacy: un solo archivo con todo el contenido.
    return this.vault.readNote(vaultPath).catch(() => null);
  }

  /**
   * Reescribe index.md y definicion.md en el OLD path antes de un move, para
   * que la copia al nuevo folder ya traiga datos frescos.
   */
  private async rewriteEpicFilesBeforeMove(
    existing: {
      id: string;
      title: string;
      markdown: string;
      vaultPath: string | null;
      initiativeId: string;
    },
    newTitle: string,
    newMarkdown: string,
  ): Promise<void> {
    if (!existing.vaultPath) return;
    const folder = existing.vaultPath.slice(0, existing.vaultPath.lastIndexOf('/'));
    const definitionPath = `${folder}/definicion.md`;

    this.vault.invalidateCache(existing.vaultPath);
    this.vault.invalidateCache(definitionPath);

    const existingIndexNote = await this.vault.readNote(existing.vaultPath);
    const existingCreated = existingIndexNote
      ? this.extractCreatedDate(existingIndexNote.content)
      : undefined;

    const indexMd = this.buildEpicIndexMarkdown({
      id: existing.id,
      title: newTitle,
      initiativeId: existing.initiativeId,
      created: existingCreated,
    });
    const definitionMd = this.buildEpicDefinitionMarkdown({
      id: existing.id,
      title: newTitle,
      initiativeId: existing.initiativeId,
      markdown: newMarkdown,
      created: existingCreated,
    });

    await this.vault.writeNote(
      existing.vaultPath,
      indexMd,
      `docs(epic): update index pre-rename [${existing.id}]`,
    );
    await this.vault.writeNote(
      definitionPath,
      definitionMd,
      `docs(epic): update definition pre-rename [${existing.id}]`,
    );
  }

  /**
   * Sin rename, actualiza el vault de la épica. Formato nuevo: toca `index.md`
   * si cambió el title; `definicion.md` si cambió el markdown.
   * Formato legacy: reescribe el archivo único (patrón del service viejo).
   */
  private async updateEpicVaultContent(
    existing: {
      id: string;
      title: string;
      markdown: string;
      vaultPath: string | null;
      initiativeId: string;
    },
    newTitle: string,
    newMarkdown: string,
  ): Promise<void> {
    if (!existing.vaultPath) return;

    if (isNewFormatVaultPath(existing.vaultPath)) {
      const folder = existing.vaultPath.slice(0, existing.vaultPath.lastIndexOf('/'));
      const definitionPath = `${folder}/definicion.md`;

      // Leemos el `created` del index UNA vez para reutilizar en los dos
      // writes posibles (index y definicion) sin doble lectura.
      this.vault.invalidateCache(existing.vaultPath);
      const existingIndexNote = await this.vault.readNote(existing.vaultPath);
      const existingCreated = existingIndexNote
        ? this.extractCreatedDate(existingIndexNote.content)
        : undefined;

      // Index: solo si cambió title.
      if (newTitle !== existing.title) {
        const indexMd = this.buildEpicIndexMarkdown({
          id: existing.id,
          title: newTitle,
          initiativeId: existing.initiativeId,
          created: existingCreated,
        });
        await this.vault.writeNote(
          existing.vaultPath,
          indexMd,
          `docs(epic): update metadata [${existing.id}]`,
        );
      }

      // Definicion: si cambió el markdown o el title (porque va en el H1).
      if (newMarkdown !== existing.markdown || newTitle !== existing.title) {
        this.vault.invalidateCache(definitionPath);
        const definitionMd = this.buildEpicDefinitionMarkdown({
          id: existing.id,
          title: newTitle,
          initiativeId: existing.initiativeId,
          markdown: newMarkdown,
          created: existingCreated,
        });
        await this.vault.writeNote(
          definitionPath,
          definitionMd,
          `docs(epic): update definition [${existing.id}]`,
        );
      }
    } else {
      // Legacy: un solo archivo con todo (titulo + markdown juntos).
      this.vault.invalidateCache(existing.vaultPath);
      const existingNote = await this.vault.readNote(existing.vaultPath);
      const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;

      const legacyMd = this.buildLegacyEpicMarkdown({
        id: existing.id,
        title: newTitle,
        initiativeId: existing.initiativeId,
        markdown: newMarkdown,
        created: existingCreated,
      });

      await this.vault.writeNote(
        existing.vaultPath,
        legacyMd,
        `docs(epic): update content [${existing.id}]`,
      );
    }
  }

  /**
   * Cascade: actualiza el `vaultPath` de cada historia hija cuando el folder
   * del epic se renombra. Simple string replace del prefijo viejo por el nuevo.
   *
   * Envuelto en `prisma.$transaction` para atomicidad: si un update falla,
   * ninguno se aplica y los hijos mantienen paths validos (apuntando al
   * folder origen todavia preservado por un eventual rollback del moveFolder).
   */
  private async cascadeStoryVaultPaths(
    epicId: string,
    oldFolder: string,
    newFolder: string,
  ): Promise<void> {
    const stories = await this.prisma.story.findMany({
      where: { epicId },
      select: { id: true, vaultPath: true },
    });

    const updates = stories
      .filter((s) => s.vaultPath && s.vaultPath.startsWith(`${oldFolder}/`))
      .map((s) =>
        this.prisma.story.update({
          where: { id: s.id },
          data: { vaultPath: s.vaultPath!.replace(`${oldFolder}/`, `${newFolder}/`) },
        }),
      );

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    this.logger.info(
      `[cascadeStoryVaultPaths] updated ${updates.length} stories for epic=${epicId} (atomic)`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Markdown builders
  // ─────────────────────────────────────────────────────────────────────

  /**
   * index.md — solo metadata + referencia a definicion.md y al resto del folder.
   * El contenido narrativo entero vive en `definicion.md`.
   */
  private buildEpicIndexMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'epic',
      initiativeId: data.initiativeId,
      title: data.title,
      created: data.created ?? new Date().toISOString().slice(0, 10),
    });

    return (
      `${fm}\n\n` +
      `# ${data.title}\n\n` +
      `Contenido completo en este folder:\n\n` +
      `- [\`definicion.md\`](./definicion.md) — markdown completo (descripción, beneficios, alcance, criterios, etc.).\n` +
      `- [\`diagramas/\`](./diagramas/) — diagramas generados por el agente IA.\n` +
      `- [\`documentos/\`](./documentos/) — documentos adjuntos a la épica.\n` +
      `- [\`dependencias/\`](./dependencias/) — dependencias identificadas.\n` +
      `- [\`matrices/\`](./matrices/) — matrices QA funcional y sistémica.\n` +
      `- [\`historias/\`](./historias/) — historias de usuario.\n`
    );
  }

  /**
   * `definicion.md` — markdown único de la épica con frontmatter YAML.
   * Estructura mínima dictada por placeholder UX y prompt al agente IA
   * (9 headings level-2 obligatorios; ver REQUIRED_EPIC_HEADINGS).
   */
  private buildEpicDefinitionMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    markdown: string;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'epic-definition',
      initiativeId: data.initiativeId,
      title: data.title,
      created: data.created ?? new Date().toISOString().slice(0, 10),
      format: 'v2',
    });

    return `${fm}\n\n# ${data.title} — Definición\n\n${data.markdown ?? ''}\n`;
  }

  /**
   * Mantiene el formato legacy (1 archivo con frontmatter + markdown) para
   * épicas pre-migración. Mismo shape que `definicion.md` pero el archivo es
   * el `vaultPath` directo en vez de un hijo del folder.
   */
  private buildLegacyEpicMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    markdown: string;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'epic',
      initiativeId: data.initiativeId,
      title: data.title,
      created: data.created ?? new Date().toISOString().slice(0, 10),
      format: 'v2',
    });

    return `${fm}\n\n# ${data.title}\n\n${data.markdown ?? ''}\n`;
  }

  /**
   * Lee el markdown literal del archivo (definicion.md o legacy flat),
   * removiendo frontmatter y el primer heading `# title`. El resto se devuelve
   * tal cual — ya no se parsean sub-secciones.
   */
  private parseEpicMarkdown(content: string): string {
    const withoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n+/m, '');
    // Sin flag `m`: solo strippea el `# Heading` al inicio del body, no
    // headings que el user pueda escribir en el cuerpo (mismo fix que en
    // `stripFrontmatterAndH1` de stories.service post QA review).
    const withoutH1 = withoutFrontmatter.replace(/^\s*#\s+[^\n]+\n+/, '');
    return withoutH1.trim();
  }

  private extractCreatedDate(markdown: string): string | undefined {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const line = match[1].split('\n').find((l) => l.startsWith('created:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Serialización de artefactos JSONB al vault
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Detecta si los artefactos JSONB (diagrams, dependencies, qaMatrix, epicQAMatrix)
   * cambiaron entre la versión existente en PG y el DTO de update, y escribe los
   * archivos correspondientes al vault usando los builders de `epic-markdown-builders.ts`.
   *
   * Solo actúa si la épica está en formato nuevo (`isNewFormatVaultPath`). En legacy
   * el caller no invoca este método.
   *
   * Fuente de verdad sobre qué cambió:
   *  - `diagrams` y `dependencies` → vienen en el DTO (el frontend los envía completos).
   *  - `qaMatrix` y `epicQAMatrix`  → residen solo en PG; cuando el DTO los incluya en
   *    el futuro (vía endpoint dedicado), este método ya los manejará. Por ahora los
   *    comparamos contra el `oldEpic` leído de PG para detectar cambios externos.
   *
   * @param epicId  - ID de la épica
   * @param oldEpic - Row actual de PG (antes del update); campos JSONB como Prisma Json
   * @param dto     - DTO con los campos que se están actualizando
   * @param iniRef  - Referencia a la iniciativa (para construir paths del vault)
   * @param epicRef - Referencia a la épica (ya con el NUEVO título si cambió)
   */
  private async writeEpicArtifacts(
    epicId: string,
    oldEpic: {
      diagrams: Prisma.JsonValue;
      dependencies: Prisma.JsonValue;
      designs: Prisma.JsonValue;
      qaMatrix: Prisma.JsonValue | null;
      epicQAMatrix: Prisma.JsonValue | null;
    },
    dto: UpdateEpicDto,
    iniRef: InitiativeRef,
    epicRef: EpicRef,
  ): Promise<void> {
    // ── Diagramas ──
    // El DTO trae la lista completa de diagramas. Comparamos serialización JSON para
    // detectar cualquier cambio (nuevo diagrama, edición de nodos, etc.).
    if (dto.diagrams !== undefined) {
      const oldDiagrams = JSON.stringify(oldEpic.diagrams ?? []);
      const newDiagrams = JSON.stringify(dto.diagrams);
      if (oldDiagrams !== newDiagrams) {
        // Iterar sobre los diagramas entrantes y escribir uno por tipo
        const diagrams = dto.diagrams as Array<{ id: string; type: string; name?: string }>;
        for (const diagram of diagrams) {
          if (!diagram?.id) {
            this.logger.warn(`[writeEpicArtifacts] diagrama sin id — skip`);
            continue;
          }
          const kind: EpicDiagramKind = diagram.type === 'technical' ? 'technical' : 'business';
          // Usar el id del diagrama en el path para evitar colisiones cuando
          // la epica tiene multiples diagramas del mismo tipo.
          const path = epicDiagramPath(iniRef, epicRef, { id: diagram.id, type: kind });
          // El builder espera un EpicDiagram completo; usamos cast porque el DTO usa any[]
          // y el runtime garantiza el shape correcto (viene de PG JSONB)
          const md = buildDiagramMarkdown(diagram as Parameters<typeof buildDiagramMarkdown>[0]);
          await this.vault.writeNote(
            path,
            md,
            `docs(epic): write diagram ${kind} [${epicId}]`,
          );
          this.logger.info({ kind, path }, `[writeEpicArtifacts] diagrama ${kind} escrito → ${path}`);
        }
      }
    }

    // ── Dependencias ──
    // Igual que los diagramas: el DTO trae la lista completa.
    if (dto.dependencies !== undefined) {
      const oldDeps = JSON.stringify(oldEpic.dependencies ?? []);
      const newDeps = JSON.stringify(dto.dependencies);
      if (oldDeps !== newDeps) {
        const dependencies = dto.dependencies as Array<{ id: string; title: string }>;
        for (const dep of dependencies) {
          const path = epicDependencyPath(iniRef, epicRef, dep.title);
          const md = buildDependencyMarkdown(dep as Parameters<typeof buildDependencyMarkdown>[0]);
          await this.vault.writeNote(
            path,
            md,
            `docs(epic): record dependency ${dep.title} [${epicId}]`,
          );
          this.logger.info({ title: dep.title, path }, `[writeEpicArtifacts] dependencia "${dep.title}" escrita → ${path}`);
        }
      }
    }

    // ── Diseños ──
    // El DTO trae la lista completa de diseños. Cada uno se escribe como
    // .md independiente en `disenos/<slug>-<id6>.md` para que el agente IA
    // pueda leerlos via vault_read cuando necesite el handoff completo.
    // El suffix de id garantiza unicidad incluso si dos diseños tienen el
    // mismo name (sin suffix, el segundo sobrescribiría silenciosamente).
    if (dto.designs !== undefined) {
      const oldDesigns = JSON.stringify(oldEpic.designs ?? []);
      const newDesigns = JSON.stringify(dto.designs);
      if (oldDesigns !== newDesigns) {
        const designs = dto.designs as Array<{ id: string; name: string }>;
        for (const design of designs) {
          if (!design?.id || !design?.name) {
            this.logger.warn(`[writeEpicArtifacts] diseño sin id/name — skip`);
            continue;
          }
          const path = epicDesignPath(iniRef, epicRef, { id: design.id, name: design.name });
          const md = buildDesignMarkdown(design as Parameters<typeof buildDesignMarkdown>[0]);
          await this.vault.writeNote(
            path,
            md,
            `docs(epic): record design ${design.name} [${epicId}]`,
          );
          this.logger.info({ name: design.name, path }, `[writeEpicArtifacts] diseño "${design.name}" escrito → ${path}`);
        }
      }
    }

    // ── Matriz QA funcional ──
    // qaMatrix no está en el DTO actual pero sí en PG. Este bloque se activa si en
    // el futuro el DTO lo incluye. Mientras tanto, nunca entra (dto.qaMatrix === undefined).
    const dtoRecord = dto as Record<string, unknown>;
    const incomingQAMatrix = dtoRecord['qaMatrix'];
    if (incomingQAMatrix !== undefined && incomingQAMatrix !== null) {
      const oldMatrix = JSON.stringify(oldEpic.qaMatrix ?? null);
      const newMatrix = JSON.stringify(incomingQAMatrix);
      if (oldMatrix !== newMatrix) {
        const path = epicMatrixPath(iniRef, epicRef, 'qa-funcional');
        const md = buildQAMatrixMarkdown(incomingQAMatrix as Parameters<typeof buildQAMatrixMarkdown>[0]);
        await this.vault.writeNote(
          path,
          md,
          `docs(epic): update qa matrix [${epicId}]`,
        );
        this.logger.info({ path }, `[writeEpicArtifacts] qa-funcional escrita → ${path}`);
      }
    }

    // ── Matriz QA sistémica ──
    const incomingEpicQAMatrix = dtoRecord['epicQAMatrix'];
    if (incomingEpicQAMatrix !== undefined && incomingEpicQAMatrix !== null) {
      const oldEpicMatrix = JSON.stringify(oldEpic.epicQAMatrix ?? null);
      const newEpicMatrix = JSON.stringify(incomingEpicQAMatrix);
      if (oldEpicMatrix !== newEpicMatrix) {
        const path = epicMatrixPath(iniRef, epicRef, 'qa-sistemica');
        const md = buildEpicQAMatrixMarkdown(incomingEpicQAMatrix as Parameters<typeof buildEpicQAMatrixMarkdown>[0]);
        await this.vault.writeNote(
          path,
          md,
          `docs(epic): update epic qa matrix [${epicId}]`,
        );
        this.logger.info({ path }, `[writeEpicArtifacts] qa-sistemica escrita → ${path}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Legacy dependencies — bridge para el roll-up
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Devuelve las dependencias LEGACY de una épica (las que viven en el JSONB
   * `epic.dependencies` y los `.md` discovered en el vault) mapeadas al shape
   * `StoryTechnicalDependency` con `storyId=''` como sentinel para indicar que
   * son legacy a nivel épica (sin owner story específica).
   *
   * El roll-up endpoint las concatena con las nuevas (FK story) para que el
   * usuario VEA todas las deps existentes sin necesidad de un backfill
   * destructivo. Cuando el usuario decida migrar manualmente, podrá crear
   * filas nuevas con FK a stories y borrar el JSONB/vault legacy.
   */
  async getLegacyDependenciesForRollup(
    epicId: string,
  ): Promise<StoryTechnicalDependency[]> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      select: { dependencies: true, vaultPath: true, initiative: { select: { id: true, name: true } }, title: true },
    });
    if (!epic) return [];

    // ── Pre-fetch del set de "deps ya existentes en tabla nueva" ────────
    // Las usamos para deduplicar AMBAS fuentes legacy (JSONB + vault) contra
    // la tabla nueva. Matching compuesto:
    //   - por `id` exacto (cubre vault discovered cuando preserva el id DTO)
    //   - por `title.trim().toLowerCase()` (cubre el JSONB legacy donde el
    //     id puede ser `ai-dep-<uuid>` mientras la tabla genera uuid nuevo)
    // Sin el match por title, las épicas afectadas por el double-write bug
    // mostrarían el mismo dep dos veces (📖 story + 📦 legacy).
    const newTableRows = await this.prisma.storyTechnicalDependency.findMany({
      where: { story: { epicId } },
      select: { id: true, title: true },
    });
    const newTableIds = new Set(newTableRows.map((r) => r.id));
    const newTableTitles = new Set(
      newTableRows.map((r) => r.title.trim().toLowerCase()).filter(Boolean),
    );
    const isAlreadyInNewTable = (id: string | undefined, title: string | undefined): boolean => {
      if (id && newTableIds.has(id)) return true;
      const t = (title ?? '').trim().toLowerCase();
      return !!t && newTableTitles.has(t);
    };

    // ── 1. Manuales del JSONB legacy `epic.dependencies` ─────────────
    const TYPE_TO_CATEGORY: Record<string, StoryTechnicalDependency['category']> = {
      technical: 'services',
      resource: 'services',
      knowledge: 'knowledge',
      external: 'apis',
      'cross-team': 'teams',
    };
    const SEVERITY_NORMALIZE: Record<string, StoryTechnicalDependency['severity']> = {
      critical: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };
    const jsonbRaw = Array.isArray(epic.dependencies)
      ? (epic.dependencies as unknown as EpicDependency[])
      : [];
    const jsonbMapped: StoryTechnicalDependency[] = jsonbRaw
      .filter((d) => !isAlreadyInNewTable(d.id, d.title))
      .map((d) => ({
        id: d.id,
        storyId: '', // sentinel: legacy a nivel épica
        title: d.title,
        description: d.description ?? '',
        category: TYPE_TO_CATEGORY[d.type] ?? 'other',
        severity: SEVERITY_NORMALIZE[d.severity as string] ?? 'medium',
        source: 'manual',
        vendor: d.vendor ?? null,
        requiresCredential: d.requiresCredential ?? false,
        linkedSecretId: d.linkedSecretId ?? null,
        isBlocking: d.isBlocking ?? false,
        targetExternalName: d.targetExternalName ?? null,
        targetEpicId: d.targetEpicId ?? null,
        status: (d.status as StoryTechnicalDependency['status']) ?? 'identified',
        owner: d.owner ?? '',
        dueDate: d.dueDate ?? null,
        resolutionNotes: d.resolutionNotes ?? '',
        mdContent: null,
        createdAt: d.createdAt ?? new Date().toISOString(),
        updatedAt: d.updatedAt ?? new Date().toISOString(),
      }));

    // ── 2. Discovered del vault (.md) — reusamos listDiscoveredDependencies
    // que ya hace el merge con la tabla nueva. Filtramos a las que NO tienen
    // un row equivalente en la nueva tabla (las nuevas ya las trae el rollup
    // principal vía findByEpic, así que evitamos duplicados).
    const CATEGORY_FROM_TYPE: Record<string, StoryTechnicalDependency['category']> = {
      api: 'apis',
      service: 'services',
      data: 'testing',
      team: 'teams',
      other: 'other',
    };
    let discovered: DiscoveredDependency[] = [];
    try {
      discovered = await this.listDiscoveredDependencies(epicId);
    } catch (err) {
      this.logger.warn(
        `[getLegacyDependenciesForRollup] vault discovered failed (non-fatal): ${(err as Error)?.message ?? err}`,
      );
    }
    const discoveredMapped: StoryTechnicalDependency[] = discovered
      .filter((d) => !isAlreadyInNewTable(d.id, d.title))
      .map((d) => ({
        id: d.id,
        storyId: '',
        title: d.title,
        description: d.description ?? '',
        category: CATEGORY_FROM_TYPE[d.type] ?? 'other',
        severity: d.severity as StoryTechnicalDependency['severity'],
        source: 'discovered',
        vendor: d.vendor ?? null,
        requiresCredential: d.requiresCredential ?? false,
        linkedSecretId: d.linkedSecretId ?? null,
        isBlocking: d.isBlocking ?? false,
        targetExternalName: null,
        targetEpicId: null,
        status: 'identified',
        owner: '',
        dueDate: null,
        resolutionNotes: '',
        mdContent: d.mdContent ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

    return [...jsonbMapped, ...discoveredMapped];
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Discovered dependencies (vault-sourced, AI-generated)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Lista las DiscoveredDependency de una épica leyéndolas del folder
   * `dependencias/` del vault. Estas son dependencias descubiertas por el
   * agente QA durante la generación de historias — viven SOLO en el vault
   * (no en Postgres), por eso se parsean en cada request.
   *
   * Diferente del campo `epic.dependencies` (JSONB en PG) que contiene las
   * `EpicDependency` creadas manualmente por el usuario.
   */
  async listDiscoveredDependencies(epicId: string): Promise<DiscoveredDependency[]> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: { initiative: { select: { id: true, name: true } } },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    if (!epic.vaultPath || !isNewFormatVaultPath(epic.vaultPath)) {
      return [];
    }

    const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
    const epicRef: EpicRef = { id: epic.id, title: epic.title };
    const folder = `${epicFolderPath(iniRef, epicRef)}/dependencias`;

    const paths = await this.vault.listNotes(folder);
    if (paths.length === 0) return [];

    const notes = await Promise.all(
      paths.map((p) =>
        this.vault.readNote(p).catch((err: unknown) => {
          this.logger.warn(
            `[listDiscoveredDependencies] readNote failed path=${p} err=${(err as Error)?.message ?? err}`,
          );
          return null;
        }),
      ),
    );

    let parseFailures = 0;
    const vaultDeps = notes
      .map((note) => {
        if (!note) return null;
        const parsed = parseDiscoveredDependencyMarkdown(note.content);
        if (!parsed) parseFailures++;
        return parsed;
      })
      .filter((d): d is DiscoveredDependency => d !== null);

    // Enriquecer con estado del JSONB `epic.dependencies[]`: cuando una dep
    // fue resuelta (linkedSecretId / status: 'resolved'), esa info vive en
    // Postgres, no en el vault (el vault es documentación inmutable). Si el
    // id coincide, preferimos los campos de estado del JSONB.
    const jsonbDeps = Array.isArray(epic.dependencies)
      ? (epic.dependencies as unknown as Array<{ id: string; linkedSecretId?: string; status?: string; vendor?: string; requiresCredential?: boolean; isBlocking?: boolean }>)
      : [];
    const jsonbById = new Map(jsonbDeps.map((d) => [d.id, d]));

    const merged = vaultDeps.map<DiscoveredDependency>((vaultDep) => {
      const jsonbMatch = jsonbById.get(vaultDep.id);
      if (!jsonbMatch) return vaultDep;
      // JSONB es source of truth para state (resolved, linkedSecretId) y
      // para los flags que el agente más reciente haya emitido. El vault
      // es source of truth para mdContent/description (markdown extenso).
      return {
        ...vaultDep,
        vendor: jsonbMatch.vendor ?? vaultDep.vendor,
        requiresCredential: jsonbMatch.requiresCredential ?? vaultDep.requiresCredential,
        isBlocking: jsonbMatch.isBlocking ?? vaultDep.isBlocking,
        linkedSecretId: jsonbMatch.linkedSecretId ?? vaultDep.linkedSecretId,
      };
    });

    // ── Unión con StoryTechnicalDependency (source='discovered') ─────
    // Después del refactor del agente QA, las nuevas discovered deps se
    // persisten directamente en la tabla `StoryTechnicalDependency` con
    // `source='discovered'` (en lugar de .md en vault). Las traemos aquí
    // y las mapeamos al shape de DiscoveredDependency para que el endpoint
    // siga devolviendo una sola lista unificada y la UI no tenga que
    // hacer dos requests durante el periodo de transición.
    const CATEGORY_TO_TYPE: Record<string, DiscoveredDependency['type']> = {
      apis: 'api',
      services: 'service',
      testing: 'data',
      teams: 'team',
      other: 'other',
      secrets: 'other',
      knowledge: 'other',
    };
    const tableDeps = await this.prisma.storyTechnicalDependency.findMany({
      where: { source: 'discovered', story: { epicId } },
    });
    const tableMapped: DiscoveredDependency[] = tableDeps.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      severity: d.severity as DiscoveredDependency['severity'],
      type: CATEGORY_TO_TYPE[d.category] ?? 'other',
      mdContent: d.mdContent ?? '',
      vendor: d.vendor ?? undefined,
      requiresCredential: d.requiresCredential,
      isBlocking: d.isBlocking,
      linkedSecretId: d.linkedSecretId ?? undefined,
    }));
    const finalMerged = [...merged, ...tableMapped];

    this.logger.info(
      `[listDiscoveredDependencies] epic=${epicId} paths=${paths.length} parsed=${vaultDeps.length} parseFailures=${parseFailures} enrichedFromJsonb=${merged.filter((d) => jsonbById.has(d.id)).length} tableDeps=${tableMapped.length}`,
    );
    return finalMerged;
  }

  /**
   * Coverage check del bundle de diseño contra las historias de la épica.
   *
   * Stream A persiste:
   *   - `epic.designs[].componentManifest`: lista determinística de
   *     componentes top-level (secciones HTML + funciones React) extraída
   *     del primary HTML del bundle al subirlo.
   *   - `story.componentsCovered: string[]`: nombres del manifest que
   *     cubre cada historia (poblado por el agente PO).
   *
   * Este endpoint cruza ambas fuentes para responder: "¿está cada
   * componente del bundle cubierto por al menos una historia?". El
   * frontend usa la respuesta para bloquear el botón "Enviar al Forge"
   * cuando faltan stories — antes esta lógica era confiar 100% en el
   * agente PO, y el manifest fue la última red de seguridad pre-deploy.
   *
   * Degrada graciosamente en 3 escenarios:
   *   1. Épica sin bundle → `hasDesignBundle: false`, no bloquea.
   *   2. Bundle legacy sin manifest (upload pre-Stream-A) →
   *      `manifestExists: false`, no bloquea, sugiere re-upload.
   *   3. Stories sin `componentsCovered` (porque Stream A no ha
   *      regenerado o porque la story es manual) → cuentan como
   *      `componentsCovered = []` (silent).
   *
   * Si la épica tiene múltiples bundles, usamos el PRIMERO con manifest
   * (asumimos que es el primary; la UI solo permite uno activo). Si
   * ninguno tiene manifest, se trata como caso legacy.
   */
  async getCoverageCheck(epicId: string): Promise<{
    hasDesignBundle: boolean;
    manifestExists: boolean;
    components: Array<{
      name: string;
      kind: 'section' | 'react-component';
      coverage: {
        covered: boolean;
        coveredByStories: Array<{ storyId: string; storyTitle: string }>;
      };
    }>;
    summary: {
      totalComponents: number;
      coveredComponents: number;
      uncoveredComponents: string[];
      coveragePercent: number;
    };
    canEnqueue: boolean;
  }> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      select: {
        id: true,
        designs: true,
        stories: { select: { id: true, title: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    const emptyResult = {
      components: [],
      summary: {
        totalComponents: 0,
        coveredComponents: 0,
        uncoveredComponents: [],
        coveragePercent: 100,
      },
    };

    // 1. No bundle → coverage gate no aplica.
    const designs = Array.isArray(epic.designs)
      ? (epic.designs as unknown as Array<{
          id: string;
          name?: string;
          componentManifest?: {
            components?: Array<{
              name?: unknown;
              kind?: unknown;
              startLine?: unknown;
              endLine?: unknown;
              filePath?: unknown;
            }>;
            primaryFilePath?: string;
            extractedAt?: string;
          } | null;
        }>)
      : [];
    if (designs.length === 0) {
      return {
        hasDesignBundle: false,
        manifestExists: false,
        ...emptyResult,
        canEnqueue: true,
      };
    }

    // 2. Pick el primer bundle con manifest válido. Sin manifest → legacy.
    const bundleWithManifest = designs.find(
      (d) =>
        d.componentManifest != null &&
        Array.isArray(d.componentManifest.components) &&
        d.componentManifest.components.length > 0,
    );
    if (!bundleWithManifest || !bundleWithManifest.componentManifest) {
      return {
        hasDesignBundle: true,
        manifestExists: false,
        ...emptyResult,
        canEnqueue: true,
      };
    }

    const rawComponents = bundleWithManifest.componentManifest.components ?? [];

    // 3. Cargar componentsCovered de cada story. Stream A persiste el
    //    array directamente en la tabla `stories` o en un campo JSONB —
    //    para desacoplar, leemos defensively con cast a `unknown` y
    //    validamos con Array.isArray. Stories sin el campo aún caen a [].
    //
    //    NOTA: usamos $queryRaw aquí para no acoplar este endpoint al
    //    timing del PR de Stream A que añade la columna al schema Prisma.
    //    `to_jsonb` garantiza que el cast a JSON array funciona ya sea
    //    que la columna sea text[] o jsonb. Si la columna no existe, la
    //    query falla y caemos al catch → tratamos todas las stories como
    //    sin coverage (peor-caso seguro).
    let storyCoverage: Array<{ id: string; title: string; componentsCovered: string[] }> = [];
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; title: string; components_covered: unknown }>
      >(
        Prisma.sql`
          SELECT id, title, to_jsonb("componentsCovered") AS components_covered
          FROM stories
          WHERE "epicId" = ${epicId}
        `,
      );
      storyCoverage = rows.map((r) => {
        const cc = r.components_covered;
        const arr: string[] = Array.isArray(cc)
          ? cc.filter((x): x is string => typeof x === 'string')
          : [];
        return { id: r.id, title: r.title, componentsCovered: arr };
      });
    } catch (err) {
      this.logger.warn(
        `[getCoverageCheck] componentsCovered no disponible (Stream A pending?): ${(err as Error)?.message ?? err}. Usando coverage vacío.`,
      );
      storyCoverage = epic.stories.map((s) => ({
        id: s.id,
        title: s.title,
        componentsCovered: [],
      }));
    }

    // 4. Iterar el manifest y cruzar con storyCoverage.
    const components = rawComponents
      .filter((c) => typeof c?.name === 'string' && (c.kind === 'section' || c.kind === 'react-component'))
      .map((c) => {
        const name = c.name as string;
        const kind = c.kind as 'section' | 'react-component';
        const coveredByStories = storyCoverage
          .filter((s) => s.componentsCovered.includes(name))
          .map((s) => ({ storyId: s.id, storyTitle: s.title }));
        return {
          name,
          kind,
          coverage: {
            covered: coveredByStories.length > 0,
            coveredByStories,
          },
        };
      });

    const totalComponents = components.length;
    const coveredComponents = components.filter((c) => c.coverage.covered).length;
    const uncoveredComponents = components
      .filter((c) => !c.coverage.covered)
      .map((c) => c.name);
    const coveragePercent =
      totalComponents === 0
        ? 100
        : Math.round((coveredComponents / totalComponents) * 100);

    // === FORENSIC LOG: por qué quedaron componentes sin cobertura ===
    // Cuando el UI muestra "0/N cubiertos" después de generar historias,
    // necesitamos saber si: (a) las stories no emitieron `componentsCovered`,
    // (b) emitieron pero con nombres distintos (case mismatch, typo),
    // (c) la columna en BD está vacía. Este log emite todos los datos crudos
    // para diagnosticar sin acceso a la BD.
    if (totalComponents > 0 && coveredComponents < totalComponents) {
      // Calcular todos los nombres que aparecen en componentsCovered de cualquier story.
      const allReportedByStories = new Set<string>();
      const storiesWithEmptyCoverage: string[] = [];
      const storiesWithCoverage: Array<{ id: string; title: string; covered: string[] }> = [];
      for (const s of storyCoverage) {
        if (s.componentsCovered.length === 0) {
          storiesWithEmptyCoverage.push(`${s.id.slice(0, 8)}:${s.title.slice(0, 40)}`);
        } else {
          storiesWithCoverage.push({ id: s.id, title: s.title, covered: s.componentsCovered });
          for (const c of s.componentsCovered) allReportedByStories.add(c);
        }
      }
      const manifestNames = components.map((c) => c.name);
      // Nombres en stories que NO matchean ningún componente del manifest.
      const reportedButNotInManifest = Array.from(allReportedByStories).filter(
        (n) => !manifestNames.includes(n),
      );
      // Posibles mismatches case-insensitive (típicamente PascalCase vs camelCase).
      const possibleCaseMismatches: Array<{ reported: string; manifestMatch: string }> = [];
      for (const reported of reportedButNotInManifest) {
        const ciMatch = manifestNames.find(
          (m) => m.toLowerCase() === reported.toLowerCase() && m !== reported,
        );
        if (ciMatch) {
          possibleCaseMismatches.push({ reported, manifestMatch: ciMatch });
        }
      }
      this.logger.warn(
        {
          event: 'coverage.gap_analysis',
          epicId,
          totalComponents,
          coveredComponents,
          uncoveredComponents,
          totalStories: storyCoverage.length,
          storiesWithCoverageCount: storiesWithCoverage.length,
          storiesWithEmptyCoverageCount: storiesWithEmptyCoverage.length,
          storiesWithEmptyCoverage: storiesWithEmptyCoverage.slice(0, 10),
          allReportedByStories: Array.from(allReportedByStories),
          reportedButNotInManifest,
          possibleCaseMismatches,
          manifestNames,
        },
        `[coverage.gap] epic=${epicId} ${coveredComponents}/${totalComponents} cubiertos. ` +
          `${storiesWithEmptyCoverage.length}/${storyCoverage.length} stories SIN componentsCovered. ` +
          `${reportedButNotInManifest.length} nombres reportados NO matchean manifest. ` +
          `${possibleCaseMismatches.length} posibles mismatches por case.`,
      );

      // Si hay case mismatches, log más loud
      if (possibleCaseMismatches.length > 0) {
        this.logger.error(
          { event: 'coverage.case_mismatch', epicId, mismatches: possibleCaseMismatches },
          `🚨 [coverage.case_mismatch] epic=${epicId} — las stories reportan nombres que matchean el manifest IGNORANDO case. ` +
            `Ejemplos: ${possibleCaseMismatches
              .slice(0, 3)
              .map((m) => `"${m.reported}" → manifest tiene "${m.manifestMatch}"`)
              .join(', ')}. El matching del coverage es case-sensitive — esto es bug del PO al normalizar nombres.`,
        );
      }
    }

    return {
      hasDesignBundle: true,
      manifestExists: true,
      components,
      summary: {
        totalComponents,
        coveredComponents,
        uncoveredComponents,
        coveragePercent,
      },
      canEnqueue: uncoveredComponents.length === 0,
    };
  }

  /**
   * Lista el DAG de orden entre historias del epic. Retorna cada historia
   * que tiene al menos una dep entrante (está bloqueada por algo) junto con
   * los edges de sus bloqueantes. Las historias sin deps se omiten — el
   * frontend las asume paralelizables.
   *
   * Shape retornado optimizado para render: cada item incluye el título de
   * la historia bloqueada y el de cada bloqueante para evitar N+1 lookups.
   */
  async listStoryDependencies(epicId: string): Promise<Array<{
    story: { id: string; title: string };
    blockedBy: Array<{
      story: { id: string; title: string };
      hardness: string;
      reason: string;
      description: string;
    }>;
  }>> {
    const epic = await this.prisma.epic.findUnique({ where: { id: epicId }, select: { id: true } });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    // Una sola query: todas las story dependencies donde la historia
    // bloqueada (storyId) pertenece a este epic. Incluimos ambas puntas
    // con su title para render directo.
    const edges = await this.prisma.storyDependency.findMany({
      where: { story: { epicId } },
      include: {
        story: { select: { id: true, title: true } },
        blockedBy: { select: { id: true, title: true } },
      },
      orderBy: [{ storyId: 'asc' }, { createdAt: 'asc' }],
    });

    // Agrupa por storyId — retorno es una entry por historia bloqueada.
    const byStoryId = new Map<string, {
      story: { id: string; title: string };
      blockedBy: Array<{
        story: { id: string; title: string };
        hardness: string;
        reason: string;
        description: string;
      }>;
    }>();
    for (const edge of edges) {
      const key = edge.storyId;
      if (!byStoryId.has(key)) {
        byStoryId.set(key, { story: edge.story, blockedBy: [] });
      }
      byStoryId.get(key)!.blockedBy.push({
        story: edge.blockedBy,
        hardness: edge.hardness,
        reason: edge.reason,
        description: edge.description,
      });
    }

    const result = Array.from(byStoryId.values());
    this.logger.info(
      `[listStoryDependencies] epic=${epicId} stories-with-deps=${result.length} total-edges=${edges.length}`,
    );
    return result;
  }

  /**
   * Borra un diseño de la épica con cleanup completo:
   *  1. Si tiene `bundleVaultPath` (diseño con ZIP): lista TODOS los archivos
   *     descomprimidos bajo ese path con `vault.listTree()` y los borra
   *     uno por uno con `vault.deleteNote()`. GitHub no soporta "rm -rf"
   *     atómico — cada archivo es un commit, así que los iteramos.
   *  2. Si tiene `bundleKey` (ZIP de respaldo en disco): borra el archivo.
   *  3. Si NO tiene bundle (diseño legacy con URL handoff): borra el
   *     `.md` independiente bajo `disenos/<slug>-<id6>.md`.
   *  4. Quita el design del array `epic.designs` y persiste.
   *
   * Idempotente: si el design ya no existe, retorna sin error.
   * Tolerante a fallos de cleanup parciales: si un `deleteNote` falla
   * (network, 404, etc.), loguea y continúa — el design se quita del array
   * de cualquier manera. Archivos huérfanos en el vault son cosméticos,
   * no rompen funcionalidad.
   */
  async deleteDesign(
    epicId: string,
    designId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        initiative: { select: { id: true, name: true } },
        pods: { select: { podId: true } },
      },
    });
    if (!epic) throw new NotFoundException(`Épica ${epicId} no encontrada`);

    // CWE-639 BOLA — fix de security-reviewer HIGH 2026-05-04. Sin esta
    // validación, cualquier user con EDIT_EPIC podía borrar diseños de
    // épicas de otros pods (DELETE simétrico al upload).
    assertUserCanAccessEpicPods(
      user,
      epic.pods.map((p) => p.podId),
    );

    const designs = Array.isArray(epic.designs) ? (epic.designs as unknown as Array<{
      id: string;
      name: string;
      bundleKey?: string;
      bundleVaultPath?: string;
    }>) : [];
    const design = designs.find((d) => d.id === designId);
    if (!design) {
      // Idempotente: ya no está, nothing to clean.
      this.logger.info({ designId, epicId }, `[deleteDesign] design=${designId} ya no existe en epic=${epicId}, no-op`);
      return;
    }

    // 1) Cleanup de archivos del vault.
    if (design.bundleVaultPath) {
      // Diseño con bundle ZIP. listTree devuelve un árbol NESTED — recorremos
      // recursivo para colectar TODOS los archivos hoja.
      const folder = design.bundleVaultPath.replace(/\/+$/, '');

      // SECURITY (CWE-22 / CWE-639): bundleVaultPath se persiste en JSONB y
      // es nominalmente user-supplied vía CreateEpicDto/UpdateEpicDto. Antes
      // de listar/borrar archivos, validamos que apunte DENTRO del folder de
      // disenos de esta épica y que termine con el sufijo `-<id6>` que produce
      // `slugifyWithId(name, design.id)`. Sin esta validación, un user con
      // EDIT_EPIC podría plantar bundleVaultPath="iniciativas" y borrar todo
      // el vault de la org al triggerar este endpoint.
      //
      // No comparamos con el path reconstruido porque el slug del nombre puede
      // haber cambiado tras un rename — el `update()` PRESERVA bundleVaultPath
      // del valor original (ver línea ~696). El sufijo `-<id6>` sí es estable
      // y suficiente: el id6 deriva del design.id actual, no del nombre.
      // Defense-in-depth: rechazar caracteres que permitan path traversal
      // o ataques downstream (..,  \\, //, control chars). Coste cero — un
      // path legítimo generado por slugifyWithId nunca contiene estos.
      if (
        folder.includes('..') ||
        folder.includes('\\') ||
        folder.includes('//') ||
        // eslint-disable-next-line no-control-regex
        /[\x00-\x1f]/.test(folder)
      ) {
        this.logger.error(
          `[deleteDesign] bundleVaultPath con caracteres peligrosos: epic=${epicId} design=${designId} folder="${folder}"`,
        );
        throw new ForbiddenException(
          'bundleVaultPath contiene caracteres inválidos',
        );
      }

      const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
      const epicRef: EpicRef = { id: epic.id, title: epic.title };
      const expectedPrefix = `${epicFolderPath(iniRef, epicRef)}/disenos/`;
      const expectedIdSuffix = `-${design.id.slice(-6)}`;
      if (!folder.startsWith(expectedPrefix) || !folder.endsWith(expectedIdSuffix)) {
        this.logger.error(
          `[deleteDesign] bundleVaultPath inválido (posible tampering): epic=${epicId} design=${designId} folder="${folder}" expected_prefix="${expectedPrefix}" expected_id_suffix="${expectedIdSuffix}"`,
        );
        throw new ForbiddenException(
          'bundleVaultPath inconsistente con el folder esperado del diseño',
        );
      }

      try {
        const tree = await this.vault.listTree(folder);
        const flatFiles: Array<{ path: string }> = [];
        const walk = (nodes: typeof tree): void => {
          for (const node of nodes) {
            if (node.type === 'file') {
              flatFiles.push({ path: node.path });
            } else if (node.children) {
              walk(node.children);
            }
          }
        };
        walk(tree);
        this.logger.info(
          `[deleteDesign] bundle cleanup epic=${epicId} design=${designId} files=${flatFiles.length} folder=${folder}`,
        );
        for (const file of flatFiles) {
          try {
            await this.vault.deleteNote(
              file.path,
              `chore(design): cleanup ${design.name} [${epicId}]`,
            );
          } catch (err: any) {
            this.logger.warn(
              `[deleteDesign] no se pudo borrar ${file.path}: ${err?.message ?? err}`,
            );
          }
        }
      } catch (err: any) {
        // listTree falló — log y continúa con el resto del cleanup.
        this.logger.warn(
          `[deleteDesign] listTree falló para ${folder}: ${err?.message ?? err}`,
        );
      }
    } else if (epic.vaultPath) {
      // Diseño legacy (URL handoff): un único .md hermano bajo disenos/.
      try {
        const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
        const epicRef: EpicRef = { id: epic.id, title: epic.title };
        const path = epicDesignPath(iniRef, epicRef, { id: design.id, name: design.name });
        await this.vault.deleteNote(
          path,
          `chore(design): remove ${design.name} [${epicId}]`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[deleteDesign] legacy cleanup falló: ${err?.message ?? err}`,
        );
      }
    }

    // 2) Cleanup del ZIP de respaldo (solo bundles).
    if (design.bundleKey) {
      await this.designBundle.deleteBundle(design.bundleKey);
    }

    // 3) Quitar del array y persistir.
    const next = designs.filter((d) => d.id !== designId);
    await this.prisma.epic.update({
      where: { id: epicId },
      data: {
        designs: next as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    this.logger.info({ epicId, designId }, `[deleteDesign] epic=${epicId} design=${designId} cleanup completo`);
  }

  /**
   * Sube un bundle ZIP de Claude Design y lo asocia como diseño de la épica.
   *
   * Orquesta:
   *  1. Carga la épica + iniciativa para construir paths del vault.
   *  2. Llama a DesignBundleService para validar + descomprimir el ZIP +
   *     guardarlo a disco como respaldo.
   *  3. Para cada archivo texto del bundle, hace `vault.writeNote()` bajo
   *     `<epicFolder>/disenos/<designSlug>-<id6>/<relativePath>`.
   *  4. Construye el handoff sintético y lo guarda en BD como
   *     `EpicDesign.handoff`.
   *  5. Persiste el EpicDesign al array `epic.designs` (JSONB).
   *
   * Falla con BadRequestException si el ZIP no es válido (estructura,
   * tamaño, sin README). El cleanup parcial NO se hace: si falla a mitad
   * de los `writeNote`, los archivos previos quedan en el vault. Razón:
   * el agente puede ignorar archivos huérfanos via su listing — y un retry
   * del user resuelve sin estado intermedio dañino.
   */
  async addDesignBundle(
    epicId: string,
    params: {
      name: string;
      description: string;
      file: Express.Multer.File;
      user: AuthenticatedUser;
    },
  ): Promise<{ id: string; name: string; description: string; handoff: string; bundleKey: string; bundleVaultPath: string; createdAt: string; updatedAt: string; createdBy?: string }> {
    const epic = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        initiative: { select: { id: true, name: true } },
        pods: { select: { podId: true } },
      },
    });
    if (!epic) throw new NotFoundException(`Épica ${epicId} no encontrada`);

    // CWE-639 BOLA — fix de security-reviewer HIGH 2026-05-04. Sin esta
    // validación, cualquier user con EDIT_EPIC (TechLead, etc.) podía subir
    // diseños a épicas de otros pods, plantando contenido en su vault y
    // material de prompt-injection en sus agent handoffs.
    assertUserCanAccessEpicPods(
      params.user,
      epic.pods.map((p) => p.podId),
    );

    if (!epic.vaultPath) {
      throw new ConflictException(
        'La épica no tiene vaultPath — no se puede asociar diseños sin folder en el vault.',
      );
    }

    // 1) Extraer + validar. Dispatch por extensión:
    //    - `.html` → standalone HTML (sin wrapper folder ni README).
    //    - `.zip` → bundle de Claude Design (estructura wrapper/README/project/).
    //    Cualquier otra extensión rechaza con BadRequestException explícita
    //    para que el user no se confunda con un "estructura inválida" críptico.
    const lowerName = (params.file.originalname || '').toLowerCase();
    let extracted;
    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
      extracted = await this.designBundle.extractStandaloneHtml(
        params.file.buffer,
        params.file.originalname,
      );
    } else if (lowerName.endsWith('.zip')) {
      extracted = await this.designBundle.extractBundle(
        params.file.buffer,
        params.file.originalname,
      );
    } else {
      throw new BadRequestException(
        'Formato no soportado. Sube un `.zip` (bundle de Claude Design) o un `.html` standalone.',
      );
    }

    // 2) Generar el id del nuevo design + paths del vault.
    const designId = randomUUID();
    const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
    const epicRef: EpicRef = { id: epic.id, title: epic.title };
    const folder = epicDesignBundleFolderPath(iniRef, epicRef, {
      id: designId,
      name: params.name,
    });
    // bundleVaultPath con trailing slash para concatenación trivial.
    const bundleVaultPath = `${folder}/`;

    // 3) Escribir cada archivo texto del bundle al vault. Hacemos write
    //    serial para no saturar la API de GitHub (Octokit) — en paralelo
    //    a 50 archivos hemos visto rate limits 403 esporádicos.
    for (const file of extracted.textFiles) {
      // Defense-in-depth CWE-22: extractBundle ya valida `..` segments,
      // pero re-validamos acá por si un caller futuro pasa un ExtractedBundle
      // construido fuera del extractor canónico (ej: tests, sync hipotético
      // desde otro storage). Fail-closed: skip + log, no abort del flow.
      const segments = file.relativePath.split('/');
      if (
        segments.some((seg) => seg === '..' || seg === '') ||
        file.relativePath.startsWith('/')
      ) {
        this.logger.warn(
          `[addDesignBundle] Skipped entry with path traversal: epic=${epicId} entry="${file.relativePath}"`,
        );
        continue;
      }
      const path = `${folder}/${file.relativePath}`;
      await this.vault.writeNote(
        path,
        file.content,
        `docs(design): bundle ${extracted.bundleSlug} → ${file.relativePath} [${epicId}]`,
      );
    }
    this.logger.info(
      `[addDesignBundle] epic=${epicId} design=${designId} files=${extracted.textFiles.length} ` +
      `binaries=${extracted.binaryEntries.length} bundleKey=${extracted.bundleKey}`,
    );

    // 4) Construir handoff sintético — usa el bundleVaultPath para que las
    //    referencias sean absolutas dentro del vault.
    const handoff = this.designBundle.buildSyntheticHandoff(extracted, bundleVaultPath);

    // 5) Persistir el EpicDesign al array JSONB.
    // BUG FIX 2026-05-25: `componentManifest` ANTES no se persistía aunque
    // el extractor lo generara. El handoff sí lo recibía como texto pero el
    // field estructurado (que el getCoverageCheck + DiagramGen + PO/QA
    // necesitan leer para forzar cobertura) quedaba null en BD. Resultado:
    // bundles "modernos" se reportaban como "legacy sin manifest" en la UI.
    // El fix es propagar `extracted.componentManifest` al objeto persistido.
    const nowIso = new Date().toISOString();
    const newDesign = {
      id: designId,
      name: params.name,
      description: params.description,
      handoff,
      bundleKey: extracted.bundleKey,
      bundleVaultPath,
      componentManifest: extracted.componentManifest ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: params.user.sub,
    };

    const currentDesigns = Array.isArray(epic.designs) ? epic.designs : [];
    const updated = [...(currentDesigns as Prisma.JsonArray), newDesign as unknown as Prisma.JsonObject];
    await this.prisma.epic.update({
      where: { id: epicId },
      data: {
        designs: updated as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    return newDesign;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Visto Bueno (VoBo) — aprobación por rol con step-up authentication
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aprueba una épica como uno de los 3 roles del Protocolo de Visto Bueno
   * (PO, TL, QA). Esta es la puerta humana antes de que la épica pueda ser
   * encolada al Forge — los 3 VoBos son requisito.
   *
   * Reglas de seguridad (en orden de evaluación):
   *  1. Pod intersection: el aprobador debe compartir al menos un pod con
   *     la épica (CWE-639 BOLA — el guard global de permisos no es
   *     suficiente porque varios pods pueden tener PO/TL/QA y no queremos
   *     que un PO de pod A apruebe épicas de pod B).
   *  2. Role match estricto: el rol del usuario autenticado debe ser
   *     EXACTAMENTE el rol que aprueba (PO solo puede dar VoBo de PO,
   *     etc). Alta Gerencia NO puede sustituir VoBos — la trazabilidad
   *     se rompería si un único super-user pudiera aprobar todo.
   *  3. Password: verificada contra Auth0 (step-up authentication).
   *     Distinto a re-leer el JWT — si el laptop quedó abierto, el JWT
   *     sigue siendo válido pero quien tipea no es el dueño.
   *  4. Prerequisites: la épica debe tener definición completa, diagrama
   *     de negocio y al menos 1 historia. Para TL: además poApproval done.
   *     Para QA: poApproval + tlApproval done.
   *
   * Side-effects:
   *  - Persiste {role}Approval en la épica con approvedBy=user.sub,
   *    approvedAt=now, comment.
   *  - Crea ChangelogEntry con action='approved' field='{role}Approval'
   *    para auditoría inmutable.
   *
   * No-op: si la épica ya tiene ese VoBo en estado 'approved', se rechaza
   * con ConflictException — re-aprobar no tiene sentido y dispararía
   * cambios fantasma en el changelog.
   */
  async approve(
    epicId: string,
    role: 'po' | 'tl' | 'qa',
    dto: ApproveEpicDto,
    user: AuthenticatedUser,
  ): Promise<{
    status: 'approved';
    approvedAt: string;
    approvedBy: string;
    approvedByName: string;
    comment: string | null;
  }> {
    this.logger.info({ role, epicId, sub: user.sub }, `[approve:${role}] START epicId=${epicId} userId=${user.sub}`);

    const existing = await this.prisma.epic.findUnique({
      where: { id: epicId },
      include: {
        pods: { select: { podId: true } },
        stories: { select: { id: true } },
      },
    });
    if (!existing) throw new NotFoundException('Épica no encontrada');

    // 1. Pod intersection — además del Permission guard global.
    assertUserCanAccessEpicPods(
      user,
      existing.pods.map((p) => p.podId),
    );

    // 2. Role match — el rol específico O Alta Gerencia (que puede aprobar
    //    en nombre de cualquier rol). La trazabilidad se preserva porque
    //    persistimos `approvedByName` con el nombre del aprobador real,
    //    así un VoBo dado por admin queda registrado como tal en el
    //    changelog y en el approval JSON.
    const expectedRole = ROLE_BY_APPROVAL_KIND[role];
    const isAdmin = user.role === UserRole.AltaGerencia;
    if (!isAdmin && user.role !== expectedRole) {
      throw new ForbiddenException(
        `Sólo un usuario con rol ${expectedRole} (o Alta Gerencia) puede dar el VoBo de ${role.toUpperCase()}`,
      );
    }

    // 3. Idempotency check optimista — falla rápido si ya está aprobada.
    //    Esta lectura NO es la garantía de unicidad; la garantía real está
    //    en la transacción serialized abajo (paso 6) que usa SELECT...FOR
    //    UPDATE para prevenir TOCTOU si dos PO clickean el mismo botón
    //    en el mismo milisegundo.
    const currentApproval = (existing as Record<string, unknown>)[`${role}Approval`] as
      | { status?: string }
      | null;
    if (currentApproval?.status === 'approved') {
      throw new ConflictException(`La épica ya tiene VoBo de ${role.toUpperCase()}`);
    }

    // 4. Verificar prerequisites antes de gastar latencia en Auth0.
    this.assertEpicReadyForApproval(existing as EpicReadinessSnapshot, role);

    // 5. Step-up authentication — verifica password contra Auth0. Esta
    //    llamada de red es la más cara; la dejamos al final para que las
    //    validaciones síncronas fallen primero.
    await this.authService.assertPasswordValid(user, dto.password);

    // 6. Persistir approval + changelog en transacción con LOCK FOR UPDATE
    //    para prevenir TOCTOU race condition. Sin lock, dos usuarios con
    //    el mismo rol pueden pasar el idempotency check del paso 3 y ambos
    //    escribir su approval; el segundo silenciosamente sobreescribiría
    //    al primero, pero el changelog tendría dos entradas inconsistentes.
    //
    //    El SELECT FOR UPDATE bloquea la fila durante la transacción —
    //    el segundo aprobador espera al COMMIT del primero, lee el campo
    //    fresco y ve status='approved', lanzando ConflictException.
    const now = new Date();
    // Snapshot del nombre — congelar en el approval para que la trazabilidad
    // sobreviva si el usuario cambia su display name o se elimina del equipo.
    // Email como fallback porque algunos tenants Auth0 no tienen `name` en el
    // JWT (configuración del Post-Login Action).
    const approverName = user.name || user.email || user.sub;
    const approval = {
      status: 'approved' as const,
      approvedBy: user.sub,
      approvedByName: approverName,
      approvedAt: now.toISOString(),
      comment: dto.comment ?? null,
    };

    const fieldName = `${role}Approval` as 'poApproval' | 'tlApproval' | 'qaApproval';

    await this.prisma.$transaction(async (tx) => {
      // Lock atómico de la fila. SELECT...FOR UPDATE es PostgreSQL-specific
      // pero compatible con el datasource del proyecto. El id se inyecta
      // como parámetro para evitar SQL injection.
      await tx.$queryRaw`SELECT id FROM epics WHERE id = ${epicId} FOR UPDATE`;

      // Re-leer el approval ahora que la fila está locked. Sólo selecciona
      // el campo que nos importa (los 3 son JSONB; son cheap).
      const fresh = await tx.epic.findUnique({
        where: { id: epicId },
        select: { poApproval: true, tlApproval: true, qaApproval: true },
      });
      const freshApproval = (fresh as Record<string, unknown> | null)?.[fieldName] as
        | { status?: string }
        | null;
      if (freshApproval?.status === 'approved') {
        throw new ConflictException(
          `La épica ya tiene VoBo de ${role.toUpperCase()}`,
        );
      }

      await tx.epic.update({
        where: { id: epicId },
        data: {
          [fieldName]: approval as unknown as Prisma.InputJsonValue,
          updatedAt: now,
        },
      });
      await tx.changelogEntry.create({
        data: {
          entityType: 'epic',
          entityId: epicId,
          entityTitle: existing.title,
          action: 'approved',
          field: fieldName,
          oldValue: null,
          // Sólo guardamos los campos clave en newValue — no el JSON entero
          // (sería ruido para el lector y duplica datos del epic.{x}Approval).
          // SECURITY: este string es plain text — viewers deben usar text
          // nodes en React, NUNCA dangerouslySetInnerHTML ni markdown render
          // sin sanitización (CWE-79).
          newValue: `${user.name || user.email}${dto.comment ? ` — ${dto.comment}` : ''}`,
          changedById: user.sub,
          changedByName: user.name || user.email,
        },
      });
    });

    this.logger.info(
      `[approve:${role}] OK epicId=${epicId} approvedBy=${user.sub}`,
    );

    return {
      status: 'approved',
      approvedAt: approval.approvedAt,
      approvedBy: approval.approvedBy,
      approvedByName: approval.approvedByName,
      comment: approval.comment,
    };
  }

  /**
   * Verifica que la épica tenga los artefactos requeridos para dar VoBo.
   * Los 3 roles (PO, TL, QA) aprueban en PARALELO — no hay cascada
   * secuencial. Cada uno valida su dimensión independiente:
   *
   *  - PO: que la definición refleje el valor de negocio
   *  - TL: que la arquitectura sea viable
   *  - QA: que los criterios sean testables
   *
   * Sin orden de prerequisitos entre approvals, todos los aprobadores
   * pueden trabajar simultáneamente y la épica avanza más rápido al
   * "Épica Lista" sin bloqueos artificiales.
   *
   * Únicos prerequisitos comunes (artefactos del editor humano + agente IA):
   *  - Definición completa (9 headings obligatorios)
   *  - Diagrama de negocio generado
   *  - ≥1 historia de usuario
   */
  private assertEpicReadyForApproval(
    epic: EpicReadinessSnapshot,
    role: 'po' | 'tl' | 'qa',
  ): void {
    // Validación shared con frontend — regex exact-match case-insensitive.
    // Reemplaza el viejo `md.includes(h.toLowerCase())` que tenía dos bugs:
    //  (a) substring trap: `## Alcance de negocio` matcheaba `## Alcance`.
    //  (b) headings divergidos del frontend (descripción vs Objetivo).
    if (!epicMarkdownHasAllHeadings(epic.markdown)) {
      throw new BadRequestException(
        'La épica no tiene la definición completa (faltan headings obligatorios)',
      );
    }

    const diagrams = (epic.diagrams as Array<{ type?: string }> | null) ?? [];
    const hasBusinessDiagram = diagrams.some((d) => d?.type === 'business');
    if (!hasBusinessDiagram) {
      throw new BadRequestException(
        'La épica no tiene diagrama de negocio generado',
      );
    }

    if (epic.stories.length === 0) {
      throw new BadRequestException(
        'La épica no tiene historias de usuario generadas',
      );
    }

    // Sin cascada de approvals — los 3 roles aprueban en paralelo. El
    // parámetro `role` se mantiene en la signature para futuros checks
    // role-specific (ej. PO valida acceptance criteria, TL valida
    // diagrama técnico, QA valida QA matrix). Por ahora, los 3
    // comparten el mismo set de prerequisitos artifactuales.
  }
}

const ROLE_BY_APPROVAL_KIND: Record<'po' | 'tl' | 'qa', UserRole> = {
  po: UserRole.ProductOwner,
  tl: UserRole.TechLead,
  qa: UserRole.QA,
};

interface EpicReadinessSnapshot {
  title: string;
  markdown: string | null;
  diagrams: Prisma.JsonValue;
  stories: { id: string }[];
  poApproval: Prisma.JsonValue;
  tlApproval: Prisma.JsonValue;
}
