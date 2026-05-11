/**
 * Convierte un UUID v4 (36 chars) en un identificador corto legible (8 chars)
 * tomando la primera sección antes del primer guión.
 *
 * Ejemplo: `5f3db0a3-f3f2-4eb8-ae35-e625952a31a1` → `5f3db0a3`
 *
 * Uso típico: mostrar como "key" de épicas/historias en columnas estrechas
 * cuando NO hay un tracker externo (Linear/Jira) que provea un key humano-
 * readable como `PAY-7817`. Antes mostrábamos `'—'` para no exponer IDs
 * internos cuando la integración con Linear era el plan; ahora que el flujo
 * pasa al Forge interno, el short ID es la representación canónica.
 *
 * No es criptográficamente único — colisiones son posibles en datasets muy
 * grandes (>100k items). Para esos casos, usar el UUID completo. Para vistas
 * de proyecto típicas (cientos de épicas/historias), 8 chars son suficientes.
 */
export function getShortId(id: string | undefined | null): string {
  if (!id) return '—';
  return id.split('-')[0];
}
