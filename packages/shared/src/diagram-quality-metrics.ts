/**
 * Métricas objetivas de calidad estructural para diagramas.
 *
 * Single source of truth consumida por:
 *  - Frontend (`ValidationPanel.tsx`) — muestra el score live al usuario.
 *  - Backend (quality refinement loop) — decide si el diagrama generado
 *    por el LLM necesita otra iteración.
 *
 * Normalizado a [0, 1] donde 1 = ideal. Umbral sugerido de aceptación: ≥ 0.85.
 */

// ────────────────────────────────────────────────────────────────────────────
// Tipos de entrada estructurales
//
// Compatibles con `Node`/`Edge` de `@xyflow/react` vía duck typing (el
// consumer en frontend pasa xyflow Node y TypeScript acepta por
// compatibilidad estructural). El backend construye objetos literales con la
// misma shape sin tener que depender de `@xyflow/react`.
// ────────────────────────────────────────────────────────────────────────────

export interface QualityInputNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: {
    nodeType?: string;
    group?: string;
  };
}

export interface QualityInputEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Dimensiones de nodos por shape.
//
// Portado desde `apps/web/src/components/proyectos/epicas/diagram-layout/
// layout-constants.ts` — única constante del layout usada por las métricas,
// así evitamos arrastrar dependencias del engine ELK al paquete shared.
// ────────────────────────────────────────────────────────────────────────────

export const nodeDimensions: Record<string, { width: number; height: number }> = {
  serviceNode: { width: 160, height: 56 },
  decisionNode: { width: 120, height: 120 },
  actorNode: { width: 100, height: 100 },
  databaseNode: { width: 130, height: 70 },
  stateNode: { width: 90, height: 90 },
  // Reference nodes (jump connectors A/B/C…) — círculo 28×28.
  reference: { width: 28, height: 28 },
};

// ────────────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────────────

/**
 * Score global del diagrama post-layout. Pensado como métrica objetiva de
 * calidad visual para tests (umbral sugerido: ≥ 0.85).
 *
 * Normalizado a [0, 1] donde 1 = ideal.
 */
export interface QualityBreakdown {
  nodeOverlapRatio: number;    // 0 = sin overlaps, 1 = todos solapan (peor)
  edgeNodeCrossings: number;   // # de edges que atraviesan nodos terceros
  edgeEdgeCrossings: number;   // # de pares de edges que se cruzan
  handleValidityRatio: number; // [0,1] — fracción de edges con handle válido
  avgEdgeLength: number;       // sanity check (px promedio)
}

export interface QualityScore extends QualityBreakdown {
  /** Score final en [0, 1]. */
  score: number;
}

export function qualityScore(
  nodes: QualityInputNode[],
  edges: QualityInputEdge[],
): QualityScore {
  const breakdown: QualityBreakdown = {
    nodeOverlapRatio: computeNodeOverlapRatio(nodes),
    edgeNodeCrossings: computeEdgeNodeCrossings(nodes, edges),
    edgeEdgeCrossings: computeEdgeEdgeCrossings(nodes, edges),
    handleValidityRatio: computeHandleValidityRatio(edges),
    avgEdgeLength: computeAvgEdgeLength(nodes, edges),
  };

  // Fórmula del score: 1.0 base, penalizaciones y premios según rúbrica del plan.
  let score = 1.0;
  score += breakdown.nodeOverlapRatio * -3.0;
  score += Math.min(breakdown.edgeNodeCrossings / Math.max(edges.length, 1), 1) * -2.0;
  score += Math.min(breakdown.edgeEdgeCrossings / Math.max(edges.length, 1), 1) * -0.5;
  score += (breakdown.handleValidityRatio - 1) * 1.0; // 1 si todos válidos → +0; 0 → -1

  // Clamp a [0, 1]
  score = Math.max(0, Math.min(1, score));

  return { ...breakdown, score };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function nodeBox(node: QualityInputNode) {
  const shape = node.type ?? 'serviceNode';
  const dim = nodeDimensions[shape] ?? nodeDimensions.serviceNode;
  return {
    x1: node.position.x,
    y1: node.position.y,
    x2: node.position.x + dim.width,
    y2: node.position.y + dim.height,
  };
}

function nodeCenter(node: QualityInputNode) {
  const shape = node.type ?? 'serviceNode';
  const dim = nodeDimensions[shape] ?? nodeDimensions.serviceNode;
  return { x: node.position.x + dim.width / 2, y: node.position.y + dim.height / 2 };
}

function boxesOverlap(a: ReturnType<typeof nodeBox>, b: ReturnType<typeof nodeBox>): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function computeNodeOverlapRatio(nodes: QualityInputNode[]): number {
  if (nodes.length < 2) return 0;
  let overlaps = 0;
  let pairs = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      pairs++;
      if (boxesOverlap(nodeBox(nodes[i]), nodeBox(nodes[j]))) overlaps++;
    }
  }
  return pairs === 0 ? 0 : overlaps / pairs;
}

function computeEdgeNodeCrossings(nodes: QualityInputNode[], edges: QualityInputEdge[]): number {
  let crossings = 0;
  for (const edge of edges) {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) continue;
    const p1 = nodeCenter(src);
    const p2 = nodeCenter(tgt);
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (segmentIntersectsBox(p1, p2, nodeBox(node))) crossings++;
    }
  }
  return crossings;
}

function computeEdgeEdgeCrossings(nodes: QualityInputNode[], edges: QualityInputEdge[]): number {
  let crossings = 0;
  const segments = edges.map((e) => {
    const src = nodes.find((n) => n.id === e.source);
    const tgt = nodes.find((n) => n.id === e.target);
    if (!src || !tgt) return null;
    return { p1: nodeCenter(src), p2: nodeCenter(tgt) };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (segmentsIntersect(a.p1.x, a.p1.y, a.p2.x, a.p2.y, b.p1.x, b.p1.y, b.p2.x, b.p2.y)) {
        crossings++;
      }
    }
  }
  return crossings;
}

function computeHandleValidityRatio(edges: QualityInputEdge[]): number {
  if (edges.length === 0) return 1;
  let valid = 0;
  for (const edge of edges) {
    const src = edge.sourceHandle;
    const tgt = edge.targetHandle;
    if (src && tgt) valid++;
  }
  return valid / edges.length;
}

function computeAvgEdgeLength(nodes: QualityInputNode[], edges: QualityInputEdge[]): number {
  if (edges.length === 0) return 0;
  let total = 0;
  let counted = 0;
  for (const edge of edges) {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) continue;
    const p1 = nodeCenter(src);
    const p2 = nodeCenter(tgt);
    total += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    counted++;
  }
  return counted === 0 ? 0 : total / counted;
}

function segmentIntersectsBox(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  box: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  if (p1.x < box.x1 && p2.x < box.x1) return false;
  if (p1.x > box.x2 && p2.x > box.x2) return false;
  if (p1.y < box.y1 && p2.y < box.y1) return false;
  if (p1.y > box.y2 && p2.y > box.y2) return false;
  const lines = [
    [box.x1, box.y1, box.x2, box.y1],
    [box.x2, box.y1, box.x2, box.y2],
    [box.x2, box.y2, box.x1, box.y2],
    [box.x1, box.y2, box.x1, box.y1],
  ] as const;
  for (const [x3, y3, x4, y4] of lines) {
    if (segmentsIntersect(p1.x, p1.y, p2.x, p2.y, x3, y3, x4, y4)) return true;
  }
  return false;
}

function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
