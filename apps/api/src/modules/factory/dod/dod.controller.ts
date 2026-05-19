import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser } from '@cenzontle/shared';
import { CurrentUser } from '../../auth/decorators';
import { FactoryAuthzService } from '../authz/factory-authz.service';
import { DodService } from './dod.service';
import { UpsertDodCriteriaDto } from './dto/upsert-dod-criteria.dto';

/**
 * Endpoints HUMANOS para gestión del catálogo de Definition of Done.
 * Usa `FactoryAuthzService.assertCanManageFleet` porque editar el DoD es
 * decisión de alta gerencia (afecta el cierre de TODAS las stories del
 * Forge, mismo nivel que pausar el Forge).
 *
 *  - `GET  /factory/dod/criteria` → lista actual ordenada por position
 *  - `PUT  /factory/dod/criteria` → reemplaza la lista entera (replace-all)
 *
 * El `terminal/page.tsx` también usa `GET` para derivar el DoD del run
 * dinámicamente (en lugar del array hardcoded que tenía antes).
 *
 * Refactor (architecture-reviewer 2026-05-13): antes inyectaba FleetService
 * con import via forwardRef(() => FleetModule) — ciclo DodModule↔FleetModule.
 * Ahora inyecta FactoryAuthzService desde su propio módulo independiente.
 */
@ApiTags('Factory DoD')
@Controller('factory/dod/criteria')
export class DodController {
  constructor(
    private readonly authz: FactoryAuthzService,
    private readonly service: DodService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Devuelve los criterios de Definition of Done ordenados por position. Incluye también los disabled (la UI los pinta grayed-out).',
  })
  async list(@CurrentUser() user: AuthenticatedUser) {
    this.authz.assertCanManageFleet(user);
    return this.service.findAll();
  }

  @Put()
  @ApiOperation({
    summary:
      'Reemplaza la lista entera de criterios. El operador edita en UI (drag/toggle/agregar/quitar) y guarda — backend hace replace-all en transacción.',
  })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertDodCriteriaDto,
  ) {
    this.authz.assertCanManageFleet(user);
    return this.service.replaceAll(dto, user.email);
  }

  @Post('reset-defaults')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Restaura los criterios estándar al estado canónico (text + description originales). PISA cualquier edición que el operador haya hecho a los criterios con `kind` set. Los custom (kind=null) NO se tocan — sobreviven y se reordenan al final.',
  })
  async resetDefaults(@CurrentUser() user: AuthenticatedUser) {
    this.authz.assertCanManageFleet(user);
    return this.service.resetDefaults(user.email);
  }
}
