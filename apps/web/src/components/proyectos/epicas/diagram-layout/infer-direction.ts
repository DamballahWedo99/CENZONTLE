import type { DiagramEdge, DiagramNode } from '@cenzontle/shared';

export type LayoutDirection = 'TB' | 'LR';

/**
 * BFS con visited-guard desde roots para calcular la profundidad topológica
 * de cada nodo. Cada nodo entra a la queue EXACTAMENTE una vez (la primera =
 * menor depth), evitando loops infinitos en grafos con ciclos.
 *
 * Retorna un Map nodeId → depth. Si el grafo es puramente cíclico (no hay
 * roots con inDegree=0) retorna un mapa vacío — el caller debe tener un
 * fallback para nodos sin entry (ej: `depthById.get(n.id) ?? 999`).
 *
 * Extraído de `inferLayoutDirection` para poder reusarlo en sort topológico
 * pre-ELK (ver `useGroupedLayout.ts`). La heurística de dirección sigue
 * consumiendo este helper y después aplica sus umbrales.
 */
export function computeNodeDepths(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): Map<string, number> {
  const depthById = new Map<string, number>();
  if (nodes.length === 0) return depthById;

  const incoming = new Map<string, number>();
  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) {
    // Self-loops NO cuentan para inDegree — mismo guard que el backend
    // (computeNodeDepths en diagram-generation.service.ts). Sin esto, un
    // nodo con retry-loop A→A se excluye de roots, obtiene depth=undefined,
    // y todos los edges que lo tocan caen a distance=0 en insertJumpConnectors
    // — edges largos dejan de partirse en jump connectors (falso negativo).
    if (edge.source === edge.target) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  if (roots.length === 0) return depthById; // grafo cíclico — sin roots

  const queue: string[] = [];
  for (const r of roots) {
    depthById.set(r.id, 0);
    queue.push(r.id);
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    // Self-loops tampoco propagan (no aportan info de profundidad).
    if (edge.source === edge.target) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // BFS clásico con visited-guard: cada nodo entra a la queue EXACTAMENTE una
  // vez (la primera = menor depth), evitando loops infinitos en grafos con
  // ciclos. El check anterior (`prev < d + 1`) se disparaba perpetuamente en
  // un ciclo porque la depth seguía creciendo cada vuelta, crasheando el
  // render con un freeze del tab.
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depthById.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if (depthById.has(next)) continue; // ya visitado: ignora back-edges / cycles
      depthById.set(next, d + 1);
      queue.push(next);
    }
  }

  return depthById;
}

/**
 * Heurística pura para decidir TB vs LR según la forma del grafo.
 *
 * Default invertido (post-fix de calidad): la mayoría de flowcharts de
 * arquitectura se leen mejor LEFT-TO-RIGHT (frontend → backend → datos),
 * siguiendo la convención del diagrama de referencia del user. Mantenemos
 * TB solo para el caso específico de "pirámide invertida" (muchos nodos
 * paralelos con poca profundidad), donde LR forzaría ramas extremadamente
 * altas visualmente.
 *
 * Umbrales:
 *   - `maxDepth <= 3 && maxWidth >= 5`: pirámide ancha y baja → TB.
 *   - Todo lo demás: LR (incluye grafos lineales, branching típico,
 *     y el caso de "Roles personalizados" del user).
 */
export function inferLayoutDirection(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): LayoutDirection {
  if (nodes.length === 0) return 'LR';

  const depthById = computeNodeDepths(nodes, edges);
  if (depthById.size === 0) return 'LR'; // grafo cíclico → LR

  const byDepth = new Map<number, number>();
  for (const d of depthById.values()) byDepth.set(d, (byDepth.get(d) ?? 0) + 1);
  const maxWidth = Math.max(...byDepth.values(), 1);
  const maxDepth = Math.max(...depthById.values(), 0);

  // Pirámide ancha y baja → TB (muchas ramas paralelas, poca profundidad)
  if (maxDepth <= 3 && maxWidth >= 5) return 'TB';
  return 'LR';
}
