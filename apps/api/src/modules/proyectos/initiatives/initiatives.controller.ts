import { Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../../auth/decorators';
import { InitiativesService } from './initiatives.service';
import { CreateInitiativeDto } from './dto/create-initiative.dto';
import { UpdateInitiativeDto } from './dto/update-initiative.dto';
import { InitiativeQueryDto } from './dto/initiative-query.dto';

@ApiTags('Iniciativas')
@Controller('proyectos/iniciativas')
export class InitiativesController {
  constructor(private readonly initiativesService: InitiativesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar iniciativas con filtros opcionales' })
  findAll(@Query() query: InitiativeQueryDto) {
    return this.initiativesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una iniciativa por ID con sus épicas. includeContent=true carga description desde el vault.' })
  findOne(@Param('id') id: string, @Query('includeContent') includeContent?: string) {
    return this.initiativesService.findOne(id, includeContent === 'true');
  }

  @Post()
  @Permissions(Permission.CREATE_INITIATIVE)
  @ApiOperation({ summary: 'Crear una iniciativa' })
  create(@Body() dto: CreateInitiativeDto) {
    return this.initiativesService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.EDIT_INITIATIVE)
  @ApiOperation({ summary: 'Actualizar una iniciativa' })
  update(@Param('id') id: string, @Body() dto: UpdateInitiativeDto) {
    return this.initiativesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(Permission.DELETE_INITIATIVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una iniciativa y sus épicas' })
  remove(@Param('id') id: string) {
    return this.initiativesService.remove(id);
  }
}
