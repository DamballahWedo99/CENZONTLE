/**
 * Algoritmos de grafo sobre el DAG de `ProposedStory.blockedBy`. Función pura
 * extraída para testing aislado del componente EpicFullPage (que tiene
 * demasiadas dependencias de React/Context/Next.js para un test unitario
 * sensato).
 */

import type { ProposedStory } from '@cenzontle/shared';

/**
 * Orden topológico de propuestas por su DAG de `blockedBy` usando Kahn's
 * algorithm (BFS con in-degree). Garantiza que las bloqueantes aparezcan
 * ANTES que las bloqueadas en el array resultado — crítico para que
 * `handleAcceptAllStories` las acepte en orden correcto y el backend pueda
 * resolver `clientId → storyId` al persistir `StoryDependency`.
 *
 * Edge cases:
 *  - Edges a historias FUERA del batch (ya aceptadas o inexistentes) se
 *    ignoran — no cuentan para el in-degree, evitando bloqueo artificial.
 *  - Ciclo residual (no debería pasar si el backend valida, pero defensivo):
 *    las historias involucradas en el ciclo se agregan al final en su orden
 *    original. Mejor emitirlas que perderlas silenciosamente.
 */
export function topologicalSortProposals(proposals: ProposedStory[]): ProposedStory[] {
  const clientIds = new Set(proposals.map((p) => p.clientId));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const p of proposals) {
    inDegree.set(p.clientId, 0);
  }
  for (const p of proposals) {
    for (const edge of p.blockedBy ?? []) {
      if (!clientIds.has(edge.storyClientId)) continue;
      inDegree.set(p.clientId, (inDegree.get(p.clientId) ?? 0) + 1);
      const arr = dependents.get(edge.storyClientId) ?? [];
      arr.push(p.clientId);
      dependents.set(edge.storyClientId, arr);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  const byId = new Map(proposals.map((p) => [p.clientId, p]));
  const result: ProposedStory[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const p = byId.get(id);
    if (p) result.push(p);
    for (const next of dependents.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (result.length < proposals.length) {
    for (const p of proposals) {
      if (!result.includes(p)) result.push(p);
    }
  }
  return result;
}
