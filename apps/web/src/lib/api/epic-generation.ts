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

/**
 * Cancela el run de generación activo en el backend (aborta el agente Anthropic
 * y limpia el cache). Idempotente: si no hay run activo, igual limpia el cache.
 *
 * El frontend lo llama desde `handleCancelAgent` para que cuando el user da
 * click en "Cancelar", el agente se detenga inmediatamente — no solo el SSE
 * local. Sin esto, el agente seguiría corriendo en background hasta el
 * timeout server-side de 10min.
 */
export async function cancelEpicGeneration(initiativeId: string): Promise<void> {
  await apiFetch<{ ok: boolean; hadActiveRun: boolean }>(
    `/proyectos/epic-generation/${initiativeId}/active`,
    { method: 'DELETE' },
  );
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
