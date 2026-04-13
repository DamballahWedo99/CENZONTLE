import { Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../auth/decorators';
import { EpicsService } from './epics.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicQueryDto } from './dto/epic-query.dto';

@ApiTags('Épicas')
@Controller('proyectos/epicas')
export class EpicsController {
  constructor(private readonly epicsService: EpicsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar épicas con filtros opcionales' })
  findAll(@Query() query: EpicQueryDto) {
    return this.epicsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una épica por ID con iniciativa y pods. includeContent=true carga el markdown del vault.' })
  findOne(@Param('id') id: string, @Query('includeContent') includeContent?: string) {
    return this.epicsService.findOne(id, includeContent === 'true');
  }

  @Post()
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Crear una épica' })
  create(@Body() dto: CreateEpicDto) {
    return this.epicsService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.EDIT_EPIC)
  @ApiOperation({ summary: 'Actualizar una épica' })
  update(@Param('id') id: string, @Body() dto: UpdateEpicDto) {
    return this.epicsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(Permission.DELETE_EPIC)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una épica' })
  remove(@Param('id') id: string) {
    return this.epicsService.remove(id);
  }
}
