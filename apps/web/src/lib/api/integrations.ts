import { apiFetch, ApiError } from './client';
import type {
  IntegrationProvider,
  TrackerReference,
  IntegrationConfigResponse,
  LinearConfig,
} from '@cenzontle/shared';

export type { IntegrationConfigResponse, LinearConfig };

export interface SaveLinearConfigInput {
  apiKey?: string;
  teamId: string;
  teamName: string;
  workspaceSlug: string;
  projectId?: string;
  projectName?: string;
}

export type TestLinearConnectionInput = SaveLinearConfigInput;

export interface TestLinearConnectionResponse {
  ok: boolean;
  error?: string;
  details?: { user?: string; workspace?: string };
  updatedAt?: string;
}

export interface PublishEpicResponse {
  alreadyPublished: boolean;
  initiativeTracker?: TrackerReference;
  initiativeAlreadyPublished?: boolean;
  epicTracker: TrackerReference;
  storyTrackers: Array<{ storyId: string; tracker: TrackerReference }>;
  partialFailures: Array<{ storyId: string; error: string }>;
}

export interface PublishStoryResponse {
  alreadyPublished: boolean;
  tracker: TrackerReference;
}

export interface PublishInitiativeResponse {
  alreadyPublished: boolean;
  tracker: TrackerReference;
}

export async function getLinearConfig(): Promise<IntegrationConfigResponse | null> {
  try {
    return await apiFetch<IntegrationConfigResponse>('/integrations/linear');
  } catch (err) {
    // 404 = sin configurar todavía, lo tratamos como ausencia legítima.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function saveLinearConfig(input: SaveLinearConfigInput) {
  return apiFetch<IntegrationConfigResponse>('/integrations/linear', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function testLinearConnection(input: TestLinearConnectionInput) {
  return apiFetch<TestLinearConnectionResponse>('/integrations/linear/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteIntegrationConfig(provider: IntegrationProvider) {
  return apiFetch<void>(`/integrations/${provider}`, { method: 'DELETE' });
}

export function publishInitiativeToTracker(
  initiativeId: string,
  provider: IntegrationProvider = 'linear',
) {
  return apiFetch<PublishInitiativeResponse>(
    `/proyectos/iniciativas/${initiativeId}/publish-to-tracker`,
    {
      method: 'POST',
      body: JSON.stringify({ provider }),
    },
  );
}

export function publishEpicToTracker(
  epicId: string,
  provider: IntegrationProvider = 'linear',
) {
  return apiFetch<PublishEpicResponse>(`/proyectos/epicas/${epicId}/publish-to-tracker`, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export function publishStoryToTracker(
  storyId: string,
  provider: IntegrationProvider = 'linear',
) {
  return apiFetch<PublishStoryResponse>(
    `/proyectos/historias/${storyId}/publish-to-tracker`,
    {
      method: 'POST',
      body: JSON.stringify({ provider }),
    },
  );
}
