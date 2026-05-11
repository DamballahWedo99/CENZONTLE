import { Module } from '@nestjs/common';
import { ExecutionRouterService } from './execution-router.service';

/**
 * ExecutionModule — abstracción de "dónde correr el trabajo del Forge".
 *
 * Hoy expone solo `ExecutionRouterService`. Sprint 3+ podría exponer
 * factories tipo `ExecutionStrategy` (LocalTmux vs RemoteWorker) si la
 * polimorphia se vuelve necesaria.
 */
@Module({
  providers: [ExecutionRouterService],
  exports: [ExecutionRouterService],
})
export class ExecutionModule {}
