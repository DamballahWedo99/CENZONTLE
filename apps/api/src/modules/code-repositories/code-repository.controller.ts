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
import { AuthenticatedUser, Permission } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { CodeRepositoryConfigService } from './code-repository-config.service';
import { CodeRepoCloneService } from './code-repo-clone.service';
import { CreateCodeRepositoryDto } from './dto/create-code-repository.dto';
import { UpdateCodeRepositoryDto } from './dto/update-code-repository.dto';

/**
 * CRUD para code repositories (repos de GitHub conectados para exploración por agentes IA).
 * Todos los endpoints requieren autenticación JWT vía Auth0.
 */
@ApiTags('Code Repositories')
@Controller('code-repositories')
export class CodeRepositoryController {
  constructor(
    private readonly repos: CodeRepositoryConfigService,
    private readonly clones: CodeRepoCloneService,
  ) {}

  @Get()
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Listar todos los repositorios — requiere MANAGE_INTEGRATIONS (admin)' })
  findAll() {
    return this.repos.findAll();
  }

  @Get('accessible')
  @ApiOperation({ summary: 'Listar repositorios accesibles para el usuario actual (pod filtering)' })
  findAccessible(@CurrentUser() user: AuthenticatedUser) {
    return this.repos.findAccessible(user);
  }

  @Get(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Obtener un repositorio por ID' })
  findOne(@Param('id') id: string) {
    return this.repos.findOne(id);
  }

  @Post()
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Crear un nuevo repositorio (el clone se dispara en background)' })
  async create(@Body() dto: CreateCodeRepositoryDto) {
    const created = await this.repos.create(dto);
    // Dispara el clone en background (fire-and-forget)
    this.clones.scheduleClone(created.id);
    return created;
  }

  @Patch(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Actualizar un repositorio (token opcional)' })
  async update(@Param('id') id: string, @Body() dto: UpdateCodeRepositoryDto) {
    const updated = await this.repos.update(id, dto);
    // Si cambió owner/repo/branch, re-clonar en background
    if (dto.owner !== undefined || dto.repo !== undefined || dto.branch !== undefined) {
      this.clones.scheduleClone(id);
    }
    return updated;
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un repositorio y su clone local' })
  async remove(@Param('id') id: string) {
    await this.repos.remove(id);
    await this.clones.removeClone(id);
  }

  @Post(':id/enable')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Habilitar un repositorio (múltiples pueden estar enabled al mismo tiempo)' })
  enable(@Param('id') id: string) {
    return this.repos.enable(id);
  }

  @Post(':id/disable')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Deshabilitar un repositorio (no elimina el clone)' })
  disable(@Param('id') id: string) {
    return this.repos.disable(id);
  }

  @Post(':id/test')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Probar conexión a GitHub con el token' })
  testConnection(@Param('id') id: string) {
    return this.repos.testConnection(id);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Forzar clone/pull del repositorio ahora' })
  syncNow(@Param('id') id: string) {
    return this.clones.syncNow(id);
  }

  @Get(':id/status')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Obtener el status del clone (para polling desde UI)' })
  getStatus(@Param('id') id: string) {
    return this.clones.getStatus(id);
  }
}
