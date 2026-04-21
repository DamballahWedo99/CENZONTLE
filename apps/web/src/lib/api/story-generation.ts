import type { CachedStoryGenerationSession } from '@cenzontle/shared';
import { apiFetch, ApiError } from './client';

export async function getCachedStorySession(
  epicId: string,
): Promise<{ session: CachedStoryGenerationSession; remainingSeconds: number } | null> {
  try {
    return await apiFetch<{ session: CachedStoryGenerationSession; remainingSeconds: number }>(
      `/proyectos/story-generation/${epicId}/cache`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getStoryCacheTtl(epicId: string): Promise<number> {
  try {
    const data = await apiFetch<{ remainingSeconds: number }>(
      `/proyectos/story-generation/${epicId}/cache/ttl`,
    );
    return data.remainingSeconds;
  } catch {
    return -1;
  }
}

export async function invalidateStoryCache(epicId: string): Promise<void> {
  await apiFetch<void>(`/proyectos/story-generation/${epicId}/cache`, { method: 'DELETE' });
}

export async function removeCachedStoryProposal(epicId: string, clientId: string): Promise<void> {
  await apiFetch<void>(
    `/proyectos/story-generation/${epicId}/cache/proposals/${clientId}`,
    { method: 'DELETE' },
  );
}
