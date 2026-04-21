import { Module } from '@nestjs/common';
import { PodsController } from './pods/pods.controller';
import { PodsService } from './pods/pods.service';
import { InitiativesController } from './initiatives/initiatives.controller';
import { InitiativesService } from './initiatives/initiatives.service';
import { EpicsController } from './epics/epics.controller';
import { EpicsService } from './epics/epics.service';
import { StoriesController } from './stories/stories.controller';
import { StoriesService } from './stories/stories.service';
import { ChangelogController } from './changelog/changelog.controller';
import { ChangelogService } from './changelog/changelog.service';
import { AgentToolsModule } from '../factory/agent-tools/agent-tools.module';
import { CodeRepositoriesModule } from '../code-repositories/code-repositories.module';
import { EpicGenerationController } from './epics/generation/epic-generation.controller';
import { EpicGenerationService } from './epics/generation/epic-generation.service';
import { ProposalCacheService } from './epics/generation/proposal-cache.service';
import { StoryGenerationController } from './stories/generation/story-generation.controller';
import { StoryGenerationService } from './stories/generation/story-generation.service';
import { StoryProposalCacheService } from './stories/generation/story-proposal-cache.service';
import { DiagramGenerationController } from './diagrams/generation/diagram-generation.controller';
import { DiagramGenerationService } from './diagrams/generation/diagram-generation.service';
import { DiagramCacheService } from './diagrams/generation/diagram-cache.service';
import { VaultMigrationController } from './migration/vault-migration.controller';
import { VaultMigrationService } from './migration/vault-migration.service';

@Module({
  imports: [AgentToolsModule, CodeRepositoriesModule],
  controllers: [
    PodsController,
    EpicGenerationController, // Must register before InitiativesController (same prefix, more specific route)
    StoryGenerationController, // Must register before StoriesController (prefix /proyectos/story-generation vs /proyectos/historias)
    DiagramGenerationController, // Must register before EpicsController (prefix /proyectos/diagrams-generation vs /proyectos/epicas)
    VaultMigrationController, // Admin endpoint: POST /admin/vault/migration/run
    InitiativesController,
    EpicsController,
    StoriesController,
    ChangelogController,
  ],
  providers: [
    PodsService,
    InitiativesService,
    EpicsService,
    EpicGenerationService,
    ProposalCacheService,
    DiagramGenerationService,
    DiagramCacheService,
    StoriesService,
    StoryGenerationService,
    StoryProposalCacheService,
    VaultMigrationService,
    ChangelogService,
  ],
  exports: [PodsService, InitiativesService, EpicsService, StoriesService, ChangelogService],
})
export class ProyectosModule {}
