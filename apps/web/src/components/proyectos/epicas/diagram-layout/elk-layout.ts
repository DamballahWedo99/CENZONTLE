import type { ElkExtendedEdge, ElkNode } from 'elkjs';
import type { DiagramEdge, DiagramNode, DiagramNodeGroup } from '@cenzontle/shared';
import {
  GROUP_COLORS,
  GROUP_LABELS,
  GROUP_RANK,
  nodeDimensions,
  nodeTypeToShape,
  SOURCE_HANDLES_BY_SHAPE,
  TARGET_HANDLES_BY_SHAPE,
  type HandleId,
} from './layout-constants';

/**
 * Mapeo handle name → ELK port side. Los handles de React Flow son
 * `top/right/bottom/left` (+ `left-out` en decision nodes); ELK los
 * posiciona en `NORTH/SOUTH/WEST/EAST` respectivamente. Declarar los
 * ports con su side permite a ELK optimizar el routing respetando la
 * geometría real del nodo (adaptado del ejemplo oficial
 * `elkjs-multiple-handles`).
 */
/**
 * Mapeo handle name → ELK port side. Los handles se distribuyen en 3 por
 * lado (índices 0/1/2) adaptado del ejemplo oficial `elkjs-multiple-handles`.
 * Todos los handles del mismo lado comparten side ELK (NORTH/SOUTH/EAST/
 * WEST); ELK con `FIXED_ORDER` distribuye los edges entre los handles del
 * lado elegido.
 */
function handleToElkSide(
  handle: HandleId,
): 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' {
  if (handle === 'left-out') return 'WEST';
  if (handle.startsWith('top')) return 'NORTH';
  if (handle.startsWith('bottom')) return 'SOUTH';
  if (handle.startsWith('right')) return 'EAST';
  return 'WEST';
}

export interface ClusterBounds {
  id: string;
  group: DiagramNodeGroup;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BuildElkGraphParams {
  diagramNodes: DiagramNode[];
  diagramEdges: DiagramEdge[];
  measuredDimensions?: Map<string, { width: number; height: number }>;
  layoutOptions: Record<string, string>;
}

function resolveDimensions(
  node: DiagramNode,
  measured?: Map<string, { width: number; height: number }>,
): { width: number; height: number } {
  const shape = nodeTypeToShape[node.type] ?? 'serviceNode';
  return (
    measured?.get(node.id) ??
    nodeDimensions[shape] ??
    nodeDimensions.serviceNode
  );
}

/**
 * Construye el grafo de entrada para ELK como grafo PLANO (sin compound).
 *
 * Decisión arquitectónica (post-diagnóstico):
 * La versión anterior usaba compound graph — cada `DiagramNodeGroup` se
 * convertía en un cluster-node ELK con sus nodos como `children[]`. ELK con
 * `hierarchyHandling: INCLUDE_CHILDREN` calculaba bounding boxes para cada
 * cluster, y si el `nodeSize.minimum` del cluster era insuficiente para el
 * número real de hijos, esos hijos se dibujaban superpuestos (issue #316).
 *
 * Aplanando el grafo, todos los nodos viven al root level y `elk.spacing.nodeNode`
 * se aplica globalmente entre cualquier par. Los clusters (para el fondo SVG
 * opcional) se derivan POST-LAYOUT agregando los bboxes de nodos con el mismo
 * `group` (ver `computeClusterBounds`). No es el ELK quien gestiona la jerarquía;
 * es el consumidor visual quien la reconstruye si la necesita.
 *
 * Cada nodo lleva `elk.portConstraints: FIXED_ORDER` en sus layoutOptions
 * individuales. Esto obliga a ELK a respetar el orden de puertos definido en
 * el nodo, reduciendo crossings que entran/salen por el mismo lado.
 */
export function buildElkGraph(params: BuildElkGraphParams): ElkNode {
  const { diagramNodes, diagramEdges, measuredDimensions, layoutOptions } = params;

  const children: ElkNode[] = diagramNodes.map((n) => {
    const dim = resolveDimensions(n, measuredDimensions);
    const shape = nodeTypeToShape[n.type] ?? 'serviceNode';
    const sourceHandles = SOURCE_HANDLES_BY_SHAPE[shape] ?? [];
    const targetHandles = TARGET_HANDLES_BY_SHAPE[shape] ?? [];

    // Declaramos TODOS los handles del nodo como ports de ELK con su side.
    // `id` único por port = `${nodeId}::${handle}` evita colisiones si dos
    // nodos tienen handles con el mismo name (ej. `right` en todos).
    // Adaptado del ejemplo oficial `elkjs-multiple-handles` de React Flow.
    //
    // El `id: n.id` extra (primer port) captura el caso donde un edge
    // viene sin sourceHandle/targetHandle — ELK lo resuelve al nodo entero
    // y elige un port cualquiera en vez de fallar.
    const ports = [
      { id: n.id },
      ...sourceHandles.map((h) => ({
        id: `${n.id}::${h}`,
        properties: { side: handleToElkSide(h) },
      })),
      ...targetHandles.map((h) => ({
        id: `${n.id}::${h}`,
        properties: { side: handleToElkSide(h) },
      })),
    ];

    // Partition ID basado en el grupo arquitectónico del nodo. ELK apila
    // los partitions en orden numérico: todos los start juntos, luego
    // frontend, luego backend, etc. Produce bandas visuales estilo swim
    // lane sin requerir compound graph. Fallback a 'backend' (rank 2)
    // para nodos sin group — mismo default que `topologicalSort`.
    const partition = GROUP_RANK[n.group ?? 'backend'] ?? GROUP_RANK.backend;

    return {
      id: n.id,
      width: dim.width,
      height: dim.height,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_ORDER',
        'elk.partitioning.partition': String(partition),
      },
      ports,
    };
  });

  const edges: ElkExtendedEdge[] = diagramEdges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  return {
    id: 'root',
    layoutOptions,
    children,
    edges,
  };
}

export interface AbsolutePosition {
  /** Coord del CENTRO del nodo. Convención heredada de Dagre que mantenemos
   *  para no tener que tocar callers downstream (`applySmartHandles`, etc.). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Waypoint en coordenadas absolutas del viewport ELK. Incluye start/end
 * (en los bordes del nodo, no en el centro) + bendPoints intermedios.
 *
 * ELK devuelve esto en `edge.sections[0]` cuando `elk.edgeRouting: ORTHOGONAL`
 * está activo — sin esa opción, `bendPoints` es undefined y el trazo queda
 * a discreción del renderer.
 */
export interface EdgeWaypoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
  bends: Array<{ x: number; y: number }>;
  /**
   * Handle del source inferido por qué lado del nodo source eligió ELK
   * para emitir el edge. Inferido desde `section.startPoint` comparando
   * con los 4 lados del bounding box del nodo — el más cercano gana.
   * Undefined si ELK no reporta startPoint (no debería pasar con
   * `elk.edgeRouting: ORTHOGONAL`).
   */
  sourceHandle?: string;
  /** Análogo a `sourceHandle` pero desde `section.endPoint` + target node. */
  targetHandle?: string;
}

/**
 * Determina qué lado del bbox (top/right/bottom/left) está más cerca del
 * punto dado. Usado para inferir el handle del edge desde el startPoint/
 * endPoint de ELK: si ELK ruteó el edge por un port del lado derecho del
 * nodo, le asignamos el handle `right` de React Flow.
 */
function inferHandleFromPoint(
  point: { x: number; y: number },
  nodeBox: { x: number; y: number; width: number; height: number },
): 'top' | 'right' | 'bottom' | 'left' {
  const dLeft = Math.abs(point.x - nodeBox.x);
  const dRight = Math.abs(point.x - (nodeBox.x + nodeBox.width));
  const dTop = Math.abs(point.y - nodeBox.y);
  const dBottom = Math.abs(point.y - (nodeBox.y + nodeBox.height));
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return 'left';
  if (min === dRight) return 'right';
  if (min === dTop) return 'top';
  return 'bottom';
}

/**
 * Walk del árbol laid-out de ELK y retorna posiciones absolutas por nodeId
 * + waypoints por edgeId.
 *
 * Con grafo plano ya no hay `cluster` children — todos los nodes están al
 * root level, así que el walk solo necesita recorrer `root.children` con
 * `parentX=parentY=0`.
 *
 * Convertimos positions a CENTRO del nodo (no top-left) por la misma razón
 * histórica que Dagre: downstream code espera coords del centro.
 *
 * Los waypoints NO se convierten a centro — son coordenadas ya absolutas
 * del routing, el WaypointEdge los consume directamente como comandos SVG
 * M/L. Si no hay `sections` en el edge (routing no activado o edge sin
 * rutear), se omite del map — el consumer aplica fallback (smoothstep).
 */
export function absolutizeElkLayout(root: ElkNode): {
  positions: Map<string, AbsolutePosition>;
  edgeRoutings: Map<string, EdgeWaypoints>;
} {
  const positions = new Map<string, AbsolutePosition>();

  for (const node of root.children ?? []) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const width = node.width ?? 0;
    const height = node.height ?? 0;
    positions.set(node.id, {
      x: x + width / 2,
      y: y + height / 2,
      width,
      height,
    });
  }

  // Map nodeId → top-left bounding box, usado para inferHandleFromPoint.
  // Construimos aquí en lugar de reutilizar `positions` porque ese map
  // convierte a centro mientras el handle inference necesita top-left.
  const nodeBoxById = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const node of root.children ?? []) {
    nodeBoxById.set(node.id, {
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 0,
      height: node.height ?? 0,
    });
  }

  const edgeRoutings = new Map<string, EdgeWaypoints>();
  let totalIncomingEdges = 0;
  let edgesWithSections = 0;
  let edgesWithBends = 0;
  let totalBendPoints = 0;
  for (const edge of root.edges ?? []) {
    totalIncomingEdges++;
    const section = edge.sections?.[0];
    if (!section) continue;
    edgesWithSections++;
    // Guard `Number.isFinite`: un grafo degenerado (auto-loops patológicos,
    // dimensiones cero) podría producir NaN/Infinity en los bends. Si cuela
    // NaN al SVG path, el edge entero se vuelve invisible sin error en
    // consola. Descartamos puntos inválidos — peor caso, bends=[] y el
    // consumer cae al fallback smoothstep.
    const isFinitePoint = (p: { x: number; y: number }): boolean =>
      Number.isFinite(p.x) && Number.isFinite(p.y);
    if (!isFinitePoint(section.startPoint) || !isFinitePoint(section.endPoint)) {
      continue;
    }
    const bends = (section.bendPoints ?? [])
      .filter(isFinitePoint)
      .map((p) => ({ x: p.x, y: p.y }));
    if (bends.length > 0) edgesWithBends++;
    totalBendPoints += bends.length;

    // Inferir qué handle usó ELK consultando la posición del startPoint/
    // endPoint respecto al bounding box de cada nodo. Esto permite que el
    // edge de React Flow entre/salga por el mismo lado que ELK eligió en
    // su layout, respetando los ports declarados en buildElkGraph.
    const sourceId = edge.sources?.[0];
    const targetId = edge.targets?.[0];
    const srcBox = sourceId ? nodeBoxById.get(sourceId) : undefined;
    const tgtBox = targetId ? nodeBoxById.get(targetId) : undefined;
    const sourceHandle = srcBox
      ? inferHandleFromPoint(section.startPoint, srcBox)
      : undefined;
    const targetHandle = tgtBox
      ? inferHandleFromPoint(section.endPoint, tgtBox)
      : undefined;

    edgeRoutings.set(edge.id, {
      start: { x: section.startPoint.x, y: section.startPoint.y },
      end: { x: section.endPoint.x, y: section.endPoint.y },
      bends,
      sourceHandle,
      targetHandle,
    });
  }

  console.debug(
    `[DIAGRAM-DEBUG][absolutizeElkLayout] edges_in=${totalIncomingEdges} ` +
      `edges_with_sections=${edgesWithSections} ` +
      `edges_with_bends=${edgesWithBends} ` +
      `total_bendPoints=${totalBendPoints} ` +
      `avg_bends_per_edge=${edgesWithSections > 0 ? (totalBendPoints / edgesWithSections).toFixed(2) : 'n/a'}`,
  );
  if (edgesWithSections > 0 && edgesWithBends === 0) {
    console.warn(
      '[DIAGRAM-DEBUG][absolutizeElkLayout] ELK devolvió sections pero CERO bendPoints en todos los edges. ' +
        'Esto sugiere que `elk.edgeRouting: ORTHOGONAL` no está activo o el grafo es tan simple ' +
        '(2 layers, pocos nodos) que ELK decidió trazos rectos. Los WaypointEdge caerán a smoothstep.',
    );
  }

  return { positions, edgeRoutings };
}

/**
 * Calcula los bounds de cada cluster visual agregando los bboxes de los nodos
 * con el mismo `group`. Se corre POST-LAYOUT, después de que ELK posicionó
 * todos los nodos al root level.
 *
 * Devuelve bounds TIGHT (sin padding extra): el consumidor visual
 * (`ClusterBackground`) ya aplica su propio padding al renderizar el rect
 * SVG. Añadir padding aquí duplicaría el aire y los clusters hermanos
 * colisionarían visualmente.
 *
 * Nodos sin `group` no producen cluster (coherente con el comportamiento
 * anterior de ungrouped-at-root).
 */
export function computeClusterBounds(
  diagramNodes: DiagramNode[],
  positions: Map<string, AbsolutePosition>,
): ClusterBounds[] {
  const byGroup = new Map<DiagramNodeGroup, DiagramNode[]>();
  for (const n of diagramNodes) {
    if (!n.group) continue;
    // Excluir jump connectors del cluster: son marcadores visuales que
    // pueden estar lejos del cluster semántico (entre layers, en gutters)
    // y al incluirlos inflaban el bounding box del cluster arrastrando
    // fondos dashed hacia zonas vacías (fix QA-MEDIUM review 2026-04-20).
    if (n.type === 'reference') continue;
    const list = byGroup.get(n.group) ?? [];
    list.push(n);
    byGroup.set(n.group, list);
  }

  const bounds: ClusterBounds[] = [];
  for (const [group, nodesInGroup] of byGroup) {
    const positionsInGroup = nodesInGroup
      .map((n) => positions.get(n.id))
      .filter((p): p is AbsolutePosition => p !== undefined);
    if (positionsInGroup.length === 0) continue;

    const xs = positionsInGroup.flatMap((p) => [
      p.x - p.width / 2,
      p.x + p.width / 2,
    ]);
    const ys = positionsInGroup.flatMap((p) => [
      p.y - p.height / 2,
      p.y + p.height / 2,
    ]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    bounds.push({
      id: `cluster-${group}`,
      group,
      label: GROUP_LABELS[group] ?? group,
      color: GROUP_COLORS[group] ?? 'rgb(100,100,100)',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }
  return bounds;
}
