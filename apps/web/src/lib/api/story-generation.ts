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

/**
 * Obtiene el estado actual de la sesión de generación incluyendo si hay
 * un agente corriendo en background. Devuelve null si no hay cache.
 *
 * Esta es la API para recovery — cuando el user recarga la página durante
 * un run activo, esta llamada devuelve los events parciales + isActive=true
 * para que la UI siga mostrando la cadena de pensamiento sin haber tenido
 * un SSE local activo.
 */
export async function getStorySession(
  epicId: string,
): Promise<{ session: import('@cenzontle/shared').CachedStoryGenerationSession; isActive: boolean } | null> {
  try {
    const data = await apiFetch<{
      session: import('@cenzontle/shared').CachedStoryGenerationSession | null;
      isActive: boolean;
    }>(`/proyectos/story-generation/${epicId}/session`);
    if (!data.session) return null;
    return { session: data.session, isActive: data.isActive };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Cancela el agente activo en el backend (abort + invalida cache).
 * Idempotente — si no hay run activo, retorna ok.
 */
export async function cancelStoryGeneration(epicId: string): Promise<void> {
  await apiFetch<{ cancelled: boolean }>(
    `/proyectos/story-generation/${epicId}/session/active`,
    { method: 'DELETE' },
  );
}
