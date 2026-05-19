import { Module } from '@nestjs/common';
import { BranchStrategyController } from './branch-strategy.controller';
import { BranchStrategyService } from './branch-strategy.service';
import { FleetModule } from '../fleet/fleet.module';
import { GitHubModule } from '../github/github.module';
import { AuthModule } from '../../auth/auth.module';

/**
 * BranchStrategyModule — singleton config del modelo de branches del Forge.
 *
 * Imports:
 *  - `FleetModule`: reusa `FleetService.assertCanManageFleet` (control de
 *    acceso compartido: solo Alta Gerencia puede tocar config de branches).
 *  - `GitHubModule`: para `validateGitState` y `alignDevWithMain` — ambas
 *    tocan el remote (verifica branches, force-update de dev).
 *  - `AuthModule`: para `assertPasswordValid` (step-up auth en alineamiento).
 *
 * Exporta `BranchStrategyService` para que `GitHubService` y otros consumers
 * (FactoryQueueService) puedan leer la config al crear integration branches.
 */
@Module({
  imports: [FleetModule, GitHubModule, AuthModule],
  controllers: [BranchStrategyController],
  providers: [BranchStrategyService],
  exports: [BranchStrategyService],
})
export class BranchStrategyModule {}
