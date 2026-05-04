'use client';

import { useEffect, useRef, useState } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import type {
  DiagramEdge,
  DiagramNode,
  DiagramNodeGroup,
  EpicDiagram,
} from '@cenzontle/shared';
import {
  canonicalSourceHandle,
  canonicalTargetHandle,
  GROUP_RANK,
  nodeDimensions,
  nodeTypeToShape,
  pickElkTuning,
} from './layout-constants';
import {
  computeNodeDepths,
  inferLayoutDirection,
  type LayoutDirection,
} from './infer-direction';
import {
  absolutizeElkLayout,
  buildElkGraph,
  computeClusterBounds,
  type AbsolutePosition,
  type ClusterBounds,
  type EdgeWaypoints,
} from './elk-layout';
import { applySmartHandles, type EdgeWithHandles } from './useSmartHandles';
import { resolveCollisions, snapToGrid } from './resolve-collisions';

/**
 * Tamaño del grid para snap post-layout. Los nodos quedan alineados a
 * múltiplos de este valor en x/y → look visual de grilla profesional.
 * 40 coincide con el gap del `<Background>` dots y con `snapGrid` del
 * `<ReactFlow>` — los 3 valores en sync para un UX consistente tipo draw.io.
 */
const SNAP_GRID_SIZE = 40;

// GROUP_RANK se importa desde layout-constants — single source of truth.
// Lo usa tanto el sort topológico (tie-break) como el ELK partitioning en
// `buildElkGraph` para agrupar nodos por banda arquitectónica.

/**
 * Aplica sort topológico a nodes/edges antes de pasarlos a ELK.
 *
 * Por qué es necesario aunque el prompt le pida al agente que ordene:
 * el LLM drifta — emite orden inconsistente. `considerModelOrder=NODES_AND_EDGES`
 * de ELK usa el orden de input como tie-break en LAYER_SWEEP, así que input
 * caótico genera layout caótico. Enforzamos el orden en código.
 *
 * Criterios del sort compuesto:
 *   1. `depth` (BFS desde roots): nodos de menor depth arriba; reduce edges que
 *      cruzan hacia arriba en la jerarquía visual.
 *   2. `groupRank`: en empates de depth, alinea con los swim lanes visuales.
 *   3. `originalIndex`: estable — preserva la semántica cuando el LLM sí fue
 *      cuidadoso con el orden.
 */
function topologicalSort(
  diagramNodes: DiagramNode[],
  diagramEdges: DiagramEdge[],
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const depthById = computeNodeDepths(diagramNodes, diagramEdges);

  // Nodos sin depth (grafos cíclicos puros) caen al final con depth=999.
  // Esto es defensivo — en la práctica siempre hay al menos un root.
  const FALLBACK_DEPTH = 999;

  const nodesWithMeta = diagramNodes.map((n, i) => ({
    n,
    i,
    depth: depthById.get(n.id) ?? FALLBACK_DEPTH,
    groupRank: GROUP_RANK[n.group ?? 'backend'] ?? GROUP_RANK.backend,
  }));
  nodesWithMeta.sort(
    (a, b) =>
      a.depth - b.depth || a.groupRank - b.groupRank || a.i - b.i,
  );
  const sortedNodes = nodesWithMeta.map(({ n }) => n);

  const edgesWithMeta = diagramEdges.map((e, i) => ({
    e,
    i,
    srcDepth: depthById.get(e.source) ?? FALLBACK_DEPTH,
    tgtDepth: depthById.get(e.target) ?? FALLBACK_DEPTH,
  }));
  edgesWithMeta.sort(
    (a, b) =>
      a.srcDepth - b.srcDepth || a.tgtDepth - b.tgtDepth || a.i - b.i,
  );
  const sortedEdges = edgesWithMeta.map(({ e }) => e);

  return { nodes: sortedNodes, edges: sortedEdges };
}

/**
 * Tamaño visual del ReferenceNode (ver `nodes/ReferenceNode.tsx`).
 * Se usa para posicionar el nodo correctamente respecto al source/target.
 */
const REF_NODE_SIZE = 28;

/**
 * Offset (px) entre el borde del source/target y el ReferenceNode. Suficiente
 * para que el ref no choque visualmente con el nodo al que representa.
 */
const REF_OFFSET = 40;

/**
 * Umbral de distancia en capas topológicas a partir del cual un edge se
 * considera "largo" y se rompe en un par de jump connectors.
 *
 * **Actualmente EFECTIVAMENTE DESACTIVADO** (valor 999) por feedback del
 * usuario: los jump connectors A/B generaban más ruido visual que valor,
 * especialmente en diagramas con muchos edges semánticamente largos o
 * tras persistir refs en el cache (quedaban marcadores flotantes sin
 * pair visible). Los edges largos ahora se trazan como waypoints ELK
 * normales — pueden atravesar zonas amplias del canvas, pero sin los
 * marcadores A/B/C distracciones.
 *
 * Para reactivar: bajar a 3-4. Para uso híbrido, considerar que el user
 * lo active solo bajo demanda (toggle en el viewer).
 */
const MAX_LAYER_DISTANCE = 999;

interface JumpConnectorParams {
  rfNodes: Node[];
  edges: EdgeWithHandles[];
  depthById: Map<string, number>;
  direction: LayoutDirection;
  measuredDimensions?: Map<string, { width: number; height: number }>;
  /**
   * Waypoints calculados por ELK (fase `elk.edgeRouting: ORTHOGONAL`) —
   * se propagan como `data.waypoints` a cada edge que NO se rompa en
   * jump connectors. Ausente en el fast-path manual (no hay ELK run) y
   * en el grid fallback; en esos casos los edges quedan sin waypoints y
   * `WaypointEdge` cae a `getSmoothStepPath`.
   */
  edgeRoutings?: Map<string, EdgeWaypoints>;
  /**
   * True cuando el editor está en modo edición. Se propaga a los refs
   * creados (`data.editing`) para activar el doble-click rename, y además
   * controla `draggable` del node: solo son arrastrables en modo edición,
   * consistente con el resto de los nodes del diagrama.
   */
  editing?: boolean;
}

/**
 * Rompe edges que cruzan muchas capas topológicas en pares de ReferenceNodes
 * circulares etiquetados con la misma letra (A, B, C...).
 *
 * Técnica estándar en flowcharts profesionales: cuando un edge va del layer 0
 * al layer 5, dibujarlo como línea única produce un trazo que atraviesa todo
 * el diagrama. El jump connector divide el edge en dos segmentos cortos:
 * `source → refOut[A]` y `refIn[A] → target`. El user sigue la letra para
 * reconstruir visualmente el flujo sin perder claridad.
 *
 * Aplica solo a edges con `|srcDepth - tgtDepth| >= MAX_LAYER_DISTANCE`. Los
 * edges cortos pasan sin modificación.
 */
export function insertJumpConnectors(params: JumpConnectorParams): {
  nodes: Node[];
  edges: Edge[];
} {
  const { rfNodes: rawRfNodes, edges: rawEdges, depthById, direction, measuredDimensions, edgeRoutings, editing } = params;

  // Desenrollar jump connectors persistidos: si el cache trae refs + edges
  // segmentados (`__jmp-out__${id}` / `__jmp-in__${id}`), los descartamos y
  // reconstruimos el edge original (mismo approach que `unfoldJumpConnectors`
  // del backend). Esto es necesario porque con MAX_LAYER_DISTANCE=999 ya no
  // generamos nuevos jumps, pero los del cache viejo quedaban flotantes
  // sin pair visible.
  const outSegments = new Map<string, EdgeWithHandles>();
  const inSegments = new Map<string, EdgeWithHandles>();
  const nonJumpEdgeInputs: EdgeWithHandles[] = [];
  for (const edge of rawEdges) {
    if (edge.id.startsWith('__jmp-out__')) {
      outSegments.set(edge.id.slice('__jmp-out__'.length), edge);
    } else if (edge.id.startsWith('__jmp-in__')) {
      inSegments.set(edge.id.slice('__jmp-in__'.length), edge);
    } else {
      nonJumpEdgeInputs.push(edge);
    }
  }
  const restoredOriginals: EdgeWithHandles[] = [];
  for (const [origId, outEdge] of outSegments) {
    const inEdge = inSegments.get(origId);
    if (!inEdge) continue;
    restoredOriginals.push({
      id: origId,
      source: outEdge.source,
      target: inEdge.target,
      sourceHandle: outEdge.sourceHandle,
      targetHandle: inEdge.targetHandle,
      label: inEdge.label,
      animated: outEdge.animated,
    });
  }
  const edges: EdgeWithHandles[] = [...nonJumpEdgeInputs, ...restoredOriginals];

  // Filtrar ref nodes persistidos — con MAX_LAYER_DISTANCE=999 ya no los
  // usamos, y dejarlos en el canvas producía marcadores A/B flotantes
  // sin sus edges segmentados (que acabamos de reconstruir a edges
  // originales).
  const rfNodes = rawRfNodes.filter((n) => n.type !== 'reference');

  const nodeById = new Map<string, Node>();
  for (const n of rfNodes) nodeById.set(n.id, n);

  // Legacy: detector de refs existentes — ahora vacío porque los filtramos
  // arriba. Se mantiene la variable para no tocar el resto de la función.
  const existingRefIds = new Set<string>();

  const extraNodes: Node[] = [];
  const resultEdges: Edge[] = [];
  let refCounter = 0;

  // Helper local — cada edge que NO se rompe en jump connectors pasa por
  // aquí y recibe su routing ortogonal si ELK lo calculó. Sin waypoints,
  // `WaypointEdge` delega a `getSmoothStepPath` (fast-path manual + fallback).
  //
  // Prioridad de sourceHandle/targetHandle:
  //  1. Si ELK reportó un handle (via `waypoints.sourceHandle/targetHandle`
  //     derivado del startPoint/endPoint de la section), usamos ese —
  //     refleja qué port eligió ELK respetando los ports declarados en
  //     buildElkGraph.
  //  2. Si no, el handle que asignó `applySmartHandles` basándose en
  //     positions (inferHandle heurístico).
  //
  // Efecto visual: los edges entran/salen por el lado que ELK consideró
  // óptimo. Sin este override, applySmartHandles siempre elegiría
  // right/left en layout LR y perderíamos el beneficio de los ports.
  const buildPrimaryEdge = (edge: EdgeWithHandles): Edge => {
    const waypoints = edgeRoutings?.get(edge.id);
    const rawSourceHandle = waypoints?.sourceHandle ?? edge.sourceHandle;
    const rawTargetHandle = waypoints?.targetHandle ?? edge.targetHandle;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      // Canonicaliza handle IDs huérfanos (edges de cache viejo con
      // `sourceHandle: 'top'` pre-handles-bidireccionales). Sin esto,
      // React Flow emite error #008 en loop al intentar resolver un
      // handle que no existe con el type requerido.
      sourceHandle: canonicalSourceHandle(rawSourceHandle),
      targetHandle: canonicalTargetHandle(rawTargetHandle),
      label: edge.label,
      animated: edge.animated,
      // `avoidNodes` = libavoid-js WASM obstacle avoidance. Reemplaza
      // el routing ortogonal de ELK que alimentaba a `WaypointEdge`.
      // El `data.waypoints` de ELK se mantiene como fallback: mientras
      // el worker de libavoid carga WASM (~500ms primer mount),
      // AvoidNodesEdge renderiza un path smooth-step provisional.
      type: 'avoidNodes',
      data: waypoints ? { waypoints } : undefined,
    };
  };

  for (const edge of edges) {
    const srcDepth = depthById.get(edge.source);
    const tgtDepth = depthById.get(edge.target);
    const distance =
      srcDepth !== undefined && tgtDepth !== undefined
        ? Math.abs(tgtDepth - srcDepth)
        : 0;

    if (distance < MAX_LAYER_DISTANCE) {
      resultEdges.push(buildPrimaryEdge(edge));
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      // Defensive: si por alguna razón no están en rfNodes, no rompemos.
      resultEdges.push(buildPrimaryEdge(edge));
      continue;
    }

    const sourceDim =
      measuredDimensions?.get(sourceNode.id) ??
      nodeDimensions[sourceNode.type ?? 'serviceNode'] ??
      nodeDimensions.serviceNode;
    const targetDim =
      measuredDimensions?.get(targetNode.id) ??
      nodeDimensions[targetNode.type ?? 'serviceNode'] ??
      nodeDimensions.serviceNode;

    // Letra cíclica A-Z. Si hay >26 edges largos, ciclamos — aceptable: es
    // muy raro ver diagramas con >26 jumps, y duplicar la letra AA/BB queda
    // fuera de alcance de esta iteración.
    const label = String.fromCharCode(65 + (refCounter % 26));
    refCounter++;

    let refOutPos: { x: number; y: number };
    let refInPos: { x: number; y: number };

    if (direction === 'LR') {
      // En LR: ref sale a la derecha del source, entra por la izquierda del target.
      refOutPos = {
        x: sourceNode.position.x + sourceDim.width + REF_OFFSET,
        y: sourceNode.position.y + sourceDim.height / 2 - REF_NODE_SIZE / 2,
      };
      refInPos = {
        x: targetNode.position.x - REF_OFFSET - REF_NODE_SIZE,
        y: targetNode.position.y + targetDim.height / 2 - REF_NODE_SIZE / 2,
      };
    } else {
      // En TB: ref sale abajo del source, entra por arriba del target.
      refOutPos = {
        x: sourceNode.position.x + sourceDim.width / 2 - REF_NODE_SIZE / 2,
        y: sourceNode.position.y + sourceDim.height + REF_OFFSET,
      };
      refInPos = {
        x: targetNode.position.x + targetDim.width / 2 - REF_NODE_SIZE / 2,
        y: targetNode.position.y - REF_OFFSET - REF_NODE_SIZE,
      };
    }

    // Prefijos `__jmp-*__` intencionalmente raros para evitar colisión con
    // IDs que el LLM pueda generar (fix QA-BLOCK: un edge original con id
    // terminando en `-to-ref` / `-from-ref` era borrado silenciosamente por
    // los filtros de save/autosave). Doble underscore ± guión medio es un
    // patrón improbable en IDs user-facing y filtrable por `startsWith`.
    const refOutId = `__jmp-out__${edge.id}`;
    const refInId = `__jmp-in__${edge.id}`;

    // Idempotencia: si el ref ya existe en rfNodes (persistido de una
    // partición anterior), NO lo duplicamos. Los nodos persistidos
    // mantienen su posición custom (si el user los movió) y su label
    // (si renombró). Este caso solo ocurre cuando `insertJumpConnectors`
    // corre sobre un diagrama ya particionado — situación transitoria
    // durante la migración de artefactos sintéticos a nodos reales.
    if (!existingRefIds.has(refOutId)) {
      extraNodes.push({
        id: refOutId,
        type: 'reference',
        position: refOutPos,
        data: { label, editing },
        draggable: Boolean(editing),
        selectable: true,
      });
    }
    if (!existingRefIds.has(refInId)) {
      extraNodes.push({
        id: refInId,
        type: 'reference',
        position: refInPos,
        data: { label, editing },
        draggable: Boolean(editing),
        selectable: true,
      });
    }

    // Segmento 1: source → refOut (mantiene sourceHandle original)
    resultEdges.push({
      id: `__jmp-out__${edge.id}`,
      source: edge.source,
      target: refOutId,
      sourceHandle: edge.sourceHandle,
      animated: edge.animated,
      type: 'smoothstep',
    });
    // Segmento 2: refIn → target (mantiene targetHandle y label originales)
    resultEdges.push({
      id: `__jmp-in__${edge.id}`,
      source: refInId,
      target: edge.target,
      targetHandle: edge.targetHandle,
      label: edge.label,
      animated: edge.animated,
      type: 'smoothstep',
    });
  }

  return {
    nodes: [...rfNodes, ...extraNodes],
    edges: resultEdges,
  };
}

export interface GroupedLayoutResult {
  nodes: Node[];
  edges: Edge[];
  direction: LayoutDirection;
  clusters: ClusterBounds[];
  /** `true` hasta que ELK resuelve el primer layout (o falla al fallback). */
  loading: boolean;
  /** Si ELK tiró, contiene el mensaje. El resultado cae a layout lineal para
   *  que el canvas siempre tenga algo que renderizar. */
  error: string | null;
}

export interface GroupedLayoutOptions {
  /**
   * Dimensiones medidas de nodos (del ResizeObserver). Si no hay medidas,
   * se usan los defaults de `nodeDimensions`.
   */
  measuredDimensions?: Map<string, { width: number; height: number }>;
  /** Override explícito de dirección; si no, se infiere. */
  direction?: LayoutDirection;
  /** `editing` se propaga a `data.editing` de cada nodo para estilos de handles. */
  editing?: boolean;
}

const DEFAULT_RESULT: GroupedLayoutResult = {
  nodes: [],
  edges: [],
  direction: 'LR',
  clusters: [],
  loading: true,
  error: null,
};

/**
 * Hook orquestador del pipeline de layout con ELK.js.
 *
 * Por qué ELK y no Dagre: ELK's `layered` algorithm con
 * `crossingMinimization.strategy=LAYER_SWEEP` y `hierarchyHandling=INCLUDE_CHILDREN`
 * reduce cruces de aristas globalmente (a través de clusters), no solo por
 * rank local como Dagre. Con `thoroughness=30` (vs default 7) paga CPU extra
 * por un resultado significativamente más limpio — el user explícitamente
 * priorizó calidad sobre costo.
 *
 * Async boundary: ELK retorna Promise, así que usamos useEffect+useState en
 * vez del useMemo sync del código anterior. El resultado inicial `{ loading:
 * true, nodes: [], ... }` permite al viewer mostrar un overlay mientras ELK
 * computa. Típicamente <500 ms para 20 nodos.
 *
 * Fallback: si ELK tira (SSR, input malformado, cycle edge-case), caemos a
 * un grid lineal idx-based. Nunca devolvemos un canvas roto — la degradación
 * es graceful.
 */
export function useGroupedLayout(
  diagram: EpicDiagram,
  opts: GroupedLayoutOptions = {},
): GroupedLayoutResult {
  const {
    measuredDimensions,
    direction: directionOverride,
    editing = false,
  } = opts;

  // Instancia de ELK reusada a través de renders. Lazy init dentro del
  // useEffect de layout (ver abajo) — NO la creamos en el render body
  // porque interactúa mal con el cleanup: si el ref queda nulo entre ciclos,
  // el effect dispara el fallback "ELK no inicializado" aunque estemos en
  // cliente.
  //
  // Nota de tipo: el default export de elkjs es un constructor (value),
  // no un tipo — usamos InstanceType<typeof ELK> para la instancia.
  const elkRef = useRef<InstanceType<typeof ELK> | null>(null);

  const [result, setResult] = useState<GroupedLayoutResult>(DEFAULT_RESULT);

  useEffect(() => {
    // SSR guard — elkjs requiere window. El render inicial del componente
    // puede correr en SSR (Next.js hydrates después). En ese caso el effect
    // no corre (useEffect solo se ejecuta en cliente), así que este check
    // es defensivo — en un entorno no-browser nunca debería entrar aquí.
    if (typeof window === 'undefined') {
      setResult({
        ...DEFAULT_RESULT,
        loading: false,
        error: 'ELK no inicializado (SSR / window undefined)',
      });
      return;
    }

    // Lazy init de ELK — creamos la instancia SOLO si no existe ya. Así
    // sobrevivimos StrictMode double-invocation sin race conditions y sin
    // recrear el worker en cada re-render que cambie las deps.
    //
    // No liberamos ELK en cleanup: `elk.bundled.js` no usa un Worker real
    // (todo inline), así que no hay leak que prevenir. El GC recoge la
    // instancia cuando el componente se desmonta definitivamente.
    if (!elkRef.current) {
      elkRef.current = new ELK();
    }

    let cancelled = false;

    // Fast-path: si el diagrama tiene layout manual COMPLETO (un entry en
    // manualPositions por cada node), saltamos ELK por completo — sería un
    // desperdicio de ~300ms de CPU que luego sobrescribimos posición por
    // posición. Aplicamos smart handles directo sobre rfNodes construidos
    // con las manual positions.
    const manualPositionsFast = diagram.hasManualLayout
      ? diagram.manualPositions ?? {}
      : null;
    const manualCount = manualPositionsFast ? Object.keys(manualPositionsFast).length : 0;
    const allManual =
      manualPositionsFast !== null &&
      manualCount >= diagram.nodes.length &&
      diagram.nodes.every((n) => {
        const p = manualPositionsFast[n.id];
        return p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y);
      });

    if (allManual) {
      const direction =
        directionOverride ?? inferLayoutDirection(diagram.nodes, diagram.edges);
      const rfNodes: Node[] = diagram.nodes.map((n) => {
        const shape = nodeTypeToShape[n.type] ?? 'serviceNode';
        const manualPos = manualPositionsFast![n.id];
        return {
          id: n.id,
          type: shape,
          position: { x: manualPos.x, y: manualPos.y },
          data: {
            label: n.label,
            description: n.description,
            nodeType: n.type,
            group: n.group,
            editing,
          },
          draggable: editing,
        };
      });
      const edgeDrafts = diagram.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.animated,
      }));
      const edgesWithHandles = applySmartHandles(rfNodes, edgeDrafts, diagram.nodes);

      // Jump connectors en el fast-path también. El user puede tener un
      // diagrama con manualPositions que siga teniendo edges semánticamente
      // largos — la técnica de partir en pares circulares no depende de ELK,
      // solo de la profundidad topológica.
      const depthById = computeNodeDepths(diagram.nodes, diagram.edges);
      const { nodes: nodesWithRefs, edges: edgesWithRefs } = insertJumpConnectors({
        rfNodes,
        edges: edgesWithHandles,
        depthById,
        direction,
        measuredDimensions,
        editing,
      });

      // Cluster bounds derivados de las manualPositions. Construimos
      // `positions` como Map con coords de CENTRO (convención interna).
      const fastPositions = new Map<string, AbsolutePosition>();
      for (const n of diagram.nodes) {
        const shape = nodeTypeToShape[n.type] ?? 'serviceNode';
        const dim =
          measuredDimensions?.get(n.id) ??
          nodeDimensions[shape] ??
          nodeDimensions.serviceNode;
        const manualPos = manualPositionsFast![n.id];
        fastPositions.set(n.id, {
          x: manualPos.x + dim.width / 2,
          y: manualPos.y + dim.height / 2,
          width: dim.width,
          height: dim.height,
        });
      }
      const fastClusters = computeClusterBounds(diagram.nodes, fastPositions);

      // Fast-path: snap-to-grid + collision resolution. El snap corrige
      // micro-desalineaciones de drags del user; el resolver fix overlaps
      // post-snap. Mismo approach que el ELK-path.
      const nodesSnappedFast = snapToGrid(nodesWithRefs, SNAP_GRID_SIZE);
      const fastCollision = resolveCollisions(nodesSnappedFast, {
        maxIterations: 50,
        overlapThreshold: 0.5,
        margin: 50,
      });

      setResult({
        nodes: fastCollision.nodes,
        edges: edgesWithRefs,
        direction,
        clusters: fastClusters,
        loading: false,
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async (): Promise<void> => {
      try {
        const direction =
          directionOverride ?? inferLayoutDirection(diagram.nodes, diagram.edges);
        const tuning = pickElkTuning(diagram.nodes.length);

        // Pre-sort topológico ANTES de pasar a ELK. Esto garantiza que
        // `considerModelOrder=NODES_AND_EDGES` (activo abajo) reciba un input
        // canónico en vez del orden random-ish que el LLM suele emitir. El
        // sort es pure function sobre el diagrama del prop — no muta nada.
        const { nodes: sortedNodes, edges: sortedEdges } = topologicalSort(
          diagram.nodes,
          diagram.edges,
        );

        const elkGraph = buildElkGraph({
          diagramNodes: sortedNodes,
          diagramEdges: sortedEdges,
          measuredDimensions,
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
            /*
             * ELK partitioning: agrupa nodos por `data.group` usando
             * GROUP_RANK como ID de partition. ELK coloca todos los
             * nodos de partition 0 (start), luego los de 1 (frontend),
             * etc. — produce bandas visuales tipo swim lane.
             *
             * Cada nodo individual lleva su `elk.partitioning.partition`
             * en `buildElkGraph`. Acá activamos el feature globalmente.
             *
             * Docs: https://eclipse.dev/elk/reference/options/org-eclipse-elk-partitioning-activate.html
             */
            'elk.partitioning.activate': 'true',
            // `SIMPLE` — garantiza que TODOS los nodos de un mismo layer
            // quedan alineados en el mismo centro Y (o X en LR). Produce
            // el look "grid-based" tipo Lucidchart: columnas verticales
            // perfectas y filas horizontales perfectas.
            //
            // Trade-off vs `BRANDES_KOEPF` anterior: este último balanceaba
            // entre 4 alineaciones (UP/DOWN × LEFT/RIGHT) para un look
            // "natural" pero producía filas imperfectas (diferencias de
            // ±10-20px entre nodos del mismo rank). SIMPLE es estrictamente
            // geométrico → columnas pixel-perfect. El post-snap a 40px
            // refuerza esto.
            //
            // `bk.fixedAlignment` ya no aplica (era opción de BRANDES_KOEPF)
            // — lo dejamos fuera explícitamente.
            'elk.layered.nodePlacement.strategy': 'SIMPLE',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            // `TWO_SIDED` es default pero lo hacemos explícito — post-
            // procesamiento agresivo que reduce cruces adicionales tras
            // LAYER_SWEEP estándar. Costo CPU aceptable para <40 nodos.
            'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
            'elk.layered.cycleBreaking.strategy': 'GREEDY',
            // `thoroughness: 15` (default 7) — más esfuerzo computacional en
            // optimización de layout. Para diagramas de ≤40 nodos el coste
            // es marginal (<100ms extra) y la calidad del layout mejora
            // notablemente: menos cruces, bends más limpios, spacing más
            // uniforme. Documentado en
            // eclipse.dev/elk/reference/options/org-eclipse-elk-layered-thoroughness.html
            'elk.layered.thoroughness': '15',
            // El pre-sort topológico (arriba) garantiza model order canónico;
            // ELK lo usa como tie-break durante LAYER_SWEEP.
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
            // `wrapping.strategy: SINGLE_EDGE` DESACTIVADO — lo probamos y
            // produjo caos: cada edge cross-chunk disparó el
            // `insertJumpConnectors` del frontend, multiplicando los
            // marcadores A/B/C hasta hacerlos incomprensibles. Wrapping
            // es útil solo cuando el consumer del layout maneja los edges
            // cross-chunk visualmente (típicamente sprotty); nuestro
            // pipeline los trata como edges largos y los parte.
            //
            // Alternativa para compactar grafos lineales largos: subir
            // `aspectRatio` (ya en 1.6), o cambiar `direction` a TB si
            // el user lo prefiere vertical.
            // `portAlignment.default: DISTRIBUTED` — con 3 ports por lado
            // (ver MultiSideHandles), DISTRIBUTED los espacia uniformemente
            // en el lado del nodo, evitando amontonamiento en uno de los
            // extremos. Impacto directo: edges que salen/entran por el
            // mismo lado quedan visualmente separados.
            'elk.portAlignment.default': 'DISTRIBUTED',
            // ORTHOGONAL edge routing: ELK añade una fase de routing al final
            // del pipeline Layered que inserta bendPoints en `edge.sections[]`
            // para que los edges rodeen nodos intermedios en lugar de
            // atravesarlos. Duplicamos la opción global y la layered-específica
            // porque algunas versiones de elkjs respetan solo una de las dos
            // — cinturón + tirantes.
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.layered.edgeRouting': 'ORTHOGONAL',
            // Diagnóstico observado: ELK con sólo `edgeRouting=ORTHOGONAL`
            // emite `bends=0` para edges cuyo source y target ELK considera
            // "alineados" (misma fila/columna) — trazo recto sin bends,
            // matemáticamente ortogonal pero puede atravesar nodos
            // intermedios. `unnecessaryBendpoints=false` le dice a ELK
            // "mantén todos los bends aunque parezcan redundantes" — así
            // los edges cross-layer conservan el bend que los hace rodear
            // obstáculos.
            'elk.layered.unnecessaryBendpoints': 'false',
            // `elk.spacing.edgeNode` en 40: gap mínimo entre un edge
            // ruteado y un nodo vecino. Observado empíricamente: >=50
            // ELK reinterpreta el grafo como necesitando más capas y
            // estira el layout hasta una sola fila (17 nodos → 17
            // columnas). 40 deja holgura suficiente combinado con el
            // A* fallback del WaypointEdge (nodePadding=30) que recoge
            // los casos donde ELK quedó rozando el texto externo de un
            // Actor/State.
            'elk.spacing.edgeNode': '80',
            // `elk.aspectRatio: 1.6` — guía a ELK para que el bounding
            // box resultante tenga proporción ≈16:10 en lugar de
            // extremadamente alargado. Sin esta opción, un grafo
            // mayoritariamente lineal (cadena de 17 nodos) produce un
            // layout 17×1 ilegible. Con aspectRatio el engine prefiere
            // agrupar nodos en múltiples filas paralelas respetando la
            // semántica de capas topológicas.
            'elk.aspectRatio': '1.6',
            // `spacing.edgeNodeBetweenLayers: 30` (default 10). Controla el
            // gap entre edges que corren EN PARALELO a una capa y los
            // nodos de esa capa. Distinto de `spacing.edgeNode` que maneja
            // edges cross-layer. Subirlo reduce el caso donde un edge
            // paralelo roza el label de un nodo vecino. Documentado en
            // eclipse.dev/elk/reference/options/org-eclipse-elk-layered-spacing-edgeNodeBetweenLayers.html
            'elk.layered.spacing.edgeNodeBetweenLayers': '60',
            // Espacio mínimo entre dos edges paralelos. Complementa
            // `edgesep` del tuning: separa los canales cuando varios edges
            // corren en paralelo por la misma gutter.
            'elk.spacing.edgeEdge': String(tuning.edgesep),
            'elk.spacing.nodeNode': String(tuning.nodesep),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(tuning.ranksep),
            'elk.padding': `[top=${tuning.marginy},left=${tuning.marginx},bottom=${tuning.marginy},right=${tuning.marginx}]`,
            // ELIMINADOS respecto a configs previas:
            //  - `elk.hierarchyHandling: INCLUDE_CHILDREN`: ya no hay compound
            //    (grafo aplanado); los "clusters" se computan post-layout como
            //    bounds agregados (`computeClusterBounds`), no como estructura
            //    ELK. Issue eclipse-elk#316 (packing agresivo dentro del
            //    compound) queda resuelto de raíz.
            //  - `favorStraightEdges`: era no-op con SIMPLE; SIMPLE ya
            //    prioriza alineación limpia sin parámetro extra.
            //  - `thoroughness=30`: default de ELK ya produce layouts limpios
            //    con grafo plano; subirlo era un parche para el packing
            //    roto del compound.
          },
        });

        const laid = await elkRef.current!.layout(elkGraph);
        if (cancelled) return;

        const { positions, edgeRoutings } = absolutizeElkLayout(laid);
        const clusters = computeClusterBounds(diagram.nodes, positions);

        // Respeta manualPositions cuando el user movió nodes manualmente.
        // `ELK solo aplica si NO hay positions manuales — mantenemos el
        // comportamiento del hook anterior.
        const manualPositions = diagram.hasManualLayout
          ? diagram.manualPositions ?? {}
          : null;

        const rfNodes: Node[] = diagram.nodes.map((n, idx) => {
          const shape = nodeTypeToShape[n.type] ?? 'serviceNode';
          const dim =
            measuredDimensions?.get(n.id) ??
            nodeDimensions[shape] ??
            nodeDimensions.serviceNode;

          const manualPos = manualPositions?.[n.id];
          let positionOffset: { x: number; y: number };

          if (
            manualPos &&
            Number.isFinite(manualPos.x) &&
            Number.isFinite(manualPos.y)
          ) {
            // Posición manual — ya guardada con offset top-left aplicado.
            positionOffset = { x: manualPos.x, y: manualPos.y };
          } else {
            const pos = positions.get(n.id);
            if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
              // `absolutizeElkLayout` devuelve coords del CENTRO (convención
              // Dagre que downstream code espera). ReactFlow necesita top-left.
              positionOffset = {
                x: pos.x - dim.width / 2,
                y: pos.y - dim.height / 2,
              };
            } else {
              positionOffset = { x: idx * (dim.width + 40), y: 0 };
            }
          }

          return {
            id: n.id,
            type: shape,
            position: positionOffset,
            data: {
              label: n.label,
              description: n.description,
              nodeType: n.type,
              group: n.group,
              editing,
            },
            draggable: editing,
          };
        });

        // Edges: pipeline post-layout — smart handles (determinísticos por
        // posición) + jump connectors para edges que cruzan muchas capas.
        const edgeDrafts = diagram.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: e.animated,
        }));
        const edgesWithHandles = applySmartHandles(
          rfNodes,
          edgeDrafts,
          diagram.nodes,
        );

        // Rompe edges largos (saltan ≥3 capas topológicas) en pares de
        // ReferenceNodes. Usa depthById del sort topológico como métrica de
        // "distancia" — coincide con la percepción visual del user de
        // "edge que cruza todo el diagrama".
        const depthById = computeNodeDepths(diagram.nodes, diagram.edges);

        // Fix QA-HIGH: si hay CUALQUIER posición manual (parcial — el user
        // movió algunos nodes y el agente añadió otros), los `edgeRoutings`
        // de ELK fueron calculados para las posiciones ELK puras y NO
        // corresponden con las coords manuales mezcladas. Los bends
        // quedarían "flotando" donde el nodo ya no está. En ese caso
        // omitimos waypoints → `WaypointEdge` cae a `getSmoothStepPath`,
        // que se auto-ajusta a los handles reales (sourceX/targetX).
        const hasAnyManualPositions =
          manualPositions !== null && Object.keys(manualPositions).length > 0;
        const { nodes: nodesWithRefs, edges: edgesWithRefs } = insertJumpConnectors({
          rfNodes,
          edges: edgesWithHandles,
          depthById,
          direction,
          measuredDimensions,
          edgeRoutings: hasAnyManualPositions ? undefined : edgeRoutings,
          editing,
        });

        // Post-ELK: snap-to-grid + collision resolution en orden.
        // 1. Snap alinea todas las posiciones a múltiplos de SNAP_GRID_SIZE —
        //    elimina micro-desalineaciones de ELK y produce un layout
        //    visualmente ordenado (todos los nodos en una grilla invisible).
        // 2. Collision resolution corrige cualquier overlap que el snap
        //    pudiera introducir (dos nodos cayendo en la misma celda del
        //    grid).
        const nodesSnapped = snapToGrid(nodesWithRefs, SNAP_GRID_SIZE);
        const collisionResult = resolveCollisions(nodesSnapped, {
          maxIterations: 50,
          overlapThreshold: 0.5,
          margin: 50,
        });
        const nodesNoCollisions = collisionResult.nodes;

        if (cancelled) return;

        setResult({
          nodes: nodesNoCollisions,
          edges: edgesWithRefs,
          direction,
          clusters,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);

        // Grid fallback lineal — nunca dejamos el canvas vacío. 5 columnas,
        // spacing arbitrario pero consistente. Edges sin smart handles para
        // evitar posibles bugs downstream.
        const rfNodes: Node[] = diagram.nodes.map((n, idx) => {
          const shape = nodeTypeToShape[n.type] ?? 'serviceNode';
          const dim =
            measuredDimensions?.get(n.id) ??
            nodeDimensions[shape] ??
            nodeDimensions.serviceNode;
          return {
            id: n.id,
            type: shape,
            position: {
              x: (idx % 5) * (dim.width + 40),
              y: Math.floor(idx / 5) * (dim.height + 60),
            },
            data: {
              label: n.label,
              description: n.description,
              nodeType: n.type,
              group: n.group,
              editing,
            },
            draggable: editing,
          };
        });
        const rfEdges: Edge[] = diagram.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          // Canonicaliza handle IDs huérfanos también en el fallback.
          sourceHandle: canonicalSourceHandle(e.sourceHandle),
          targetHandle: canonicalTargetHandle(e.targetHandle),
          label: e.label,
          animated: e.animated,
          // Fallback path (ELK falló): libavoid sigue siendo el router,
          // simplemente sin bendPoints iniciales de ELK. El Worker
          // recomputa desde las posiciones manuales/stub del fallback.
          type: 'avoidNodes',
        }));
        setResult({
          nodes: rfNodes,
          edges: rfEdges,
          direction: directionOverride ?? 'LR',
          clusters: [],
          loading: false,
          error: message,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [diagram, measuredDimensions, directionOverride, editing]);

  return result;
}
