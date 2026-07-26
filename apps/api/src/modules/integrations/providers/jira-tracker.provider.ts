import { NotImplementedException } from '@nestjs/common';
import type {
  TrackerProvider,
  TestConnectionResult,
  PublishEpicResult,
  PublishStoryRelationsResult,
} from './tracker-provider.interface';
import type { TrackerReference } from '@cenzontle/shared';

const NOT_IMPL_MSG =
  'La integración Jira aún no está implementada. Solo Linear está disponible.';

/**
 * Stub: cada método lanza de inmediato, así que ninguno declara parámetros.
 * El contrato de entrada lo sigue imponiendo `implements TrackerProvider` —
 * TypeScript permite implementar con aridad menor, y omitirlos evita
 * parámetros muertos. Al implementar Jira de verdad, se re-declaran aquí.
 */
export class JiraTrackerProvider implements TrackerProvider {
  readonly providerName = 'jira' as const;

  async testConnection(): Promise<TestConnectionResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishInitiative(): Promise<TrackerReference> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishEpic(): Promise<PublishEpicResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishStory(): Promise<TrackerReference> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }

  async publishStoryRelations(): Promise<PublishStoryRelationsResult> {
    throw new NotImplementedException(NOT_IMPL_MSG);
  }
}
