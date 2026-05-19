import { Module } from '@nestjs/common';
import { FactoryAuthzService } from './factory-authz.service';

/**
 * Authz centralizada para operaciones de gestión del Factory.
 *
 * Módulo standalone — sin dependencias hacia otros módulos del Factory —
 * para que cualquier módulo pueda inyectarlo sin crear ciclos. En particular
 * resuelve el ciclo `FleetModule ↔ DodModule` que existía por causa de
 * `FleetService.assertCanManageFleet` (architecture-reviewer WARN 2026-05-13).
 */
@Module({
  providers: [FactoryAuthzService],
  exports: [FactoryAuthzService],
})
export class FactoryAuthzModule {}
