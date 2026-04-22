import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, Permission } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { ExternalSecretsService } from './external-secrets.service';
import { CreateExternalSecretDto } from './dto/create-external-secret.dto';

/**
 * CRUD de credenciales externas. Todos los endpoints requieren el permiso
 * `MANAGE_EXTERNAL_SECRETS` (default: AltaGerencia + TechLead) — separado de
 * `MANAGE_INTEGRATIONS` porque operaciones cripto son más sensibles.
 *
 * El plaintext del secret NUNCA se devuelve por HTTP — solo `maskedValue`.
 * Para consumo runtime, los services inyectan `ExternalSecretsService` y
 * llaman `getByName(name)` directamente (ver jsdoc del service).
 */
@ApiTags('External Secrets')
@Controller('external-secrets')
export class ExternalSecretsController {
  constructor(private readonly secrets: ExternalSecretsService) {}

  @Get()
  @Permissions(Permission.MANAGE_EXTERNAL_SECRETS)
  @ApiOperation({ summary: 'Listar todos los secrets externos (valor enmascarado).' })
  list() {
    return this.secrets.list();
  }

  @Post()
  @Permissions(Permission.MANAGE_EXTERNAL_SECRETS)
  @ApiOperation({
    summary:
      'Crear un secret externo. Si viene `sourceDependencyId`, auto-resuelve la dep que originó la creación.',
  })
  create(@Body() dto: CreateExternalSecretDto, @CurrentUser() user: AuthenticatedUser) {
    return this.secrets.create(dto, user.sub);
  }

  @Delete(':id')
  @Permissions(Permission.MANAGE_EXTERNAL_SECRETS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un secret. Operación destructiva (frontend debe confirmar type-to-confirm).' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.secrets.delete(id);
  }
}
