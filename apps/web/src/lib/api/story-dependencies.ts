import { apiFetch } from './client';
import type { StoryTechnicalDependency } from '@cenzontle/shared';

export type {
  StoryTechnicalDependency,
  StoryTechnicalDependencyCategory,
  StoryTechnicalDependencySeverity,
  StoryTechnicalDependencySource,
  StoryTechnicalDependencyStatus,
} from '@cenzontle/shared';

export interface CreateStoryDependencyInput {
  title: string;
  description?: string;
  category: 'secrets' | 'apis' | 'testing' | 'services' | 'teams' | 'knowledge' | 'other';
  severity?: 'critical' | 'high' | 'medium' | 'low';
  source?: 'manual' | 'discovered';
  vendor?: string;
  requiresCredential?: boolean;
  linkedSecretId?: string;
  isBlocking?: boolean;
  targetExternalName?: string;
  targetEpicId?: string;
  status?: 'identified' | 'in_progress' | 'resolved' | 'blocked' | 'mitigated';
  owner?: string;
  dueDate?: string;
  resolutionNotes?: string;
  mdContent?: string;
}

export type UpdateStoryDependencyInput = Partial<CreateStoryDependencyInput>;

export function getStoryDependencies(storyId: string) {
  return apiFetch<StoryTechnicalDependency[]>(
    `/proyectos/historias/${storyId}/dependencies`,
  );
}

export function createStoryDependency(
  storyId: string,
  data: CreateStoryDependencyInput,
) {
  return apiFetch<StoryTechnicalDependency>(
    `/proyectos/historias/${storyId}/dependencies`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

export function updateStoryDependency(
  storyId: string,
  depId: string,
  data: UpdateStoryDependencyInput,
) {
  return apiFetch<StoryTechnicalDependency>(
    `/proyectos/historias/${storyId}/dependencies/${depId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
}

export function deleteStoryDependency(storyId: string, depId: string) {
  return apiFetch<void>(
    `/proyectos/historias/${storyId}/dependencies/${depId}`,
    { method: 'DELETE' },
  );
}

/** Roll-up: agrega las deps técnicas de TODAS las historias de un epic. */
export function getEpicDependenciesRollup(epicId: string) {
  return apiFetch<StoryTechnicalDependency[]>(
    `/proyectos/epicas/${epicId}/story-dependencies/rollup`,
  );
}
