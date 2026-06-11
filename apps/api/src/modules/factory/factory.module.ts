import { Module } from "@nestjs/common";
import { FactoryController } from "./factory.controller";
import { FactoryService } from "./factory.service";
import { TerminalController } from "./terminal.controller";
import { TerminalService } from "./terminal.service";
import { FactoryQueueController } from "./queue/factory-queue.controller";
import { FactoryQueueService } from "./queue/factory-queue.service";
import { ForgePrsController } from "./prs/forge-prs.controller";
import { ForgePrsService } from "./prs/forge-prs.service";
import { FleetModule } from "./fleet/fleet.module";
import { ExecutionModule } from "./execution/execution.module";
import { BranchStrategyModule } from "./branch-strategy/branch-strategy.module";
import { GitHubModule } from "./github/github.module";
import { DodModule } from "./dod/dod.module";
import { PreviewModule } from "./preview/preview.module";
import { FactoryMetricsModule } from "./metrics/metrics.module";
import { ProyectosModule } from "../proyectos/proyectos.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [ProyectosModule, FleetModule, ExecutionModule, BranchStrategyModule, GitHubModule, DodModule, PreviewModule, FactoryMetricsModule, AuthModule],
  controllers: [FactoryController, TerminalController, FactoryQueueController, ForgePrsController],
  providers: [FactoryService, TerminalService, FactoryQueueService, ForgePrsService],
  exports: [FactoryService, TerminalService, FactoryQueueService],
})
export class FactoryModule {}
