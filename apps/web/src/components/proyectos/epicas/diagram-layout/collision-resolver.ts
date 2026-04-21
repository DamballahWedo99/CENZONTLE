import type { Node } from '@xyflow/react';
import { nodeDimensions } from './layout-constants';

const MIN_MARGIN = 24;
const RANK_BUCKET = 20; // px; dos nodos cuyo Y difiere < bucket se consideran en la misma "fila"

/**
 * Resuelve overlaps horizontales entre nodos que quedaron en la misma fila
 * (misma Y aproximada) tras el layout automático.
 *
 * Estrategia: agrupar por rank, ordenar por X, recorrer de izquierda a
 * derecha empujando el siguiente si invade el espacio mínimo del previo.
 * El empuje se propaga al resto de la fila.
 *
 * O(n log n). Pase opcional — no siempre es necesario tras Dagre + clustering.
 */
export function resolveCollisions(nodes: Node[]): Node[] {
  if (nodes.length === 0) return nodes;

  const mutable = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const ranks = new Map<number, typeof mutable>();
  for (const node of mutable) {
    const rankKey = Math.round(node.position.y / RANK_BUCKET) * RANK_BUCKET;
    if (!ranks.has(rankKey)) ranks.set(rankKey, []);
    ranks.get(rankKey)!.push(node);
  }

  for (const rank of ranks.values()) {
    rank.sort((a, b) => a.position.x - b.position.x);
    for (let i = 1; i < rank.length; i++) {
      const prev = rank[i - 1];
      const curr = rank[i];
      const prevDim = dims(prev);
      const currDim = dims(curr);
      const minSeparation = (prevDim.width + currDim.width) / 2 + MIN_MARGIN;
      const actualSeparation = curr.position.x + currDim.width / 2 - (prev.position.x + prevDim.width / 2);
      if (actualSeparation < minSeparation) {
        const shift = minSeparation - actualSeparation;
        for (let j = i; j < rank.length; j++) {
          rank[j].position.x += shift;
        }
      }
    }
  }

  return mutable;
}

function dims(node: Node) {
  const shape = node.type ?? 'serviceNode';
  return nodeDimensions[shape] ?? nodeDimensions.serviceNode;
}
