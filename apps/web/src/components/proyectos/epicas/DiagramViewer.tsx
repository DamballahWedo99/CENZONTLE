'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Connection,
  ConnectionMode,
  addEdge,
  Panel,
  NodeChange,
  EdgeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { EpicDiagram, DiagramNode, DiagramEdge, DiagramNodeType } from '@cenzontle/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Save, RotateCcw, MousePointer2, Shuffle } from 'lucide-react';
import { resetDiagramLayout } from '@/lib/diagram-agent';

// Layout pipeline extraído a diagram-layout/
import { nodeTypes } from './diagram-layout/nodes';
import {
  canonicalSourceHandle,
  canonicalTargetHandle,
  shapeToNodeType,
  makeEdgeStyle,
} from './diagram-layout/layout-constants';
import { useGroupedLayout } from './diagram-layout/useGroupedLayout';
import { resolveCollisions, snapToGrid } from './diagram-layout/resolve-collisions';
// `ClusterBackground` desmontado — deshabilitamos los fondos por grupo.
// El componente sigue existiendo en `diagram-layout/cluster-background.tsx`
// por si se reactiva más adelante; solo no lo importamos acá.
// import { ClusterBackground } from './diagram-layout/cluster-background';

/**
 * Tamaño del grid para snap al arrastrar nodos. Debe coincidir con
 * `SNAP_GRID_SIZE` en useGroupedLayout.ts para que el drag produzca
 * posiciones consistentes con el layout inicial.
 */
const DRAG_SNAP_GRID_SIZE = 40;
import { useMeasuredDimensions } from './diagram-layout/useMeasuredDimensions';
import { SmartStepEdge } from './diagram-layout/edges/SmartStepEdge';
import { WaypointEdge } from './diagram-layout/edges/WaypointEdge';
/*
 * libavoid-js (vía `avoid-nodes-edge`) — routing ortogonal con obstacle
 * avoidance genuino. El motor C++ original de draw.io/Inkscape/Dia,
 * compilado a WASM, corriendo en Web Worker para no bloquear el hilo
 * principal. Reemplaza el routing ortogonal que ELK provee via
 * `edgeRouting: ORTHOGONAL` — ELK asume layered, libavoid no (A* sobre
 * visibility graph del espacio 2D entero, más nudging de edges paralelos).
 *
 * Licencia: avoid-nodes-edge MIT con restricción de no-republicación en
 * registries (OK para uso interno en CENZONTLE). libavoid-js (dep
 * transitiva): LGPL-2.1-or-later — attribution en NOTICES.md.
 *
 * El .wasm se sirve desde `/libavoid.wasm` en Next.js (copiado por
 * `scripts/copy-libavoid-wasm.cjs` via postinstall).
 */
import { AvoidNodesEdge } from 'avoid-nodes-edge/edge';
import { useAvoidNodesRouterFromWorker } from 'avoid-nodes-edge';
import { useDiagramTheme, isLightColor } from './diagram-layout/useDiagramTheme';
import { useOrgDiagramTheme } from './diagram-layout/useOrgDiagramTheme';
import { DiagramThemePanel } from './diagram-layout/DiagramThemePanel';
import { ColorLegend } from './diagram-layout/ColorLegend';
import { useDiagramEditor } from './diagram-layout/editor/useDiagramEditor';
import { EditToolbar } from './diagram-layout/editor/EditToolbar';
import { PropertyPanel } from './diagram-layout/editor/PropertyPanel';
import { useDropNode } from './diagram-layout/editor/useDropNode';
import { useDiagramHistory } from './diagram-layout/editor/useDiagramHistory';
import { useDiagramKeyboard } from './diagram-layout/editor/useDiagramKeyboard';
import { DiagramContextMenu, useContextMenu } from './diagram-layout/editor/DiagramContextMenu';
import { useDiagramAutoSave } from './diagram-layout/editor/useDiagramAutoSave';
import { SaveIndicator } from './diagram-layout/editor/SaveIndicator';

// Registro de edge types:
//  - `avoidNodes` (activo por default): routing ortogonal con obstacle
//    avoidance real vía libavoid-js (WASM + Web Worker). Las aristas dan
//    la vuelta alrededor de cualquier nodo que no sea source/target,
//    aristas paralelas se separan automáticamente (nudging). Usa el
//    hook `useAvoidNodesRouterFromWorker` más abajo.
//  - `waypoint` (fallback, usado por cache persistido): consume los
//    bendPoints que ELK calcula durante `elk.edgeRouting: ORTHOGONAL`.
//    Se mantiene registrado por compatibilidad con diagramas viejos en
//    Redis cache que traen `type: 'waypoint'`. El nuevo flow (ver
//    `useGroupedLayout`) emite `type: 'avoidNodes'` por default.
//  - `smart` (legacy): wrapper sobre @tisoap/react-flow-smart-edge (A*
//    cliente). Se mantiene registrado porque algunos edges persistidos
//    del caché Redis pueden seguir trayendo `type: 'smart'`; el renderer
//    no crashea y el user puede re-generar el diagrama para migrar.
//  - Resto: XYFlow nativo (smoothstep, step, straight, bezier).
const edgeTypes = {
  avoidNodes: AvoidNodesEdge,
  smart: SmartStepEdge,
  waypoint: WaypointEdge,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// DiagramViewer
// ────────────────────────────────────────────────────────────────────────────

interface DiagramViewerProps {
  diagram: EpicDiagram;
  editable?: boolean;
  onDiagramChange?: (diagram: EpicDiagram) => void;
  fullHeight?: boolean;
  /**
   * Si se pasa, activa auto-save durante edición: los cambios se persisten
   * al cache Redis con debounce 500ms. Sin epicId el editor sigue funcional
   * pero solo guarda al pulsar "Guardar" explícito.
   */
  epicId?: string;
  /**
   * Set de nodeIds a iluminar (paso activo del sidepanel). Cuando es
   * no-vacío, toma precedencia sobre el hover-de-nodo individual: los nodos
   * fuera del set se atenúan y los edges cuyos ambos endpoints están en el
   * set se resaltan. Cuando es vacío o undefined, el highlight cae al
   * comportamiento existente de hover-nodo.
   */
  highlightedNodeIds?: Set<string>;
  /**
   * Lista de nodeIds sobre los que hacer zoom/pan del viewport. Deliberadamente
   * SEPARADO de `highlightedNodeIds` porque el highlight responde a hover+click
   * (debe ser barato, sin mover la cámara) mientras que este focus responde
   * SOLO al click (debe mover la cámara, pero solo cuando el user "ancla" un
   * paso). Pasar `null` o array vacío → fitView a todos los nodos (reset).
   * Pasar IDs → fitView limitado a ese subset con padding amplio.
   */
  focusNodeIds?: string[] | null;
  /**
   * Callback invocado cuando el user clickea un nodo del canvas que pertenece
   * a un step del flujo (`diagram.steps[].nodeIds`). El parent (DiagramFullPage)
   * lo usa para setear `clickedStepId` — lo que abre el bottom panel, aplica
   * highlight y hace zoom. Sin este callback, click en nodo fuera de edición
   * es no-op (preserva comportamiento legacy).
   */
  onStepFromNode?: (stepId: string) => void;
}

export function DiagramViewer({
  diagram,
  editable = false,
  onDiagramChange,
  fullHeight = false,
  epicId,
  highlightedNodeIds: externalHighlightedNodeIds,
  focusNodeIds,
  onStepFromNode,
}: DiagramViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  /*
    `editModeMounted` desacopla presencia en el DOM de la animación. Cuando
    `isEditing` pasa de true → false, los paneles (EditToolbar, PropertyPanel)
    permanecen montados durante `EDIT_ANIM_MS` para que la
    animación-out se reproduzca; tras ese delay, `editModeMounted` pasa a
    false y los paneles se desmontan. Mismo patrón que `DiagramThemePanel`.

    Guardia contra race-condition en toggle rápido: si el user hace
    edit → cancel → edit dentro de los 180 ms, el timer del ciclo anterior
    podría desmontar los paneles cuando `isEditing` ya es `true` de nuevo.
    Leemos el estado destino vía ref en el callback del timer para que la
    cleanup del useEffect no elimine los paneles del nuevo ciclo.
  */
  const [editModeMounted, setEditModeMounted] = useState(false);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const EDIT_ANIM_MS = 180;
  useEffect(() => {
    if (isEditing) {
      setEditModeMounted(true);
      return;
    }
    if (!editModeMounted) return;
    const timer = window.setTimeout(() => {
      // Re-check destino: si el user reabrió edit dentro del anim window,
      // el ref trae el valor actual y abortamos el dismount.
      if (!isEditingRef.current) setEditModeMounted(false);
    }, EDIT_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [isEditing, editModeMounted]);

  // Dos flags distintas, intencionalmente separadas:
  //   - `hadManualLayoutOnLoadRef`: el diagrama entró con `hasManualLayout=true`
  //     (posiciones manuales previas). Se lee una vez al montar.
  //   - `modifiedThisSessionRef`: el user DROP/DRAG algo en esta sesión de
  //     edición. Solo se enciende con drags reales o nodes añadidos.
  //
  // Separarlas evita el bug de "cristalización" (QA H6): si el user solo abre
  // edit y cierra sin cambios, no queremos sobrescribir `manualPositions` con
  // lo que Dagre acabó de calcular — preservamos las positions originales.
  const hadManualLayoutOnLoadRef = useRef<boolean>(Boolean(diagram.hasManualLayout));
  // Convertido de ref a state (fix Arch H9 + QA H4): como `useMemo` observa
  // dependencies reactive, un ref no disparaba recompute del
  // `liveDiagramForAutoSave`. Con state, el autosave solo cristaliza
  // `manualPositions` cuando el user REALMENTE modificó algo esta sesión.
  const [hasModifiedThisSession, setHasModifiedThisSession] = useState(false);

  // Snapshot de `{nodes, edges}` al entrar a edit. `handleReset` restaura
  // desde aquí — inmune a cambios externos del prop `diagram` durante la
  // sesión de edición (QA H2).
  const editSnapshotRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  // Refs de nodes/edges actualizados en cada render. Usados en
  // `toggleEditing` para evitar capturar esos arrays en el closure del
  // useCallback (fix QA H5 / Arch M3): si los capturara, el callback se
  // recrearía en cada render del canvas, invalidando referencias memorizadas
  // en el botón "Editar diagrama".
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  // Tema configurable (fondo + color de nodos) persistido en localStorage.
  // Se propaga a los nodes via CSS variables en el contenedor, evitando
  // re-renders individuales cuando cambia el color.
  const { theme, setBackground, reset: resetTheme } = useDiagramTheme();

  // Tema org-wide (colores por grupo) persistido en el backend + RBAC.
  // Se aplica vía CSS variables `--diagram-group-${group}-bg` en el
  // contenedor; los custom nodes las consumen sin re-renders.
  const orgTheme = useOrgDiagramTheme();

  // Vars CSS para colores-por-grupo. Memoizado sobre `orgTheme.colors`
  // (identity estable mientras no cambien los colores) para evitar
  // recomputar el record en cada render del viewer, lo que invalidaría
  // el `style` del contenedor y forzaría un reflow innecesario.
  const groupThemeVars = useMemo<Record<string, string>>(() => {
    const vars: Record<string, string> = {};
    for (const [group, color] of Object.entries(orgTheme.colors)) {
      vars[`--diagram-group-${group}-bg`] = color;
    }
    // CSS vars de colores de texto — los 6 nodos custom las consumen vía
    // `text-[color:var(--diagram-title-color,#ffffff)]` sin necesidad de
    // propagar por props. Cambiar un color re-pinta todos los nodos sin
    // disparar un React re-render.
    vars['--diagram-title-color'] = orgTheme.textColors.title;
    vars['--diagram-description-color'] = orgTheme.textColors.description;
    return vars;
  }, [orgTheme.colors, orgTheme.textColors]);

  // Color automático de los puntos del fondo: contrasta con el color del
  // canvas para que los puntos sean visibles sobre cualquier fondo elegido.
  const dotsColor = isLightColor(theme.background)
    ? 'rgba(39, 39, 42, 0.35)'
    : 'rgba(212, 212, 216, 0.25)';

  // Container ref para el ResizeObserver que mide nodos reales
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Instancia de ReactFlow para llamar fitView controlado
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Estado paralelo a `rfInstanceRef` para uso REACTIVO (refs no disparan
  // re-renders ni invalidan deps de useEffect). Sin este flag, el useEffect
  // de fitView corría una vez con `rfInstanceRef.current=null` y no se
  // re-disparaba cuando `onInit` asignaba la instancia → el diagrama
  // cargaba sin centrar correctamente.
  const [isInstanceReady, setIsInstanceReady] = useState(false);
  // Fingerprint del último layout fitteado. Cambia cuando ELK produce nuevas
  // posiciones (por ej. después de `useMeasuredDimensions` que mide los
  // nodos reales y dispara re-layout). Antes usábamos `diagram.id`, pero
  // múltiples re-layouts del mismo diagrama producían fingerprints distintos
  // que nuestro guard ignoraba — el primer fit quedaba aplicado a layout
  // stale. Ahora re-fittea cada vez que las posiciones reales cambian.
  const lastFittedFingerprintRef = useRef<string | null>(null);
  // Flag para suprimir el flickering del primer load: ELK produce 2-3 passes
  // de layout (primero con dimensiones default, luego con tamaños medidos
  // por ResizeObserver, luego con collision resolution). Cada pass cambia
  // las posiciones de los nodos y dispara re-fit — visualmente el user ve
  // los nodos "saltar" mientras estabilizan. Con este flag mostramos un
  // skeleton hasta que el primer fit corra sobre el último layout estable;
  // el reveal del diagrama ya centrado es instantáneo y limpio.
  // Se resetea a false cuando cambia `diagram.id` (nuevo diagrama → nuevo
  // ciclo de loading + fit).
  const [hasFittedFirstTime, setHasFittedFirstTime] = useState(false);

  // Mediciones reales de tamaños — si el CSS expandió un nodo más allá del
  // default en `nodeDimensions`, el hook devuelve un map para forzar re-layout.
  const measured = useMeasuredDimensions(containerRef.current, isEditing);

  // Pipeline de layout con ELK.js: async, devuelve loading/error además de
  // nodes/edges/clusters. Durante el primer compute (~100-500ms para 20 nodos
  // con thoroughness=30), `loading=true` dispara un overlay.
  const {
    nodes: layoutedNodes,
    edges: layoutedEdges,
    clusters,
    loading: layoutLoading,
    error: layoutError,
  } = useGroupedLayout(diagram, {
    measuredDimensions: measured,
    editing: isEditing,
  });

  // ReactFlow controla nodes/edges en estado local para soportar drag manual
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  /*
   * Hover highlight — cuando el cursor está sobre un nodo, las aristas
   * conectadas a él (source o target) se iluminan (stroke indigo + width
   * +1px) y las no-conectadas se atenúan a opacity 0.2. Da contexto
   * visual inmediato: "¿qué tiene que ver este nodo con los demás?".
   *
   * Se actualiza vía `onNodeMouseEnter`/`onNodeMouseLeave` del React Flow
   * (props nativos — no toca los custom nodes). El useMemo de
   * `enrichedEdges` incluye este state en su dep array para recomputar
   * los estilos en cada cambio.
   */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Mantener refs sincronizados a cada render — así callbacks estables
  // (toggleEditing, handleSave) pueden leer el estado actual sin capturar
  // el array en su closure (evita recreación del callback por frame).
  nodesRef.current = nodes;
  edgesRef.current = edges;

  /*
   * Router de obstacle-avoidance de libavoid-js corriendo en Web Worker.
   * El hook arranca el worker en el primer render (lazy: la carga del WASM
   * ~500 KB es async; mientras se compila, `AvoidNodesEdge` cae a
   * smooth-step fallback en cada edge). En `updateRoutingOnNodesChange`
   * ReactFlow nos da los `NodeChange[]` del drag → los propagamos al
   * worker para re-route incremental. `resetRouting` fuerza un re-compute
   * completo (usado cuando cambia topología: add/remove edge).
   *
   * Tuning — validado leyendo el source de `avoid-nodes-edge/dist/index.js`
   * + comportamiento de draw.io (floating connections, no fixed points):
   *
   *   - `edgeToNodeSpacing: 20` → internamente `shapeBufferDistance` del
   *     libavoid Router. Gap entre edge ruteado y borde de nodo vecino.
   *   - `edgeToEdgeSpacing: 25` → internamente `idealNudgingDistance`.
   *     Separación entre edges paralelos. Valor alto (25) da aire
   *     suficiente para 3+ edges entre los mismos nodos.
   *   - `edgeRounding: 8` — radio de las curvas en los bends ortogonales.
   *   - `autoBestSideConnection: TRUE` — libavoid decide el mejor lado
   *     de entrada/salida según la geometría (como draw.io floating
   *     connections). El usuario arrastra "del nodo al nodo" y el router
   *     optimiza el path automáticamente. La dirección de la flecha
   *     (source → target) SIGUE respetando el gesto porque la asignamos
   *     manualmente desde `connectionState.fromNode/toNode` en
   *     `onConnectEnd`. Solo el LADO por donde entra/sale es auto.
   *
   *     Por qué no `false`: con `false`, libavoid respeta el
   *     sourceHandle/targetHandle literal del edge. Con mis handles
   *     bidireccionales superpuestos (mismo spot en cada lado), el
   *     handle activado depende del z-index del DOM — no de la
   *     "intención" del usuario. Si el z-order activa el handle top
   *     pero el usuario quería ir abajo, libavoid fuerza un path
   *     absurdo que rodea todo para salir por arriba. `true` evita esto
   *     dejando que el router decida el lado más corto.
   *   - `shouldSplitEdgesNearHandle: true` → libavoid distribuye
   *     múltiples edges paralelos a lo largo del borde del nodo en
   *     lugar de convergerlos en un solo punto.
   */
  const { updateRoutingOnNodesChange, resetRouting } = useAvoidNodesRouterFromWorker(
    nodes,
    edges,
    {
      edgeToNodeSpacing: 20,
      edgeToEdgeSpacing: 25,
      edgeRounding: 8,
      autoBestSideConnection: true,
      shouldSplitEdgesNearHandle: true,
    },
  );

  // State machine central del modo edición: selección, tool activo, y
  // operaciones atómicas (add/update/delete node|edge). El hook NO
  // mantiene copia separada de nodes/edges — opera directamente sobre los
  // setters de React Flow. Single source of truth.
  const editor = useDiagramEditor({
    nodes,
    setNodes,
    edges,
    setEdges,
    onManualLayout: () => {
      setHasModifiedThisSession(true);
    },
  });

  // Undo/redo: useDiagramHistory acepta setters "directos" (array → array,
  // no updater). React Flow `useNodesState` devuelve setters con signature
  // `(updater) => void`, así que wrapeamos cada uno en un callback que
  // convierte array a updater.
  const setNodesDirect = useCallback((next: Node[]) => setNodes(() => next), [setNodes]);
  const setEdgesDirect = useCallback((next: Edge[]) => setEdges(() => next), [setEdges]);

  const history = useDiagramHistory({
    nodes,
    edges,
    setNodes: setNodesDirect,
    setEdges: setEdgesDirect,
  });

  // Keyboard shortcuts: callbacks wrapeados en useCallback con dependencias
  // estables (fix QA H1). Sin esto, los callbacks inline se recrean en cada
  // render del viewer y el useEffect del hook remonta el listener global,
  // creando ventanas donde teclas no se detectan durante edición intensa.
  const kbOnDelete = useCallback(() => {
    const count = editor.selection.nodeIds.size + (editor.selection.edgeId ? 1 : 0);
    if (count === 0) return;
    history.push();
    editor.deleteSelection();
    // Toast con acción "Deshacer" — patrón Gmail/Figma. El user puede
    // cancelar la eliminación sin memorizar Cmd+Z.
    toast.success(count === 1 ? 'Elemento eliminado' : `${count} elementos eliminados`, {
      action: { label: 'Deshacer', onClick: () => history.undo() },
    });
  }, [history, editor]);
  const kbOnDuplicate = useCallback(() => {
    if (editor.selection.nodeIds.size === 0) return;
    history.push();
    editor.duplicateSelection();
    toast.success('Nodo duplicado', {
      action: { label: 'Deshacer', onClick: () => history.undo() },
    });
  }, [history, editor]);
  const kbOnEscape = useCallback(() => {
    editor.clearSelection();
    editor.setActiveTool(null);
  }, [editor]);
  const kbOnNudge = useCallback(
    (dx: number, dy: number) => {
      history.push();
      editor.nudgeSelection(dx, dy);
    },
    [history, editor],
  );
  useDiagramKeyboard({
    enabled: isEditing,
    onDelete: kbOnDelete,
    onUndo: history.undo,
    onRedo: history.redo,
    onDuplicate: kbOnDuplicate,
    onSelectAll: editor.selectAll,
    onEscape: kbOnEscape,
    onNudge: kbOnNudge,
  });

  // Drag-drop de la palette al canvas. El hook expone los handlers que se
  // pegan al `<div>` que envuelve al `<ReactFlow>` — al soltar, proyecta
  // coords del cursor (pantalla) a coords del flow via `screenToFlowPosition`
  // y llama `addNodeAt` del editor con el tipo arrastrado.
  const { onDragOver, onDrop: onDropTool } = useDropNode({
    onDrop: (type, position) => {
      history.push();
      editor.addNodeAt(position, type);
    },
    rfInstance: rfInstanceRef.current,
  });

  // Menú contextual (right-click). El hook encapsula el state del menu
  // (posición pantalla + target). Los callbacks del render despachan al
  // editor + history según el tipo de target.
  const contextMenu = useContextMenu();

  /**
   * Construye el `EpicDiagram` canónico para auto-save desde los nodes/edges
   * del state de React Flow. Memoized sobre content de nodes/edges — el
   * hook `useDiagramAutoSave` comparará identity para disparar debounce.
   *
   * Nota: esto puede disparar saves "no significativos" al entrar en edit
   * (cuando onNodesChange sincroniza editing=true). Es aceptable — el
   * server escribe al mismo cache y el debounce 500ms absorbe ráfagas.
   */
  const liveDiagramForAutoSave = useMemo<EpicDiagram | null>(() => {
    if (!isEditing) return null;
    if (!epicId) return null;
    // Fix QA H4 + Arch H9: NO cristalizar el layout Dagre como "manual" si
    // el user no modificó nada esta sesión y el diagrama no tenía layout
    // manual previo. Sin este guard, abrir y cerrar el editor sin tocar
    // nada congela las posiciones de Dagre al cache.
    const shouldPersistLayout = hasModifiedThisSession || hadManualLayoutOnLoadRef.current;

    // Ya NO filtramos ReferenceNodes ni jump-edges — son primitivas del
    // modelo. Ver shared `DiagramNodeType` con `'reference'` y backend
    // `VALID_NODE_TYPES_PERSIST`. Se persisten con sus posiciones, labels
    // editables, y el user puede arrastrarlos/renombrarlos/borrarlos.
    const liveNodes: DiagramNode[] = nodes.map((n) => {
      const data = n.data as { nodeType?: DiagramNodeType; label: string; description?: string; group?: DiagramNode['group'] };
      return {
        id: n.id,
        type: data.nodeType ?? shapeToNodeType[n.type ?? 'serviceNode'] ?? 'service',
        label: data.label,
        description: data.description,
        group: data.group,
      };
    });
    const liveEdges: DiagramEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
      animated: e.animated,
    }));

    // Tres ramas para `manualPositions`:
    //   1. Si modificó esta sesión → capturar positions actuales.
    //   2. Si había layout manual previo pero no modificó → preservar
    //      las positions originales del prop (no sobrescribir con Dagre).
    //   3. Sin ninguna condición → NO persistir positions ni hasManualLayout.
    let nextManualPositions: Record<string, { x: number; y: number }> | undefined;
    if (hasModifiedThisSession) {
      // Incluimos los ReferenceNode — sus posiciones también se persisten
      // para que al recargar aparezcan donde el user los dejó.
      nextManualPositions = Object.fromEntries(
        nodes
          .filter((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
          .map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
      );
    } else if (hadManualLayoutOnLoadRef.current) {
      nextManualPositions = diagram.manualPositions;
    }

    return {
      ...diagram,
      nodes: liveNodes,
      edges: liveEdges,
      ...(shouldPersistLayout
        ? { hasManualLayout: true, manualPositions: nextManualPositions }
        : {}),
      generatedAt: new Date().toISOString(),
      generatedBy: 'manual',
    };
  }, [nodes, edges, diagram, isEditing, epicId, hasModifiedThisSession]);

  const autoSave = useDiagramAutoSave({
    epicId: epicId ?? '',
    type: diagram.type,
    diagram: liveDiagramForAutoSave,
    enabled: isEditing && !!epicId,
  });

  // Sincronizar cuando el layout externo cambia (diagram nuevo o medidas
  // nuevas). **Guard crítico**: durante edición activa, NO sobrescribimos
  // los nodes/edges — perderíamos drags y adds en vuelo (Arch H1). Si el
  // diagram cambia durante edit (refresh del cache en otro tab), lo
  // ignoramos hasta que el user salga del modo edición.
  useEffect(() => {
    if (isEditing) return;
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges, isEditing]);

  // Fingerprint del layout actual: id + posiciones de cada nodo. Si las
  // posiciones cambian (re-layout post-medición de `useMeasuredDimensions`,
  // recompute por colisiones), el fingerprint cambia y el useEffect
  // re-fittea. Usar `useMemo` para evitar recompute en cada render — solo
  // cambia cuando layoutedNodes referencia distinta.
  const layoutFingerprint = useMemo(() => {
    return `${diagram.id}:${layoutedNodes
      .map((n) => `${n.id}@${n.position.x.toFixed(0)},${n.position.y.toFixed(0)}`)
      .join('|')}`;
  }, [diagram.id, layoutedNodes]);

  // fitView controlado: re-fittea cada vez que el LAYOUT cambia (no solo
  // cuando cambia diagram.id). Razón: ELK produce dos pases — el primero
  // con dimensiones default de los nodos, el segundo después de que
  // `useMeasuredDimensions` mide los tamaños reales y dispara re-layout
  // con `setLayoutedNodes` posiciones distintas. Con el guard antiguo
  // (`lastFittedIdRef.current === diagram.id`) el primer fit se quedaba
  // aplicado al layout stale del primer pass — el viewport mostraba un
  // bbox que ya no era válido. Con fingerprint, cada pass triggers su
  // propio fit.
  //
  // Skip durante edición (`isEditing=true`) — el user puede estar moviendo
  // nodos manualmente, no queremos pisar su drag con un fit automático.
  //
  // Doble rAF: rAF #1 espera al primer paint post-render. rAF #2 da
  // otro frame para que React Flow internal state (bbox del container,
  // measurements de nodos vía ResizeObserver) esté estable.
  useEffect(() => {
    if (!isInstanceReady || !rfInstanceRef.current) return;
    if (layoutedNodes.length === 0) return;
    if (isEditing) return;
    if (lastFittedFingerprintRef.current === layoutFingerprint) return;
    let cancelled = false;
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        rfInstanceRef.current?.fitView({ padding: 0.1 });
        lastFittedFingerprintRef.current = layoutFingerprint;
        // Después del primer fit exitoso, revelar el viewport con fade-in.
        // Los re-fits siguientes (de pases ulteriores de ELK) ocurrirán mientras
        // el viewport ya está visible, pero como el fingerprint dispara fit
        // ANTES del paint del nuevo layout, el user no ve "saltos" — solo el
        // estado final ya centrado.
        setHasFittedFirstTime(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [layoutFingerprint, isInstanceReady, isEditing, layoutedNodes.length]);

  // Reset del flag cuando cambia el diagrama. Sin esto, navegar de un
  // diagrama a otro mostraría el viewport ya visible (con el viewport del
  // diagrama anterior) durante los pases iniciales de ELK del nuevo —
  // exactamente el flickering que estamos evitando.
  useEffect(() => {
    setHasFittedFirstTime(false);
    lastFittedFingerprintRef.current = null;
  }, [diagram.id]);

  // Zoom/pan al grupo de nodos del paso clickeado. Se dispara SOLO cuando
  // cambia `focusNodeIds` (driven por click-del-step, no por hover).
  // `maxZoom: 1.2` evita sobre-zoom en pasos de 1-2 nodos (el viewport no
  // gigantiza los nodos chicos); `padding: 0.25` da aire alrededor.
  //
  // BUG FIX (2026-05-04 v3): trackear `prevFocusKey` con ref para distinguir
  // "mount inicial con focusKey vacío" de "user deseleccionó algo". Antes
  // este efecto corría al mount con focusKey='' y llamaba `fitView` con
  // padding 0.15 + duration 400 — un fit COMPETIDOR contra mi useEffect
  // controlado del fit inicial. La animación de 400ms del competidor pisaba
  // el resultado de mi fitView, y los logs mostraban delta=0 porque RF ya
  // tenía la animación del competidor en curso al momento de mi llamada.
  //
  // Ahora: solo re-fit a la vista panorámica cuando focusKey transiciona
  // de algo (ej. "node1,node2") a vacío (""). El fit inicial del mount lo
  // hace EXCLUSIVAMENTE el useEffect controlado de arriba.
  const focusKey = (focusNodeIds ?? []).join(',');
  const prevFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const instance = rfInstanceRef.current;
    if (!instance) return;
    const prevFocusKey = prevFocusKeyRef.current;
    prevFocusKeyRef.current = focusKey;
    if (focusNodeIds && focusNodeIds.length > 0) {
      instance.fitView({
        nodes: focusNodeIds.map((id) => ({ id })),
        padding: 0.25,
        maxZoom: 1.2,
        duration: 500,
      });
    } else if (prevFocusKey !== null && prevFocusKey !== '' && focusKey === '') {
      // Solo re-fit panorámico cuando el user DESELECCIONÓ algo (transición
      // de focusKey con contenido → vacío). Skip al mount inicial (prevFocusKey
      // === null) y skip si seguimos sin focus desde antes.
      instance.fitView({ padding: 0.1, duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // ─────────── Edit mode handlers ───────────

  const toggleEditing = useCallback(() => {
    setIsEditing((v) => {
      const next = !v;
      // Usamos `next` (no `!isEditing` del closure) para evitar stale
      // closure bug: en el segundo toggle el closure todavía vería el
      // valor pre-flip y los nodes quedarían en estado contradictorio.
      if (next) {
        // Entrando a edit: capturamos snapshot del estado actual desde refs
        // (no del closure — evita recreación del callback en cada render).
        editSnapshotRef.current = { nodes: nodesRef.current, edges: edgesRef.current };
        setHasModifiedThisSession(false);
        // Limpiar history de sesión previa (fix QA H7): si el user entró-
        // salió-entró rápido, evitar que Cmd+Z devuelva a estados descartados
        // con "Cancelar" de la sesión anterior.
        history.clear();
      } else {
        // Saliendo de edit: limpiamos snapshot y estado efímero.
        editSnapshotRef.current = null;
        editor.clearSelection();
        editor.setActiveTool(null);
        history.clear();
      }
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          draggable: next,
          data: { ...n.data, editing: next },
        })),
      );
      return next;
    });
  }, [setNodes, editor, history]);

  const handleSave = useCallback(() => {
    // ReferenceNodes (jump connectors) son primitivas del modelo — se
    // persisten con los demás nodes. Ver shared `DiagramNodeType` ('reference').
    const updatedNodes: DiagramNode[] = nodes.map((n) => {
      const data = n.data as { nodeType?: DiagramNodeType; label: string; description?: string; group?: DiagramNode['group'] };
      return {
        id: n.id,
        type: data.nodeType ?? shapeToNodeType[n.type ?? 'serviceNode'] ?? 'service',
        label: data.label,
        description: data.description,
        group: data.group,
      };
    });
    // Al guardar, NO persistimos sourceHandle/targetHandle — los recalcula
    // el viewer al volver a cargar. Esto evita que un drag manual fije
    // handles ilógicos en la BD.
    const updatedEdges: DiagramEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
      animated: e.animated,
    }));

    // Decisión de `manualPositions`:
    //   1. Si el user modificó algo en ESTA sesión (drag o add) → capturamos
    //      las posiciones actuales de todos los nodes.
    //   2. Si el diagrama ya tenía `hasManualLayout=true` al cargar pero el
    //      user NO tocó nada → preservamos las posiciones originales que
    //      vinieron en el prop (no sobrescribimos con lo que Dagre acabó
    //      de calcular; evita la "cristalización" del layout).
    //   3. Sin hasManualLayout previo + sin cambios esta sesión → no
    //      persistimos manualPositions (el diagrama sigue usando Dagre).
    let nextHasManualLayout = false;
    let nextManualPositions: Record<string, { x: number; y: number }> | undefined;

    if (hasModifiedThisSession) {
      nextHasManualLayout = true;
      // Incluimos los ReferenceNode para que sus posiciones se persistan.
      nextManualPositions = Object.fromEntries(
        nodes
          .filter((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
          .map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
      );
    } else if (hadManualLayoutOnLoadRef.current) {
      nextHasManualLayout = true;
      nextManualPositions = diagram.manualPositions;
    }

    const updatedDiagram: EpicDiagram = {
      ...diagram,
      nodes: updatedNodes,
      edges: updatedEdges,
      generatedAt: new Date().toISOString(),
      generatedBy: 'manual',
      ...(nextHasManualLayout
        ? { hasManualLayout: true, manualPositions: nextManualPositions }
        : {}),
    };
    onDiagramChange?.(updatedDiagram);
    setIsEditing(false);
    editSnapshotRef.current = null;
    setHasModifiedThisSession(false);
    editor.clearSelection();
    editor.setActiveTool(null);
    setNodes((nds) => nds.map((n) => ({ ...n, draggable: false, data: { ...n.data, editing: false } })));
  }, [nodes, edges, diagram, onDiagramChange, setNodes, editor]);

  /**
   * Descarta las posiciones manuales del diagrama (server-side) y recarga el
   * contenido para que el layout engine (ELK) vuelva a calcular posiciones.
   *
   * Solo tiene sentido cuando `diagram.hasManualLayout=true` — si el diagrama
   * ya usa layout automático, el botón no se muestra (ver render). La acción
   * es irreversible respecto a las posiciones manuales; el contenido
   * semántico (nodos/edges/labels) se preserva.
   */
  const handleRecalculateLayout = useCallback(async () => {
    if (!epicId) return;
    if (!onDiagramChange) return;
    const confirmed = window.confirm(
      '¿Recalcular el layout automáticamente? Las posiciones manuales actuales se descartarán.',
    );
    if (!confirmed) return;
    const reset = await resetDiagramLayout(epicId, diagram.type);
    if (reset) {
      onDiagramChange(reset);
      toast.success('Layout recalculado');
    } else {
      toast.error('No se pudo recalcular el layout');
    }
  }, [epicId, diagram.type, onDiagramChange]);

  const handleReset = useCallback(() => {
    // Restaurar desde snapshot de inicio de sesión, NO desde `layoutedNodes`.
    // `layoutedNodes` puede haber cambiado si el prop `diagram` recibió un
    // update externo durante la edición — restaurarlo daría al user algo
    // distinto al estado de partida.
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    } else {
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
    editor.clearSelection();
    editor.setActiveTool(null);
    setHasModifiedThisSession(false);
    rfInstanceRef.current?.fitView({ padding: 0.15 });
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges, editor]);

  const onConnectStart = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectStart']>
  >(() => {
    // no-op: la creacion del edge ocurre en onConnectEnd donde
    // `connectionState.fromNode/toNode` respetan la direccion del drag.
  }, []);

  const isValidConnection = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['isValidConnection']>
  >(() => {
    // Siempre true — React Flow v12 dispara esto muchas veces durante el
    // drag; la validacion real (editing mode, nodos validos) se hace en
    // onConnectEnd antes de persistir.
    return true;
  }, []);

  /*
   * `onConnect` queda como no-op. React Flow v12 lo dispara cuando la
   * conexión es "válida" según sus reglas internas, pero el `Connection`
   * object viene normalizado (source/target alineados con el `type`
   * fijo de cada handle) — no refleja el gesto REAL del usuario cuando
   * arrastra de target a source. La creación del edge se hace en
   * `onConnectEnd` donde `connectionState.fromNode/toNode` respetan la
   * dirección del drag.
   */
  const onConnect = useCallback((_connection: Connection) => {
    // no-op — ver comentario arriba.
  }, []);

  const onConnectEnd = useCallback<
    NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectEnd']>
  >((_event, connectionState) => {
    if (!isEditing) return;
    // El gesto no aterrizó en un handle válido (soltó en el aire).
    if (!connectionState?.isValid) return;
    if (!connectionState.fromNode || !connectionState.toNode) return;

    // History push ACÁ (no en onConnect) porque onConnectEnd dispara
    // siempre (válido o no) — queremos capturar el pre-estado solamente
    // cuando sabemos que vamos a crear el edge. Evita polluir undo stack
    // con snapshots de gestos cancelados.
    history.push();

    // Dirección semántica REAL: `fromNode` = donde inició el drag,
    // `toNode` = donde se soltó. Esto respeta la intención visual del
    // usuario independiente del `type` de cada handle.
    //
    // `canonicalSourceHandle`/`canonicalTargetHandle` aseguran que el
    // edge persiste con IDs que existen con el `type` correcto para
    // renderizar, sin importar qué handle type activó el gesto (p. ej.
    // user arrastra desde `top` que es target → lo remapeamos a
    // `top-source` que existe superpuesto en la misma posición).
    const newEdge: Edge = {
      id: `edge-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: connectionState.fromNode.id,
      target: connectionState.toNode.id,
      sourceHandle: canonicalSourceHandle(connectionState.fromHandle?.id),
      targetHandle: canonicalTargetHandle(connectionState.toHandle?.id),
      type: 'avoidNodes',
      ...makeEdgeStyle(false),
      deletable: true,
    };
    // Concatenación manual — NO usamos el helper `addEdge` de React Flow
    // porque deduplica por (source, target, sourceHandle, targetHandle).
    // Queremos permitir edges paralelos entre los mismos nodos: libavoid
    // los nudge automáticamente con offset visible (`edgeToEdgeSpacing`).
    setEdges((eds) => [...eds, newEdge]);

    /*
     * CRÍTICO: llamar `resetRouting()` explícitamente después del
     * `setEdges`. El `handleEdgesChange` (que normalmente dispara reset en
     * changes de tipo 'add') sólo se activa con manipulaciones que hace
     * React Flow mismo sobre `edges` (p. ej. backspace para delete). Al
     * mutar el array con `setEdges` directo desde acá, `onEdgesChange`
     * NO se dispara → libavoid no entera del nuevo edge → los edges
     * paralelos no se recalculan con el nuevo miembro en el batch, y el
     * último edge se renderiza con path "forzado" (diagonal feo).
     *
     * `requestAnimationFrame` deja que React commitee el setEdges antes
     * de que resetRouting lea el estado via refs internos del hook.
     */
    requestAnimationFrame(() => resetRouting());
  }, [isEditing, setEdges, history, resetRouting]);

  // Mapa nodeId → stepId para abrir el step correspondiente al clickear un
  // nodo del canvas. Orden ascendente por `step.order` — si un nodo pertenece
  // a múltiples steps (caso raro), gana el PRIMERO del flujo (más intuitivo
  // que el último). `join(',')` NO se usa aquí; el useMemo depende de
  // `diagram.steps` que es estable salvo regeneración.
  const nodeToStep = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    if (!diagram.steps) return m;
    const sorted = [...diagram.steps].sort((a, b) => a.order - b.order);
    for (const step of sorted) {
      for (const nodeId of step.nodeIds) {
        if (!m.has(nodeId)) m.set(nodeId, step.id);
      }
    }
    return m;
  }, [diagram.steps]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Modo edición: selección para editar propiedades del nodo.
      if (isEditing) {
        editor.selectNode(node.id);
        return;
      }
      // Modo view: si el nodo pertenece a un step, abrirlo en el bottom panel.
      // El padre decide qué hacer (setClickedStepId → pipeline highlight+zoom).
      if (onStepFromNode) {
        const stepId = nodeToStep.get(node.id);
        if (stepId) onStepFromNode(stepId);
      }
    },
    [isEditing, editor, onStepFromNode, nodeToStep]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (!isEditing) return;
      editor.selectEdge(edge.id);
    },
    [isEditing, editor]
  );

  /**
   * Enriquece los edges custom con el callback `onLabelDoubleClick` en
   * `data`. Los 3 edge types custom (`avoidNodes`, `waypoint`, `smart`) lo
   * leen para habilitar el double-click sobre el pill HTML del label — el
   * handler simplemente selecciona la edge (el user la edita luego en el
   * PropertyPanel o inline editor).
   *
   * `avoidNodes` es el default actual; `waypoint`/`smart` se mantienen
   * por compatibilidad con edges persistidos en cache Redis viejo. Si
   * olvidáramos uno, double-click al label quedaría sin handler silencioso.
   *
   * Solo inyectamos el callback cuando estamos en modo edición — evita
   * que el handler aparezca como prop fantasma en el modo view.
   */
  /**
   * Dos fuentes de highlight en este viewer, mutuamente excluyentes:
   *
   *   1. Sidepanel step (externo, via `externalHighlightedNodeIds`): cuando
   *      un paso del flujo está activo (hover o click). El SET completo de
   *      nodos del paso se ilumina; los demás se atenúan. Edges entre dos
   *      nodos del set se resaltan; los demás se atenúan.
   *
   *   2. Hover de nodo individual (interno, `hoveredNodeId`): comportamiento
   *      clásico. Solo se resaltan los edges que TOCAN el nodo (source o
   *      target coincide); nodos se mantienen con su opacidad normal.
   *
   * Precedencia: el set externo gana cuando es no-vacío. Así evitamos
   * flicker si el cursor del user está sobre un nodo mientras ya hay un
   * paso seleccionado — la selección del sidepanel domina visualmente.
   */
  const hasStepHighlight = Boolean(
    externalHighlightedNodeIds && externalHighlightedNodeIds.size > 0,
  );

  const enrichedEdges = useMemo<Edge[]>(
    () => {
      const hoverActive = hoveredNodeId !== null;
      return edges.map((e): Edge => {
        const existingData = (e.data as Record<string, unknown>) ?? {};
        const extraData: Record<string, unknown> = {};

        // En edit mode, inyectar el callback de double-click del label.
        if (
          isEditing &&
          (e.type === 'avoidNodes' || e.type === 'waypoint' || e.type === 'smart')
        ) {
          extraData.onLabelDoubleClick = (edgeId: string) => editor.selectEdge(edgeId);
        }

        // Hover highlight: el `AvoidNodesEdge` lee `data.strokeColor` /
        // `data.strokeWidth` (NO `edge.style`), así que los overrides
        // deben ir en `data`. Source verificado en
        // `node_modules/avoid-nodes-edge/dist/index.js`:
        //    let M = i?.strokeColor ?? "#94a3b8";
        //    let L = i?.strokeWidth ?? Fe;
        if (hasStepHighlight && externalHighlightedNodeIds) {
          // Step highlight: solo se resaltan edges cuyos DOS endpoints están
          // en el set. Todo lo demás se atenúa fuertemente para dar foco.
          const bothInSet =
            externalHighlightedNodeIds.has(e.source) &&
            externalHighlightedNodeIds.has(e.target);
          if (bothInSet) {
            extraData.strokeColor = 'rgb(129,140,248)'; // indigo-400
            extraData.strokeWidth = 2.5;
          } else {
            extraData.strokeColor = 'rgba(212,212,216,0.12)';
            extraData.strokeWidth = 1;
          }
        } else if (hoverActive) {
          const isConnected = e.source === hoveredNodeId || e.target === hoveredNodeId;
          if (isConnected) {
            extraData.strokeColor = 'rgb(129,140,248)'; // indigo-400 brillante
            extraData.strokeWidth = 2.5;
          } else {
            extraData.strokeColor = 'rgba(212,212,216,0.15)';
            extraData.strokeWidth = 1;
          }
        }

        return {
          ...e,
          data: { ...existingData, ...extraData },
        };
      });
    },
    // `hoveredNodeId` + set externo disparan recompute de los estilos.
    [edges, isEditing, editor.selectEdge, hoveredNodeId, hasStepHighlight, externalHighlightedNodeIds],
  );

  /**
   * Inyecta `onLabelChange` en los reference nodes cuando está en modo
   * edit. El callback actualiza el node Y activa `hasModifiedThisSession`
   * en el mismo tick, garantizando que el auto-save captura el label
   * nuevo (fix QA-HIGH: race condition entre `setNodes` del nodo y el
   * debounce del auto-save).
   *
   * Patrón paralelo al de `enrichedEdges.onLabelDoubleClick`.
   */
  const handleReferenceLabelChange = useCallback(
    (nodeId: string, newLabel: string) => {
      setNodes((current) =>
        current.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...(n.data ?? {}), label: newLabel } }
            : n,
        ),
      );
      setHasModifiedThisSession(true);
    },
    [setNodes],
  );

  const enrichedNodes = useMemo(
    () => {
      // Edición: inyectar callback onLabelChange en reference nodes.
      // Step highlight: atenuar nodos que NO pertenecen al set activo del
      // sidepanel. Aplicamos opacidad al `style` — ReactFlow la propaga al
      // wrapper div que envuelve los custom nodes, así el dimming es uniforme
      // sin tener que modificar cada NodeComponent individualmente.
      const baseNodes = isEditing
        ? nodes.map((n) =>
            n.type === 'reference'
              ? {
                  ...n,
                  data: {
                    ...((n.data as Record<string, unknown>) ?? {}),
                    onLabelChange: handleReferenceLabelChange,
                  },
                }
              : n,
          )
        : nodes;

      if (!hasStepHighlight || !externalHighlightedNodeIds) return baseNodes;

      return baseNodes.map((n) => {
        const isHighlighted = externalHighlightedNodeIds.has(n.id);
        return {
          ...n,
          style: {
            ...(n.style ?? {}),
            opacity: isHighlighted ? 1 : 0.25,
            transition: 'opacity 180ms ease-in-out',
          },
        };
      });
    },
    [nodes, isEditing, handleReferenceLabelChange, hasStepHighlight, externalHighlightedNodeIds],
  );

  /**
   * Click en área vacía del canvas. Dos comportamientos según `activeTool`:
   *   - Tool activo → deposita un node de ese tipo en la posición del click
   *     (convertida de coords de pantalla a coords del grafo via
   *     `screenToFlowPosition`). El tool se desactiva tras colocar.
   *   - Sin tool → limpia selección (comportamiento previo).
   */
  const onPaneClick = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (!isEditing) return;
      if (!editor.activeTool) {
        editor.clearSelection();
        return;
      }
      const instance = rfInstanceRef.current;
      if (!instance) return;
      const clientX = 'clientX' in event ? event.clientX : event.touches[0]?.clientX ?? 0;
      const clientY = 'clientY' in event ? event.clientY : event.touches[0]?.clientY ?? 0;
      const position = instance.screenToFlowPosition({ x: clientX, y: clientY });
      editor.addNodeAt(position);
    },
    [isEditing, editor]
  );

  /**
   * Primer drag manual del user enciende la flag `manualLayoutFlagRef`. El
   * hook del editor también la enciende al añadir un nuevo node. En
   * `handleSave` capturamos las posiciones actuales para persistirlas.
   */
  const onNodeDragStart = useCallback(() => {
    setHasModifiedThisSession(true);
  }, []);

  /**
   * Al soltar un nodo arrastrado, resolvemos colisiones: si el user lo
   * dejó encima de otro, empujamos ambos mínimamente hasta que no se
   * solapen. Algoritmo naive O(n²) importado de `resolve-collisions.ts`,
   * adaptado del ejemplo oficial de React Flow (xyflow blog post).
   *
   * Solo se dispara en modo edición — en view mode el user no puede
   * arrastrar nodos, así que el handler nunca debería ejecutarse fuera
   * de edit.
   */
  const onNodeDragStop = useCallback(() => {
    if (!isEditing) return;
    setNodes((current) => {
      // Snap al grid primero — el nodo que acabo de arrastrar cae en la
      // celda más cercana, manteniendo el layout alineado.
      const snapped = snapToGrid(current, DRAG_SNAP_GRID_SIZE);
      // Luego resolveCollisions por si el snap causó solape.
      const result = resolveCollisions(snapped, {
        maxIterations: 50,
        overlapThreshold: 0.5,
        margin: 50,
      });
      return result.nodes;
    });
  }, [isEditing, setNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const effectiveChanges = !isEditing
        ? changes.filter((c) => c.type !== 'position' && c.type !== 'remove')
        : changes;
      onNodesChange(effectiveChanges);
      // libavoid-js: re-route incremental. El worker batches los drag
      // events (debounce interno) — enviamos cada change sin preocuparnos
      // de over-posting. En modo view-only `effectiveChanges` no trae
      // position/remove, así que el worker no hace trabajo extra.
      updateRoutingOnNodesChange(effectiveChanges);
    },
    [isEditing, onNodesChange, updateRoutingOnNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const effectiveChanges = !isEditing
        ? changes.filter((c) => c.type !== 'remove')
        : changes;
      onEdgesChange(effectiveChanges);
      // Cambios de topología (add/remove edges) requieren full re-route:
      // libavoid incremental sólo maneja nodos, no nuevas conexiones.
      // `requestAnimationFrame` deja que React aplique `setEdges` antes
      // del reset — así `resetRouting` lee el estado post-mutación vía
      // zustand/store interno del hook.
      const needsReset = effectiveChanges.some(
        (c) => c.type === 'add' || c.type === 'remove',
      );
      if (needsReset) requestAnimationFrame(() => resetRouting());
    },
    [isEditing, onEdgesChange, resetRouting]
  );

  // ─────────── Render ───────────

  return (
    <div ref={containerRef} className={`relative ${fullHeight ? 'h-full' : ''}`}>
      {/*
        Card styling (rounded + border) solo cuando NO es fullHeight — en la
        vista dedicada fullscreen el diagrama debe ir edge-to-edge sin radio
        ni borde que compitan visualmente con el canvas. El highlight de
        edición también es irrelevante en fullHeight (no hay encuadre).

        El `backgroundColor` viene del tema configurable (user-settable via
        el panel). La CSS variable `--diagram-node-bg` se propaga a los
        custom nodes para que consuman el color de nodos elegido sin
        re-renders por nodo.
      */}
      <div
        className={`relative overflow-hidden ${
          fullHeight
            ? // Bordes redondeados tipo Lovable en fullHeight: el board "flota"
              // dentro del padding externo del padre (DiagramFullPage) con un
              // borde sutil y corners rounded-2xl. El overflow-hidden clipa
              // el grid y los edges dentro de los corners.
              `h-full rounded-2xl border border-border/40 shadow-sm`
            : `h-[600px] rounded-xl border ${isEditing ? 'border-primary/50' : 'border-zinc-800'}`
        }`}
        style={{
          backgroundColor: theme.background,
          // `groupThemeVars` expone `--diagram-group-${group}-bg` para
          // cada uno de los 7 layers arquitectónicos. Los custom nodes los
          // consumen con fallback: `var(--diagram-group-frontend-bg,
          // var(--diagram-node-bg, #27272a))` — así el tema org-wide
          // tiene prioridad y el tema per-user es el fallback.
          ...groupThemeVars,
        } as React.CSSProperties}
        onDragOver={isEditing ? onDragOver : undefined}
        onDrop={isEditing ? onDropTool : undefined}
      >
        {/* Overlay mientras ELK computa el layout inicial Y mientras el
            primer fitView no ha corrido. Cubre el flickering de los pases
            sucesivos de ELK (initial → measured → collision-resolved) que
            antes el user veía como "saltos" de nodos. Una vez fitteado,
            fade-out suave de 200ms. Ocupa toda el área sin bloquear los
            hooks de React Flow detrás. */}
        <div
          className={`absolute inset-0 z-20 flex items-center justify-center bg-background backdrop-blur-sm text-xs text-muted-foreground transition-opacity duration-300 ${
            layoutLoading || !hasFittedFirstTime
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            <span>{layoutLoading ? 'Calculando layout…' : 'Centrando…'}</span>
          </div>
        </div>
        {layoutError && !layoutLoading && hasFittedFirstTime && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            Layout en modo fallback (ELK falló): {layoutError}
          </div>
        )}
        <DiagramThemePanel
          theme={theme}
          onBackgroundChange={setBackground}
          onReset={resetTheme}
          orgColors={orgTheme.colors}
          orgCanEdit={orgTheme.canEdit}
          onOrgColorChange={(group, color) =>
            orgTheme.save({ ...orgTheme.colors, [group]: color })
          }
          onOrgReset={orgTheme.reset}
          textColors={orgTheme.textColors}
          onTextColorChange={(key, color) =>
            orgTheme.saveTextColors({ ...orgTheme.textColors, [key]: color })
          }
        />
        <ReactFlow
          nodes={enrichedNodes}
          edges={enrichedEdges}
          onInit={(instance) => {
            rfInstanceRef.current = instance;
            // Setea el state reactivo para que el useEffect de fitView
            // controlado se dispare (la ref por sí sola no invalida deps).
            setIsInstanceReady(true);
          }}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={isEditing ? onConnect : undefined}
          onConnectStart={isEditing ? onConnectStart : undefined}
          onConnectEnd={isEditing ? onConnectEnd : undefined}
          isValidConnection={isEditing ? isValidConnection : undefined}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          /*
            Hover highlight — setea el `hoveredNodeId` que dispara el
            recálculo de estilos en `enrichedEdges`. React Flow dispara
            estos eventos en cada mouse-enter/leave del bounding box del
            nodo, así que cubren tanto el header box como la descripción.
          */
          onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          /*
            Right-click handlers: abren el menú contextual en la posición
            del cursor, con target contextualizado (node/edge/pane). El menú
            se monta fuera del <ReactFlow> para usar `position: fixed` y que
            no sea cortado por el overflow del canvas.
          */
          onNodeContextMenu={(e, node) => {
            if (!isEditing) return;
            e.preventDefault();
            contextMenu.open({ x: e.clientX, y: e.clientY }, { kind: 'node', nodeId: node.id });
          }}
          onEdgeContextMenu={(e, edge) => {
            if (!isEditing) return;
            e.preventDefault();
            contextMenu.open({ x: e.clientX, y: e.clientY }, { kind: 'edge', edgeId: edge.id });
          }}
          onPaneContextMenu={(e) => {
            if (!isEditing) return;
            const mouseEvent = e as unknown as MouseEvent;
            mouseEvent.preventDefault?.();
            const instance = rfInstanceRef.current;
            if (!instance) return;
            const flowPos = instance.screenToFlowPosition({
              x: mouseEvent.clientX,
              y: mouseEvent.clientY,
            });
            contextMenu.open(
              { x: mouseEvent.clientX, y: mouseEvent.clientY },
              { kind: 'pane', position: flowPos },
            );
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          /*
           * ConnectionMode.Loose — permite arrastrar conexiones en
           * cualquier combinación de handles (source→source, target→target,
           * target→source), no solo source→target. Con esto el `source`
           * del edge creado es el nodo donde el usuario inició el gesto y
           * el `target` es donde lo soltó, respetando la dirección
           * semántica del dibujo manual. Sin Loose, React Flow invertía
           * source/target para respetar el `type` fijo de cada handle, y
           * la flecha quedaba apuntando al revés de lo que el user dibujó.
           *
           * El Strict default sigue siendo lo correcto para diagramas
           * rigidamente hierárquicos (flowcharts top-down), pero con
           * libavoid + autoBestSideConnection el routing es geométrico,
           * no topológico — los handles son solo anchors del visual, no
           * constraints de flow.
           */
          connectionMode={ConnectionMode.Loose}
          /*
           * Snap to grid al arrastrar nodos. Combina con `SNAP_GRID_SIZE`
           * del `useGroupedLayout` (post-layout snap) y con el `gap` del
           * `<Background>` dots para un comportamiento consistente tipo
           * draw.io: nodos cargan en grid, snap al moverlos, grid visible.
           * Los 3 valores deben coincidir (40px) — la fuente de verdad
           * vive en `DRAG_SNAP_GRID_SIZE` arriba y `SNAP_GRID_SIZE` en
           * `useGroupedLayout.ts`.
           */
          snapToGrid
          snapGrid={[DRAG_SNAP_GRID_SIZE, DRAG_SNAP_GRID_SIZE]}
          /*
           * Removido `fitView` + `fitViewOptions` del prop builtin de
           * ReactFlow (BUG FIX 2026-05-04 v3): el fit automático del prop
           * se ejecuta SYNC al mount con bbox stale (los nodos no han sido
           * medidos por ResizeObserver todavía). El viewport queda
           * descentrado y RF cachea ese estado como "fit aplicado".
           * Cuando mi useEffect controlado llama fitView() después en
           * doble rAF, RF ve que el viewport "ya fue fiteado" y no lo
           * actualiza — los logs mostraban delta=0.
           *
           * Solo el useEffect controlado arriba (con doble rAF tras
           * isInstanceReady && layoutedNodes ready) hace el fit inicial.
           */
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          /*
            Navegación estilo Figma/Excalidraw:
              - `panOnScroll`: scroll con trackpad (two-finger) mueve el canvas
                en vez de zoomear.
              - `zoomOnScroll=false`: desactiva el default "rueda = zoom".
              - Zoom sigue disponible vía pinch del trackpad (zoomOnPinch es
                true por default) y `Cmd/Ctrl + scroll` (React Flow lo mapea
                automáticamente cuando panOnScroll está activo).
              - Click-and-drag sigue funcionando para pan porque `panOnDrag`
                es true por default — tenemos ambos métodos de navegación.
          */
          panOnScroll
          zoomOnScroll={false}
          nodesDraggable={isEditing}
          nodesConnectable={isEditing}
          elementsSelectable={isEditing}
          className="[&_.react-flow__edge-text]:!fill-zinc-400"
          defaultEdgeOptions={isEditing ? { type: 'avoidNodes', ...makeEdgeStyle(false) } : makeEdgeStyle(false)}
        >
          {/*
            Swim lanes por grupo arquitectónico — DESHABILITADAS.
            El `ClusterBackground` sigue importado y disponible; solo no se
            monta. `clusters` sigue computándose en `useGroupedLayout` porque
            lo consumen otras rutas (p. ej. stats en dev logs). Si en el
            futuro querés reactivar las bandas, descomentá la línea de abajo.
          */}
          {/* <ClusterBackground clusters={clusters} /> */}
          {/*
            Background con `variant="dots"`: patrón tipo Figma/Excalidraw.
            `gap={DRAG_SNAP_GRID_SIZE}` (40px) hace que CADA punto del
            background coincida con un punto de snap del grid — al
            arrastrar un nodo, "salta" exactamente entre dots visibles.
            Da feedback visual inmediato de la grilla, look draw.io.
            `dotsColor` se calcula por luminancia del fondo para
            contrastar automáticamente en cualquier tema elegido.
          */}
          <Background gap={DRAG_SNAP_GRID_SIZE} size={1.5} color={dotsColor} />
          {/* Controles de zoom/fit en bottom-right (donde antes vivía el
              ValidationPanel que removimos). Provee:
                - Zoom + / Zoom -
                - Fit view (centra y ajusta el contenido al viewport)
              `showInteractive={false}` oculta el toggle de interactividad
              (locked/unlocked) que rara vez se usa en este flujo. */}
          <Controls
            position="bottom-right"
            showInteractive={false}
            className="!bg-zinc-900 !border-zinc-700 !shadow-lg !rounded-lg [&>button]:!bg-zinc-900 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-800"
          />

          {/* Toolbar lateral izquierda (palette de tipos de node).
              Solo visible en edit; comparte el espacio con el panel de Colores
              arriba (ese va en top-left con z alto desde DiagramViewer).

              Usamos `editModeMounted` en vez de `isEditing` para que el
              panel permanezca montado durante el out-animation de 180ms. */}
          {editable && editModeMounted && (
            <Panel
              position="top-left"
              className="!mt-14 !ml-2"
              data-state={isEditing ? 'open' : 'closed'}
            >
              <div
                data-state={isEditing ? 'open' : 'closed'}
                className="duration-[180ms] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-left-4 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-left-4"
              >
                <EditToolbar
                  activeTool={editor.activeTool}
                  onToolSelect={editor.setActiveTool}
                />
              </div>
            </Panel>
          )}

          {/* Panel derecho: propiedades de la selección. Solo se monta con
              selección activa — progressive disclosure. Animado con slide
              desde la derecha al entrar/salir del modo edición. */}
          {editable && editModeMounted && (editor.selectedNode || editor.selectedEdge) && (
            <Panel
              position="top-right"
              className="!mt-14 !mr-2"
              data-state={isEditing ? 'open' : 'closed'}
            >
              <div
                data-state={isEditing ? 'open' : 'closed'}
                className="duration-[180ms] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-right-4 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-right-4"
              >
                <PropertyPanel
                  selectedNode={editor.selectedNode}
                  selectedEdge={editor.selectedEdge}
                  onUpdateNode={editor.updateNode}
                  onUpdateEdge={editor.updateEdge}
                  onDeleteNode={editor.deleteNode}
                  onDeleteEdge={editor.deleteEdge}
                  onClose={editor.clearSelection}
                />
              </div>
            </Panel>
          )}

          {/* Action bar top-right: Guardar / Cancelar / Editar diagrama.
              La palette (izquierda) y property panel (derecha) no colisionan
              con esta barra porque viven debajo (mt-14).

              Tooltips vienen del wrapper `@/components/ui/tooltip` (Radix)
              para mantener consistencia con el resto del software
              (FolderTree, sidebar, etc.). */}
          {editable && (
            <Panel position="top-right" className="flex items-center gap-1.5">
              <TooltipProvider delayDuration={300}>
                {isEditing && epicId && (
                  <SaveIndicator
                    status={autoSave.status}
                    lastSavedAt={autoSave.lastSavedAt}
                    error={autoSave.error}
                    onRetry={autoSave.retry}
                  />
                )}
                {isEditing ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleReset}
                          className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Descartar cambios</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          onClick={handleSave}
                          className="h-7 gap-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                          <Save className="h-3 w-3" />
                          Guardar
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Guardar cambios (Cmd+S)</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={toggleEditing}
                          className="h-7 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        >
                          Cancelar
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Salir sin guardar (Esc)</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    {diagram.hasManualLayout && epicId && onDiagramChange && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleRecalculateLayout}
                            className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                          >
                            <Shuffle className="h-3 w-3" />
                            Recalcular layout
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Descarta las posiciones manuales y aplica el layout automático actual
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={toggleEditing}
                          className="h-7 gap-1.5 text-xs bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        >
                          <MousePointer2 className="h-3 w-3" />
                          Editar diagrama
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Habilita la paleta, las selecciones y el guardado del diagrama
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </TooltipProvider>
            </Panel>
          )}

          {/* Leyenda flotante de colores por grupo — bottom-left. Siempre
              visible (view + edit) para discoverability inmediata: el user ve
              un cluster de color y entiende qué layer es sin abrir el panel
              de configuración.

              Recibe `orgTheme.colors` por prop (lifted state) — DiagramViewer
              es la única instance de useOrgDiagramTheme, así ambos consumidores
              (DiagramThemePanel + ColorLegend) ven los mismos colores
              reactivos. Si la leyenda llamara el hook por su cuenta, crearía
              un `useState` independiente y quedaría desincronizada. */}
          <Panel position="bottom-left" className="!mb-2 !ml-2">
            <ColorLegend colors={orgTheme.colors} />
          </Panel>

        </ReactFlow>

        {/*
          Menú contextual fuera del <ReactFlow> para usar position:fixed
          y no ser cortado por el overflow del canvas. Los callbacks hacen
          push al history antes de cada mutación para soportar undo.
        */}
        <DiagramContextMenu
          screenPosition={contextMenu.screenPosition}
          target={contextMenu.target}
          onEdit={(t) => {
            if (t.kind === 'node') editor.selectNode(t.nodeId);
            else if (t.kind === 'edge') editor.selectEdge(t.edgeId);
          }}
          onDuplicate={(t) => {
            if (t.kind !== 'node') return;
            history.push();
            editor.selectNode(t.nodeId);
            editor.duplicateSelection();
          }}
          onDelete={(t) => {
            history.push();
            if (t.kind === 'node') {
              editor.deleteNode(t.nodeId);
              toast.success('Nodo eliminado', {
                action: { label: 'Deshacer', onClick: () => history.undo() },
              });
            } else if (t.kind === 'edge') {
              editor.deleteEdge(t.edgeId);
              toast.success('Conexión eliminada', {
                action: { label: 'Deshacer', onClick: () => history.undo() },
              });
            }
          }}
          onAddNodeHere={(pos) => {
            history.push();
            editor.addNodeAt(pos, 'service');
          }}
          onClose={contextMenu.close}
        />
      </div>
    </div>
  );
}
