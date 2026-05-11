import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FleetController } from './fleet.controller';
import { WorkerApiController } from './worker-api.controller';
import { OrgAnthropicConfigController } from './org-anthropic-config.controller';
import { FleetService } from './fleet.service';
import { FleetSweeperService } from './fleet-sweeper.service';
import { WorkerTokenService } from './worker-token.service';
import { WorkerAuthGuard } from './worker-auth.guard';
import { AgentRunService } from './agent-run.service';
import { OrgAnthropicConfigService } from './org-anthropic-config.service';
import { ForgePromptBuilderService } from './forge-prompt-builder.service';
import { ProyectosModule } from '../../proyectos/proyectos.module';
import { VaultModule } from '../../vault/vault.module';
import { GitHubModule } from '../github/github.module';
import { DodModule } from '../dod/dod.module';

/**
 * FleetModule — gestión de la flota de cómputo del Forge.
 *
 * Imports:
 *  - ProyectosModule → reusa ChangelogService (audit trail de operaciones)
 *  - VaultModule → reusa CryptoService (encryption AES-256-GCM para
 *    OrgAnthropicConfig — la API key viaja al worker en cada claim-story)
 *  - GitHubModule → AgentRunService usa GitHubService para resolver clone
 *    URL, crear integration branches, y abrir PRs cuando el worker reporta
 *    prBranchPushed=true (HITOS 2/4/5)
 *  - ScheduleModule.forRoot → habilita @Cron decorators (FleetSweeperService)
 */
@Module({
  imports: [
    ProyectosModule,
    VaultModule,
    GitHubModule,
    // forwardRef rompe el ciclo: DodModule importa FleetModule (para
    // assertCanManageFleet del controller), y FleetModule necesita
    // DodService aquí para que AgentRunService inyecte DoD criteria al
    // prompt del agente. NestJS resuelve la dependencia post-init.
    forwardRef(() => DodModule),
    ScheduleModule.forRoot(),
  ],
  controllers: [FleetController, WorkerApiController, OrgAnthropicConfigController],
  providers: [
    FleetService,
    FleetSweeperService,
    WorkerTokenService,
    WorkerAuthGuard,
    AgentRunService,
    OrgAnthropicConfigService,
    ForgePromptBuilderService,
  ],
  exports: [
    FleetService,
    WorkerTokenService,
    AgentRunService,
    OrgAnthropicConfigService,
    ForgePromptBuilderService,
  ],
})
export class FleetModule {}
