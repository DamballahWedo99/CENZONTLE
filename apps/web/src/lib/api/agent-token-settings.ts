import type { AgentTokenSettings } from '@cenzontle/shared';
import { apiFetch } from './client';

const LOG_PREFIX = '[ForgeWorker UI]';

/**
 * Lee la configuración singleton de tokens (thinking + max_tokens) por agente IA.
 * Disponible para cualquier usuario autenticado — la UI de settings lo usa
 * para mostrar valores actuales.
 *
 * Solo loggeamos errores — el success path es visible en DevTools Network
 * tab sin necesidad de console.log adicional (cleanup 2026-05-19).
 */
export async function getAgentTokenSettings(): Promise<AgentTokenSettings> {
  try {
    return await apiFetch<AgentTokenSettings>('/agent-token-settings');
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /agent-token-settings — FAILED`, err);
    throw err;
  }
}

/**
 * Update parcial de uno o más campos. Requiere `MANAGE_AGENT_TOKENS`
 * (solo Alta Gerencia). El backend valida bounds (thinking 1024-32K,
 * max_tokens 4K-64K) y la relación cruzada `max_tokens > thinking`.
 *
 * Logs estructurados habilitados: muestra el patch ENVIADO al backend y la
 * RESPUESTA recibida. Útil para detectar:
 *   - Si el patch tiene los campos correctos (UI bug → estado local mal)
 *   - Si el backend descarta algún valor (DTO validation, defense in depth)
 *   - Latencia de la request (debugging perf)
 */
export async function updateAgentTokenSettings(
  patch: Partial<Omit<AgentTokenSettings, 'updatedAt' | 'updatedBy'>>,
): Promise<AgentTokenSettings> {
  const { forgeWorkerModel, forgeWorkerEffort } = patch;
  try {
    const result = await apiFetch<AgentTokenSettings>('/agent-token-settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    // Defense check: si el backend NO devuelve los mismos valores que
    // mandamos, hay desync. Único log valioso del success path — DevTools
    // Network tab no muestra esta correlación. (cleanup 2026-05-19)
    const driftModel = forgeWorkerModel !== undefined && forgeWorkerModel !== result.forgeWorkerModel;
    const driftEffort = forgeWorkerEffort !== undefined && forgeWorkerEffort !== result.forgeWorkerEffort;
    if (driftModel || driftEffort) {
      console.warn(
        `${LOG_PREFIX} PATCH response DIFFERS from request — backend overrode value(s):`,
        {
          requested: { forgeWorkerModel, forgeWorkerEffort },
          applied: {
            forgeWorkerModel: result.forgeWorkerModel,
            forgeWorkerEffort: result.forgeWorkerEffort,
          },
        },
      );
    }
    return result;
  } catch (err) {
    console.error(`${LOG_PREFIX} PATCH /agent-token-settings — FAILED`, err);
    throw err;
  }
}
