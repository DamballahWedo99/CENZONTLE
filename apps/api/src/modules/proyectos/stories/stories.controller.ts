import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../auth/decorators';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StoryQueryDto } from './dto/story-query.dto';

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
}
