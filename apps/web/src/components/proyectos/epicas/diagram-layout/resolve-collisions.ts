import type { Node } from '@xyflow/react';
import { nodeDimensions } from './layout-constants';

/**
 * Algoritmo naive O(n²) de resolución de colisiones entre nodos — adaptado
 * del ejemplo oficial de React Flow:
 * https://xyflow.com/blog/node-collision-detection-algorithms
 * https://github.com/xyflow/node-collision-algorithms/blob/main/src/lib/algorithms/naive.ts
 *
 * Para grafos <500 nodos (nuestro rango típico de 2-40 nodos), O(n²) es
 * aceptable y más simple que spatial hash / quadtree. El blog de xyflow
 * confirma que Flatbush solo vale la pena sobre ~500 nodos.
 *
 * Approach:
 *   1. Convierte cada nodo en un bounding box con `margin` alrededor.
 *   2. En cada iteración revisa todos los pares (i, j).
 *   3. Si hay solape >= overlapThreshold en ambos ejes, separa en el eje
 *      de MENOR solape (desplazamiento mínimo).
 *   4. Ambos nodos se mueven la mitad del overlap cada uno → centros se
 *      alejan simétricamente.
 *   5. Early exit cuando una iteración completa no produjo movimientos.
 */

export interface ResolveCollisionsOptions {
  /**
   * Máximo de iteraciones. 50 es suficiente para resolver capas densas.
   * En grafos extremos (nodos muy apretados inicialmente) podría no
   * converger, pero cortar a 50 evita freeze del hilo. Default: 50.
   */
  maxIterations?: number;
  /**
   * Umbral mínimo de solape en pixels para considerar colisión. <0.5 px
   * es jitter de fractional positions, no un overlap real. Default: 0.5.
   */
  overlapThreshold?: number;
  /**
   * Margin extra alrededor de cada bounding box. Subirlo fuerza más
   * separación entre nodos. Útil para nodes con label externo (Actor,
   * State) cuyo bounding box reportado no incluye el texto. Default: 10.
   */
  margin?: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  moved: boolean;
  node: Node;
}

/**
 * Resuelve `node.measured.width/height` con fallback a `nodeDimensions`
 * por shape y, como último recurso, al default del serviceNode. React
 * Flow puede no haber medido un nodo aún (primer render antes de que el
 * ResizeObserver reporte), en ese caso usamos los defaults del layout.
 */
function resolveDimensions(node: Node): { width: number; height: number } {
  const measured = node.measured;
  if (
    measured &&
    typeof measured.width === 'number' &&
    typeof measured.height === 'number'
  ) {
    return { width: measured.width, height: measured.height };
  }
  const shape = node.type ?? 'serviceNode';
  return nodeDimensions[shape] ?? nodeDimensions.serviceNode;
}

function getBoxesFromNodes(nodes: Node[], margin: number): Box[] {
  const boxes: Box[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const { width, height } = resolveDimensions(node);
    boxes[i] = {
      x: node.position.x - margin,
      y: node.position.y - margin,
      width: width + margin * 2,
      height: height + margin * 2,
      node,
      moved: false,
    };
  }
  return boxes;
}

/**
 * Redondea las posiciones de cada nodo al múltiplo de `gridSize` más
 * cercano. Garantiza alineación visual perfecta — los nodos quedan en
 * una grilla invisible, eliminando desalineaciones sub-pixel de ELK.
 *
 * IMPORTANTE: aplicar ANTES de `resolveCollisions` para que el resolver
 * corrija cualquier overlap que el snap pudiera introducir (dos nodos
 * que cayeran en la misma celda del grid).
 *
 * Valor típico: 50 px (visualmente limpio sin hacer el grid perceptible).
 * Subirlo a 100 da un look más "architectural"; bajarlo a 20 da snap sutil.
 */
export function snapToGrid(nodes: Node[], gridSize: number): Node[] {
  if (gridSize <= 0) return nodes;
  return nodes.map((n) => {
    if (!Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) {
      return n;
    }
    const snappedX = Math.round(n.position.x / gridSize) * gridSize;
    const snappedY = Math.round(n.position.y / gridSize) * gridSize;
    if (snappedX === n.position.x && snappedY === n.position.y) return n;
    return { ...n, position: { x: snappedX, y: snappedY } };
  });
}

export function resolveCollisions(
  nodes: Node[],
  opts: ResolveCollisionsOptions = {},
): { nodes: Node[]; iterations: number; nodesMoved: number } {
  const maxIterations = opts.maxIterations ?? 50;
  const overlapThreshold = opts.overlapThreshold ?? 0.5;
  const margin = opts.margin ?? 10;

  const boxes = getBoxesFromNodes(nodes, margin);
  let numIterations = 0;

  for (let iter = 0; iter <= maxIterations; iter++) {
    let moved = false;

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i];
        const B = boxes[j];

        // Centros de cada box (incluye margin).
        const centerAX = A.x + A.width * 0.5;
        const centerAY = A.y + A.height * 0.5;
        const centerBX = B.x + B.width * 0.5;
        const centerBY = B.y + B.height * 0.5;

        // Distancia entre centros en cada eje.
        const dx = centerAX - centerBX;
        const dy = centerAY - centerBY;

        // Solape en cada eje (positivo = hay overlap).
        const px = (A.width + B.width) * 0.5 - Math.abs(dx);
        const py = (A.height + B.height) * 0.5 - Math.abs(dy);

        if (px > overlapThreshold && py > overlapThreshold) {
          A.moved = B.moved = moved = true;
          // Desplazar en el eje de menor solape (menor disrupción visual).
          if (px < py) {
            const sx = dx > 0 ? 1 : -1;
            const moveAmount = (px / 2) * sx;
            A.x += moveAmount;
            B.x -= moveAmount;
          } else {
            const sy = dy > 0 ? 1 : -1;
            const moveAmount = (py / 2) * sy;
            A.y += moveAmount;
            B.y -= moveAmount;
          }
        }
      }
    }

    numIterations++;
    if (!moved) break;
  }

  let nodesMoved = 0;
  const newNodes = boxes.map((box) => {
    if (!box.moved) return box.node;
    nodesMoved++;
    return {
      ...box.node,
      position: {
        x: box.x + margin,
        y: box.y + margin,
      },
    };
  });

  return { nodes: newNodes, iterations: numIterations, nodesMoved };
}
