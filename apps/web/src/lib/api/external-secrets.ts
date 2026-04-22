import type { ExternalSecret, CreateExternalSecretInput } from '@cenzontle/shared';
import { apiFetch } from './client';

/**
 * Client API para credenciales externas. El valor plaintext NUNCA viaja
 * desde el backend — solo `maskedValue`. Para "rotar" un secret hoy el
 * flujo es delete + create (NICE-to-have: endpoint rotate separado).
 */

export function listExternalSecrets() {
  return apiFetch<ExternalSecret[]>('/external-secrets');
}

export function createExternalSecret(input: CreateExternalSecretInput) {
  return apiFetch<ExternalSecret>('/external-secrets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteExternalSecret(id: string) {
  return apiFetch<void>(`/external-secrets/${id}`, { method: 'DELETE' });
}
