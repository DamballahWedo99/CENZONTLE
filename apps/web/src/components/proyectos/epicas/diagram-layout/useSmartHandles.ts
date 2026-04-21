import type { Node } from '@xyflow/react';
import type { DiagramNode } from '@cenzontle/shared';
import { inferHandle } from './infer-handle';
import { nodeDimensions, nodeTypeToShape } from './layout-constants';

interface EdgeDraft {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface EdgeWithHandles extends EdgeDraft {
  sourceHandle: string;
  targetHandle: string;
}

/**
 * Post-procesa las edges añadiendo sourceHandle/targetHandle determinísticos
 * calculados con `inferHandle` según la posición relativa centro-a-centro
 * de los nodos tras el layout.
 *
 * Esta es la fuente única de verdad de los handles — cualquier valor que
 * haya venido del LLM se ignora, porque el LLM no ve el layout final.
 */
export function applySmartHandles(
  rfNodes: Node[],
  edges: EdgeDraft[],
  originalNodes: DiagramNode[],
): EdgeWithHandles[] {
  const positionById = new Map<string, { x: number; y: number }>();
  const typeById = new Map<string, DiagramNode['type']>();

  // Guardamos el CENTRO de cada nodo (posiciones de RF son top-left)
  for (const rfNode of rfNodes) {
    const shape = rfNode.type ?? 'serviceNode';
    const dim = nodeDimensions[shape] ?? nodeDimensions.serviceNode;
    positionById.set(rfNode.id, {
      x: rfNode.position.x + dim.width / 2,
      y: rfNode.position.y + dim.height / 2,
    });
  }
  for (const n of originalNodes) {
    typeById.set(n.id, n.type);
  }

  return edges.map((edge) => {
    const src = positionById.get(edge.source);
    const tgt = positionById.get(edge.target);
    const srcType = typeById.get(edge.source) ?? 'service';
    const tgtType = typeById.get(edge.target) ?? 'service';

    if (!src || !tgt) {
      // Fallback silencioso: top/bottom. No debería ocurrir si el validator
      // del backend hace su trabajo, pero cubrimos el caso por robustez.
      return { ...edge, sourceHandle: 'bottom', targetHandle: 'top' };
    }

    const { sourceHandle, targetHandle } = inferHandle(src, tgt, srcType, tgtType);
    return { ...edge, sourceHandle, targetHandle };
  });
}

// Referencia para silenciar el linter sobre el re-export simbólico
export { nodeTypeToShape };
