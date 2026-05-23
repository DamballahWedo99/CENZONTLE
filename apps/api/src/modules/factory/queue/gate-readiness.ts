/**
 * Story statuses considerados TERMINALES para efectos del merge gate:
 *   - done       → completada con éxito
 *   - in_review  → PR abierto esperando merge humano
 *   - blocked    → run falló (doom loop / exit≠0) — escaló a humano
 *
 * NO terminales (el Forge aún tiene trabajo): backlog, todo, in_progress, qa.
 */
const TERMINAL_STORY_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'in_review',
  'blocked',
]);

/**
 * Un batch está "esperando al humano" (`awaitingHumanGate`) cuando TODAS sus
 * stories llegaron a un estado terminal. Mientras haya una sola story en
 * curso (claimed/running) o sin arrancar (backlog/todo/in_progress/qa), el
 * Forge sigue trabajando y el merge gate no debe renderizarse.
 *
 * Unifica la lógica que antes divergía entre `listQueue` (contaba
 * done+in_review) y `getBatchDetail` (contaba solo done) — bug 2026-05-19
 * que hacía aparecer/desaparecer el gate según qué endpoint pollease el
 * frontend. Incluir `blocked` es lo que permite que un batch con stories
 * fallidas alcance el gate (antes quedaba atascado para siempre).
 *
 * Un batch vacío (0 stories) NO está esperando al humano — devuelve false
 * para evitar el `0 === 0` trivially-true del caso degenerado.
 */
export function isAwaitingHumanGate(
  storyStatuses: ReadonlyArray<string>,
): boolean {
  if (storyStatuses.length === 0) return false;
  return storyStatuses.every((s) => TERMINAL_STORY_STATUSES.has(s));
}
