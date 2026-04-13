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
import { VaultConfigService } from './vault-config.service';
import { VaultService } from './vault.service';
import { CreateVaultConfigDto } from './dto/create-vault-config.dto';
import { UpdateVaultConfigDto } from './dto/update-vault-config.dto';

/**
 * CRUD para vault configs. Todos los endpoints requieren autenticación
 * vía JWT de Auth0. El frontend envía requests a través del BFF proxy.
 */
@ApiTags('Vault Configs')
@Controller('vault/configs')
export class VaultConfigController {
  constructor(
    private readonly vaultConfigs: VaultConfigService,
    private readonly vault: VaultService,
  ) {}

  @Get()
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Listar todos los vault configs — requiere MANAGE_INTEGRATIONS (admin)' })
  findAll() {
    return this.vaultConfigs.findAll();
  }

  @Get('accessible')
  @ApiOperation({ summary: 'Listar vaults accesibles para el usuario actual (filtrado server-side por pod membership)' })
  findAccessible(@CurrentUser() user: AuthenticatedUser) {
    return this.vaultConfigs.findAccessible(user);
  }

  @Get(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Obtener un vault config por ID' })
  findOne(@Param('id') id: string) {
    return this.vaultConfigs.findOne(id);
  }

  @Post()
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Crear un nuevo vault config' })
  create(@Body() dto: CreateVaultConfigDto) {
    return this.vaultConfigs.create(dto);
  }

  @Patch(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Actualizar un vault config (token opcional)' })
  async update(@Param('id') id: string, @Body() dto: UpdateVaultConfigDto) {
    const updated = await this.vaultConfigs.update(id, dto);
    // Si actualizamos el vault activo, invalidar cache del VaultService
    // para que la próxima lectura use los valores nuevos.
    if (updated.isActive) {
      this.vault.invalidateActiveConfig();
    }
    return updated;
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un vault config' })
  async remove(@Param('id') id: string) {
    await this.vaultConfigs.remove(id);
    this.vault.invalidateActiveConfig();
  }

  @Post(':id/activate')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Activar un vault (los demás se desactivan)' })
  async activate(@Param('id') id: string) {
    const activated = await this.vaultConfigs.activate(id);
    this.vault.invalidateActiveConfig();
    return activated;
  }

  @Post(':id/test')
  @Permissions(Permission.MANAGE_INTEGRATIONS)
  @ApiOperation({ summary: 'Probar conexión a GitHub con el token del vault' })
  testConnection(@Param('id') id: string) {
    return this.vaultConfigs.testConnection(id);
  }
}
