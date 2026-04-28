import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission, type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../auth/decorators';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StoryQueryDto } from './dto/story-query.dto';
import { PublishToTrackerDto } from '../epics/dto/publish-to-tracker.dto';

@ApiTags('Historias')
@Controller('proyectos/historias')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar historias de usuario' })
  findAll(@Query() query: StoryQueryDto) {
    return this.storiesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una historia por ID' })
  findOne(
    @Param('id') id: string,
    @Query('includeContent') includeContent?: string,
  ) {
    return this.storiesService.findOne(id, includeContent === 'true');
  }

  @Post()
  @Permissions(Permission.CREATE_STORY)
  @ApiOperation({ summary: 'Crear una historia de usuario' })
  create(@Body() dto: CreateStoryDto) {
    return this.storiesService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.EDIT_STORY)
  @ApiOperation({ summary: 'Actualizar una historia' })
  update(@Param('id') id: string, @Body() dto: UpdateStoryDto) {
    return this.storiesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(Permission.DELETE_STORY)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una historia' })
  remove(@Param('id') id: string) {
    return this.storiesService.remove(id);
  }

  @Post(':id/publish-to-tracker')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publica la historia como issue en el tracker externo. Si la épica padre tiene tracker, se cuelga como sub-issue. Requiere ser AltaGerencia o miembro de un pod asignado.',
  })
  publishToTracker(
    @Param('id') id: string,
    @Body() dto: PublishToTrackerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storiesService.publishToTracker(id, dto.provider, user);
  }
}
