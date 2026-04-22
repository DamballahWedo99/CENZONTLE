import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { CreateStoryDto, RelatedDocumentDto, DiscoveredDependencyDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StoryQueryDto } from './dto/story-query.dto';
import { StoryPoFieldsDto, StoryTechnicalFieldsDto, StoryQaFieldsDto } from './dto/story-content.dto';
import { randomUUID } from 'crypto';
import {
  storyFolderPath,
  storyIndexPath,
  initiativeDocumentPath,
  epicDependencyPath,
  type InitiativeRef,
  type EpicRef,
  type StoryRef,
} from '../vault-paths';
import { buildDiscoveredDependencyMarkdown } from '../epics/epic-markdown-builders';
import { buildFrontmatter } from '../vault-frontmatter';

export interface StoryMarkdownData {
  po?: StoryPoFieldsDto;
  technical?: StoryTechnicalFieldsDto;
  qa?: StoryQaFieldsDto;
}

interface StoryFileEntry {
  content: string;
  commitMsg: string;
}

interface BuildFileSetInput {
  id: string;
  title: string;
  epicId: string;
  status?: string;
  storyPoints?: number;
  labels?: string[];
  podId?: string;
  po?: StoryPoFieldsDto;
  technical?: StoryTechnicalFieldsDto;
  qa?: StoryQaFieldsDto;
  relatedDocuments?: RelatedDocumentDto[];
  discoveredDependencies?: DiscoveredDependencyDto[];
  created?: string; // preservar date original al update
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private vaultFolder: VaultFolderService,
  ) {}

  async findAll(query: StoryQueryDto) {
    const where: Prisma.StoryWhereInput = {};
    if (query.epicId) where.epicId = query.epicId;
    if (query.podId) where.podId = query.podId;
    if (query.status) where.status = query.status;

    return this.prisma.story.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, includeContent = false) {
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException('Historia no encontrada');

    if (includeContent && story.vaultPath) {
      const parsed = await this.readStoryContent(story.vaultPath);
      return { ...story, content: parsed };
    }

    return story;
  }

  async create(dto: CreateStoryDto) {
    const docsCount = dto.relatedDocuments?.length ?? 0;
    const depsCount = dto.discoveredDependencies?.length ?? 0;
    this.logger.log(
      `[StoryVault:create] ═══ START title="${dto.title}" epicId=${dto.epicId} podId=${dto.podId} docs=${docsCount} deps=${depsCount}`,
    );

    // Resolver parent chain: necesitamos initiative + epic para construir el
    // path anidado `iniciativas/.../epics/.../historias/<story>/`.
    const epic = await this.prisma.epic.findUnique({
      where: { id: dto.epicId },
      include: { initiative: { select: { id: true, name: true } } },
    });
    if (!epic) throw new NotFoundException('Épica padre no encontrada');

    const id = randomUUID();
    const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
    const epicRef: EpicRef = { id: epic.id, title: epic.title };
    const storyRef: StoryRef = { id, title: dto.title };
    const folderPath = storyFolderPath(iniRef, epicRef, storyRef);
    const indexPath = storyIndexPath(iniRef, epicRef, storyRef);
    this.logger.log(`[StoryVault:create] folder=${folderPath}`);

    const fileSet = this.buildStoryFileSet({
      id,
      title: dto.title,
      epicId: dto.epicId,
      status: dto.status ?? 'backlog',
      storyPoints: dto.storyPoints ?? 0,
      labels: dto.labels ?? [],
      podId: dto.podId,
      po: dto.po,
      technical: dto.technical,
      qa: dto.qa,
      relatedDocuments: dto.relatedDocuments,
      discoveredDependencies: dto.discoveredDependencies,
    }, folderPath);
    this.logger.log(
      `[StoryVault:create] fileSet built: ${fileSet.size} files\n  - ${Array.from(fileSet.keys()).join('\n  - ')}`,
    );

    // 1. Escribir los archivos CORE de la historia al vault (index + 3 definiciones).
    // writeFileSet hace rollback interno si alguno falla.
    // EN PARALELO: escribir docs y deps a nivel INICIATIVA/EPICA (compartidos
    // entre historias hermanas, con dedup por contenido). Los artefactos epic-level
    // son best-effort: si fallan, se loguea pero no aborta la historia porque los
    // 4 archivos core ya son la data critica.
    const writesStart = Date.now();
    const [writtenPaths] = await Promise.all([
      this.writeFileSet(fileSet),
      this.writeEpicLevelArtifacts(
        iniRef,
        epicRef,
        id,
        dto.relatedDocuments,
        dto.discoveredDependencies,
        dto.epicId,
      ),
    ]);
    this.logger.log(
      `[StoryVault:create] ✓ vault writes OK (${writtenPaths.length} story files in ${Date.now() - writesStart}ms, plus epic-level artifacts in parallel)`,
    );

    // 2. Crear fila en PG. Si falla, rollback completo del vault.
    try {
      const result = await this.prisma.story.create({
        data: {
          id,
          title: dto.title,
          status: dto.status ?? 'backlog',
          storyPoints: dto.storyPoints ?? 0,
          epicId: dto.epicId,
          podId: dto.podId,
          sprintId: dto.sprintId,
          labels: dto.labels ?? [],
          vaultPath: indexPath,
          sourceClientId: dto.sourceClientId ?? null,
        },
      });

      // 3. Persistir edges de `blockedBy` al modelo `StoryDependency`. Solo
      // crear rows para las bloqueantes que YA existen en DB (búsqueda por
      // sourceClientId). Si una bloqueante aún está en staging, la row se
      // creará cuando esa historia se acepte (hace lookup inverso vía el
      // mismo mecanismo — ver bloque abajo).
      if (dto.blockedBy && dto.blockedBy.length > 0) {
        await this.persistBlockedByEdges(result.id, dto.epicId, dto.blockedBy);
      }

      // 4. Lookup inverso: si otras historias YA aceptadas del mismo epic
      // tenían en su sourceClientId un valor que coincide con el clientId
      // DE ESTA historia, y apuntaban a mí como bloqueante (guardamos ese
      // estado no persistido... wait, no lo guardamos). Entonces el caso
      // "A aceptada después de B que la bloquea" requeriría re-send del
      // blockedBy desde el frontend al aceptar A. No lo resolvemos en MVP:
      // el frontend debe aceptar en orden topológico o todas juntas, y las
      // deps se pierden si se aceptan fuera de orden — loggeado como warn.
      // Ver comentario en `persistBlockedByEdges`.

      this.logger.log(`[StoryVault:create] ═══ DONE story.id=${result.id} vaultPath=${indexPath} sourceClientId=${result.sourceClientId ?? 'none'}`);
      return result;
    } catch (err) {
      this.logger.error(`[StoryVault:create] ✗ PG insert FAILED, rolling back ${writtenPaths.length} vault files`, err);
      await this.rollbackFileSet(writtenPaths, id);
      throw err;
    }
  }

  async update(id: string, dto: UpdateStoryDto) {
    this.logger.log(`[StoryVault:update] START id=${id} fields=[${Object.keys(dto).join(',')}]`);
    const existing = await this.prisma.story.findUnique({
      where: { id },
      include: {
        epic: {
          select: {
            id: true,
            title: true,
            initiative: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Historia no encontrada');
    }

    // Excluir campos que no son columnas escalares de `story`: los 3 de
    // contenido (po/technical/qa van al vault), `relatedDocuments` y
    // `discoveredDependencies` (se escriben al vault + JSONB del epic, no a
    // la story directamente), y `blockedBy` (se persiste como rows en
    // `story_dependencies`, no como columna). El resto son campos escalares
    // que Prisma acepta directo en el update.
    const {
      po, technical, qa,
      relatedDocuments: _rd,
      discoveredDependencies: _dd,
      blockedBy: _bb,
      ...structuralData
    } = dto;
    const isLegacy = existing.vaultPath ? !existing.vaultPath.endsWith('/index.md') : false;
    this.logger.log(`[StoryVault:update] format=${isLegacy ? 'LEGACY' : 'NEW'} vaultPath=${existing.vaultPath}`);

    // ── Rename: si cambio el title Y estamos en formato nuevo, mover el folder
    // ANTES de hacer cualquier partial write. Asi el partial update escribe
    // directamente al folder nuevo, evitando escrituras duplicadas.
    const titleChanged =
      structuralData.title !== undefined && structuralData.title !== existing.title;
    let newVaultPath: string | null = null;
    if (titleChanged && existing.vaultPath && !isLegacy) {
      const iniRef: InitiativeRef = {
        id: existing.epic.initiative.id,
        name: existing.epic.initiative.name,
      };
      const epicRef: EpicRef = { id: existing.epic.id, title: existing.epic.title };
      const oldStoryRef: StoryRef = { id: existing.id, title: existing.title };
      const newStoryRef: StoryRef = { id: existing.id, title: structuralData.title! };
      const oldFolder = storyFolderPath(iniRef, epicRef, oldStoryRef);
      const newFolder = storyFolderPath(iniRef, epicRef, newStoryRef);

      this.logger.log(`[StoryVault:update] Renaming folder: ${oldFolder} → ${newFolder}`);
      const result = await this.vaultFolder.moveFolder(
        oldFolder,
        newFolder,
        `refactor(story): rename folder [${id}]`,
        `refactor(story): cleanup old folder [${id}]`,
      );
      if (result.copyErrors.length > 0) {
        this.logger.error(
          `[StoryVault:update] moveFolder had ${result.copyErrors.length} copy failures.`,
        );
        throw new Error(
          'Rename de historia fallo parcialmente. Los archivos originales quedaron intactos.',
        );
      }

      // Actualizar la referencia al vaultPath para el resto del update.
      newVaultPath = storyIndexPath(iniRef, epicRef, newStoryRef);
      existing.vaultPath = newVaultPath;
    }

    // Cambios estructurales que afectan el index.md (metadata).
    const indexDirty =
      structuralData.title !== undefined ||
      structuralData.labels !== undefined ||
      structuralData.storyPoints !== undefined ||
      structuralData.status !== undefined ||
      structuralData.podId !== undefined;

    if (isLegacy && existing.vaultPath) {
      // Legacy coexistence: el archivo unico sigue siendo la fuente de verdad.
      // Mantenemos el flujo anterior para no migrar en un update parcial.
      await this.updateLegacyMarkdown(existing, dto);
    } else if (existing.vaultPath) {
      // Formato nuevo: solo reescribir archivos afectados.
      const folderPath = this.dirname(existing.vaultPath);
      const partialSet = new Map<string, StoryFileEntry>();

      // Leer existing content para fetch de datos que no cambian.
      const currentContent = await this.readStoryContent(existing.vaultPath).catch(() => ({
        po: {},
        technical: {},
        qa: {},
      }));

      const mergedTitle = structuralData.title ?? existing.title;
      const mergedLabels = structuralData.labels ?? existing.labels ?? [];
      const mergedSP = structuralData.storyPoints ?? existing.storyPoints;
      const mergedStatus = structuralData.status ?? existing.status;
      const mergedPodId = structuralData.podId ?? existing.podId;

      if (indexDirty) {
        partialSet.set(`${folderPath}/index.md`, {
          content: this.buildIndexMarkdown({
            id: existing.id,
            title: mergedTitle,
            epicId: existing.epicId,
            status: mergedStatus,
            storyPoints: mergedSP,
            labels: mergedLabels,
            podId: mergedPodId,
            created: this.extractCreatedDate(await this.vault.readNote(existing.vaultPath).then((n) => n?.content ?? '').catch(() => '')),
          }),
          commitMsg: `docs(story): update metadata "${mergedTitle}" [${id}]`,
        });
      }

      const updateMeta = {
        id: existing.id,
        title: mergedTitle,
        epicId: existing.epicId,
        // En update preservamos el created del index.md original para no
        // sobrescribir la fecha de creacion. Si no lo podemos leer, usamos hoy.
        created: await this.vault
          .readNote(`${folderPath}/index.md`)
          .then((n) => (n ? this.extractCreatedDate(n.content) : undefined))
          .catch(() => undefined),
      };

      if (po !== undefined) {
        const mergedPO = { ...currentContent.po, ...po };
        partialSet.set(`${folderPath}/definicion-negocio.md`, {
          content: this.buildPOMarkdown(mergedPO, updateMeta),
          commitMsg: `docs(story): update business definition [${id}]`,
        });
      }

      if (technical !== undefined) {
        const mergedTech = { ...currentContent.technical, ...technical };
        partialSet.set(`${folderPath}/definicion-tecnica.md`, {
          content: this.buildTechnicalMarkdown(mergedTech, updateMeta),
          commitMsg: `docs(story): update technical design [${id}]`,
        });
      }

      if (qa !== undefined) {
        const mergedQA = { ...currentContent.qa, ...qa };
        partialSet.set(`${folderPath}/testing-strategy.md`, {
          content: this.buildQAMarkdown(mergedQA, updateMeta),
          commitMsg: `docs(story): update qa strategy [${id}]`,
        });
      }

      if (partialSet.size > 0) {
        this.logger.log(
          `[StoryVault:update] rewriting ${partialSet.size} files: ${Array.from(partialSet.keys()).map((p) => this.basename(p)).join(', ')}`,
        );
        // Invalidar cache de cada path para leer SHAs frescos y evitar 409 Conflict.
        for (const path of partialSet.keys()) {
          this.vault.invalidateCache(path);
        }
        await this.writeFileSet(partialSet);
      } else {
        this.logger.log(`[StoryVault:update] no vault changes (only PG structural fields)`);
      }
    }

    // Update PG (campos estructurales). Si hubo rename, sincronizar vaultPath.
    const pgData: Prisma.StoryUpdateInput = { ...structuralData };
    if (newVaultPath) {
      pgData.vaultPath = newVaultPath;
    }
    const result = await this.prisma.story.update({
      where: { id },
      data: pgData,
    });
    this.logger.log(`[StoryVault:update] ═══ DONE id=${id}${newVaultPath ? ` (renamed → ${newVaultPath})` : ''}`);
    return result;
  }

  async remove(id: string) {
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException('Historia no encontrada');

    this.logger.log(`[StoryVault:remove] START id=${id} title="${story.title}" vaultPath=${story.vaultPath}`);

    if (story.vaultPath) {
      const isLegacy = !story.vaultPath.endsWith('/index.md');
      if (isLegacy) {
        this.logger.log(`[StoryVault:remove] format=LEGACY — deleting single file`);
        await this.vault
          .deleteNote(story.vaultPath, `feat(story): delete "${story.title}" [${id}]`)
          .catch((err) => this.logger.warn(`[StoryVault:remove] failed to delete legacy ${story.vaultPath}: ${err?.message}`));
      } else {
        const folderPath = this.dirname(story.vaultPath);
        this.logger.log(`[StoryVault:remove] format=NEW — deleting folder ${folderPath}`);
        await this.vaultFolder.deleteFolder(
          folderPath,
          `feat(story): delete "${story.title}" [${id}]`,
        );
      }
    }

    await this.prisma.story.delete({ where: { id } });
    this.logger.log(`[StoryVault:remove] ═══ DONE id=${id}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Helpers: file set construction
  // ─────────────────────────────────────────────────────────────────────

  private buildStoryFileSet(
    data: BuildFileSetInput,
    folderPath: string,
  ): Map<string, StoryFileEntry> {
    const set = new Map<string, StoryFileEntry>();

    // index.md — metadata del folder, entrada de referencia
    set.set(`${folderPath}/index.md`, {
      content: this.buildIndexMarkdown({
        id: data.id,
        title: data.title,
        epicId: data.epicId,
        status: data.status,
        storyPoints: data.storyPoints,
        labels: data.labels,
        podId: data.podId,
        created: data.created,
      }),
      commitMsg: `feat(story): create "${data.title}" [${data.id}]`,
    });

    const sectionMeta = {
      id: data.id,
      title: data.title,
      epicId: data.epicId,
      created: data.created,
    };

    // definicion-negocio.md — seccion PO
    set.set(`${folderPath}/definicion-negocio.md`, {
      content: this.buildPOMarkdown(data.po ?? {}, sectionMeta),
      commitMsg: `docs(story): business definition [${data.id}]`,
    });

    // definicion-tecnica.md — seccion Tech Lead
    set.set(`${folderPath}/definicion-tecnica.md`, {
      content: this.buildTechnicalMarkdown(data.technical ?? {}, sectionMeta),
      commitMsg: `docs(story): technical design [${data.id}]`,
    });

    // testing-strategy.md — seccion QA
    set.set(`${folderPath}/testing-strategy.md`, {
      content: this.buildQAMarkdown(data.qa ?? {}, sectionMeta),
      commitMsg: `docs(story): qa strategy [${data.id}]`,
    });

    // NOTA: los relatedDocuments y discoveredDependencies NO se escriben dentro
    // del folder de la historia — antes se duplicaban en cada historia del batch
    // (todas las historias de un PO batch tienen los mismos docs/deps relevantes).
    // Ahora van a nivel iniciativa/epica via writeEpicLevelArtifacts() — UNA copia
    // compartida por todas las historias hermanas.
    return set;
  }

  /**
   * Escribe los relatedDocuments a nivel INICIATIVA y las discoveredDependencies
   * a nivel EPICA, con dedup por path. Si el archivo ya existe con el mismo
   * contenido, se skip. Si existe con contenido distinto, se actualiza.
   *
   * Best-effort: errores se loguean pero no abortan la creacion de la historia
   * (los archivos core de la historia ya se escribieron en writeFileSet). El
   * vault queda en estado parcial si alguno falla — es aceptable porque el
   * contenido de docs/deps se puede re-escribir en el proximo accept de otra
   * historia del mismo batch.
   */
  private async writeEpicLevelArtifacts(
    iniRef: InitiativeRef,
    epicRef: EpicRef,
    storyId: string,
    relatedDocuments?: RelatedDocumentDto[],
    discoveredDependencies?: DiscoveredDependencyDto[],
    epicId?: string,
  ): Promise<void> {
    // Persist discoveredDependencies AL JSONB `epic.dependencies[]` con dedup
    // por `id`. Sin esto las deps vivirían solo en el vault y el auto-resolve
    // con `sourceDependencyId` (ExternalSecretsService) no las encontraría —
    // el resolve busca en `epic.dependencies @> [{id}]`.
    //
    // Semántica: cada dep descubierta se guarda con `status: 'identified'` +
    // `isBlocking` + `vendor` + `requiresCredential` desde el DTO. Al resolver
    // con secret, el service actualiza `status: 'resolved'` + `linkedSecretId`.
    if (epicId && discoveredDependencies && discoveredDependencies.length > 0) {
      try {
        await this.persistDiscoveredDependenciesToEpicJsonb(
          epicId,
          discoveredDependencies,
        );
      } catch (err: unknown) {
        // Best-effort: el vault ya tiene la doc, y la próxima vez que el
        // agente corra se reintentará. No abortar la historia.
        this.logger.warn(
          `[StoryVault:epic-artifacts] persist to epic.dependencies JSONB failed (non-fatal): ${(err as Error)?.message ?? err}`,
        );
      }
    }
    const docPromises = (relatedDocuments ?? []).map(async (doc) => {
      const path = initiativeDocumentPath(iniRef, doc.docName);
      try {
        const existing = await this.vault.readNote(path).catch(() => null);
        const newContent = this.buildDocReferenceMarkdown(doc);
        if (existing && existing.content === newContent) {
          this.logger.log(`[StoryVault:epic-artifacts] doc ${path} already exists with same content — skip`);
          return;
        }
        const commitMsg = existing
          ? `docs(initiative): update doc reference "${doc.docName}" [from story ${storyId}]`
          : `docs(initiative): link doc "${doc.docName}" [from story ${storyId}]`;
        await this.vault.writeNote(path, newContent, commitMsg);
        this.logger.log(
          `[StoryVault:epic-artifacts] ✓ doc ${existing ? 'updated' : 'created'} at ${path}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[StoryVault:epic-artifacts] ✗ doc ${path} failed (best-effort, story creation continues): ${err?.message}`,
        );
      }
    });

    const depPromises = (discoveredDependencies ?? []).map(async (dep) => {
      const path = epicDependencyPath(iniRef, epicRef, dep.title);
      try {
        const existing = await this.vault.readNote(path).catch(() => null);
        const newContent = buildDiscoveredDependencyMarkdown(dep as unknown as Parameters<typeof buildDiscoveredDependencyMarkdown>[0]);
        if (existing && existing.content === newContent) {
          this.logger.log(`[StoryVault:epic-artifacts] dep ${path} already exists with same content — skip`);
          return;
        }
        const commitMsg = existing
          ? `docs(epic): update dependency "${dep.title}" [from story ${storyId}]`
          : `docs(epic): record dependency "${dep.title}" [from story ${storyId}]`;
        await this.vault.writeNote(path, newContent, commitMsg);
        this.logger.log(
          `[StoryVault:epic-artifacts] ✓ dep ${existing ? 'updated' : 'created'} at ${path}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[StoryVault:epic-artifacts] ✗ dep ${path} failed (best-effort, story creation continues): ${err?.message}`,
        );
      }
    });

    await Promise.allSettled([...docPromises, ...depPromises]);
  }

  private async writeFileSet(fileSet: Map<string, StoryFileEntry>): Promise<string[]> {
    const batchStart = Date.now();
    const entries = Array.from(fileSet.entries());

    // Escribimos TODOS los archivos en PARALELO. Cada uno tiene un path unico
    // dentro del folder de la historia (index.md, definicion-negocio.md,
    // documentos/<slug>.md, dependencias/<slug>.md, etc.) — no hay colision de
    // SHA entre writes concurrentes. GitHub Contents API con archivos NUEVOS
    // no requiere SHA del parent, solo el SHA del archivo (que no existe).
    //
    // Promise.allSettled permite que unas fallen sin abortar el batch —
    // luego del fan-out hacemos rollback atomico de los que SI se escribieron
    // si hay cualquier falla.
    const results = await Promise.allSettled(
      entries.map(async ([path, entry]) => {
        const writeStart = Date.now();
        await this.vault.writeNote(path, entry.content, entry.commitMsg);
        const dur = Date.now() - writeStart;
        this.logger.log(
          `[StoryVault:write] ✓ ${path} (${dur}ms, msg="${entry.commitMsg.slice(0, 60)}")`,
        );
        return path;
      }),
    );

    const writtenPaths: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        writtenPaths.push(r.value);
      } else {
        failures.push({
          path: entries[i][0],
          error: r.reason?.message ?? String(r.reason),
        });
      }
    }

    const totalDur = Date.now() - batchStart;
    this.logger.log(
      `[StoryVault:write] batch done in ${totalDur}ms — ${writtenPaths.length}/${entries.length} OK, ${failures.length} failed`,
    );

    if (failures.length > 0) {
      this.logger.error(
        `[StoryVault:write] ✗ ${failures.length} writes failed. Rolling back ${writtenPaths.length} successful files. Failures: ${failures.map((f) => `${f.path}: ${f.error}`).join('; ')}`,
      );
      await this.rollbackFileSet(writtenPaths, 'inline');
      // Lanzamos el primer error como representativo (todos los errores estan en los logs).
      throw new Error(`writeFileSet: ${failures.length} write(s) failed: ${failures[0].error}`);
    }

    return writtenPaths;
  }

  private async rollbackFileSet(paths: string[], storyIdHint: string): Promise<void> {
    if (paths.length === 0) return;
    this.logger.warn(`[rollback] Removing ${paths.length} vault files for ${storyIdHint}`);
    const results = await Promise.allSettled(
      paths.map((p) =>
        this.vault.deleteNote(p, `revert(story): rollback partial create [${storyIdHint}]`),
      ),
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? paths[i] : null))
      .filter((p): p is string => p !== null);
    if (failed.length > 0) {
      this.logger.error(
        `[rollback] Failed to delete ${failed.length}/${paths.length} orphan files. Manual cleanup needed: ${failed.join(', ')}`,
      );
    }
  }

  private async deleteFolder(folderPath: string, storyId: string, storyTitle: string): Promise<void> {
    try {
      // listTree retorna estructura recursiva. Aplanamos todos los paths de archivo.
      const tree = await this.vault.listTree(folderPath).catch(() => []);
      const allFiles: string[] = [];
      const walk = (nodes: any[]) => {
        for (const node of nodes) {
          if (node.type === 'file' && typeof node.path === 'string') {
            allFiles.push(node.path);
          } else if (node.children) {
            walk(node.children);
          }
        }
      };
      walk(tree);

      if (allFiles.length === 0) {
        // Fallback: intenta borrar al menos los paths conocidos.
        const known = [
          `${folderPath}/index.md`,
          `${folderPath}/definicion-negocio.md`,
          `${folderPath}/definicion-tecnica.md`,
          `${folderPath}/testing-strategy.md`,
        ];
        for (const p of known) {
          await this.vault.deleteNote(p, `feat(story): delete "${storyTitle}" [${storyId}]`).catch(() => {});
        }
        return;
      }

      // Primer archivo con commit de "feat(story): delete", el resto con mensaje de cleanup.
      let first = true;
      for (const file of allFiles) {
        const msg = first
          ? `feat(story): delete "${storyTitle}" [${storyId}]`
          : `chore(story): cleanup ${this.basename(file)} [${storyId}]`;
        await this.vault.deleteNote(file, msg).catch((err) =>
          this.logger.warn(`[deleteFolder] Failed to delete ${file}: ${err?.message}`),
        );
        first = false;
      }
    } catch (err: any) {
      this.logger.warn(`[deleteFolder] Error listing/deleting folder ${folderPath}: ${err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Markdown builders (un archivo = una seccion)
  // ─────────────────────────────────────────────────────────────────────

  private buildIndexMarkdown(data: {
    id: string;
    title: string;
    epicId: string;
    status?: string;
    storyPoints?: number;
    labels?: string[];
    podId?: string;
    created?: string;
  }): string {
    const fm = buildFrontmatter({
      id: data.id,
      type: 'story',
      epicId: data.epicId,
      title: data.title,
      status: data.status ?? 'backlog',
      storyPoints: data.storyPoints ?? 0,
      // Preserva la clave aun cuando no hay pod asignado — parsers downstream
      // pueden esperar presencia siempre. `null` es el idioma YAML para "vacío
      // pero presente", vs `undefined` que omitiría la clave (breaking change).
      podId: data.podId || null,
      labels: data.labels ?? [],
      created: data.created ?? new Date().toISOString().slice(0, 10),
    });

    return (
      `${fm}\n\n` +
      `# ${data.title}\n\n` +
      `Entrada de referencia de la historia. Archivos en este folder:\n\n` +
      `- [\`definicion-negocio.md\`](./definicion-negocio.md) — seccion PO (Product Owner).\n` +
      `- [\`definicion-tecnica.md\`](./definicion-tecnica.md) — seccion Tech Lead.\n` +
      `- [\`testing-strategy.md\`](./testing-strategy.md) — seccion QA.\n` +
      `- [\`documentos-epica/\`](./documentos-epica/) — documentos de la iniciativa relevantes.\n` +
      `- [\`dependencias/\`](./dependencias/) — dependencias descubiertas durante el diseno.\n`
    );
  }

  /**
   * Construye el bloque YAML frontmatter para una seccion de historia (PO/TL/QA).
   * El parser del frontend del Vault detecta el `---\n...\n---` y lo renderiza
   * como seccion METADATA colapsable (el mismo patron que usa el index.md).
   * Cada seccion tiene `type` distinto (story-po, story-technical, story-qa)
   * para que la UI pueda filtrar o renderizar diferencialmente si hace falta.
   */
  private buildSectionFrontmatter(
    meta: { id: string; title: string; epicId: string; created?: string },
    sectionType: 'story-po' | 'story-technical' | 'story-qa',
  ): string {
    const fm = buildFrontmatter({
      id: meta.id,
      type: sectionType,
      storyTitle: meta.title,
      epicId: meta.epicId,
      created: meta.created ?? new Date().toISOString().slice(0, 10),
    });
    return `${fm}\n\n`;
  }

  private buildPOMarkdown(
    po: Partial<StoryPoFieldsDto>,
    meta: { id: string; title: string; epicId: string; created?: string },
  ): string {
    const whw = typeof po.whatHowWhen === 'string' ? po.whatHowWhen : '';
    // Si llego como string (DTO), lo emitimos inline. Si algun dia migra a objeto,
    // el parser inverso sabe distinguir por la presencia de etiquetas **What:**.
    return (
      this.buildSectionFrontmatter(meta, 'story-po') +
      `# Definicion de Negocio\n\n` +
      `## Background\n${po.background ?? ''}\n\n` +
      `## Objetivo\n${po.objective ?? ''}\n\n` +
      `## Historia de usuario\n${po.userStory ?? ''}\n\n` +
      `## Que / Como / Cuando\n${whw}\n\n` +
      `## Criterios de aceptacion\n${po.acceptanceCriteria ?? ''}\n\n` +
      `## Notas adicionales\n${po.additionalNotes ?? ''}\n`
    );
  }

  private buildTechnicalMarkdown(
    tech: Partial<StoryTechnicalFieldsDto>,
    meta: { id: string; title: string; epicId: string; created?: string },
  ): string {
    const list = (items?: string[]) =>
      (items ?? []).length === 0 ? '' : (items ?? []).map((v) => `- ${v}`).join('\n');
    const checklist = (items?: string[]) =>
      (items ?? []).length === 0 ? '' : (items ?? []).map((v) => `- [ ] ${v}`).join('\n');

    return (
      this.buildSectionFrontmatter(meta, 'story-technical') +
      `# Definicion Tecnica\n\n` +
      `## Arquitectura\n${tech.architecture ?? ''}\n\n` +
      `## Flujo de integracion\n${tech.integrationFlow ?? ''}\n\n` +
      `## Validaciones\n${list(tech.validations)}\n\n` +
      `## Manejo de errores\n${list(tech.errorHandling)}\n\n` +
      `## Checklist de implementacion\n${checklist(tech.implementationChecklist)}\n`
    );
  }

  private buildQAMarkdown(
    qa: Partial<StoryQaFieldsDto>,
    meta: { id: string; title: string; epicId: string; created?: string },
  ): string {
    return (
      this.buildSectionFrontmatter(meta, 'story-qa') +
      `# Testing Strategy\n\n` +
      `${qa.testingStrategy ?? ''}\n` +
      (qa.linkedQAMatrixId ? `\n---\n\n**QA Matrix vinculada:** \`${qa.linkedQAMatrixId}\`\n` : '')
    );
  }

  /**
   * Acorta nombres de archivos user-uploaded quitando timestamps verbosos y
   * la extension. Mantiene la fecha si existe.
   *
   * Ejemplos:
   *   "Captura de pantalla 2026-04-21 a las 2.18.26 a. m..png"
   *   -> "Captura de pantalla 2026-04-21"
   *
   *   "Reporte Q4 2024 final.pdf"
   *   -> "Reporte Q4 2024 final"
   *
   * Nota: duplicado intencional de `shortenUserUploadedName` en
   * `apps/web/src/lib/definiciones-display.ts`. Si se necesita en un tercer
   * lugar, promover a `packages/shared`.
   */
  private shortenDocName(name: string): string {
    let out = name;
    out = out.replace(/\s+a\s+las\s+.+$/i, '');
    out = out.replace(/\.[a-z0-9]{2,4}$/i, '');
    out = out.replace(/\.+$/, '').trim();
    return out || name;
  }

  private buildDocReferenceMarkdown(doc: RelatedDocumentDto): string {
    const shortName = this.shortenDocName(doc.docName);
    const fm = buildFrontmatter({
      id: doc.docId,
      type: 'document-reference',
      docName: doc.docName,
      bucketUrl: doc.bucketUrl,
      created: new Date().toISOString().slice(0, 10),
    });
    return (
      `${fm}\n\n` +
      `# ${shortName}\n\n` +
      `**Ubicacion en bucket:** [\`${doc.bucketUrl}\`](${doc.bucketUrl})\n\n` +
      `**Document ID:** \`${doc.docId}\`\n\n` +
      `## Relevancia para la historia\n\n${doc.relevanceSummary}\n`
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Reading: folder-based + legacy parser
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Lee el contenido de una historia del vault. Detecta automaticamente si
   * es el formato nuevo (vaultPath termina en `/index.md`) o el legacy flat
   * (vaultPath termina en `.md` sin folder intermedio).
   */
  private async readStoryContent(vaultPath: string): Promise<StoryMarkdownData> {
    if (!vaultPath.endsWith('/index.md')) {
      this.logger.log(`[StoryVault:read] format=LEGACY path=${vaultPath}`);
      const note = await this.vault.readNote(vaultPath);
      if (!note) return { po: {}, technical: {}, qa: {} };
      return this.parseLegacyMarkdown(note.content);
    }

    const folderPath = this.dirname(vaultPath);
    this.logger.log(`[StoryVault:read] format=NEW folder=${folderPath} (reading 3 section files)`);
    const [poNote, tlNote, qaNote] = await Promise.all([
      this.vault.readNote(`${folderPath}/definicion-negocio.md`).catch(() => null),
      this.vault.readNote(`${folderPath}/definicion-tecnica.md`).catch(() => null),
      this.vault.readNote(`${folderPath}/testing-strategy.md`).catch(() => null),
    ]);
    this.logger.log(
      `[StoryVault:read] files: po=${poNote ? 'ok' : 'missing'} tl=${tlNote ? 'ok' : 'missing'} qa=${qaNote ? 'ok' : 'missing'}`,
    );

    return {
      po: poNote ? this.parsePOMarkdown(poNote.content) : {},
      technical: tlNote ? this.parseTechnicalMarkdown(tlNote.content) : {},
      qa: qaNote ? this.parseQAMarkdown(qaNote.content) : {},
    };
  }

  /** Parser del nuevo formato: un archivo = una seccion con headings `## X`. */
  private parsePOMarkdown(md: string): StoryPoFieldsDto {
    const headings = ['Background', 'Objetivo', 'Historia de usuario', 'Que / Como / Cuando', 'Criterios de aceptacion', 'Notas adicionales'];
    const sections = this.parseFlatSections(md, headings);
    return {
      background: sections['Background'] ?? '',
      objective: sections['Objetivo'] ?? '',
      userStory: sections['Historia de usuario'] ?? '',
      whatHowWhen: sections['Que / Como / Cuando'] ?? '',
      acceptanceCriteria: sections['Criterios de aceptacion'] ?? '',
      additionalNotes: sections['Notas adicionales'] ?? '',
    };
  }

  private parseTechnicalMarkdown(md: string): StoryTechnicalFieldsDto {
    const headings = ['Arquitectura', 'Flujo de integracion', 'Validaciones', 'Manejo de errores', 'Checklist de implementacion'];
    const sections = this.parseFlatSections(md, headings);
    const toList = (s: string): string[] =>
      s
        .split('\n')
        .map((line) => line.replace(/^-\s*(\[\s?\]\s*)?/, '').trim())
        .filter((l) => l.length > 0);
    return {
      architecture: sections['Arquitectura'] ?? '',
      integrationFlow: sections['Flujo de integracion'] ?? '',
      validations: toList(sections['Validaciones'] ?? ''),
      errorHandling: toList(sections['Manejo de errores'] ?? ''),
      implementationChecklist: toList(sections['Checklist de implementacion'] ?? ''),
    };
  }

  private parseQAMarkdown(md: string): StoryQaFieldsDto {
    // QA es texto libre bajo `# Testing Strategy`. Solo removemos la etiqueta
    // y el eventual bloque "QA Matrix vinculada" del final.
    let content = md.replace(/^#\s+Testing Strategy\s*\n+/im, '').trim();
    const matrixMatch = content.match(/---\s*\n\s*\*\*QA Matrix vinculada:\*\*\s*`([^`]+)`/);
    let linkedQAMatrixId: string | undefined;
    if (matrixMatch) {
      linkedQAMatrixId = matrixMatch[1];
      content = content.replace(/---\s*\n\s*\*\*QA Matrix vinculada:\*\*\s*`[^`]+`\s*\n?$/, '').trim();
    }
    return {
      testingStrategy: content,
      ...(linkedQAMatrixId ? { linkedQAMatrixId } : {}),
    };
  }

  /**
   * Parser de markdown plano con headings `## X`. Devuelve un map de heading→texto.
   * Terminador estricto: usa la lista de headings conocidos para no partirse con
   * contenido del usuario que tenga `##` arbitrarios.
   */
  private parseFlatSections(md: string, headings: string[]): Record<string, string> {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = headings.map(escape).join('|');
    const result: Record<string, string> = {};
    for (const heading of headings) {
      const re = new RegExp(
        `##\\s+${escape(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+(?:${pattern})\\b|$)`,
        'i',
      );
      const match = md.match(re);
      result[heading] = match ? match[1].trim() : '';
    }
    return result;
  }

  /** Parser legacy: un archivo unico con `## Producto`, `## Tecnico`, `## QA`. */
  private parseLegacyMarkdown(markdown: string): StoryMarkdownData {
    const STORY_HEADINGS = [
      'Background',
      'Objetivo',
      'Historia de usuario',
      'Qué / Cómo / Cuándo',
      'Criterios de aceptación',
      'Notas adicionales',
      'Arquitectura',
      'Flujo de integración',
      'Validaciones',
      'Manejo de errores',
      'Checklist de implementación',
      'Estrategia de testing',
      'QA Matrix vinculada',
    ];
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const terminatorsPattern = STORY_HEADINGS.map(escapeRe).join('|');

    const getSection = (heading: string): string => {
      const escaped = escapeRe(heading);
      const re = new RegExp(
        `### ${escaped}\\n([\\s\\S]*?)(?=\\n### (?:${terminatorsPattern})\\n|\\n## |$)`,
        'i',
      );
      const match = markdown.match(re);
      return match ? match[1].trim() : '';
    };

    const getList = (heading: string): string[] => {
      const text = getSection(heading);
      return text
        .split('\n')
        .map((line) => line.replace(/^-\s*(\[\s?\]\s*)?/, '').trim())
        .filter((line) => line.length > 0);
    };

    return {
      po: {
        background: getSection('Background'),
        objective: getSection('Objetivo'),
        userStory: getSection('Historia de usuario'),
        whatHowWhen: getSection('Qué / Cómo / Cuándo'),
        acceptanceCriteria: getSection('Criterios de aceptación'),
        additionalNotes: getSection('Notas adicionales'),
      },
      technical: {
        architecture: getSection('Arquitectura'),
        integrationFlow: getSection('Flujo de integración'),
        validations: getList('Validaciones'),
        errorHandling: getList('Manejo de errores'),
        implementationChecklist: getList('Checklist de implementación'),
      },
      qa: {
        testingStrategy: getSection('Estrategia de testing'),
      },
    };
  }

  /**
   * Para stories legacy, aplicamos el update al archivo unico manteniendo el
   * formato viejo (no migramos en un update parcial para evitar commits complejos).
   */
  private async updateLegacyMarkdown(
    existing: { id: string; title: string; epicId: string; vaultPath: string | null },
    dto: UpdateStoryDto,
  ): Promise<void> {
    if (!existing.vaultPath) return;
    this.vault.invalidateCache(existing.vaultPath);
    const existingNote = await this.vault.readNote(existing.vaultPath);
    const existingContent = existingNote
      ? this.parseLegacyMarkdown(existingNote.content)
      : { po: {}, technical: {}, qa: {} };
    const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;

    const merged = {
      po: { ...existingContent.po, ...(dto.po ?? {}) },
      technical: { ...existingContent.technical, ...(dto.technical ?? {}) },
      qa: { ...existingContent.qa, ...(dto.qa ?? {}) },
    };

    const legacyMd = this.buildLegacyMarkdown({
      id: existing.id,
      title: dto.title ?? existing.title,
      epicId: existing.epicId,
      po: merged.po,
      technical: merged.technical,
      qa: merged.qa,
      created: existingCreated,
    });
    await this.vault.writeNote(
      existing.vaultPath,
      legacyMd,
      `docs(story): update content [${existing.id}]`,
    );
  }

  /** Mantiene el builder legacy para backward compat en updates de historias viejas. */
  private buildLegacyMarkdown(data: {
    id: string;
    title: string;
    epicId: string;
    po?: StoryPoFieldsDto;
    technical?: StoryTechnicalFieldsDto;
    qa?: StoryQaFieldsDto;
    created?: string;
  }): string {
    const frontmatter = `${buildFrontmatter({
      id: data.id,
      type: 'story',
      epicId: data.epicId,
      title: data.title,
      created: data.created ?? new Date().toISOString().slice(0, 10),
    })}\n\n`;

    const po = data.po ?? {};
    const technical = data.technical ?? {};
    const qa = data.qa ?? {};

    const sections: string[] = [];
    sections.push(`# ${data.title}\n`);
    sections.push('## Producto\n');
    sections.push(`### Background\n${po.background ?? ''}\n`);
    sections.push(`### Objetivo\n${po.objective ?? ''}\n`);
    sections.push(`### Historia de usuario\n${po.userStory ?? ''}\n`);
    sections.push(`### Qué / Cómo / Cuándo\n${typeof po.whatHowWhen === 'string' ? po.whatHowWhen : ''}\n`);
    sections.push(`### Criterios de aceptación\n${po.acceptanceCriteria ?? ''}\n`);
    sections.push(`### Notas adicionales\n${po.additionalNotes ?? ''}\n`);

    sections.push('## Técnico\n');
    sections.push(`### Arquitectura\n${technical.architecture ?? ''}\n`);
    sections.push(`### Flujo de integración\n${technical.integrationFlow ?? ''}\n`);
    sections.push(`### Validaciones\n${(technical.validations ?? []).map((v) => `- ${v}`).join('\n')}\n`);
    sections.push(`### Manejo de errores\n${(technical.errorHandling ?? []).map((e) => `- ${e}`).join('\n')}\n`);
    sections.push(`### Checklist de implementación\n${(technical.implementationChecklist ?? []).map((i) => `- [ ] ${i}`).join('\n')}\n`);

    sections.push('## QA\n');
    sections.push(`### Estrategia de testing\n${qa.testingStrategy ?? ''}\n`);
    if (qa.linkedQAMatrixId) {
      sections.push(`### QA Matrix vinculada\n[[${qa.linkedQAMatrixId}]]\n`);
    }

    return frontmatter + sections.join('\n');
  }

  private extractCreatedDate(markdown: string): string | undefined {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const line = match[1].split('\n').find((l) => l.startsWith('created:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Path helpers
  // ─────────────────────────────────────────────────────────────────────

  private buildFolderSlug(title: string, id: string): string {
    const slug = this.slugify(title) || 'historia';
    const shortId = id.slice(-6);
    return `${slug}-${shortId}`;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  private dirname(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(0, idx) : '';
  }

  private basename(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(idx + 1) : path;
  }

  /**
   * Persiste edges del DAG de orden entre historias (`blockedBy`) como rows
   * en la tabla `story_dependencies`.
   *
   * Cada entry en `blockedBy` referencia a la bloqueante por `storyClientId`
   * (clientId de la propuesta staging). Buscamos en la DB una Story con el
   * mismo `epicId` y `sourceClientId === storyClientId` — si existe, creamos
   * el row. Si no (porque esa historia aún está en staging), loggeamos WARN
   * y skippeamos — el edge NO se persiste.
   *
   * Limitación conocida del MVP: el flujo "acepta B antes que A aunque A
   * bloquea a B" pierde el edge. La mitigación es que el frontend acepte
   * en orden topológico (o usar el botón "Aceptar todas"). Si a futuro se
   * vuelve un dolor, podemos persistir edges pending en una tabla auxiliar
   * `story_dependency_pending` con el clientId sin resolver.
   */
  private async persistBlockedByEdges(
    storyId: string,
    epicId: string,
    blockedBy: NonNullable<CreateStoryDto['blockedBy']>,
  ): Promise<void> {
    if (blockedBy.length === 0) return;

    // Lookup batch: fetch todas las bloqueantes candidatas de una vez en
    // lugar de N queries separadas.
    const targetClientIds = Array.from(
      new Set(blockedBy.map((b) => b.storyClientId).filter(Boolean)),
    );
    if (targetClientIds.length === 0) return;

    const resolvedStories = await this.prisma.story.findMany({
      where: {
        epicId,
        sourceClientId: { in: targetClientIds },
      },
      select: { id: true, sourceClientId: true },
    });
    const clientIdToStoryId = new Map<string, string>();
    for (const s of resolvedStories) {
      if (s.sourceClientId) clientIdToStoryId.set(s.sourceClientId, s.id);
    }

    let created = 0;
    let skipped = 0;
    for (const edge of blockedBy) {
      // También soportamos el caso donde el cliente envía directamente un
      // storyId real (no un clientId) — útil si el frontend ya hizo la
      // resolución local antes de enviar.
      const resolvedId =
        clientIdToStoryId.get(edge.storyClientId) ??
        (resolvedStories.some((s) => s.id === edge.storyClientId)
          ? edge.storyClientId
          : null);
      if (!resolvedId) {
        this.logger.warn(
          `[StoryDep] Skip edge: story ${storyId} blockedBy unresolved clientId=${edge.storyClientId}. ` +
            `La historia bloqueante aún no está aceptada (acepta en orden topológico o usa "Aceptar todas").`,
        );
        skipped++;
        continue;
      }
      if (resolvedId === storyId) {
        this.logger.warn(`[StoryDep] Skip edge: self-block story=${storyId}`);
        skipped++;
        continue;
      }
      try {
        await this.prisma.storyDependency.create({
          data: {
            storyId,
            blockedById: resolvedId,
            hardness: edge.hardness,
            reason: edge.reason,
            description: edge.description ?? '',
          },
        });
        created++;
      } catch (err: unknown) {
        // P2002 unique violation = edge ya existía (usuario aceptó 2x o
        // caso de doble envío). Silenciar.
        const message = (err as Error)?.message ?? String(err);
        if (message.includes('P2002') || message.includes('Unique constraint')) {
          skipped++;
          continue;
        }
        this.logger.warn(
          `[StoryDep] Failed to create edge story=${storyId} blockedBy=${resolvedId}: ${message}`,
        );
        skipped++;
      }
    }
    this.logger.log(
      `[StoryDep] story=${storyId} edges: created=${created} skipped=${skipped} (of ${blockedBy.length})`,
    );
  }

  /**
   * Inserta las `discoveredDependencies` al JSONB `epic.dependencies[]` con
   * dedup por `id`. Las deps ya existentes se preservan (no se sobreescriben)
   * — solo se agregan las nuevas del batch actual.
   *
   * SQL atómico para evitar race conditions si dos historias del mismo batch
   * se aceptan simultáneamente. El `jsonb_agg + WHERE NOT EXISTS` hace
   * upsert in-place sin read-modify-write.
   *
   * Campos core persistidos: id, title, description, severity, type, vendor,
   * requiresCredential, isBlocking, + status: 'identified' + createdAt/
   * updatedAt. Se omite `mdContent` del JSONB (vive en el vault) para evitar
   * bloatear el campo.
   */
  private async persistDiscoveredDependenciesToEpicJsonb(
    epicId: string,
    deps: DiscoveredDependencyDto[],
  ): Promise<void> {
    if (deps.length === 0) return;
    const now = new Date().toISOString();

    // Shape del item que guardamos en JSONB — coherente con `EpicDependency`
    // donde aplique, + flags nuevos del feature External Secrets.
    const jsonbItems = deps.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      type: d.type,
      severity: d.severity,
      status: 'identified' as const,
      isBlocking: d.isBlocking ?? false,
      vendor: d.vendor ?? null,
      requiresCredential: d.requiresCredential ?? false,
      linkedSecretId: null,
      createdAt: now,
      updatedAt: now,
      // Campos de `EpicDependency` que no aplican para discovered — se dejan
      // como null/defaults razonables para que el UI los maneje.
      direction: 'depends_on' as const,
      scheduling: 'finish-to-start' as const,
      targetEpicId: null,
      targetExternalName: null,
      owner: '',
      dueDate: null,
      resolutionNotes: '',
    }));

    const payload = JSON.stringify(jsonbItems);

    // Filtra del payload los items cuyo id ya existe en `epic.dependencies`,
    // luego concatena los nuevos. Atomic per-epic.
    await this.prisma.$executeRaw`
      UPDATE epics
      SET dependencies = COALESCE(dependencies, '[]'::jsonb) || (
        SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
        FROM jsonb_array_elements(${payload}::jsonb) AS item
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(dependencies, '[]'::jsonb)) AS existing
          WHERE existing->>'id' = item->>'id'
        )
      )
      WHERE id = ${epicId}
    `;

    this.logger.log(
      `[persistDiscoveredDependenciesToEpicJsonb] epic=${epicId} attempted=${deps.length} (duplicates by id are skipped)`,
    );
  }
}
