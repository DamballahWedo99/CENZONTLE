import { Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission, type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../auth/decorators';
import { InitiativesService } from './initiatives.service';
import { CreateInitiativeDto } from './dto/create-initiative.dto';
import { UpdateInitiativeDto } from './dto/update-initiative.dto';
import { InitiativeQueryDto } from './dto/initiative-query.dto';
import { PublishToTrackerDto } from '../epics/dto/publish-to-tracker.dto';

@ApiTags('Iniciativas')
@Controller('proyectos/iniciativas')
export class InitiativesController {
  constructor(private readonly initiativesService: InitiativesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar iniciativas con filtros opcionales. Para no-AltaGerencia, filtra por iniciativas que tienen al menos una épica en un pod del usuario (CWE-639).',
  })
  findAll(
    @Query() query: InitiativeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.initiativesService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Obtener una iniciativa por ID con sus épicas. includeContent=true carga description desde el vault. Pod intersection requerida para no-AltaGerencia.',
  })
  findOne(
    @Param('id') id: string,
    @Query('includeContent') includeContent: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.initiativesService.findOne(id, includeContent === 'true', user);
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

  @Post(':id/publish-to-tracker')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publica la iniciativa como Linear Initiative (entidad cross-team de alto nivel). Idempotente.',
  })
  publishToTracker(
    @Param('id') id: string,
    @Body() dto: PublishToTrackerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.initiativesService.publishToTracker(id, dto.provider, user);
  }
}
