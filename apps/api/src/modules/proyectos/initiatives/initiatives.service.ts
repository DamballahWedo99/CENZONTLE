import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { VaultFolderService } from '../../vault/vault-folder.service';
import { CreateInitiativeDto } from './dto/create-initiative.dto';
import { UpdateInitiativeDto } from './dto/update-initiative.dto';
import { InitiativeQueryDto } from './dto/initiative-query.dto';
import {
  initiativeFolderPath,
  initiativeIndexPath,
  isLegacyVaultPath,
  isNewFormatVaultPath,
  type InitiativeRef,
} from '../vault-paths';

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
  ) {}

  async findAll(query: InitiativeQueryDto) {
    const where: Prisma.InitiativeWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.initiative.findMany({
      where,
      include: INITIATIVE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, includeContent = false) {
    const initiative = await this.prisma.initiative.findUnique({
      where: { id },
      include: INITIATIVE_INCLUDE,
    });
    if (!initiative) throw new NotFoundException('Iniciativa no encontrada');

    if (includeContent && initiative.vaultPath) {
      const note = await this.vault.readNote(initiative.vaultPath);
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
    this.logger.log(`[create] Generated vaultPath=${vaultPath}`);

    const markdown = this.buildInitiativeMarkdown({
      id,
      name: dto.name,
      description: dto.description,
    });

    // 1. Write to vault first.
    await this.vault.writeNote(
      vaultPath,
      markdown,
      `feat(initiative): create "${dto.name}" [${id}]`,
    );
    this.logger.log(`[create] Vault write OK`);

    // 2. Create PG row (rollback vault on failure).
    try {
      const initiative = await this.prisma.initiative.create({
        data: {
          id,
          ...dto,
          startDate: new Date(dto.startDate),
          targetDate: new Date(dto.targetDate),
          vaultPath,
        },
        include: INITIATIVE_INCLUDE,
      });
      this.logger.log(`[create] PG insert OK id=${initiative.id}`);
      return initiative;
    } catch (err) {
      this.logger.error(`[create] PG insert FAILED, rolling back vault: ${vaultPath}`, err);
      await this.vault
        .deleteNote(vaultPath, `revert(initiative): rollback create [${id}]`)
        .catch(() => {});
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
        // No hay rename de folder — solo reescribimos el index.md (o el archivo
        // legacy) con el contenido actualizado.
        this.vault.invalidateCache(existing.vaultPath);
        const existingNote = await this.vault.readNote(existing.vaultPath);
        const existingCreated = existingNote
          ? this.extractCreatedDate(existingNote.content)
          : undefined;

        const markdown = this.buildInitiativeMarkdown({
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
        this.logger.log(`[update] Vault write OK`);
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
    existing: { id: string; name: string; description: string; vaultPath: string | null },
    newName: string,
    newDescription: string,
  ): Promise<void> {
    if (!existing.vaultPath) return;
    this.vault.invalidateCache(existing.vaultPath);
    const existingNote = await this.vault.readNote(existing.vaultPath);
    const existingCreated = existingNote
      ? this.extractCreatedDate(existingNote.content)
      : undefined;

    const markdown = this.buildInitiativeMarkdown({
      id: existing.id,
      name: newName,
      description: newDescription,
      created: existingCreated,
    });

    await this.vault.writeNote(
      existing.vaultPath,
      markdown,
      `docs(initiative): update content pre-rename [${existing.id}]`,
    );
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

  private buildInitiativeMarkdown(data: {
    id: string;
    name: string;
    description: string;
    created?: string;
  }): string {
    const frontmatter = [
      '---',
      `id: ${data.id}`,
      'type: initiative',
      `name: ${JSON.stringify(data.name)}`,
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    const title = `# ${data.name}\n\n`;
    const descriptionSection = `## Descripción\n\n${data.description ?? ''}\n`;

    return frontmatter + title + descriptionSection;
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
