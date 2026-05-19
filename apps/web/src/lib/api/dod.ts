import { apiFetch } from './client';

/**
 * Catálogo global de criterios de Definition of Done. Reemplaza el array
 * hardcoded `DEFAULT_DOD_CRITERIA` que vivía en el frontend.
 *
 * Endpoints (solo Alta Gerencia, BFF prefix `/api`):
 *   GET  /api/factory/dod/criteria   → lista
 *   PUT  /api/factory/dod/criteria   → replace-all
 */
export interface DodCriterion {
  id: string;
  /** Identificador estable para mapping determinístico de evaluación.
   *  Solo aplica a criterios estándar; custom = null. */
  kind: string | null;
  text: string;
  /** Descripción larga que se inyecta en el prompt del agente.
   *  REQUERIDA — todos los criterios del DoD deben tenerla. */
  description: string;
  position: number;
}

export interface DodCriterionInput {
  kind?: string | null;
  text: string;
  description: string;
  position: number;
}

export async function listDodCriteria(): Promise<DodCriterion[]> {
  return apiFetch<DodCriterion[]>('/factory/dod/criteria', { method: 'GET' });
}

export async function upsertDodCriteria(criteria: DodCriterionInput[]): Promise<DodCriterion[]> {
  return apiFetch<DodCriterion[]>('/factory/dod/criteria', {
    method: 'PUT',
    body: JSON.stringify({ criteria }),
  });
}

/**
 * Restaura los criterios estándar al estado canónico. Pisa los que el
 * operador haya editado; preserva los custom (kind=null). Devuelve la
 * lista resultante completa para que el caller actualice su state.
 */
export async function resetDodCriteriaDefaults(): Promise<DodCriterion[]> {
  return apiFetch<DodCriterion[]>('/factory/dod/criteria/reset-defaults', {
    method: 'POST',
  });
}
