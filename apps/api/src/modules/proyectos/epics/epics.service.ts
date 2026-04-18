import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicQueryDto } from './dto/epic-query.dto';

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

function mapEpic(raw: any) {
  const { pods, ...epic } = raw;
  return {
    ...epic,
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
      const note = await this.vault.readNote(epic.vaultPath);
      if (note) {
        const content = this.parseEpicMarkdown(note.content);
        // Vault es fuente de verdad: los campos narrativos del vault sobrescriben los de PG
        return { ...mapped, ...content };
      }
    }

    return mapped;
  }

  async create(dto: CreateEpicDto) {
    this.logger.log(`[create] START title="${dto.title}" initiativeId=${dto.initiativeId}`);

    const id = randomUUID();
    const slug = this.slugify(dto.title);
    const vaultPath = `epics/${id}-${slug}.md`;
    this.logger.log(`[create] Generated vaultPath=${vaultPath}`);

    const narrative = this.extractNarrative(dto);
    const markdown = this.buildEpicMarkdown({
      id,
      title: dto.title,
      initiativeId: dto.initiativeId,
      description: dto.description,
      narrative,
    });

    // 1. Write to vault first
    await this.vault.writeNote(
      vaultPath,
      markdown,
      `feat(epic): create "${dto.title}" [${id}]`,
    );
    this.logger.log(`[create] Vault write OK`);

    // 2. Create PG row (with rollback on failure)
    try {
      const { podIds, startDate, targetDate, ...data } = dto;
      const epic = await this.prisma.$transaction(async (tx) => {
        const created = await tx.epic.create({
          data: {
            id,
            ...data,
            startDate: new Date(startDate),
            targetDate: new Date(targetDate),
            vaultPath,
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
      this.logger.error(`[create] PG insert FAILED, rolling back vault: ${vaultPath}`, err);
      await this.vault
        .deleteNote(vaultPath, `revert(epic): rollback create [${id}]`)
        .catch(() => {});
      throw err;
    }
  }

  async update(id: string, dto: UpdateEpicDto) {
    this.logger.log(`[update] START id=${id} fields=${Object.keys(dto).join(',')}`);

    const existing = await this.prisma.epic.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Épica no encontrada');

    // Detect narrative changes
    const incomingNarrative = this.extractNarrative(dto);
    const hasNarrativeChanges = Object.keys(incomingNarrative).length > 0;
    const titleChanged = dto.title !== undefined && dto.title !== existing.title;
    const descriptionChanged = dto.description !== undefined && dto.description !== existing.description;

    // Update vault if narrative content or title/description changed
    if ((hasNarrativeChanges || titleChanged || descriptionChanged) && existing.vaultPath) {
      this.logger.log(`[update] Reading existing vault note...`);
      // Invalidar cache para garantizar que leamos el SHA más reciente y evitar
      // 409 Conflict en writes concurrentes. GitHub rechaza writes con SHA stale.
      this.vault.invalidateCache(existing.vaultPath);
      const existingNote = await this.vault.readNote(existing.vaultPath);
      const existingCreated = existingNote ? this.extractCreatedDate(existingNote.content) : undefined;
      const existingNarrative = existingNote ? this.parseEpicMarkdown(existingNote.content) : {};

      // Merge: incoming fields win over existing
      const mergedNarrative: NarrativeContent = { ...existingNarrative, ...incomingNarrative };

      const markdown = this.buildEpicMarkdown({
        id: existing.id,
        title: dto.title ?? existing.title,
        initiativeId: existing.initiativeId,
        description: dto.description ?? existing.description,
        narrative: mergedNarrative,
        created: existingCreated,
      });

      await this.vault.writeNote(
        existing.vaultPath,
        markdown,
        `docs(epic): update content [${id}]`,
      );
      this.logger.log(`[update] Vault write OK`);
    }

    // Update PG row
    const { podIds, startDate, targetDate, ...data } = dto;
    const updateData: any = { ...data };
    if (startDate) updateData.startDate = new Date(startDate);
    if (targetDate) updateData.targetDate = new Date(targetDate);

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
    // Traemos las historias junto con la épica para poder limpiar sus vault
    // files. Mismo razonamiento que en InitiativesService.remove: Postgres
    // cascade borra rows pero no toca GitHub.
    const epic = await this.prisma.epic.findUnique({
      where: { id },
      include: {
        stories: { select: { id: true, title: true, vaultPath: true } },
      },
    });
    if (!epic) throw new NotFoundException('Épica no encontrada');

    // Borrar primero las historias del vault (best effort), luego la épica.
    for (const story of epic.stories) {
      if (story.vaultPath) {
        await this.vault
          .deleteNote(story.vaultPath, `feat(story): delete "${story.title}" [${story.id}] (cascade from epic)`)
          .catch((err) => this.logger.warn(`Failed to delete vault note ${story.vaultPath}: ${err?.message}`));
      }
    }
    if (epic.vaultPath) {
      await this.vault
        .deleteNote(epic.vaultPath, `feat(epic): delete "${epic.title}" [${id}]`)
        .catch((err) => this.logger.warn(`Failed to delete vault note ${epic.vaultPath}: ${err?.message}`));
    }

    await this.prisma.epic.delete({ where: { id } });
    this.logger.log(`[remove] epic=${id} cleaned ${epic.stories.length} stories from vault`);
  }

  // ─── Narrative extraction ───

  private extractNarrative(dto: Partial<CreateEpicDto>): NarrativeContent {
    const out: NarrativeContent = {};
    for (const field of NARRATIVE_FIELDS) {
      const value = dto[field];
      if (value !== undefined) out[field] = value;
    }
    return out;
  }

  // ─── Markdown serialization ───

  private buildEpicMarkdown(data: {
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
   * Minimal markdown parser: extracts sections back into structured fields.
   * Not a general-purpose parser — assumes the exact format produced by buildEpicMarkdown.
   *
   * Usa un set cerrado de labels conocidos como terminadores. Esto evita que
   * contenido del usuario con headings ## arbitrarios corrompa la sección actual
   * (a menos que el usuario use literalmente uno de nuestros labels — caso extremo).
   */
  private parseEpicMarkdown(markdown: string): NarrativeContent {
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const allHeadings = ['Descripción', ...Object.values(FIELD_LABELS)];
    const terminatorsPattern = allHeadings.map(escapeRe).join('|');

    const getSection = (heading: string): string => {
      const escaped = escapeRe(heading);
      // Captura desde el heading exacto hasta el siguiente heading CONOCIDO o fin de doc.
      // Solo los labels oficiales cuentan como terminadores — headings arbitrarios
      // dentro del contenido del usuario se preservan intactos.
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
