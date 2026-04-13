import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../auth/decorators';
import { VaultService } from './vault.service';
import { VaultAccessGuard } from './guards/vault-access.guard';
import { WriteFileDto } from './dto/write-file.dto';
import { DeleteFileDto } from './dto/delete-file.dto';

/**
 * Path safety: GitHub's content API rejects paths with `..` and the slugify/validation
 * on DTOs prevents path traversal from user input. This controller accepts paths as-is
 * because the caller (frontend) derives them from the tree response it got from us.
 *
 * We still validate against obvious traversal attempts.
 */
function assertSafePath(path: string): void {
  if (path.includes('..')) {
    throw new NotFoundException('Path inválido');
  }
  if (path.startsWith('/')) {
    throw new NotFoundException('Path no debe comenzar con /');
  }
  // CWE-117/CWE-93: Rechazar caracteres de control que podrían usarse para
  // log injection (newlines en commit messages) o path confusion (null bytes).
  if (/[\r\n\0]/.test(path)) {
    throw new NotFoundException('Path contiene caracteres de control inválidos');
  }
}

/**
 * Endpoints del vault. Todos requieren autenticación vía JWT de Auth0.
 * El frontend envía requests a través del BFF proxy que inyecta el token.
 */
@ApiTags('Vault')
@Controller('vault')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get('config')
  @ApiOperation({ summary: 'Información de configuración pública del vault (sin token). No expone datos sensibles — solo owner/repo/branch/connected.' })
  getConfig() {
    return this.vault.getConfigInfo();
  }

  @Get('changelog')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Historial de commits del vault (changelog natural vía git history)' })
  async getChangelog(@Query('limit') limit?: string) {
    return this.vault.listCommits(Math.min(Number(limit) || 30, 100));
  }

  @Get('changelog/:sha')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Detalle de un commit incluyendo el diff/patch de archivos' })
  async getCommitDetail(@Param('sha') sha: string) {
    const detail = await this.vault.getCommitDetail(sha);
    if (!detail) throw new NotFoundException('Commit no encontrado');
    return detail;
  }

  @Get('tree')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Listar el árbol (recursivo) de un folder del vault' })
  async getTree(@Query('folder') folder = '') {
    assertSafePath(folder || 'root');
    return this.vault.listTree(folder);
  }

  @Get('file')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Leer el contenido de un archivo del vault' })
  async getFile(@Query('path') path: string) {
    if (!path) throw new NotFoundException('Parámetro path requerido');
    assertSafePath(path);
    const note = await this.vault.readNote(path);
    if (!note) throw new NotFoundException(`Archivo no encontrado: ${path}`);
    return note;
  }

  @Put('file')
  @UseGuards(VaultAccessGuard)
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Crear o actualizar un archivo en el vault' })
  async writeFile(@Body() dto: WriteFileDto) {
    assertSafePath(dto.path);
    // Invalidar cache para evitar SHA stale en writes concurrentes
    this.vault.invalidateCache(dto.path);
    return this.vault.writeNote(dto.path, dto.content, dto.message ?? `docs(vault): update ${dto.path}`);
  }

  @Delete('file')
  @UseGuards(VaultAccessGuard)
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un archivo del vault' })
  async deleteFile(@Body() dto: DeleteFileDto) {
    assertSafePath(dto.path);
    this.vault.invalidateCache(dto.path);
    await this.vault.deleteNote(dto.path, dto.message ?? `chore(vault): delete ${dto.path}`);
  }
}
