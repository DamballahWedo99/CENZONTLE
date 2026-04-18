import type { CachedGenerationSession } from '@cenzontle/shared';
import { apiFetch } from './client';
import { ApiError } from './client';

export async function getCachedSession(
  initiativeId: string,
): Promise<{ session: CachedGenerationSession; remainingSeconds: number } | null> {
  try {
    return await apiFetch<{ session: CachedGenerationSession; remainingSeconds: number }>(
      `/proyectos/epic-generation/${initiativeId}/cache`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getCacheTtl(initiativeId: string): Promise<number> {
  try {
    const data = await apiFetch<{ remainingSeconds: number }>(
      `/proyectos/epic-generation/${initiativeId}/cache/ttl`,
    );
    return data.remainingSeconds;
  } catch {
    return -1;
  }
}

export async function invalidateCache(initiativeId: string): Promise<void> {
  await apiFetch<void>(`/proyectos/epic-generation/${initiativeId}/cache`, {
    method: 'DELETE',
  });
}

export async function removeCachedProposal(
  initiativeId: string,
  clientId: string,
): Promise<void> {
  await apiFetch<void>(
    `/proyectos/epic-generation/${initiativeId}/cache/proposals/${clientId}`,
    { method: 'DELETE' },
  );
}
