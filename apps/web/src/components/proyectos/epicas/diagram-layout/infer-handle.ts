import type { DiagramNodeType } from '@cenzontle/shared';
import {
  SOURCE_HANDLES_BY_SHAPE,
  TARGET_HANDLES_BY_SHAPE,
  nodeTypeToShape,
  type HandleId,
} from './layout-constants';

export interface HandlePair {
  sourceHandle: HandleId;
  targetHandle: HandleId;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Calcula sourceHandle y targetHandle óptimos para una arista, basándose en
 * la posición relativa entre source y target DESPUÉS del layout automático.
 *
 * Estrategia:
 *   1. Si la delta vertical domina → handles top/bottom (flujo vertical).
 *   2. Si la delta horizontal domina → handles left/right (flujo horizontal).
 *   3. `decision` + target arriba-izquierda → usa el extra `left-out` para el
 *      cable que sale por la izquierda y baja (patrón típico: ACCEPT a la
 *      derecha, REJECT por izquierda-out).
 *   4. Validar que el handle calculado exista en el nodo; si no, fallback
 *      determinístico según la posición relativa.
 */
export function inferHandle(
  src: Point,
  tgt: Point,
  srcType: DiagramNodeType,
  tgtType: DiagramNodeType,
): HandlePair {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  let sourceHandle: HandleId;
  let targetHandle: HandleId;

  // 4 handles por nodo: top/right/bottom/left. Decision node tiene
  // `left-out` adicional para la rama REJECT que sale hacia atrás.
  if (srcType === 'decision' && dx < 0 && dy < 0) {
    sourceHandle = 'left-out';
  } else if (ay >= ax) {
    sourceHandle = dy > 0 ? 'bottom' : 'top';
  } else {
    sourceHandle = dx > 0 ? 'right' : 'left';
  }

  if (ay >= ax) {
    targetHandle = dy > 0 ? 'top' : 'bottom';
  } else {
    targetHandle = dx > 0 ? 'left' : 'right';
  }

  // Validación: el handle calculado debe existir como el tipo correcto
  // (source vs target) en la shape del nodo. Si no, cae a un default seguro
  // que sí está disponible.
  const srcShape = nodeTypeToShape[srcType] ?? 'serviceNode';
  const tgtShape = nodeTypeToShape[tgtType] ?? 'serviceNode';
  const srcHandles = SOURCE_HANDLES_BY_SHAPE[srcShape] ?? (['bottom', 'right'] as const);
  const tgtHandles = TARGET_HANDLES_BY_SHAPE[tgtShape] ?? (['top', 'left'] as const);

  if (!srcHandles.includes(sourceHandle)) {
    sourceHandle = srcHandles.includes('bottom' as HandleId)
      ? 'bottom'
      : srcHandles[0];
  }
  if (!tgtHandles.includes(targetHandle)) {
    targetHandle = tgtHandles.includes('top' as HandleId)
      ? 'top'
      : tgtHandles[0];
  }

  return { sourceHandle, targetHandle };
}
