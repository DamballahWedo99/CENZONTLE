import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser, TrackerReference } from '@cenzontle/shared';
import { UserRole } from '@cenzontle/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { CreateInitiativeDto } from './dto/create-initiative.dto';
import { UpdateInitiativeDto } from './dto/update-initiative.dto';
import { InitiativeQueryDto } from './dto/initiative-query.dto';
import {
  initiativeFolderPath,
  initiativeIndexPath,
  initiativeDefinitionPath,
  isLegacyVaultPath,
  isNewFormatVaultPath,
  type InitiativeRef,
} from '../vault-paths';
import { buildFrontmatter } from '../vault-frontmatter';

const PENDING_TRACKER_SENTINEL = '__pending__';

const INITIATIVE_INCLUDE = {
  epics: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      pods: { include: { pod: { select: { id: true, name: true, color: true } } } },
    },
  },
} as const;

/**
 * Las iniciativas solo tienen un campo narrativo (description). Todos los demás
 * son estructurales (name, status, dates, owner) o JSONB (documents).
 */
interface InitiativeMarkdownData {
  description?: string;
}

@Injectable()
export class InitiativesService {
  private readonly logger = new Logger(InitiativesService.name);

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private vaultFolder: VaultFolderService,
    private integrationsService: IntegrationsService,
  ) {}

  /**
   * Garantiza que la iniciativa tenga un tracker en el provider externo.
   * Idempotente: si ya tiene tracker real, lo devuelve. Si está en proceso
   * (sentinel), lanza 409. Si no tiene, lo crea atómicamente y persiste.
   *
   * Se invoca tanto desde el endpoint público como desde EpicsService.publishToTracker
   * (cascade hacia arriba: subir una épica primero asegura la iniciativa).
   */
  async ensureTracker(
    initiativeId: string,
    provider: 'linear' | 'jira',
    user: AuthenticatedUser,
  ): Promise<{ alreadyPublished: boolean; tracker: TrackerReference }> {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id: initiativeId },
      include: {
        epics: { include: { pods: { select: { podId: true } } } },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    // Auth: AltaGerencia O comparte pod con cualquier épica de la iniciativa.
    const isAdmin = user.role === UserRole.AltaGerencia;
    const allowedPodIds = new Set<string>();
    for (const epic of initiative.epics) {
      for (const ep of epic.pods) allowedPodIds.add(ep.podId);
    }
    const sharesPod = (user.podIds ?? []).some((p) => allowedPodIds.has(p));
    if (!isAdmin && !sharesPod) {
      throw new ForbiddenException(
        'No autorizado: solo AltaGerencia o miembros de un pod asignado a sus épicas pueden publicar esta iniciativa.',
      );
    }

    const existingTracker = initiative.tracker as unknown as TrackerReference | null;
    if (
      existingTracker?.externalId &&
      existingTracker.externalId !== PENDING_TRACKER_SENTINEL
    ) {
      return { alreadyPublished: true, tracker: existingTracker };
    }

    // Si OTRA request ya está publicando (sentinel presente), esperamos
    // silenciosamente a que termine en lugar de devolver 409. El loader del
    // botón se mantiene activo durante la espera. Solo lanzamos error real
    // si el otro proceso no termina en `WAIT_BUDGET_MS`.
    if (existingTracker?.externalId === PENDING_TRACKER_SENTINEL) {
      const waited = await this.waitForTrackerOrFreed(initiativeId);
      if (waited.kind === 'ready') {
        return { alreadyPublished: true, tracker: waited.tracker };
      }
      if (waited.kind === 'timeout') {
        throw new ConflictException(
          'Otra publicación de esta iniciativa lleva mucho tiempo. Reintenta en unos segundos.',
        );
      }
      // 'freed' → caemos al CAS de abajo y reintentamos el claim.
    }

    // CAS atómico: solo procede si tracker es null.
    const placeholder = {
      provider,
      externalId: PENDING_TRACKER_SENTINEL,
      externalKey: PENDING_TRACKER_SENTINEL,
      externalUrl: '',
    };
    const claimed = await this.prisma.initiative.updateMany({
      where: { id: initiativeId, tracker: { equals: Prisma.DbNull } },
      data: { tracker: placeholder as unknown as Prisma.InputJsonValue },
    });
    if (claimed.count === 0) {
      // El claim falló — alguien más lo tomó entre findUnique y updateMany.
      // Esperamos al ganador. Si termina OK → devolvemos su tracker. Si falla
      // y libera el lock (`freed`) → recursión para reintentar el claim.
      const waited = await this.waitForTrackerOrFreed(initiativeId);
      if (waited.kind === 'ready') {
        return { alreadyPublished: true, tracker: waited.tracker };
      }
      if (waited.kind === 'freed') {
        return this.ensureTracker(initiativeId, provider, user);
      }
      throw new ConflictException(
        'Otra publicación de esta iniciativa lleva mucho tiempo. Reintenta en unos segundos.',
      );
    }

    let tracker: TrackerReference;
    try {
      const trackerProvider = await this.integrationsService.getProvider(provider);
      tracker = await trackerProvider.publishInitiative({
        id: initiative.id,
        name: initiative.name,
        description: initiative.description,
        startDate: initiative.startDate,
        targetDate: initiative.targetDate,
        status: initiative.status,
      });
    } catch (err) {
      // Liberar el lock para que un retry pueda intentar de nuevo.
      await this.prisma.initiative.update({
        where: { id: initiativeId },
        data: { tracker: Prisma.DbNull },
      });
      throw err;
    }

    await this.prisma.initiative.update({
      where: { id: initiativeId },
      data: { tracker: tracker as unknown as Prisma.InputJsonValue },
    });
    await this.integrationsService.markSyncedAt(provider);

    this.logger.log(
      `[ensureTracker] actor=${user.sub} initiative=${initiativeId} → ${tracker.externalKey}`,
    );

    return { alreadyPublished: false, tracker };
  }

  async publishToTracker(
    initiativeId: string,
    provider: 'linear' | 'jira',
    user: AuthenticatedUser,
  ) {
    return this.ensureTracker(initiativeId, provider, user);
  }

  /**
   * Polling corto (cada 250ms hasta 20s) sobre `initiative.tracker`. Resuelve
   * cuando el sentinel desaparece — bien porque otro proceso terminó (kind
   * `ready`), bien porque liberó el lock por error (`freed`). Si pasa el
   * budget total sin cambios, retorna `timeout` para escalar a 409.
   */
  private async waitForTrackerOrFreed(
    initiativeId: string,
  ): Promise<
    | { kind: 'ready'; tracker: TrackerReference }
    | { kind: 'freed' }
    | { kind: 'timeout' }
  > {
    const POLL_INTERVAL_MS = 250;
    const WAIT_BUDGET_MS = 20_000;
    const start = Date.now();
    while (Date.now() - start < WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const row = await this.prisma.initiative.findUnique({
        where: { id: initiativeId },
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

  async findAll(query: InitiativeQueryDto, user?: AuthenticatedUser) {
    const where: Prisma.InitiativeWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Filtrado por pods — el usuario sólo ve iniciativas que tienen al menos
    // UNA épica con AL MENOS UN pod en común con su `user.podIds`. Las
    // iniciativas no tienen pods directos (la asociación es transitiva
    // Initiative → Epic → Pod), por eso el filtro es anidado.
    //
    // Reglas:
    //  - AltaGerencia ve todas las iniciativas.
    //  - Caller interno (sin user, ej. agentes batch) ve todas.
    //  - Usuario sin pods → no ve nada (fail-closed, mismo patrón que épicas).
    //  - Iniciativa sin épicas → invisible para no-admins (sin canal de acceso).
    //
    // Patrón consistente con epics.service.ts:450-468 (CWE-639 fix MEDIUM).
    if (user && user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      if (userPodIds.length === 0) return [];
      where.epics = {
        some: {
          pods: {
            some: { podId: { in: userPodIds } },
          },
        },
      };
    }

    return this.prisma.initiative.findMany({
      where,
      include: INITIATIVE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, includeContent = false, user?: AuthenticatedUser) {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id },
      include: INITIATIVE_INCLUDE,
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    // Pod intersection — para no-AltaGerencia, la iniciativa debe tener al
    // menos una épica en algún pod del usuario. Equivalente al filtro de
    // findAll pero aplicado al resource individual (defense in depth contra
    // direct ID access — alguien podría descubrir un ID por API y pegarle
    // a /iniciativas/:id sin haber pasado por findAll).
    if (user && user.role !== UserRole.AltaGerencia) {
      const userPodIds = user.podIds ?? [];
      const initiativePodIds = new Set<string>();
      for (const epic of initiative.epics) {
        for (const ep of epic.pods) initiativePodIds.add(ep.podId);
      }
      const sharesPod = userPodIds.some((p) => initiativePodIds.has(p));
      if (!sharesPod) {
        throw new NotFoundException('Iniciativa no encontrada');
      }
    }

    if (includeContent && initiative.vaultPath) {
      // En formato nuevo (folder), el contenido narrativo vive en `definicion.md`
      // — sibling del `index.md` al que apunta `vaultPath`. En legacy (archivo
      // flat), el contenido vive directamente en `vaultPath`. La lectura es
      // tolerante a ambos: probamos definicion.md primero; si no existe (caso
      // edge: iniciativa migrada parcialmente o creada con un bug previo),
      // fallback al `vaultPath` directo (donde el contenido narrativo vivía
      // antes de la migración a doble archivo).
      const isNewFormat = isNewFormatVaultPath(initiative.vaultPath);
      const definicionPath = isNewFormat
        ? initiativeDefinitionPath({ id: initiative.id, name: initiative.name })
        : null;

      let note = definicionPath ? await this.vault.readNote(definicionPath) : null;
      if (!note) {
        // Fallback: lee del `vaultPath` directo. En legacy es donde vive el
        // contenido. En formato nuevo es el `index.md` (que post-refactor
        // tiene solo sumario sin description, así que parseInitiativeMarkdown
        // retornará description vacía y el bloque de abajo no sobrescribirá
        // nada — comportamiento seguro).
        if (definicionPath) {
          this.logger.warn(
            `[findOne] initiative ${initiative.id} en formato nuevo pero sin definicion.md — fallback a ${initiative.vaultPath}`,
          );
        }
        note = await this.vault.readNote(initiative.vaultPath);
      }
      if (note) {
        const content = this.parseInitiativeMarkdown(note.content);
        // Vault es fuente de verdad para el campo narrativo.
        if (content.description) {
          return { ...initiative, description: content.description };
        }
      }
    }

    return initiative;
  }

  async create(dto: CreateInitiativeDto) {
    this.logger.log(`[create] START name="${dto.name}"`);

    const id = randomUUID();
    const ref: InitiativeRef = { id, name: dto.name };
    const vaultPath = initiativeIndexPath(ref);
    const definicionPath = initiativeDefinitionPath(ref);
    this.logger.log(`[create] Generated vaultPath=${vaultPath} (+ definicion.md sibling)`);

    // Patrón paritario con épicas: el folder de la iniciativa contiene
    // `index.md` (sumario con links a hijos) y `definicion.md` (contenido
    // narrativo de la iniciativa). El `vaultPath` en DB sigue apuntando al
    // index.md por convención de la estructura del vault.
    const indexMd = this.buildInitiativeIndexMarkdown({
      id,
      name: dto.name,
    });
    const definicionMd = this.buildInitiativeDefinitionMarkdown({
      id,
      name: dto.name,
      description: dto.description,
    });

    // 1. Write both vault files first. Si el segundo write falla, hay que
    //    revertir el primero para no dejar un index huérfano sin definicion.
    await this.vault.writeNote(
      vaultPath,
      indexMd,
      `feat(initiative): create "${dto.name}" [${id}]`,
    );
    try {
      await this.vault.writeNote(
        definicionPath,
        definicionMd,
        `feat(initiative): create definicion "${dto.name}" [${id}]`,
      );
    } catch (err) {
      this.logger.error(`[create] definicion.md write FAILED, rolling back index.md`, err);
      await this.vault
        .deleteNote(vaultPath, `revert(initiative): rollback create [${id}]`)
        .catch(() => {});
      throw err;
    }
    this.logger.log(`[create] Vault writes OK (index + definicion)`);

    // 2. Create PG row (rollback vault on failure).
    try {
      const initiative = await this.prisma.initiative.create({
        data: {
          id,
          ...dto,
          // Fechas opcionales: si el user crea en borrador sin definirlas,
          // quedan null en PG. `new Date(undefined)` daría Invalid Date — por
          // eso la guarda explícita.
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
          vaultPath,
        },
        include: INITIATIVE_INCLUDE,
      });
      this.logger.log(`[create] PG insert OK id=${initiative.id}`);
      return initiative;
    } catch (err) {
      this.logger.error(`[create] PG insert FAILED, rolling back vault: ${vaultPath}`, err);
      await Promise.all([
        this.vault
          .deleteNote(vaultPath, `revert(initiative): rollback create [${id}]`)
          .catch(() => {}),
        this.vault
          .deleteNote(definicionPath, `revert(initiative): rollback create [${id}]`)
          .catch(() => {}),
      ]);
      throw err;
    }
  }

  async update(id: string, dto: UpdateInitiativeDto) {
    this.logger.log(`[update] START id=${id} fields=${Object.keys(dto).join(',')}`);

    const existing = await this.prisma.initiative.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Iniciativa no encontrada');

    const nameChanged = dto.name !== undefined && dto.name !== existing.name;
    const descriptionChanged =
      dto.description !== undefined && dto.description !== existing.description;

    const newName = dto.name ?? existing.name;
    const newDescription = dto.description ?? existing.description;

    // ── Vault updates ──
    if (existing.vaultPath) {
      const isNewFormat = isNewFormatVaultPath(existing.vaultPath);
      const isLegacy = isLegacyVaultPath(existing.vaultPath);

      if (nameChanged && isNewFormat) {
        // Rename de la iniciativa en formato nuevo → mover folder completo y
        // cascadear los vaultPath de epicas/historias hijas en PG.
        const oldFolder = initiativeFolderPath({ id: existing.id, name: existing.name });
        const newFolder = initiativeFolderPath({ id: existing.id, name: newName });

        this.logger.log(`[update] Renaming folder: ${oldFolder} → ${newFolder}`);

        // Antes de mover, actualizamos el contenido del index.md con el nuevo
        // nombre/descripcion, asi la copia en el nuevo folder ya trae los datos
        // frescos (evitamos un segundo write post-move).
        await this.rewriteIndexBeforeMove(existing, newName, newDescription);

        const result = await this.vaultFolder.moveFolder(
          oldFolder,
          newFolder,
          `refactor(initiative): rename folder [${id}]`,
          `refactor(initiative): cleanup old folder [${id}]`,
        );

        if (result.copyErrors.length > 0) {
          this.logger.error(
            `[update] moveFolder had ${result.copyErrors.length} copy failures. Reverting rename.`,
          );
          throw new Error('Rename de iniciativa fallo parcialmente. Los archivos originales quedaron intactos.');
        }

        // Cascadear los vaultPath en PG para epicas e historias hijas.
        await this.cascadeVaultPathRename(existing.id, oldFolder, newFolder);
      } else if ((nameChanged || descriptionChanged) && (isNewFormat || isLegacy)) {
        // No hay rename de folder — reescribimos los archivos del vault con el
        // contenido actualizado. En formato nuevo: index.md (si cambió el name,
        // que aparece en su heading) y definicion.md (si cambió description).
        // En legacy: solo el archivo flat.
        this.vault.invalidateCache(existing.vaultPath);

        if (isLegacy) {
          // Formato legacy: un solo archivo plano con el contenido completo.
          const existingNote = await this.vault.readNote(existing.vaultPath);
          const existingCreated = existingNote
            ? this.extractCreatedDate(existingNote.content)
            : undefined;
          const markdown = this.buildInitiativeDefinitionMarkdown({
            id: existing.id,
            name: newName,
            description: newDescription,
            created: existingCreated,
          });
          await this.vault.writeNote(
            existing.vaultPath,
            markdown,
            `docs(initiative): update content [${id}]`,
          );
        } else {
          // Formato nuevo: index.md y definicion.md son archivos separados.
          // Si cambió description, reescribir definicion.md.
          // Si cambió name, reescribir index.md (heading depende del name).
          // Construimos AMBOS markdowns primero y luego ejecutamos los writes
          // en paralelo (Promise.all): si uno falla el otro también revierte
          // por la propagación del error — evita el estado inconsistente
          // donde definicion quedó actualizado pero index todavía con el
          // nombre viejo.
          //
          // IMPORTANTE: el path físico del archivo se construye con
          // `existing.name` (NO `newName`). Estamos en el branch de "no hay
          // rename de folder" — el slug físico del folder sigue siendo el
          // viejo. Si llegáramos a este branch con `nameChanged === true`
          // (caso edge si las condiciones de arriba cambian), apuntar a
          // `newName` daría un path al folder equivocado.
          const ref: InitiativeRef = { id: existing.id, name: existing.name };
          const definicionPath = initiativeDefinitionPath(ref);
          const writes: Promise<unknown>[] = [];

          if (descriptionChanged) {
            this.vault.invalidateCache(definicionPath);
            const existingDef = await this.vault.readNote(definicionPath);
            const existingCreated = existingDef
              ? this.extractCreatedDate(existingDef.content)
              : undefined;
            const definicionMd = this.buildInitiativeDefinitionMarkdown({
              id: existing.id,
              name: newName,
              description: newDescription,
              created: existingCreated,
            });
            writes.push(
              this.vault.writeNote(
                definicionPath,
                definicionMd,
                `docs(initiative): update definicion [${id}]`,
              ),
            );
          }

          if (nameChanged) {
            const indexMd = this.buildInitiativeIndexMarkdown({
              id: existing.id,
              name: newName,
            });
            writes.push(
              this.vault.writeNote(
                existing.vaultPath,
                indexMd,
                `docs(initiative): update index [${id}]`,
              ),
            );
          }

          if (writes.length > 0) await Promise.all(writes);
        }
        this.logger.log(`[update] Vault write OK`);
      } else if ((nameChanged || descriptionChanged) && existing.vaultPath) {
        // vaultPath existe pero NO matchea ni isNewFormat ni isLegacy.
        // Caso edge: path malformado o de un formato futuro/desconocido.
        // No abortamos el update de PG (el user sigue pudiendo editar metadata),
        // pero loggeamos para detectar drift entre PG y vault.
        this.logger.warn(
          `[update] initiative ${id}: vaultPath="${existing.vaultPath}" no matchea legacy ni new-format — vault NO actualizado, solo PG`,
        );
      }
    }

    // ── PG update ──
    // Si renombraste, vaultPath tambien cambio — actualiza al nuevo index.md.
    const data: Prisma.InitiativeUpdateInput = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.targetDate) data.targetDate = new Date(dto.targetDate);
    if (nameChanged && existing.vaultPath && isNewFormatVaultPath(existing.vaultPath)) {
      data.vaultPath = initiativeIndexPath({ id: existing.id, name: newName });
    }

    const result = await this.prisma.initiative.update({
      where: { id },
      data,
      include: INITIATIVE_INCLUDE,
    });
    this.logger.log(`[update] DONE id=${id}`);
    return result;
  }

  async remove(id: string) {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id },
      include: {
        epics: {
          select: {
            id: true,
            title: true,
            vaultPath: true,
            stories: { select: { id: true, title: true, vaultPath: true } },
          },
        },
      },
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    // Si esta en formato nuevo (folder anidado), un solo deleteFolder recursivo
    // limpia TODO el folder de la iniciativa (incluye epicas + historias + docs).
    // Si esta en formato legacy (archivo flat), hacemos el cleanup bottom-up
    // manualmente como antes.
    if (initiative.vaultPath && isNewFormatVaultPath(initiative.vaultPath)) {
      const folder = initiativeFolderPath({ id: initiative.id, name: initiative.name });
      this.logger.log(`[remove] Deleting folder (new format): ${folder}`);
      await this.vaultFolder.deleteFolder(
        folder,
        `feat(initiative): delete "${initiative.name}" [${id}]`,
      );
    } else {
      // Legacy: borrado bottom-up archivo por archivo.
      this.logger.log(`[remove] Legacy cleanup: ${initiative.epics.length} epics`);
      for (const epic of initiative.epics) {
        for (const story of epic.stories) {
          if (story.vaultPath) {
            await this.vault
              .deleteNote(
                story.vaultPath,
                `feat(story): delete "${story.title}" [${story.id}] (cascade from initiative)`,
              )
              .catch((err) =>
                this.logger.warn(
                  `Failed to delete vault note ${story.vaultPath}: ${err?.message}`,
                ),
              );
          }
        }
        if (epic.vaultPath) {
          await this.vault
            .deleteNote(
              epic.vaultPath,
              `feat(epic): delete "${epic.title}" [${epic.id}] (cascade from initiative)`,
            )
            .catch((err) =>
              this.logger.warn(`Failed to delete vault note ${epic.vaultPath}: ${err?.message}`),
            );
        }
      }
      if (initiative.vaultPath) {
        await this.vault
          .deleteNote(
            initiative.vaultPath,
            `feat(initiative): delete "${initiative.name}" [${id}]`,
          )
          .catch((err) =>
            this.logger.warn(
              `Failed to delete vault note ${initiative.vaultPath}: ${err?.message}`,
            ),
          );
      }
    }

    // Postgres ON DELETE CASCADE borra epics + stories en DB.
    await this.prisma.initiative.delete({ where: { id } });
    this.logger.log(
      `[remove] initiative=${id} done (${initiative.epics.length} epics, ${initiative.epics.reduce((n, e) => n + e.stories.length, 0)} stories)`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Helpers privados
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Antes de mover el folder, reescribimos el `index.md` en el path OLD con el
   * contenido actualizado (nuevo name/description). Asi cuando `moveFolder`
   * copia, el destino ya tiene la version correcta sin necesidad de un
   * segundo write post-move.
   */
  private async rewriteIndexBeforeMove(
    existing: { id: string; name: string; description: string; vaultPath: string | null; createdAt?: Date | null },
    newName: string,
    newDescription: string,
  ): Promise<void> {
    if (!existing.vaultPath) return;
    this.vault.invalidateCache(existing.vaultPath);

    // Reconstruimos AMBOS archivos del folder con los datos frescos antes del
    // rename. Así, cuando el moveFolder copie el folder al nuevo destino, las
    // copias ya traen el nuevo name/description y evitamos un segundo write
    // post-move. `created` se preserva con cadena de fallbacks:
    //  1. frontmatter de `definicion.md` (source of truth en formato nuevo)
    //  2. frontmatter del `index.md` (fallback si definicion.md no existe
    //     por migración parcial)
    //  3. `createdAt` de PG (último recurso, siempre disponible)
    // Sin esta cadena, una iniciativa sin definicion.md (caso edge) perdería
    // su fecha original y obtendría la de hoy al renombrar.
    const ref: InitiativeRef = { id: existing.id, name: existing.name };
    const definicionPath = initiativeDefinitionPath(ref);
    this.vault.invalidateCache(definicionPath);

    const existingDef = await this.vault.readNote(definicionPath);
    let existingCreated = existingDef
      ? this.extractCreatedDate(existingDef.content)
      : undefined;
    if (!existingCreated) {
      const existingIndex = await this.vault.readNote(existing.vaultPath);
      existingCreated = existingIndex
        ? this.extractCreatedDate(existingIndex.content)
        : undefined;
    }
    if (!existingCreated && existing.createdAt) {
      existingCreated = existing.createdAt.toISOString().slice(0, 10);
    }

    const indexMd = this.buildInitiativeIndexMarkdown({
      id: existing.id,
      name: newName,
    });
    const definicionMd = this.buildInitiativeDefinitionMarkdown({
      id: existing.id,
      name: newName,
      description: newDescription,
      created: existingCreated,
    });

    await Promise.all([
      this.vault.writeNote(
        existing.vaultPath,
        indexMd,
        `docs(initiative): update index pre-rename [${existing.id}]`,
      ),
      this.vault.writeNote(
        definicionPath,
        definicionMd,
        `docs(initiative): update definicion pre-rename [${existing.id}]`,
      ),
    ]);
  }

  /**
   * Actualiza los `vaultPath` de TODAS las epicas e historias hijas cuando la
   * iniciativa padre se renombra (su folder cambia). Simple string replace del
   * prefijo: `oldFolder/rest` → `newFolder/rest`.
   *
   * Envuelto en `prisma.$transaction` para garantizar atomicidad: si falla un
   * update a la mitad, ninguno se aplica y el estado en PG queda consistente
   * con el vault (todos los hijos apuntan al oldFolder todavia valido por el
   * rollback del moveFolder).
   */
  private async cascadeVaultPathRename(
    initiativeId: string,
    oldFolder: string,
    newFolder: string,
  ): Promise<void> {
    // Leer ambas listas fuera de la transaccion — solo los writes se atomizan.
    const [epics, stories] = await Promise.all([
      this.prisma.epic.findMany({
        where: { initiativeId },
        select: { id: true, vaultPath: true },
      }),
      this.prisma.story.findMany({
        where: { epic: { initiativeId } },
        select: { id: true, vaultPath: true },
      }),
    ]);

    const epicUpdates = epics
      .filter((e) => e.vaultPath && e.vaultPath.startsWith(`${oldFolder}/`))
      .map((e) =>
        this.prisma.epic.update({
          where: { id: e.id },
          data: { vaultPath: e.vaultPath!.replace(`${oldFolder}/`, `${newFolder}/`) },
        }),
      );

    const storyUpdates = stories
      .filter((s) => s.vaultPath && s.vaultPath.startsWith(`${oldFolder}/`))
      .map((s) =>
        this.prisma.story.update({
          where: { id: s.id },
          data: { vaultPath: s.vaultPath!.replace(`${oldFolder}/`, `${newFolder}/`) },
        }),
      );

    if (epicUpdates.length > 0 || storyUpdates.length > 0) {
      await this.prisma.$transaction([...epicUpdates, ...storyUpdates]);
    }

    this.logger.log(
      `[cascadeVaultPathRename] updated ${epicUpdates.length} epics + ${storyUpdates.length} stories for initiative=${initiativeId} (atomic)`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Markdown serialization
  // ─────────────────────────────────────────────────────────────────────

  /**
   * `index.md` — sumario del folder de la iniciativa con links a sus hijos.
   * Análogo a `buildEpicIndexMarkdown`. NO contiene la descripción narrativa
   * (esa vive en `definicion.md`). Si el user abre el repo en un editor
   * markdown, este archivo le da una tabla de contenidos navegable.
   */
  private buildInitiativeIndexMarkdown(data: {
    id: string;
    name: string;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'initiative',
      name: data.name,
      created: data.created ?? new Date().toISOString().slice(0, 10),
    });

    return (
      `${fm}\n\n` +
      `# ${data.name}\n\n` +
      `Contenido completo en este folder:\n\n` +
      `- [\`definicion.md\`](./definicion.md) — descripción narrativa de la iniciativa.\n` +
      `- [\`resumenes-ejecutivos/\`](./resumenes-ejecutivos/) — resúmenes ejecutivos.\n` +
      `- [\`documentos/\`](./documentos/) — documentos adjuntos a la iniciativa.\n` +
      `- [\`epics/\`](./epics/) — épicas hijas (cada una con su propio folder).\n`
    );
  }

  /**
   * `definicion.md` — contenido narrativo de la iniciativa (descripción).
   * Análogo a `buildEpicDefinitionMarkdown`. Es el archivo que el frontend
   * lee para mostrar el campo `description` (vault es source of truth).
   *
   * También usado para el formato legacy (archivo flat) — el shape es
   * idéntico, solo cambia el path donde vive.
   */
  private buildInitiativeDefinitionMarkdown(data: {
    id: string;
    name: string;
    // `description` puede ser null/undefined en runtime: viene de
    // `dto.description ?? existing.description` y ambos pueden ser null en
    // PG (Prisma `String?`). El builder lo coalesce a string vacío para
    // que el render sea seguro y no emita el literal "null".
    description: string | null | undefined;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'initiative-definition',
      name: data.name,
      created: data.created ?? new Date().toISOString().slice(0, 10),
    });

    const title = `# ${data.name}\n\n`;
    const descriptionSection = `## Descripción\n\n${data.description ?? ''}\n`;

    return `${fm}\n\n${title}${descriptionSection}`;
  }

  /**
   * Parser minimo: extrae la seccion de descripcion. Soporta los dos formatos
   * (legacy flat y nuevo folder/index.md) porque el cuerpo del markdown es
   * identico — solo cambia el path.
   */
  private parseInitiativeMarkdown(markdown: string): InitiativeMarkdownData {
    const KNOWN_HEADINGS = ['Descripción'];
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const terminatorsPattern = KNOWN_HEADINGS.map(escapeRe).join('|');

    const getSection = (heading: string): string => {
      const escaped = escapeRe(heading);
      const re = new RegExp(
        `## ${escaped}\\n+([\\s\\S]*?)(?=\\n## (?:${terminatorsPattern})\\n|$)`,
        'i',
      );
      const match = markdown.match(re);
      return match ? match[1].trim() : '';
    };

    return {
      description: getSection('Descripción'),
    };
  }

  private extractCreatedDate(markdown: string): string | undefined {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const line = match[1].split('\n').find((l) => l.startsWith('created:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
  }
}
