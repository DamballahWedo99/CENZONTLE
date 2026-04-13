import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StoryQueryDto } from './dto/story-query.dto';
import { StoryPoFieldsDto, StoryTechnicalFieldsDto, StoryQaFieldsDto } from './dto/story-content.dto';
import { randomUUID } from 'crypto';

export interface StoryMarkdownData {
  po?: StoryPoFieldsDto;
  technical?: StoryTechnicalFieldsDto;
  qa?: StoryQaFieldsDto;
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
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
      const note = await this.vault.readNote(story.vaultPath);
      const parsed = note ? this.parseMarkdown(note.content) : { po: {}, technical: {}, qa: {} };
      return { ...story, content: parsed };
    }

    return story;
  }

  async create(dto: CreateStoryDto) {
    this.logger.log(`[create] START title="${dto.title}" epicId=${dto.epicId} podId=${dto.podId}`);
    const id = randomUUID();
    const slug = this.slugify(dto.title);
    const vaultPath = `stories/${id}-${slug}.md`;
    this.logger.log(`[create] Generated vaultPath=${vaultPath}`);

    const markdown = this.buildMarkdown({
      id,
      title: dto.title,
      epicId: dto.epicId,
      po: dto.po,
      technical: dto.technical,
      qa: dto.qa,
    });
    this.logger.log(`[create] Markdown length=${markdown.length}`);

    // 1. Write to vault first
    this.logger.log(`[create] About to write to vault...`);
    await this.vault.writeNote(
      vaultPath,
      markdown,
      `feat(story): create "${dto.title}" [${id}]`,
    );
    this.logger.log(`[create] Vault write OK`);

    // 2. Create row in PG. If this fails, rollback the vault write.
    try {
      this.logger.log(`[create] Creating row in PG...`);
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
          vaultPath,
        },
      });
      this.logger.log(`[create] PG insert OK, story.id=${result.id}`);
      return result;
    } catch (err) {
      this.logger.error(`[create] PG insert FAILED, rolling back vault: ${vaultPath}`, err);
      await this.vault.deleteNote(vaultPath, `revert(story): rollback create [${id}]`).catch(() => {});
      throw err;
    }
  }

  async update(id: string, dto: UpdateStoryDto) {
    this.logger.log(`[update] START id=${id} fields=${Object.keys(dto).join(',')}`);
    const existing = await this.prisma.story.findUnique({ where: { id } });
    if (!existing) {
      this.logger.warn(`[update] Story not found id=${id}`);
      throw new NotFoundException('Historia no encontrada');
    }
    this.logger.log(`[update] Found existing vaultPath=${existing.vaultPath}`);

    // Extract narrative content to write to vault
    const { po, technical, qa, ...structuralData } = dto;
    const hasContentChanges = po !== undefined || technical !== undefined || qa !== undefined;

    // Update vault if narrative content changed
    this.logger.log(`[update] hasContentChanges=${hasContentChanges}`);
    if (hasContentChanges && existing.vaultPath) {
      this.logger.log(`[update] Reading existing vault note...`);
      // Invalidar cache para garantizar que leamos el SHA más reciente y evitar
      // 409 Conflict en writes concurrentes. GitHub rechaza writes con SHA stale.
      this.vault.invalidateCache(existing.vaultPath);
      const existingNote = await this.vault.readNote(existing.vaultPath);
      const existingContent = existingNote ? this.parseMarkdown(existingNote.content) : { po: {}, technical: {}, qa: {} };
      const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;

      const mergedContent = {
        po: { ...existingContent.po, ...(po ?? {}) },
        technical: { ...existingContent.technical, ...(technical ?? {}) },
        qa: { ...existingContent.qa, ...(qa ?? {}) },
      };

      const markdown = this.buildMarkdown({
        id: existing.id,
        title: structuralData.title ?? existing.title,
        epicId: existing.epicId,
        po: mergedContent.po,
        technical: mergedContent.technical,
        qa: mergedContent.qa,
        created: existingCreated,
      });

      this.logger.log(`[update] Writing updated markdown to vault...`);
      await this.vault.writeNote(
        existing.vaultPath,
        markdown,
        `docs(story): update content [${id}]`,
      );
      this.logger.log(`[update] Vault write OK`);
    } else if (hasContentChanges && !existing.vaultPath) {
      this.logger.warn(`[update] Story has content changes but no vaultPath! id=${id}`);
    }

    // Update PG row
    this.logger.log(`[update] Updating PG row with ${Object.keys(structuralData).length} fields`);
    const result = await this.prisma.story.update({
      where: { id },
      data: {
        ...structuralData,
      },
    });
    this.logger.log(`[update] DONE id=${id}`);
    return result;
  }

  async remove(id: string) {
    const story = await this.prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException('Historia no encontrada');

    // Delete vault note (best effort)
    if (story.vaultPath) {
      await this.vault
        .deleteNote(story.vaultPath, `feat(story): delete "${story.title}" [${id}]`)
        .catch((err) => this.logger.warn(`Failed to delete vault note ${story.vaultPath}`, err));
    }

    await this.prisma.story.delete({ where: { id } });
  }

  // ---- Markdown serialization ----

  private buildMarkdown(data: {
    id: string;
    title: string;
    epicId: string;
    po?: StoryPoFieldsDto;
    technical?: StoryTechnicalFieldsDto;
    qa?: StoryQaFieldsDto;
    created?: string;
  }): string {
    const frontmatter = [
      '---',
      `id: ${data.id}`,
      'type: story',
      `epicId: ${data.epicId}`,
      `created: ${data.created ?? new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');

    const title = `# ${data.title}\n\n`;

    const po = data.po ?? {};
    const technical = data.technical ?? {};
    const qa = data.qa ?? {};

    const sections: string[] = [];

    // Producto section
    sections.push('## Producto\n');
    sections.push(`### Background\n${po.background ?? ''}\n`);
    sections.push(`### Objetivo\n${po.objective ?? ''}\n`);
    sections.push(`### Historia de usuario\n${po.userStory ?? ''}\n`);
    sections.push(`### Qué / Cómo / Cuándo\n${po.whatHowWhen ?? ''}\n`);
    sections.push(`### Criterios de aceptación\n${po.acceptanceCriteria ?? ''}\n`);
    sections.push(`### Notas adicionales\n${po.additionalNotes ?? ''}\n`);

    // Técnico section
    sections.push('## Técnico\n');
    sections.push(`### Arquitectura\n${technical.architecture ?? ''}\n`);
    sections.push(`### Flujo de integración\n${technical.integrationFlow ?? ''}\n`);
    sections.push(`### Validaciones\n${(technical.validations ?? []).map((v) => `- ${v}`).join('\n')}\n`);
    sections.push(`### Manejo de errores\n${(technical.errorHandling ?? []).map((e) => `- ${e}`).join('\n')}\n`);
    sections.push(`### Checklist de implementación\n${(technical.implementationChecklist ?? []).map((i) => `- [ ] ${i}`).join('\n')}\n`);

    // QA section
    sections.push('## QA\n');
    sections.push(`### Estrategia de testing\n${qa.testingStrategy ?? ''}\n`);
    if (qa.linkedQAMatrixId) {
      sections.push(`### QA Matrix vinculada\n[[${qa.linkedQAMatrixId}]]\n`);
    }

    return frontmatter + title + sections.join('\n');
  }

  /**
   * Extract `created` date from YAML frontmatter. Returns undefined if not present.
   * Keeps the original creation date stable across updates.
   */
  private extractCreatedDate(markdown: string): string | undefined {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return undefined;
    const line = match[1].split('\n').find((l) => l.startsWith('created:'));
    return line?.split(':').slice(1).join(':').trim() || undefined;
  }

  /**
   * Minimal markdown parser: extracts sections back into the structured fields.
   * Not a general-purpose parser — assumes the exact format produced by buildMarkdown.
   *
   * Usa un set cerrado de labels conocidos como terminadores. Esto evita que
   * contenido del usuario con headings ### arbitrarios corrompa la sección actual.
   */
  private parseMarkdown(markdown: string): StoryMarkdownData {
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
      // Termina solo en headings conocidos (### o ##) o en fin de doc.
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
