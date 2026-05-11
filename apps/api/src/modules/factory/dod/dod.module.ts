import { Module, forwardRef } from '@nestjs/common';
import { DodController } from './dod.controller';
import { DodService } from './dod.service';
import { FleetModule } from '../fleet/fleet.module';

/**
 * DodModule — catálogo global de criterios de Definition of Done.
 *
 * Importa FleetModule (forwardRef) para reusar `FleetService.assertCanManageFleet`
 * en el controller. forwardRef rompe el ciclo con FleetModule, que a su vez
 * importa este módulo para que AgentRunService inyecte DoD criteria al
 * prompt del agente.
 *
 * Exporta `DodService` para que AgentRunService (en FleetModule) pueda
 * leer los criterios al construir el prompt.
 */
@Module({
  imports: [forwardRef(() => FleetModule)],
  controllers: [DodController],
  providers: [DodService],
  exports: [DodService],
})
export class DodModule {}
