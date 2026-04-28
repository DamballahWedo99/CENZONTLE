import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../../auth/decorators';
import { StoryDependenciesService } from './story-dependencies.service';
import { CreateStoryDependencyDto } from './dto/create-story-dependency.dto';
import { UpdateStoryDependencyDto } from './dto/update-story-dependency.dto';

@ApiTags('Story Dependencies')
@Controller('proyectos/historias/:storyId/dependencies')
export class StoryDependenciesController {
  constructor(private readonly service: StoryDependenciesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar dependencias técnicas propias de la historia (FK story). Las legacy a nivel épica NO se incluyen aquí — viven en el rollup del epic.',
  })
  list(@Param('storyId') storyId: string) {
    return this.service.findByStory(storyId);
  }

  @Post()
  @Permissions(Permission.EDIT_STORY)
  @ApiOperation({ summary: 'Crear una dependencia técnica para una historia.' })
  create(@Param('storyId') storyId: string, @Body() dto: CreateStoryDependencyDto) {
    return this.service.create(storyId, dto);
  }

  @Patch(':depId')
  @Permissions(Permission.EDIT_STORY)
  @ApiOperation({ summary: 'Actualizar una dependencia técnica.' })
  update(
    @Param('storyId') storyId: string,
    @Param('depId') depId: string,
    @Body() dto: UpdateStoryDependencyDto,
  ) {
    return this.service.update(storyId, depId, dto);
  }

  @Delete(':depId')
  @Permissions(Permission.EDIT_STORY)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una dependencia técnica.' })
  remove(@Param('storyId') storyId: string, @Param('depId') depId: string) {
    return this.service.remove(storyId, depId);
  }
}
