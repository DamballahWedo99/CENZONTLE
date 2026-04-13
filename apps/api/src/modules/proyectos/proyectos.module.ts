import { Module } from '@nestjs/common';
import { PodsController } from './pods/pods.controller';
import { PodsService } from './pods/pods.service';
import { ProductOwnersController } from './product-owners/product-owners.controller';
import { ProductOwnersService } from './product-owners/product-owners.service';
import { InitiativesController } from './initiatives/initiatives.controller';
import { InitiativesService } from './initiatives/initiatives.service';
import { EpicsController } from './epics/epics.controller';
import { EpicsService } from './epics/epics.service';
import { StoriesController } from './stories/stories.controller';
import { StoriesService } from './stories/stories.service';
import { ChangelogController } from './changelog/changelog.controller';
import { ChangelogService } from './changelog/changelog.service';

@Module({
  controllers: [
    PodsController,
    ProductOwnersController,
    InitiativesController,
    EpicsController,
    StoriesController,
    ChangelogController,
  ],
  providers: [
    PodsService,
    ProductOwnersService,
    InitiativesService,
    EpicsService,
    StoriesService,
    ChangelogService,
  ],
  exports: [PodsService, ProductOwnersService, InitiativesService, EpicsService, StoriesService, ChangelogService],
})
export class ProyectosModule {}
