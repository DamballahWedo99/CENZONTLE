import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { CreateInitiativeDto } from './dto/create-initiative.dto';
import { UpdateInitiativeDto } from './dto/update-initiative.dto';
import { InitiativeQueryDto } from './dto/initiative-query.dto';

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
 * Por eso el markdown solo tiene una sección `## Descripción`.
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
        // Vault es fuente de verdad para el campo narrativo
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
    const slug = this.slugify(dto.name);
    const vaultPath = `initiatives/${id}-${slug}.md`;
    this.logger.log(`[create] Generated vaultPath=${vaultPath}`);

    const markdown = this.buildInitiativeMarkdown({
      id,
      name: dto.name,
      description: dto.description,
    });

    // 1. Write to vault first
    await this.vault.writeNote(
      vaultPath,
      markdown,
      `feat(initiative): create "${dto.name}" [${id}]`,
    );
    this.logger.log(`[create] Vault write OK`);

    // 2. Create PG row (with rollback on failure)
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
    const descriptionChanged = dto.description !== undefined && dto.description !== existing.description;

    // Update vault if name or description changed
    if ((nameChanged || descriptionChanged) && existing.vaultPath) {
      this.logger.log(`[update] Reading existing vault note...`);
      // Invalidar cache para evitar SHA stale en writes concurrentes (409 Conflict)
      this.vault.invalidateCache(existing.vaultPath);
      const existingNote = await this.vault.readNote(existing.vaultPath);
      const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;

      const markdown = this.buildInitiativeMarkdown({
        id: existing.id,
        name: dto.name ?? existing.name,
        description: dto.description ?? existing.description,
        created: existingCreated,
      });

      await this.vault.writeNote(
        existing.vaultPath,
        markdown,
        `docs(initiative): update content [${id}]`,
      );
      this.logger.log(`[update] Vault write OK`);
    }

    // Update PG row
    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.targetDate) data.targetDate = new Date(dto.targetDate);

    const result = await this.prisma.initiative.update({
      where: { id },
      data,
      include: INITIATIVE_INCLUDE,
    });
    this.logger.log(`[update] DONE id=${id}`);
    return result;
  }

  async remove(id: string) {
    // Incluimos épicas con sus historias para poder limpiar recursivamente
    // los archivos del vault ANTES de que Postgres cascade borre las rows.
    // Si omitiéramos esto, Prisma borra epics/stories en PG por ON DELETE CASCADE
    // pero los markdown files quedan huérfanos en GitHub (cascade de DB no
    // ejecuta código de aplicación).
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

    // Borrado bottom-up en el vault: historias → épicas → iniciativa.
    // Todas las llamadas a deleteNote son best-effort: si una falla por rate
    // limit de GitHub o race condition, loggeamos y seguimos — el delete en
    // DB no depende del éxito del vault cleanup.
    for (const epic of initiative.epics) {
      for (const story of epic.stories) {
        if (story.vaultPath) {
          await this.vault
            .deleteNote(story.vaultPath, `feat(story): delete "${story.title}" [${story.id}] (cascade from initiative)`)
            .catch((err) => this.logger.warn(`Failed to delete vault note ${story.vaultPath}: ${err?.message}`));
        }
      }
      if (epic.vaultPath) {
        await this.vault
          .deleteNote(epic.vaultPath, `feat(epic): delete "${epic.title}" [${epic.id}] (cascade from initiative)`)
          .catch((err) => this.logger.warn(`Failed to delete vault note ${epic.vaultPath}: ${err?.message}`));
      }
    }
    if (initiative.vaultPath) {
      await this.vault
        .deleteNote(initiative.vaultPath, `feat(initiative): delete "${initiative.name}" [${id}]`)
        .catch((err) => this.logger.warn(`Failed to delete vault note ${initiative.vaultPath}: ${err?.message}`));
    }

    // Postgres ON DELETE CASCADE se encarga de borrar epics + stories en DB.
    await this.prisma.initiative.delete({ where: { id } });
    this.logger.log(`[remove] initiative=${id} cleaned ${initiative.epics.length} epics + ${initiative.epics.reduce((n, e) => n + e.stories.length, 0)} stories from vault`);
  }

  // ─── Markdown serialization ───

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
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    const title = `# ${data.name}\n\n`;
    const descriptionSection = `## Descripción\n\n${data.description ?? ''}\n`;

    return frontmatter + title + descriptionSection;
  }

  /**
   * Minimal markdown parser: extracts the description section.
   * Usa terminadores conocidos para evitar que contenido de usuario con ## arbitrarios corrompa el parse.
   */
  private parseInitiativeMarkdown(markdown: string): InitiativeMarkdownData {
    // Solo hay una sección conocida para iniciativas hoy. Si agregamos más en el futuro,
    // extender este array con los labels oficiales.
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

  /**
   * Extract `created` date from YAML frontmatter. Returns undefined if not present.
   */
  private extractCreatedDate(markdown: string): string | undefined {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const line = match[1].split('\n').find((l) => l.startsWith('created:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
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
}
