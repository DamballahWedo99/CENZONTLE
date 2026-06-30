import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { OrgAnthropicConfigModule } from '../../org-anthropic-config/org-anthropic-config.module';
import { AuthModule } from '../../auth/auth.module';
import { QaController } from './qa.controller';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { QaSweepService } from './qa-sweep.service';
import { QaWorkspaceService } from './qa-workspace.service';
import { QaLensRunnerService } from './qa-lens-runner.service';
import { QaVerifierService } from './qa-verifier.service';
import { QaSynthesizerService } from './qa-synthesizer.service';
import { QaGateService } from './qa-gate.service';
import { QaReadService } from './qa-read.service';

/**
 * QaModule — pipeline de QA automático multi-agente del Forge.
 *
 * Imports (todos módulos hoja/neutros — sin ciclo):
 *  - GitHubModule           → QaWorkspaceService usa getCloneUrl() para clonar.
 *  - OrgAnthropicConfigModule → lens runner / verifier / synthesizer construyen
 *    su cliente Anthropic con la API key org-scoped.
 *  - AuthModule             → QaGateService usa assertPasswordValid (step-up).
 *
 * PrismaService viene de @Global PrismaModule. ScheduleModule ya fue
 * forRoot'd por FleetModule, así que los @Cron de QaSweepService se descubren
 * globalmente. NO importa FleetModule (evita el riesgo de ciclo Fleet↔QA):
 * el devBranch se lee directo de Prisma (mismo patrón que agent-run.service).
 */
@Module({
  imports: [GitHubModule, OrgAnthropicConfigModule, AuthModule],
  controllers: [QaController],
  providers: [
    QaOrchestratorService,
    QaSweepService,
    QaWorkspaceService,
    QaLensRunnerService,
    QaVerifierService,
    QaSynthesizerService,
    QaGateService,
    QaReadService,
  ],
  exports: [QaReadService],
})
export class QaModule {}
