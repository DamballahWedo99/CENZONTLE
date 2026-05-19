import { Module } from '@nestjs/common';
import { DodController } from './dod.controller';
import { DodService } from './dod.service';
import { FactoryAuthzModule } from '../authz/factory-authz.module';

/**
 * DodModule — catálogo global de criterios de Definition of Done.
 *
 * Importa FactoryAuthzModule para que DodController inyecte FactoryAuthzService
 * (autorización Alta Gerencia). Ya NO importa FleetModule — antes lo hacía
 * vía forwardRef solo para reusar assertCanManageFleet, creando un ciclo
 * con FleetModule (que importa DodModule para que AgentRunService inyecte
 * DodService al construir el prompt). Architecture-reviewer WARN 2026-05-13
 * apuntó el ciclo; el fix extrajo el método de autorización a su propio
 * módulo, dejando la dependencia DodModule → FactoryAuthzModule unidireccional
 * y permitiendo a FleetModule → DodModule ser un import simple sin forwardRef.
 *
 * Exporta `DodService` para que AgentRunService (en FleetModule) pueda
 * leer los criterios al construir el prompt.
 */
@Module({
  imports: [FactoryAuthzModule],
  controllers: [DodController],
  providers: [DodService],
  exports: [DodService],
})
export class DodModule {}
