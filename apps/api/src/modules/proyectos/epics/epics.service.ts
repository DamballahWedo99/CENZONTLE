import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicQueryDto } from './dto/epic-query.dto';
import {
  epicFolderPath,
  epicIndexPath,
  epicDefinitionPath,
  epicDiagramPath,
  epicDependencyPath,
  epicMatrixPath,
  isLegacyVaultPath,
  isNewFormatVaultPath,
  type InitiativeRef,
  type EpicRef,
  type EpicDiagramKind,
} from '../vault-paths';
import {
  buildDiagramMarkdown,
  buildDependencyMarkdown,
  buildQAMatrixMarkdown,
  buildEpicQAMatrixMarkdown,
} from './epic-markdown-builders';

const EPIC_INCLUDE = {
  initiative: { select: { id: true, name: true, status: true } },
  pods: {
    include: { pod: { select: { id: true, name: true, color: true } } },
  },
} as const;

/**
 * Campos narrativos (rich-text) que viven tanto en PG como en el vault.
 * El vault es la fuente de verdad cuando se carga con includeContent=true.
 */
const NARRATIVE_FIELDS = [
  'qualitativeBenefits',
  'quantitativeBenefits',
  'benefitsMeasurement',
  'scopeDescription',
  'acceptanceCriteria',
  'technologicalImprovements',
  'businessPriority',
  'teamsInvolved',
  'impactedChannels',
  'impactedFlows',
  'impactSabreLevel',
  'thirdPartyDependencies',
] as const;

type NarrativeField = (typeof NARRATIVE_FIELDS)[number];
type NarrativeContent = Partial<Record<NarrativeField, string>>;

/** Label en español para cada campo narrativo, usado como heading en el markdown */
const FIELD_LABELS: Record<NarrativeField, string> = {
  qualitativeBenefits: 'Beneficios cualitativos',
  quantitativeBenefits: 'Beneficios cuantitativos',
  benefitsMeasurement: 'Medición de beneficios',
  scopeDescription: 'Descripción del alcance',
  acceptanceCriteria: 'Criterios de aceptación',
  technologicalImprovements: 'Mejoras tecnológicas',
  businessPriority: 'Prioridad de negocio',
  teamsInvolved: 'Equipos involucrados',
  impactedChannels: 'Canales impactados',
  impactedFlows: 'Flujos impactados',
  impactSabreLevel: 'Nivel de impacto Sabre',
  thirdPartyDependencies: 'Dependencias de terceros',
};

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

@Injectable()
export class EpicsService {
  private readonly logger = new Logger(EpicsService.name);

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private vaultFolder: VaultFolderService,
  ) {}

  async findAll(query: EpicQueryDto) {
    const where: Prisma.EpicWhereInput = {};
    if (query.initiativeId) where.initiativeId = query.initiativeId;
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.podId) where.pods = { some: { podId: query.podId } };

    const epics = await this.prisma.epic.findMany({
      where,
      include: EPIC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return epics.map(mapEpic);
  }

  async findOne(id: string, includeContent = false) {
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: EPIC_INCLUDE,
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    const mapped = mapEpic(epic);

    if (includeContent && epic.vaultPath) {
      // En formato nuevo, los campos narrativos viven en `definicion.md` dentro
      // del folder de la epica. En legacy flat, viven en el archivo unico.
      const narrativeNote = await this.readNarrativeNote(epic.vaultPath);
      if (narrativeNote) {
        const content = this.parseEpicMarkdown(narrativeNote.content);
        return { ...mapped, ...content };
      }
    }

    return mapped;
  }

  async create(dto: CreateEpicDto) {
    this.logger.log(`[create] START title="${dto.title}" initiativeId=${dto.initiativeId}`);

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
    this.logger.log(`[create] Generated vaultPath=${indexPath}`);

    const narrative = this.extractNarrative(dto);
    const indexMd = this.buildEpicIndexMarkdown({
      id,
      title: dto.title,
      initiativeId: dto.initiativeId,
      description: dto.description,
    });
    const definitionMd = this.buildEpicDefinitionMarkdown({
      id,
      title: dto.title,
      initiativeId: dto.initiativeId,
      narrative,
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
      this.logger.error(`[create] definicion.md failed, rolling back index.md`, err);
      await this.vault.deleteNote(indexPath, `revert(epic): rollback [${id}]`).catch(() => {});
      throw err;
    }
    this.logger.log(`[create] Vault writes OK (index + definicion)`);

    // 2. Create PG row (rollback ambos archivos on failure).
    try {
      const { podIds, startDate, targetDate, diagrams, ...data } = dto;
      // `diagrams` se extrae del spread y se reasigna como JSON. El DTO
      // valida solo `id` de cada diagrama (critico para seguridad path
      // traversal en epicDiagramPath); el resto del shape es free-form y
      // se persiste as-is en el campo JSONB. Prisma requiere
      // `InputJsonValue` — cast via `unknown` porque un class-validator
      // DTO no declara la index signature de InputJsonObject.
      const epic = await this.prisma.$transaction(async (tx) => {
        const created = await tx.epic.create({
          data: {
            id,
            ...data,
            ...(diagrams !== undefined
              ? { diagrams: diagrams as unknown as Prisma.InputJsonValue }
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
      this.logger.log(`[create] PG insert OK id=${epic.id}`);
      return mapEpic(epic);
    } catch (err) {
      this.logger.error(`[create] PG insert FAILED, rolling back vault files`, err);
      await this.vault.deleteNote(definitionPath, `revert(epic): rollback [${id}]`).catch(() => {});
      await this.vault.deleteNote(indexPath, `revert(epic): rollback [${id}]`).catch(() => {});
      throw err;
    }
  }

  async update(id: string, dto: UpdateEpicDto) {
    this.logger.log(`[update] START id=${id} fields=${Object.keys(dto).join(',')}`);

    const existing = await this.prisma.epic.findUnique({
      where: { id },
      include: { initiative: { select: { id: true, name: true } } },
    });
    if (!existing) throw new NotFoundException('Épica no encontrada');

    const incomingNarrative = this.extractNarrative(dto);
    const hasNarrativeChanges = Object.keys(incomingNarrative).length > 0;
    const titleChanged = dto.title !== undefined && dto.title !== existing.title;
    const descriptionChanged =
      dto.description !== undefined && dto.description !== existing.description;

    const newTitle = dto.title ?? existing.title;
    const newDescription = dto.description ?? existing.description;

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

        this.logger.log(`[update] Renaming folder: ${oldFolder} → ${newFolder}`);

        // Reescribimos index + definicion con el contenido actualizado ANTES de mover.
        await this.rewriteEpicFilesBeforeMove(
          existing,
          newTitle,
          newDescription,
          incomingNarrative,
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
      } else if ((hasNarrativeChanges || descriptionChanged) && (isNewFormat || isLegacy)) {
        // Sin rename: solo reescribir index.md y/o definicion.md segun lo que cambio.
        await this.updateEpicVaultContent(
          existing,
          newTitle,
          newDescription,
          incomingNarrative,
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
    const { podIds, startDate, targetDate, ...data } = dto;
    const updateData: Prisma.EpicUpdateInput = { ...data } as Prisma.EpicUpdateInput;
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
    this.logger.log(`[update] DONE id=${id}`);
    return mapEpic(epic);
  }

  async remove(id: string) {
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: {
        initiative: { select: { id: true, name: true } },
        stories: { select: { id: true, title: true, vaultPath: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    if (epic.vaultPath && isNewFormatVaultPath(epic.vaultPath)) {
      // Formato nuevo: deleteFolder recursivo limpia TODO el folder del epic
      // (incluye index + definicion + diagramas/ + docs/ + deps/ + matrices/ +
      // historias/ con su contenido).
      const iniRef: InitiativeRef = { id: epic.initiative.id, name: epic.initiative.name };
      const folder = epicFolderPath(iniRef, { id: epic.id, title: epic.title });
      this.logger.log(`[remove] Deleting folder (new format): ${folder}`);
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
              this.logger.warn(`Failed to delete vault note ${story.vaultPath}: ${err?.message}`),
            );
        }
      }
      if (epic.vaultPath) {
        await this.vault
          .deleteNote(epic.vaultPath, `feat(epic): delete "${epic.title}" [${id}]`)
          .catch((err) =>
            this.logger.warn(`Failed to delete vault note ${epic.vaultPath}: ${err?.message}`),
          );
      }
    }

    await this.prisma.epic.delete({ where: { id } });
    this.logger.log(`[remove] epic=${id} done (${epic.stories.length} stories cascaded)`);
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
      description: string;
      vaultPath: string | null;
      initiativeId: string;
    },
    newTitle: string,
    newDescription: string,
    incomingNarrative: NarrativeContent,
  ): Promise<void> {
    if (!existing.vaultPath) return;
    const folder = existing.vaultPath.slice(0, existing.vaultPath.lastIndexOf('/'));
    const definitionPath = `${folder}/definicion.md`;

    this.vault.invalidateCache(existing.vaultPath);
    this.vault.invalidateCache(definitionPath);

    const existingIndexNote = await this.vault.readNote(existing.vaultPath);
    const existingDefNote = await this.vault.readNote(definitionPath).catch(() => null);
    const existingCreated = existingIndexNote
      ? this.extractCreatedDate(existingIndexNote.content)
      : undefined;
    const existingNarrative = existingDefNote ? this.parseEpicMarkdown(existingDefNote.content) : {};
    const mergedNarrative: NarrativeContent = { ...existingNarrative, ...incomingNarrative };

    const indexMd = this.buildEpicIndexMarkdown({
      id: existing.id,
      title: newTitle,
      initiativeId: existing.initiativeId,
      description: newDescription,
      created: existingCreated,
    });
    const definitionMd = this.buildEpicDefinitionMarkdown({
      id: existing.id,
      title: newTitle,
      initiativeId: existing.initiativeId,
      narrative: mergedNarrative,
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
   * Sin rename, actualiza el vault de la epica. Formato nuevo: toca `index.md`
   * si cambio title/description; `definicion.md` si cambio algun narrative.
   * Formato legacy: reescribe el archivo unico (patron del service viejo).
   */
  private async updateEpicVaultContent(
    existing: {
      id: string;
      title: string;
      description: string;
      vaultPath: string | null;
      initiativeId: string;
    },
    newTitle: string,
    newDescription: string,
    incomingNarrative: NarrativeContent,
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

      // Index: solo si cambio title o description.
      if (newTitle !== existing.title || newDescription !== existing.description) {
        const indexMd = this.buildEpicIndexMarkdown({
          id: existing.id,
          title: newTitle,
          initiativeId: existing.initiativeId,
          description: newDescription,
          created: existingCreated,
        });
        await this.vault.writeNote(
          existing.vaultPath,
          indexMd,
          `docs(epic): update metadata [${existing.id}]`,
        );
      }

      // Definicion: solo si cambio algun narrative o title (heading).
      if (Object.keys(incomingNarrative).length > 0 || newTitle !== existing.title) {
        this.vault.invalidateCache(definitionPath);
        const existingDefNote = await this.vault.readNote(definitionPath).catch(() => null);
        const existingNarrative = existingDefNote
          ? this.parseEpicMarkdown(existingDefNote.content)
          : {};
        const mergedNarrative: NarrativeContent = { ...existingNarrative, ...incomingNarrative };
        const definitionMd = this.buildEpicDefinitionMarkdown({
          id: existing.id,
          title: newTitle,
          initiativeId: existing.initiativeId,
          narrative: mergedNarrative,
          created: existingCreated,
        });
        await this.vault.writeNote(
          definitionPath,
          definitionMd,
          `docs(epic): update definition [${existing.id}]`,
        );
      }
    } else {
      // Legacy: un solo archivo con todo (titulo + narrative juntos).
      this.vault.invalidateCache(existing.vaultPath);
      const existingNote = await this.vault.readNote(existing.vaultPath);
      const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;
      const existingNarrative = existingNote ? this.parseEpicMarkdown(existingNote.content) : {};
      const mergedNarrative: NarrativeContent = { ...existingNarrative, ...incomingNarrative };

      const legacyMd = this.buildLegacyEpicMarkdown({
        id: existing.id,
        title: newTitle,
        initiativeId: existing.initiativeId,
        description: newDescription,
        narrative: mergedNarrative,
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

    this.logger.log(
      `[cascadeStoryVaultPaths] updated ${updates.length} stories for epic=${epicId} (atomic)`,
    );
  }

  private extractNarrative(dto: Partial<CreateEpicDto>): NarrativeContent {
    const out: NarrativeContent = {};
    for (const field of NARRATIVE_FIELDS) {
      const value = dto[field];
      if (value !== undefined) out[field] = value;
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────
  //   Markdown builders
  // ─────────────────────────────────────────────────────────────────────

  /** index.md — metadata + descripcion breve + referencia a definicion.md. */
  private buildEpicIndexMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    description: string;
    created?: string;
  }): string {
    const frontmatter = [
      '---',
      `id: ${data.id}`,
      'type: epic',
      `initiativeId: ${data.initiativeId}`,
      `title: ${JSON.stringify(data.title)}`,
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    return (
      frontmatter +
      `# ${data.title}\n\n` +
      `## Descripción\n\n${data.description ?? ''}\n\n` +
      `---\n\n` +
      `Contenido completo en este folder:\n\n` +
      `- [\`definicion.md\`](./definicion.md) — campos narrativos (beneficios, alcance, criterios, etc.).\n` +
      `- [\`diagramas/\`](./diagramas/) — diagramas generados por el agente IA.\n` +
      `- [\`documentos/\`](./documentos/) — documentos adjuntos a la épica.\n` +
      `- [\`dependencias/\`](./dependencias/) — dependencias identificadas.\n` +
      `- [\`matrices/\`](./matrices/) — matrices QA funcional y sistémica.\n` +
      `- [\`historias/\`](./historias/) — historias de usuario.\n`
    );
  }

  /**
   * `definicion.md` — los 12 campos narrativos del epic con frontmatter YAML.
   * El frontmatter es consistente con `index.md` del epic y con los archivos
   * de historia (para que el parser del Vault renderice la seccion METADATA).
   */
  private buildEpicDefinitionMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    narrative: NarrativeContent;
    created?: string;
  }): string {
    const frontmatter = [
      '---',
      `id: ${data.id}`,
      'type: epic-definition',
      `initiativeId: ${data.initiativeId}`,
      `title: ${JSON.stringify(data.title)}`,
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    const narrativeSections = NARRATIVE_FIELDS.map((field) => {
      const value = data.narrative[field] ?? '';
      const label = FIELD_LABELS[field];
      return `## ${label}\n\n${value}\n`;
    }).join('\n');

    return frontmatter + `# ${data.title} — Definición\n\n` + narrativeSections;
  }

  /**
   * Mantiene el formato legacy (1 archivo con frontmatter + description + narrative)
   * para historias que aun no han sido migradas.
   */
  private buildLegacyEpicMarkdown(data: {
    id: string;
    title: string;
    initiativeId: string;
    description: string;
    narrative: NarrativeContent;
    created?: string;
  }): string {
    const frontmatter = [
      '---',
      `id: ${data.id}`,
      'type: epic',
      `initiativeId: ${data.initiativeId}`,
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    const title = `# ${data.title}\n\n`;
    const descriptionSection = `## Descripción\n\n${data.description ?? ''}\n\n`;
    const narrativeSections = NARRATIVE_FIELDS.map((field) => {
      const value = data.narrative[field] ?? '';
      const label = FIELD_LABELS[field];
      return `## ${label}\n\n${value}\n`;
    }).join('\n');

    return frontmatter + title + descriptionSection + narrativeSections;
  }

  /**
   * Parser de markdown narrative. Funciona para ambos formatos (legacy flat y
   * nuevo definicion.md) porque la seccion `## <Label>` es identica.
   */
  private parseEpicMarkdown(markdown: string): NarrativeContent {
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const allHeadings = ['Descripción', ...Object.values(FIELD_LABELS)];
    const terminatorsPattern = allHeadings.map(escapeRe).join('|');

    const getSection = (heading: string): string => {
      const escaped = escapeRe(heading);
      const re = new RegExp(
        `## ${escaped}\\n+([\\s\\S]*?)(?=\\n## (?:${terminatorsPattern})\\n|$)`,
        'i',
      );
      const match = markdown.match(re);
      return match ? match[1].trim() : '';
    };

    const out: NarrativeContent = {};
    for (const field of NARRATIVE_FIELDS) {
      out[field] = getSection(FIELD_LABELS[field]);
    }
    return out;
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
          this.logger.log(`[writeEpicArtifacts] diagrama ${kind} escrito → ${path}`);
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
          this.logger.log(`[writeEpicArtifacts] dependencia "${dep.title}" escrita → ${path}`);
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
        this.logger.log(`[writeEpicArtifacts] qa-funcional escrita → ${path}`);
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
        this.logger.log(`[writeEpicArtifacts] qa-sistemica escrita → ${path}`);
      }
    }
  }
}
