import { Module } from '@nestjs/common';
import { PodsController } from './pods/pods.controller';
import { PodsService } from './pods/pods.service';
import { InitiativesController } from './initiatives/initiatives.controller';
import { InitiativesService } from './initiatives/initiatives.service';
import { EpicsController } from './epics/epics.controller';
import { EpicsService } from './epics/epics.service';
import { DesignBundleService } from './epics/design-bundle.service';
import { StoriesController } from './stories/stories.controller';
import { StoriesService } from './stories/stories.service';
import { StoryDependenciesController } from './stories/dependencies/story-dependencies.controller';
import { StoryDependenciesRollupController } from './stories/dependencies/story-dependencies-rollup.controller';
import { StoryDependenciesService } from './stories/dependencies/story-dependencies.service';
import { ChangelogController } from './changelog/changelog.controller';
import { ChangelogService } from './changelog/changelog.service';
import { AgentToolsModule } from '../factory/agent-tools/agent-tools.module';
import { CodeRepositoriesModule } from '../code-repositories/code-repositories.module';
import { DocumentsModule } from '../documents/documents.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';
import { OrgAnthropicConfigModule } from '../org-anthropic-config/org-anthropic-config.module';
import { EpicGenerationController } from './epics/generation/epic-generation.controller';
import { EpicGenerationService } from './epics/generation/epic-generation.service';
import { ProposalCacheService } from './epics/generation/proposal-cache.service';
import { ExecutiveSummaryController } from './initiatives/executive-summary/executive-summary.controller';
import { ExecutiveSummaryService } from './initiatives/executive-summary/executive-summary.service';
import { StoryGenerationController } from './stories/generation/story-generation.controller';
import { StoryGenerationService } from './stories/generation/story-generation.service';
import { StoryProposalCacheService } from './stories/generation/story-proposal-cache.service';
import { DiagramGenerationController } from './diagrams/generation/diagram-generation.controller';
import { DiagramGenerationService } from './diagrams/generation/diagram-generation.service';
import { DiagramCacheService } from './diagrams/generation/diagram-cache.service';
import { DiagramSessionCacheService } from './diagrams/generation/diagram-session-cache.service';
import { VaultMigrationController } from './migration/vault-migration.controller';
import { VaultMigrationService } from './migration/vault-migration.service';
import { AssistantChatController } from './assistant/assistant-chat.controller';
import { AssistantChatService } from './assistant/assistant-chat.service';
import { AssistantSessionService } from './assistant/assistant-session.service';

@Module({
  imports: [
    AgentToolsModule,
    CodeRepositoriesModule,
    DocumentsModule,
    IntegrationsModule,
    AuthModule,
    OrgAnthropicConfigModule,
  ],
  controllers: [
    PodsController,
    EpicGenerationController, // Must register before InitiativesController (same prefix, more specific route)
    ExecutiveSummaryController, // Sin conflicto de prefijo con InitiativesController — agrupado aquí junto a los demás agentes SSE
    StoryGenerationController, // Must register before StoriesController (prefix /proyectos/story-generation vs /proyectos/historias)
    DiagramGenerationController, // Must register before EpicsController (prefix /proyectos/diagrams-generation vs /proyectos/epicas)
    VaultMigrationController, // Admin endpoint: POST /admin/vault/migration/run
    InitiativesController,
    StoryDependenciesRollupController, // Must register before EpicsController (prefix /proyectos/epicas/:epicId/story-dependencies vs /proyectos/epicas/:id)
    EpicsController,
    StoriesController,
    StoryDependenciesController,
    ChangelogController,
    AssistantChatController, // Prefijo propio /proyectos/assistant-chat — sin colisión con :id catch-alls
  ],
  providers: [
    PodsService,
    InitiativesService,
    EpicsService,
    DesignBundleService,
    EpicGenerationService,
    ProposalCacheService,
    ExecutiveSummaryService,
    DiagramGenerationService,
    DiagramCacheService,
    DiagramSessionCacheService,
    StoriesService,
    StoryDependenciesService,
    StoryGenerationService,
    StoryProposalCacheService,
    VaultMigrationService,
    ChangelogService,
    AssistantChatService,
    AssistantSessionService,
  ],
  exports: [PodsService, InitiativesService, EpicsService, StoriesService, StoryDependenciesService, ChangelogService],
})
export class ProyectosModule {}
