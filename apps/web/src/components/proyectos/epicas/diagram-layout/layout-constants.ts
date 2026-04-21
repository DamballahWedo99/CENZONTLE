import { MarkerType } from '@xyflow/react';
import type { DiagramNodeType, DiagramNodeGroup } from '@cenzontle/shared';

// ────────────────────────────────────────────────────────────────────────────
// Handle styles
// ────────────────────────────────────────────────────────────────────────────

export const handleStyle = {
  background: 'rgba(255,255,255,0.3)',
  width: 6,
  height: 6,
  border: 'none',
} as const;

export const handleStyleEditing = {
  background: 'rgba(99,102,241,0.7)',
  width: 8,
  height: 8,
  border: '1px solid rgba(99,102,241,1)',
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Node type → custom component key (in nodeTypes map)
// ────────────────────────────────────────────────────────────────────────────

export const nodeTypeToShape: Record<DiagramNodeType, string> = {
  service: 'serviceNode',
  database: 'databaseNode',
  queue: 'serviceNode',
  gateway: 'serviceNode',
  external: 'serviceNode',
  client: 'stateNode',
  process: 'serviceNode',
  decision: 'decisionNode',
  actor: 'actorNode',
  reference: 'reference',
};

export const shapeToNodeType: Record<string, DiagramNodeType> = {
  serviceNode: 'service',
  databaseNode: 'database',
  decisionNode: 'decision',
  actorNode: 'actor',
  stateNode: 'client',
  reference: 'reference',
};

// ────────────────────────────────────────────────────────────────────────────
// Node dimensions used by the layout engine
// ────────────────────────────────────────────────────────────────────────────

export const nodeDimensions: Record<string, { width: number; height: number }> = {
  serviceNode: { width: 160, height: 56 },
  decisionNode: { width: 120, height: 120 },
  actorNode: { width: 100, height: 100 },
  databaseNode: { width: 130, height: 70 },
  stateNode: { width: 90, height: 90 },
  // Reference nodes (jump connectors A/B/C…) — círculo 28×28. El valor vive
  // también en `packages/shared/src/diagram-quality-metrics.ts` para el
  // cálculo de score; mantener ambos en sync.
  reference: { width: 28, height: 28 },
};

export const nodeTypeLabels: Record<string, string> = {
  serviceNode: 'Servicio',
  decisionNode: 'Decisión',
  actorNode: 'Actor',
  databaseNode: 'Base de datos',
  stateNode: 'Estado',
};

// ────────────────────────────────────────────────────────────────────────────
// Group labels and accent colors for cluster backgrounds
// ────────────────────────────────────────────────────────────────────────────

export const GROUP_LABELS: Record<DiagramNodeGroup, string> = {
  start: 'Inicio',
  end: 'Cierre',
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Datos',
  infra: 'Infraestructura',
  external: 'Terceros',
};

/**
 * Color de acento por grupo. Se usa para el borde dashed del cluster y un
 * fondo muy sutil (la opacidad se aplica en el componente SVG).
 */
export const GROUP_COLORS: Record<DiagramNodeGroup, string> = {
  start: 'rgb(99,102,241)',    // indigo
  end: 'rgb(16,185,129)',       // emerald
  frontend: 'rgb(56,189,248)',  // sky
  backend: 'rgb(168,85,247)',   // violet
  data: 'rgb(245,158,11)',      // amber
  infra: 'rgb(148,163,184)',    // slate
  external: 'rgb(244,63,94)',   // rose
};

/**
 * Orden canónico de grupos arquitectónicos. Usado para:
 *   1. Sort topológico (tie-break en `topologicalSort` de useGroupedLayout).
 *   2. ELK `partitioning` — cada nodo se asigna al partition número
 *      correspondiente a su `group`. ELK apila los partitions en orden
 *      numérico, produciendo bandas visuales claras (start → frontend →
 *      backend → data → infra → external → end).
 *
 * Es single source of truth para el orden visual de los grupos.
 */
export const GROUP_RANK: Record<DiagramNodeGroup, number> = {
  start: 0,
  frontend: 1,
  backend: 2,
  data: 3,
  infra: 4,
  external: 5,
  end: 6,
};

// ────────────────────────────────────────────────────────────────────────────
// ELK tuning presets — adaptativos por densidad del grafo
// ────────────────────────────────────────────────────────────────────────────

export interface ElkTuning {
  /** Separación horizontal entre nodos del mismo rank. ELK: `elk.spacing.nodeNode`. */
  nodesep: number;
  /** Separación vertical entre layers. ELK: `elk.layered.spacing.nodeNodeBetweenLayers`. */
  ranksep: number;
  /** Separación entre aristas paralelas. ELK: `elk.spacing.edgeEdge`. */
  edgesep: number;
  /** Margen horizontal del root — left/right del ELK padding. */
  marginx: number;
  /** Margen vertical del root. marginy > marginx porque los pills de label de
   *  cluster viven ENCIMA del rect consumiendo ~32 px. */
  marginy: number;
}

/**
 * Tuning adaptativo por densidad del grafo para ELK.js (`layered` algorithm).
 *
 * Valores calibrados para un look tipo **draw.io / Lucidchart compact**:
 * suficiente aire para que los edges de libavoid puedan rutear sin
 * chocar con nodos vecinos (edgeToNodeSpacing=20 + edgeToEdgeSpacing=25
 * en el hook), pero sin el "wide empty canvas" que teníamos antes.
 *
 * Referencias visuales:
 *   - Un nodo custom típico mide ~160×120 px (con título+descripción).
 *   - nodesep=100 ≈ 60% del ancho del nodo → cómodo pero no separado.
 *   - ranksep=120 ≈ 100% del alto del nodo → un nodo cabe entre layers.
 *
 * Los grafos pequeños (≤8 nodos) pueden darse 20% más aire; los grandes
 * se compactan para caber en viewport sin scrollbar horizontal excesivo.
 */
export function pickElkTuning(nodeCount: number): ElkTuning {
  if (nodeCount <= 8) {
    return { nodesep: 120, ranksep: 140, edgesep: 40, marginx: 40, marginy: 40 };
  }
  if (nodeCount <= 15) {
    return { nodesep: 100, ranksep: 120, edgesep: 35, marginx: 36, marginy: 36 };
  }
  if (nodeCount <= 22) {
    return { nodesep: 90, ranksep: 110, edgesep: 32, marginx: 32, marginy: 32 };
  }
  return { nodesep: 80, ranksep: 100, edgesep: 30, marginx: 28, marginy: 28 };
}

// ────────────────────────────────────────────────────────────────────────────
// Edge styles
// ────────────────────────────────────────────────────────────────────────────

/**
 * Estilo CSS del pill del label en edges CUSTOM (p. ej. SmartStepEdge).
 *
 * Vive como constante module-level — no como campo del retorno de
 * `makeEdgeStyle()` — porque los consumidores de `makeEdgeStyle` hacen spread
 * sobre edges NATIVAS de React Flow vía `defaultEdgeOptions`, y cualquier
 * campo desconocido allí viaja como prop inútil a cada edge nativa. La
 * separación evita esa contaminación (single responsibility por export).
 */
export const EDGE_LABEL_HTML_STYLE = {
  backgroundColor: 'rgba(9,9,11,0.92)',
  borderRadius: 4,
  padding: '3px 6px',
  boxShadow: '0 0 0 1px rgba(161,161,170,0.15)',
} as const;

/**
 * Estilo base de edge aplicado a edges NATIVAS de React Flow (smoothstep,
 * step, straight). El `type` se fuerza a `'smoothstep'` en `useGroupedLayout`:
 * requisito explícito del user de aristas ortogonales (dobleces a 90°, estilo
 * diagrams.net), no diagonales.
 *
 * Notas importantes sobre el label:
 *  - `labelBgStyle` usa `fill` + `fillOpacity` (atributos SVG, que SÍ son
 *    aplicables vía CSS presentation attributes en un `<rect>` SVG). NO incluye
 *    `rx`/`ry` — esos son atributos de geometría SVG que el navegador ignora
 *    cuando se setean vía `style={}`. React Flow v12 expone un prop específico
 *    `labelBgBorderRadius` para controlar el radio del fondo del label, y ese
 *    es el que usamos abajo.
 *  - `labelStyle` combina `fill` (para `<text>` SVG) y `color` (para `<span>`
 *    HTML si alguien lo reutiliza en un EdgeLabelRenderer): ambos renderers
 *    ignoran la propiedad irrelevante a su contexto.
 */
export function makeEdgeStyle(animated?: boolean) {
  return {
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: 'rgba(161,161,170,0.7)',
    },
    style: {
      strokeWidth: 1.5,
      stroke: 'rgba(161,161,170,0.5)',
    },
    labelStyle: {
      fontSize: 10,
      fontWeight: 600,
      fill: 'rgba(212,212,216,0.95)',
      color: 'rgba(212,212,216,0.95)',
    },
    labelBgStyle: { fill: 'rgba(9,9,11,0.92)', fillOpacity: 1 },
    labelBgBorderRadius: 4,
    labelBgPadding: [6, 4] as [number, number],
    animated,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Handle IDs soportados por los custom nodes (usado por inferHandle para
// validar que el handle calculado realmente existe en el nodo).
// ────────────────────────────────────────────────────────────────────────────

/**
 * HandleId — cubre los 8 handles bidireccionales por nodo (cada lado
 * tiene un target y un source separados por offset), más el legacy
 * `left-out` del DecisionNode.
 *
 * Naming convention:
 *   - `top`/`right`/`bottom`/`left` → IDs HISTÓRICOS, rol original
 *     (top/left=target, bottom/right=source). Preservados para que
 *     edges persistidos en Redis sigan resolviendo al handle correcto
 *     sin migrar data.
 *   - `top-source`/`right-target`/`bottom-target`/`left-source` →
 *     handles nuevos que cubren el rol inverso (permiten arrastrar
 *     conexiones "contra-flow" sin que el renderer de edges falle).
 *   - `left-out` → legacy source del DecisionNode REJECT branch.
 */
export type HandleId =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'left-out'
  | 'top-source'
  | 'right-target'
  | 'bottom-target'
  | 'left-source';

/**
 * Handles que pueden ser origen de una arista (type="source") por shape.
 * Crítico: ReactFlow rechaza una edge al RENDERIZAR si su sourceHandle
 * no existe como type="source" en el nodo origen (React Flow error #008
 * "Couldn't create edge for source handle id"). Por eso cada lado tiene
 * un ID source disponible.
 */
export const SOURCE_HANDLES_BY_SHAPE: Record<string, readonly HandleId[]> = {
  serviceNode: ['bottom', 'right', 'top-source', 'left-source'],
  decisionNode: ['bottom', 'right', 'left-out', 'top-source'],
  actorNode: ['bottom', 'right', 'top-source', 'left-source'],
  databaseNode: ['bottom', 'right', 'top-source', 'left-source'],
  stateNode: ['bottom', 'right', 'top-source', 'left-source'],
};

/**
 * Handles que pueden ser destino de una arista (type="target") por shape.
 * Mismo razonamiento que SOURCE: cada lado tiene un ID target disponible
 * para que el renderer pueda resolver edges drawn en dirección "inversa".
 */
export const TARGET_HANDLES_BY_SHAPE: Record<string, readonly HandleId[]> = {
  serviceNode: ['top', 'left', 'bottom-target', 'right-target'],
  decisionNode: ['top', 'left', 'bottom-target', 'right-target'],
  actorNode: ['top', 'left', 'bottom-target', 'right-target'],
  databaseNode: ['top', 'left', 'bottom-target', 'right-target'],
  stateNode: ['top', 'left', 'bottom-target', 'right-target'],
};

// ────────────────────────────────────────────────────────────────────────────
// Handle canonicalization — normaliza handle IDs por posición para que el
// render de React Flow siempre encuentre un Handle con el type correcto
// ────────────────────────────────────────────────────────────────────────────

/**
 * Dado un handleId **cualquiera** (sea type="source" o type="target" en
 * el DOM), devuelve el ID equivalente de **la misma posición** que está
 * registrado como `type="source"`. Esto resuelve dos problemas:
 *
 *   1. Edges viejos del cache Redis persistidos antes de los handles
 *      bidireccionales (sourceHandle='top' cuando top era target-only).
 *   2. Gestos "inversos" del usuario donde React Flow activa el handle
 *      target (por z-index) y lo pasa como fromHandle — issue documentado
 *      en https://github.com/xyflow/xyflow/issues/5439 (Loose mode
 *      devuelve el handle "equivocado" por z-order).
 *
 * La clave: mapear POR POSICIÓN (top/right/bottom/left), no por el type
 * actual del ID. Cualquier ID de la posición "top" → 'top-source'
 * (el único source existente en esa posición), y así con cada lado.
 */
export function canonicalSourceHandle(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  // Position.Top — único source es 'top-source'
  if (id === 'top' || id === 'top-source') return 'top-source';
  // Position.Left — único source "regular" es 'left-source'.
  // `left-out` (legacy DecisionNode REJECT) se preserva tal cual porque
  // es un handle fisicamente distinto (offset top: 75%).
  if (id === 'left' || id === 'left-source') return 'left-source';
  if (id === 'left-out') return 'left-out';
  // Position.Bottom — único source es 'bottom'
  if (id === 'bottom' || id === 'bottom-target') return 'bottom';
  // Position.Right — único source es 'right'
  if (id === 'right' || id === 'right-target') return 'right';
  // Fallback: ID desconocido — tal cual. React Flow emitirá warning pero
  // no crashea el diagrama.
  return id;
}

/**
 * Análogo a `canonicalSourceHandle`: mapea cualquier handle ID al target
 * de la misma posición. Resuelve el caso donde React Flow pasa un handle
 * source como `toHandle` (ver issue #5439), o edges viejos con IDs
 * huérfanos que hoy son source.
 */
export function canonicalTargetHandle(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  // Position.Top — único target es 'top'
  if (id === 'top' || id === 'top-source') return 'top';
  // Position.Left — único target es 'left'
  if (id === 'left' || id === 'left-source' || id === 'left-out') return 'left';
  // Position.Bottom — único target es 'bottom-target'
  if (id === 'bottom' || id === 'bottom-target') return 'bottom-target';
  // Position.Right — único target es 'right-target'
  if (id === 'right' || id === 'right-target') return 'right-target';
  return id;
}
