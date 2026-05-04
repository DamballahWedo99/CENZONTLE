import type { AgentTokenSettings } from '@cenzontle/shared';
import { apiFetch } from './client';

/**
 * Lee la configuración singleton de tokens (thinking + max_tokens) por agente IA.
 * Disponible para cualquier usuario autenticado — la UI de settings lo usa
 * para mostrar valores actuales.
 */
export function getAgentTokenSettings(): Promise<AgentTokenSettings> {
  return apiFetch<AgentTokenSettings>('/agent-token-settings');
}

/**
 * Update parcial de uno o más campos. Requiere `MANAGE_AGENT_TOKENS`
 * (solo Alta Gerencia). El backend valida bounds (thinking 1024-32K,
 * max_tokens 4K-64K) y la relación cruzada `max_tokens > thinking`.
 */
export function updateAgentTokenSettings(
  patch: Partial<Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'>>,
): Promise<AgentTokenSettings> {
  return apiFetch<AgentTokenSettings>('/agent-token-settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
