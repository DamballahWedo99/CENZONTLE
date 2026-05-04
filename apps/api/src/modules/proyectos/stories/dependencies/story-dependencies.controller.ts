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
import { Permission, type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../../auth/decorators';
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
  @ApiOperation({ summary: 'Crear una dependencia técnica para una historia. Requiere pod intersection con la historia (CWE-639).' })
  create(
    @Param('storyId') storyId: string,
    @Body() dto: CreateStoryDependencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(storyId, dto, user);
  }

  @Patch(':depId')
  @Permissions(Permission.EDIT_STORY)
  @ApiOperation({ summary: 'Actualizar una dependencia técnica. Requiere pod intersection con la historia (CWE-639).' })
  update(
    @Param('storyId') storyId: string,
    @Param('depId') depId: string,
    @Body() dto: UpdateStoryDependencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(storyId, depId, dto, user);
  }

  @Delete(':depId')
  @Permissions(Permission.EDIT_STORY)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una dependencia técnica. Requiere pod intersection con la historia (CWE-639).' })
  remove(
    @Param('storyId') storyId: string,
    @Param('depId') depId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(storyId, depId, user);
  }
}
