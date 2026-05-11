import { Module } from '@nestjs/common';
import { BranchStrategyController } from './branch-strategy.controller';
import { BranchStrategyService } from './branch-strategy.service';
import { FleetModule } from '../fleet/fleet.module';

/**
 * BranchStrategyModule — singleton config del modelo de branches del Forge.
 *
 * Importa `FleetModule` para reusar `FleetService.assertCanManageFleet`
 * (control de acceso compartido: solo Alta Gerencia puede tocar config
 * de fleet/branches).
 *
 * Exporta `BranchStrategyService` para que `GitHubService` (Sprint 4
 * Fase 2) pueda leer la config al crear integration branches.
 */
@Module({
  imports: [FleetModule],
  controllers: [BranchStrategyController],
  providers: [BranchStrategyService],
  exports: [BranchStrategyService],
})
export class BranchStrategyModule {}
