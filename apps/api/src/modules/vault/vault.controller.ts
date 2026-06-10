import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../auth/decorators';
import { VaultService } from './vault.service';
import { VaultConnectionsService } from './vault-connections.service';
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
  constructor(
    private readonly vault: VaultService,
    private readonly connections: VaultConnectionsService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Información de configuración pública del vault (sin token). No expone datos sensibles — solo owner/repo/branch/connected.' })
  getConfig() {
    return this.vault.getConfigInfo();
  }

  @Get('changelog')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Historial de commits del vault (changelog natural vía git history)' })
  async getChangelog(@Query('limit') limit?: string, @Query('vaultId') vaultId?: string) {
    return this.vault.listCommits(Math.min(Number(limit) || 30, 100), undefined, vaultId);
  }

  @Get('changelog/:sha')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Detalle de un commit incluyendo el diff/patch de archivos' })
  async getCommitDetail(@Param('sha') sha: string, @Query('vaultId') vaultId?: string) {
    const detail = await this.vault.getCommitDetail(sha, vaultId);
    if (!detail) throw new NotFoundException('Commit no encontrado');
    return detail;
  }

  @Get('tags')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Mapa path → tags de todos los documentos .md del vault. Alimenta las conexiones de la vista de grafo. Acepta `?vaultId=X` para browse-mode.' })
  async getAllTags(@Query('vaultId') vaultId?: string) {
    return this.connections.getAllTags(vaultId);
  }

  @Post('connections')
  @UseGuards(VaultAccessGuard)
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @HttpCode(HttpStatus.ACCEPTED)
  // Cada job dispara llamadas LLM con costo real ($) sobre todo el vault —
  // el lock de un-job-a-la-vez ya rechaza concurrencia, pero el throttle
  // evita ráfagas de re-intentos que encadenen jobs caros back-to-back.
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Dispara el agente IA que analiza todos los documentos del vault y escribe tags al frontmatter para crear conexiones en el grafo. Fire-and-forget: pollear GET /vault/connections/status. 409 si ya hay un job en curso.' })
  runConnections(@Query('vaultId') vaultId?: string) {
    return this.connections.start(vaultId);
  }

  @Get('connections/status')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Estado del job de conexiones IA (un job a la vez por proceso): fase, progreso y resumen final. Acepta `?vaultId=X`; si el job en curso pertenece a otro vault, devuelve idle (no filtra metadatos cross-vault).' })
  getConnectionsStatus(@Query('vaultId') vaultId?: string) {
    return this.connections.getStatus(vaultId);
  }

  @Get('connections/last-run')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Fecha ISO de la última generación de conexiones IA, derivada del git history del vault (commit-marcador del agente). null si nunca se generaron. Acepta `?vaultId=X`.' })
  async getConnectionsLastRun(@Query('vaultId') vaultId?: string) {
    return { lastRunAt: await this.connections.getLastRunAt(vaultId) };
  }

  @Get('tree')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Listar el árbol (recursivo) de un folder del vault. Acepta `?vaultId=X` para browse-mode (lee de un vault distinto al activo).' })
  async getTree(@Query('folder') folder = '', @Query('vaultId') vaultId?: string) {
    assertSafePath(folder || 'root');
    return this.vault.listTree(folder, vaultId);
  }

  @Get('file')
  @UseGuards(VaultAccessGuard)
  @ApiOperation({ summary: 'Leer el contenido de un archivo del vault. Acepta `?vaultId=X` para browse-mode.' })
  async getFile(@Query('path') path: string, @Query('vaultId') vaultId?: string) {
    if (!path) throw new NotFoundException('Parámetro path requerido');
    assertSafePath(path);
    const note = await this.vault.readNote(path, vaultId);
    if (!note) throw new NotFoundException(`Archivo no encontrado: ${path}`);
    return note;
  }

  @Put('file')
  @UseGuards(VaultAccessGuard)
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Crear o actualizar un archivo en el vault. Acepta `?vaultId=X` para escribir a un vault distinto del activo (manual CRUD desde browse-mode).' })
  async writeFile(@Body() dto: WriteFileDto, @Query('vaultId') vaultId?: string) {
    assertSafePath(dto.path);
    // Invalidar cache solo cuando se escribe al activo (cache es solo del activo).
    if (!vaultId) this.vault.invalidateCache(dto.path);
    return this.vault.writeNote(
      dto.path,
      dto.content,
      dto.message ?? `docs(vault): update ${dto.path}`,
      vaultId,
    );
  }

  @Delete('file')
  @UseGuards(VaultAccessGuard)
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un archivo del vault. Acepta `?vaultId=X` para borrar de un vault distinto del activo.' })
  async deleteFile(@Body() dto: DeleteFileDto, @Query('vaultId') vaultId?: string) {
    assertSafePath(dto.path);
    if (!vaultId) this.vault.invalidateCache(dto.path);
    await this.vault.deleteNote(
      dto.path,
      dto.message ?? `chore(vault): delete ${dto.path}`,
      vaultId,
    );
  }
}
