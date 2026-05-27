import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Permission, type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../auth/decorators';
import { EpicsService } from './epics.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicQueryDto } from './dto/epic-query.dto';
import { PublishToTrackerDto } from './dto/publish-to-tracker.dto';
import { ApproveEpicDto } from './dto/approve-epic.dto';

@ApiTags('Épicas')
@Controller('proyectos/epicas')
export class EpicsController {
  constructor(private readonly epicsService: EpicsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar épicas con filtros opcionales. Para no-admins, filtra por pods del usuario (CWE-639).' })
  findAll(@Query() query: EpicQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una épica por ID con iniciativa y pods. includeContent=true carga el markdown del vault (gate por pod intersection).' })
  findOne(
    @Param('id') id: string,
    @Query('includeContent') includeContent: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.findOne(id, includeContent === 'true', user);
  }

  @Get(':id/discovered-dependencies')
  @ApiOperation({
    summary:
      'Lista las dependencias descubiertas por el agente QA (leídas del vault). Estas son diferentes de epic.dependencies (manuales en Postgres).',
  })
  listDiscoveredDependencies(@Param('id') id: string) {
    return this.epicsService.listDiscoveredDependencies(id);
  }

  @Get(':id/story-dependencies')
  @ApiOperation({
    summary:
      'Lista el DAG de orden entre historias de la épica. Cada entry es una historia con sus bloqueantes directos (edges del modelo StoryDependency).',
  })
  listStoryDependencies(@Param('id') id: string) {
    return this.epicsService.listStoryDependencies(id);
  }

  @Get(':id/coverage-check')
  @ApiOperation({
    summary:
      'Coverage check del bundle de diseño contra las historias. Devuelve qué componentes del manifest están cubiertos por al menos una story (via story.componentsCovered) y un flag `canEnqueue`. Degrada para épicas sin bundle o con bundle legacy (sin manifest): no bloquea.',
  })
  getCoverageCheck(@Param('id') id: string) {
    return this.epicsService.getCoverageCheck(id);
  }

  @Post()
  @Permissions(Permission.CREATE_EPIC)
  @ApiOperation({ summary: 'Crear una épica' })
  create(@Body() dto: CreateEpicDto) {
    return this.epicsService.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.EDIT_EPIC)
  @ApiOperation({ summary: 'Actualizar una épica. Requiere pod intersection con el target (CWE-639).' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEpicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions(Permission.DELETE_EPIC)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una épica. Requiere pod intersection con el target (CWE-639).' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.remove(id, user);
  }

  /**
   * Sube un bundle ZIP de Claude Design y lo asocia como diseño de la épica.
   *
   * El backend:
   *  1. Descomprime el ZIP en memoria.
   *  2. Valida estructura (carpeta wrapper única + README.md en raíz).
   *  3. Persiste el ZIP completo a disco como respaldo (incluye binarios).
   *  4. Escribe los archivos texto del bundle al vault bajo
   *     `iniciativas/<x>/epics/<y>/disenos/<wrapperSlug>-<designId6>/`.
   *  5. Construye un handoff sintético compacto (slug + primary path +
   *     listing) y lo guarda como `handoff` del EpicDesign en BD.
   *  6. Devuelve el EpicDesign creado con `bundleKey` y `bundleVaultPath`.
   *
   * Multipart payload:
   *  - `file` (required): el ZIP exportado de Claude Design.
   *  - `name` (required): nombre que el user le da al diseño.
   *  - `description` (optional): resumen para el dialog.
   *
   * Tamaño máximo del archivo: 10 MB. ZIPs más grandes son raros para
   * exports de Claude Design — si alguien los necesita, ajustar.
   */
  @Post(':id/designs/upload')
  @Permissions(Permission.EDIT_EPIC)
  @ApiOperation({
    summary: 'Sube un bundle ZIP de Claude Design como diseño de la épica.',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDesignBundle(
    @Param('id') epicId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Body('description') description: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo ZIP en el campo `file`.');
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new BadRequestException('El campo `name` es requerido.');
    }
    return this.epicsService.addDesignBundle(epicId, {
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      file,
      user,
    });
  }

  /**
   * Borra un diseño de la épica. Limpieza completa:
   *  - Si era un bundle: borra todos los archivos descomprimidos del vault
   *    bajo `disenos/<slug>/`, y borra el ZIP de respaldo de disco.
   *  - Si era legacy (URL handoff): borra el `disenos/<slug>.md`.
   *  - Quita el design del array `epic.designs` y persiste.
   *
   * Idempotente: si el design ya fue borrado, retorna 204 sin error.
   */
  @Delete(':id/designs/:designId')
  @Permissions(Permission.EDIT_EPIC)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borrar un diseño + limpiar vault y storage del bundle.' })
  deleteDesign(
    @Param('id') epicId: string,
    @Param('designId') designId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.deleteDesign(epicId, designId, user);
  }

  @Post(':id/publish-to-tracker')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publica la épica + sus historias como issues en el tracker externo (Linear). Idempotente. Requiere ser AltaGerencia o miembro de un pod asignado.',
  })
  publishToTracker(
    @Param('id') id: string,
    @Body() dto: PublishToTrackerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.publishToTracker(id, dto.provider, user);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Visto Bueno (VoBo) — Protocolo de aprobación por rol
  // ──────────────────────────────────────────────────────────────────────

  // Throttle estricto: estos endpoints reenvían la password a Auth0
  // (step-up auth). Sin límite, un atacante con un JWT comprometido puede
  // brute-force la password del aprobador (CWE-307) y bloquear su cuenta
  // en Auth0 (DoS lateral). 5 intentos/min por sub del JWT.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(':id/approvals/po')
  @Permissions(Permission.APPROVE_EPIC_PO)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'VoBo del Product Owner. Requiere rol ProductOwner + contraseña actual + definición/diagrama/historias completas. Límite 5/min.',
  })
  approveAsPO(
    @Param('id') id: string,
    @Body() dto: ApproveEpicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.approve(id, 'po', dto, user);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(':id/approvals/tl')
  @Permissions(Permission.APPROVE_EPIC_TL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'VoBo del Tech Lead. Requiere rol TechLead + contraseña + VoBo PO previo. Límite 5/min.',
  })
  approveAsTL(
    @Param('id') id: string,
    @Body() dto: ApproveEpicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.approve(id, 'tl', dto, user);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(':id/approvals/qa')
  @Permissions(Permission.APPROVE_QA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'VoBo de QA. Requiere rol QA + contraseña + VoBo PO y TL previos. Límite 5/min.',
  })
  approveAsQA(
    @Param('id') id: string,
    @Body() dto: ApproveEpicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.approve(id, 'qa', dto, user);
  }
}
