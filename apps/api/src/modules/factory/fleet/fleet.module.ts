import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FleetController } from './fleet.controller';
import { WorkerApiController } from './worker-api.controller';
import { FleetService } from './fleet.service';
import { FleetSweeperService } from './fleet-sweeper.service';
import { WorkerTokenService } from './worker-token.service';
import { WorkerAuthGuard } from './worker-auth.guard';
import { AgentRunService } from './agent-run.service';
import { OrgAnthropicConfigModule } from '../../org-anthropic-config/org-anthropic-config.module';
import { ForgePromptBuilderService } from './forge-prompt-builder.service';
import { ConflictResolverService } from './conflict-resolver.service';
import { ForgePlannerService } from './forge-planner.service';
import { ProyectosModule } from '../../proyectos/proyectos.module';
import { VaultModule } from '../../vault/vault.module';
import { GitHubModule } from '../github/github.module';
import { DodModule } from '../dod/dod.module';
import { FactoryAuthzModule } from '../authz/factory-authz.module';
import { ExternalSecretsModule } from '../../external-secrets/external-secrets.module';

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
 *  - DodModule → AgentRunService inyecta DoD criteria al prompt del agente.
 *    Antes era forwardRef por ciclo con DodModule.assertCanManageFleet;
 *    ahora dependencia simple porque DodModule importa FactoryAuthzModule
 *    en su lugar (architecture-reviewer fix 2026-05-13).
 *  - FactoryAuthzModule → FleetService delega assertCanManageFleet aquí
 *    (callers existentes mantienen `this.fleet.assertCanManageFleet(user)`).
 *  - ExternalSecretsModule → AgentRunService inyecta ExternalSecretsService
 *    para desencriptar los secrets del org (getAllPlaintext) y forwardearlos
 *    al worker en cada claim-story. Sin ciclo: ExternalSecretsModule solo
 *    importa PrismaModule + VaultModule.
 *  - ScheduleModule.forRoot → habilita @Cron decorators (FleetSweeperService)
 */
@Module({
  imports: [
    ProyectosModule,
    VaultModule,
    GitHubModule,
    DodModule,
    FactoryAuthzModule,
    ExternalSecretsModule,
    OrgAnthropicConfigModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [FleetController, WorkerApiController],
  providers: [
    FleetService,
    FleetSweeperService,
    WorkerTokenService,
    WorkerAuthGuard,
    AgentRunService,
    ForgePromptBuilderService,
    ConflictResolverService,
    ForgePlannerService,
  ],
  exports: [
    FleetService,
    WorkerTokenService,
    AgentRunService,
    // Re-export del módulo (no del service directo) — patrón NestJS correcto
    // para re-exportar providers de módulos importados. Consumers que importen
    // FleetModule reciben OrgAnthropicConfigService transitivamente.
    OrgAnthropicConfigModule,
    ForgePromptBuilderService,
    ConflictResolverService,
    ForgePlannerService,
  ],
})
export class FleetModule {}
