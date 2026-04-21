import { Controller, Logger, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import type { AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser, Permissions } from '../../auth/decorators';
import { sanitizeForLog } from '../../../common/utils/sanitize-llm-input.util';
import { VaultMigrationService, MigrationReport } from './vault-migration.service';

/**
 * Endpoint de administración para ejecutar la migración big-bang del vault
 * al formato anidado bajo `iniciativas/`.
 *
 * Protegido con el permiso más alto disponible (MANAGE_USERS).
 * Diseñado para uso único o idempotente — se puede correr múltiples veces
 * de forma segura, las entidades ya migradas son skipeadas.
 *
 * El user que ejecuta se loggea para auditoria (quien disparo la migracion
 * y cuando). No se usa para filtrar — la migracion siempre es global.
 */
@ApiTags('Admin — Vault Migration')
@Controller('admin/vault/migration')
export class VaultMigrationController {
  private readonly logger = new Logger(VaultMigrationController.name);

  constructor(private readonly migration: VaultMigrationService) {}

  @Post('run')
  @Permissions(Permission.MANAGE_USERS)
  @ApiOperation({
    summary: 'Ejecutar migración big-bang del vault al formato anidado',
    description:
      'Migra todas las initiatives, epics y stories del formato legacy (flat) al formato ' +
      'anidado bajo iniciativas/. Operación idempotente: las entidades ya migradas son skipeadas. ' +
      'Retorna un reporte con conteos de éxito/skip/error por tipo de entidad. ' +
      'Responde 409 Conflict si ya hay una migración en ejecución.',
  })
  async run(@CurrentUser() user: AuthenticatedUser): Promise<MigrationReport> {
    this.logger.log(
      `[VaultMigration] ejecutada por user=${sanitizeForLog(user.sub)} email=${sanitizeForLog(user.email ?? 'unknown')}`,
    );
    return this.migration.migrateAll(user.sub);
  }
}
