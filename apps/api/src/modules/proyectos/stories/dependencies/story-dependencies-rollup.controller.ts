import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoryDependenciesService } from './story-dependencies.service';
import { EpicsService } from '../../epics/epics.service';

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
 * El frontend renderiza ambas en las mismas categorías; las legacy quedan
 * marcadas con badge "Legacy a nivel épica" hasta que el usuario las migre.
 */
@ApiTags('Story Dependencies')
@Controller('proyectos/epicas/:epicId/story-dependencies')
export class StoryDependenciesRollupController {
  constructor(
    private readonly service: StoryDependenciesService,
    private readonly epicsService: EpicsService,
  ) {}

  @Get('rollup')
  @ApiOperation({
    summary:
      'Roll-up read-only de las dependencias técnicas. Une las nuevas (FK story) con las legacy (JSONB + vault) durante el periodo de transición.',
  })
  async rollup(@Param('epicId') epicId: string) {
    const [fresh, legacy] = await Promise.all([
      this.service.findByEpic(epicId),
      this.epicsService.getLegacyDependenciesForRollup(epicId),
    ]);
    return [...fresh, ...legacy];
  }
}
