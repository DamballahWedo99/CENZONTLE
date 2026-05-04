import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoryDependenciesService } from './story-dependencies.service';
import { EpicsService } from '../../epics/epics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { dedupeRollup, type StoryTitleLookup } from './dedupe-rollup';

/**
 * Controller separado para los rollups cross-aggregate de
 * `StoryTechnicalDependency`. Vive bajo el prefix `proyectos/epicas/:epicId/...`
 * porque la URL es semánticamente más precisa (la épica agrega las deps
 * de sus stories) sin que `EpicsController` tenga que importar el service
 * de otro sub-dominio.
 *
 * El rollup une dos fuentes:
 *   1. `StoryTechnicalDependency` con FK a las stories del epic (nuevas)
 *   2. Legacy: `epic.dependencies` JSONB + vault `.md` discovered (con
 *      `storyId=''` como sentinel)
 *
 * Las fresh se DEDUPLICAN visualmente: si la misma credencial aparece en
 * varias historias del epic (ej. AMADEUS_CLIENT_ID en 3 stories), se
 * consolidan en una sola entry con `relatedStories[]` listando las stories
 * que la mencionan. La DB no se toca — cada story sigue siendo dueña de
 * sus rows; el dedup es solo visual y se calcula al vuelo en el GET.
 *
 * El frontend renderiza ambas en las mismas categorías; las legacy quedan
 * marcadas con badge "Legacy a nivel épica" hasta que el usuario las migre.
 */
@ApiTags('Story Dependencies')
@Controller('proyectos/epicas/:epicId/story-dependencies')
export class StoryDependenciesRollupController {
  constructor(
    private readonly service: StoryDependenciesService,
    private readonly epicsService: EpicsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('rollup')
  @ApiOperation({
    summary:
      'Roll-up read-only de las dependencias técnicas. Une las nuevas (FK story, deduplicadas cross-stories) con las legacy (JSONB + vault) durante el periodo de transición.',
  })
  async rollup(@Param('epicId') epicId: string) {
    const [fresh, legacy, stories] = await Promise.all([
      this.service.findByEpic(epicId),
      // Legacy es path degradado (JSONB + vault file scan); si falla
      // (epic no encontrado, vault unreachable), fallback a array vacío
      // para que las fresh deps se sigan rendereando. Sin esto, una falla
      // en el path legacy 500 todo el endpoint y el user no ve NADA.
      this.epicsService.getLegacyDependenciesForRollup(epicId).catch(() => []),
      // Lookup de títulos para resolver `relatedStories[].storyTitle` sin
      // N queries dentro del helper.
      this.prisma.story.findMany({
        where: { epicId },
        select: { id: true, title: true },
      }),
    ]);

    const titleLookup: StoryTitleLookup = new Map(
      stories.map((s) => [s.id, s.title]),
    );

    // El helper agrupa fresh por (category, vendor, normalizedTitle) y
    // preserva legacy intacto. Si una credencial aparece en N stories,
    // queda como UNA entry con `relatedStories[]` de N elementos.
    return dedupeRollup([...fresh, ...legacy], titleLookup);
  }
}
