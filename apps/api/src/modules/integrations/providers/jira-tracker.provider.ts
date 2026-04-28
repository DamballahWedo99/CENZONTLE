import { NotImplementedException } from '@nestjs/common';
import type {
  TrackerProvider,
  TestConnectionResult,
  PublishEpicResult,
  EpicPayload,
  InitiativePayload,
  StoryPayload,
  StoryHardEdge,
  PublishStoryRelationsResult,
} from './tracker-provider.interface';
import type { TrackerReference } from '@cenzontle/shared';

const NOT_IMPL_MSG =
  'La integración Jira aún no está implementada. Solo Linear está disponible.';

export class JiraTrackerProvider implements TrackerProvider {
  readonly providerName = 'jira' as const;

  async testConnection(): Promise<TestConnectionResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishInitiative(_initiative: InitiativePayload): Promise<TrackerReference> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishEpic(
    _epic: EpicPayload,
    _opts?: { initiativeExternalId?: string },
  ): Promise<PublishEpicResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishStory(
    _story: StoryPayload,
    _opts: { projectExternalId: string },
  ): Promise<TrackerReference> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishStoryRelations(
    _edges: StoryHardEdge[],
  ): Promise<PublishStoryRelationsResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }
}
