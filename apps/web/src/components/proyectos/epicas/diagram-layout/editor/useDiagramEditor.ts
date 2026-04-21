'use client';

import { useCallback, useState } from 'react';
import type { Node, Edge, XYPosition } from '@xyflow/react';
import type { DiagramNode, DiagramNodeType, DiagramNodeGroup } from '@cenzontle/shared';
import { nodeTypeToShape, nodeDimensions } from '../layout-constants';

export type ToolKind = DiagramNodeType | null;

export interface EditorSelection {
  nodeIds: Set<string>;
  edgeId: string | null;
}

export interface UseDiagramEditorArgs {
  nodes: Node[];
  setNodes: (updater: (nds: Node[]) => Node[]) => void;
  edges: Edge[];
  setEdges: (updater: (eds: Edge[]) => Edge[]) => void;
  /** Callback cuando el user marca posicionamiento manual (primer drag). */
  onManualLayout?: () => void;
}

/**
 * State machine central del modo de edición. Consolida selección, tool
 * activo de la toolbar, edición inline, y operaciones atómicas sobre
 * nodes/edges.
 *
 * Convenciones:
 *   - `nodeIds` es Set para soportar multi-selección en fases posteriores.
 *     Por ahora se usa single-select (un node a la vez o un edge), pero el
 *     contrato admite Shift+click sin refactor.
 *   - Los handlers NUNCA mutan directamente; devuelven un nuevo estado
 *     via `setNodes` / `setEdges` (React Flow espera immutabilidad).
 *   - El tool activo se limpia automáticamente tras colocar un node — si
 *     el user quiere añadir varios del mismo tipo, re-selecciona el tool
 *     (convención Excalidraw; previene additions accidentales).
 */
export function useDiagramEditor({
  nodes,
  setNodes,
  edges,
  setEdges,
  onManualLayout,
}: UseDiagramEditorArgs) {
  const [selection, setSelection] = useState<EditorSelection>({
    nodeIds: new Set(),
    edgeId: null,
  });
  const [activeTool, setActiveTool] = useState<ToolKind>(null);

  // NOTA: el state de inline label edit (`editingLabelId`/`startInlineEdit`/
  // `finishInlineEdit`) se removió deliberadamente de Fase 1. El componente
  // `InlineLabelEditor` existe pero aún no lo consumen los custom nodes —
  // su integración es trabajo de Fase 2. Exponerlo aquí sin consumer crearía
  // dead surface en la API del hook (YAGNI).

  // ─── Selection ─────────────────────────────────────────────────────────

  const selectNode = useCallback((nodeId: string, additive = false) => {
    setSelection((prev) => ({
      nodeIds: additive ? new Set([...prev.nodeIds, nodeId]) : new Set([nodeId]),
      edgeId: null,
    }));
  }, []);

  const selectEdge = useCallback((edgeId: string) => {
    setSelection({ nodeIds: new Set(), edgeId });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ nodeIds: new Set(), edgeId: null });
  }, []);

  // ─── Node operations ───────────────────────────────────────────────────

  /**
   * Añade un node al canvas en `position` (pantalla: usar project() de
   * ReactFlowInstance antes de llamar para convertir coords del viewport).
   * El tipo del node lo determina `activeTool`; si no hay tool activo,
   * no-op. Limpia el tool activo después de colocar (convención).
   */
  const addNodeAt = useCallback(
    (position: XYPosition, fallbackType?: DiagramNodeType): string | null => {
      const type = activeTool ?? fallbackType;
      if (!type) return null;

      const shape = nodeTypeToShape[type] ?? 'serviceNode';
      const dim = nodeDimensions[shape] ?? nodeDimensions.serviceNode;
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const newNode: Node = {
        id,
        type: shape,
        position: {
          x: position.x - dim.width / 2,
          y: position.y - dim.height / 2,
        },
        data: {
          label: defaultLabelFor(type),
          nodeType: type,
          group: defaultGroupFor(type),
          editing: true,
        },
        draggable: true,
      };

      setNodes((nds) => [...nds, newNode]);
      setActiveTool(null); // "drop" the tool tras colocar
      onManualLayout?.(); // añadir nodes cuenta como edición manual
      return id;
    },
    [activeTool, setNodes, onManualLayout],
  );

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<{ label: string; description: string; group: DiagramNodeGroup; type: DiagramNodeType }>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const currentData = n.data as Record<string, unknown>;
          const nextData: Record<string, unknown> = { ...currentData };

          if (patch.label !== undefined) nextData.label = patch.label;
          if (patch.description !== undefined) nextData.description = patch.description || undefined;
          if (patch.group !== undefined) nextData.group = patch.group;
          if (patch.type !== undefined) {
            nextData.nodeType = patch.type;
            // Al cambiar el type, también se ajusta el shape (el componente
            // React Flow asociado). Esto re-mapea el visual sin reset.
            return {
              ...n,
              type: nodeTypeToShape[patch.type] ?? n.type,
              data: nextData,
            };
          }
          return { ...n, data: nextData };
        }),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelection((prev) => {
        const next = new Set(prev.nodeIds);
        next.delete(nodeId);
        return { ...prev, nodeIds: next };
      });
    },
    [setNodes, setEdges],
  );

  // ─── Edge operations ───────────────────────────────────────────────────

  const updateEdge = useCallback(
    (edgeId: string, patch: Partial<{ label: string; animated: boolean; type: string }>) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edgeId) return e;
          return {
            ...e,
            label: patch.label !== undefined ? (patch.label || undefined) : e.label,
            animated: patch.animated !== undefined ? patch.animated : e.animated,
            type: patch.type !== undefined ? patch.type : e.type,
          };
        }),
      );
    },
    [setEdges],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelection((prev) => (prev.edgeId === edgeId ? { ...prev, edgeId: null } : prev));
    },
    [setEdges],
  );

  // ─── Bulk ──────────────────────────────────────────────────────────────

  const deleteSelection = useCallback(() => {
    const { nodeIds, edgeId } = selection;
    if (edgeId) {
      deleteEdge(edgeId);
      return;
    }
    if (nodeIds.size > 0) {
      setNodes((nds) => nds.filter((n) => !nodeIds.has(n.id)));
      setEdges((eds) => eds.filter((e) => !nodeIds.has(e.source) && !nodeIds.has(e.target)));
      setSelection({ nodeIds: new Set(), edgeId: null });
    }
  }, [selection, deleteEdge, setNodes, setEdges]);

  /**
   * Clona los nodes seleccionados con offset +20px (convención Figma/Excalidraw).
   * Genera IDs nuevos; NO duplica edges (el clone es de shapes aislados por
   * ahora — duplicar aristas requiere decidir si preservan extremos al origen,
   * al clon, o ambos, y hoy no hay consumer que lo pida → YAGNI).
   * La selección pasa a los clones para permitir drag inmediato.
   */
  const duplicateSelection = useCallback(() => {
    const { nodeIds } = selection;
    if (nodeIds.size === 0) return;

    const newIds = new Set<string>();
    setNodes((nds) => {
      const clones: Node[] = [];
      for (const n of nds) {
        if (!nodeIds.has(n.id)) continue;
        const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        newIds.add(newId);
        clones.push({
          ...n,
          id: newId,
          position: { x: n.position.x + 20, y: n.position.y + 20 },
          // Dropear estado de drag/selected interno de React Flow para evitar
          // arrastrar flags del original.
          selected: false,
          dragging: false,
          // Clonar data de forma shallow; `editing: false` para que el clon no
          // abra inline editor al instante (el original puede estar editándose).
          data: { ...(n.data as Record<string, unknown>), editing: false },
        });
      }
      return [...nds, ...clones];
    });

    // Actualizar selección a los clones (newIds ya fue poblado en el updater).
    // Nota: setNodes puede ejecutarse async en concurrent mode, pero newIds se
    // captura por cierre síncrono en el mismo tick → seguro.
    setSelection({ nodeIds: newIds, edgeId: null });
    onManualLayout?.();
  }, [selection, setNodes, onManualLayout]);

  /**
   * Selecciona todos los nodes del canvas. No selecciona edges porque la
   * convención del editor es "node-first" (un edge seleccionado aisla la UI
   * al PropertyPanel de aristas — seleccionar todo + un edge no tiene
   * semántica clara).
   */
  const selectAll = useCallback(() => {
    setSelection({
      nodeIds: new Set(nodes.map((n) => n.id)),
      edgeId: null,
    });
  }, [nodes]);

  /**
   * Mueve los nodes seleccionados `dx`/`dy` pixeles. Usado por arrow keys
   * (10px default, 50px con Shift). Cuenta como layout manual.
   */
  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      const { nodeIds } = selection;
      if (nodeIds.size === 0) return;
      if (dx === 0 && dy === 0) return;

      setNodes((nds) =>
        nds.map((n) =>
          nodeIds.has(n.id)
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n,
        ),
      );
      onManualLayout?.();
    },
    [selection, setNodes, onManualLayout],
  );

  // ─── Derived state ─────────────────────────────────────────────────────

  const selectedNode: Node | null =
    selection.nodeIds.size === 1
      ? nodes.find((n) => selection.nodeIds.has(n.id)) ?? null
      : null;

  const selectedEdge: Edge | null =
    selection.edgeId ? edges.find((e) => e.id === selection.edgeId) ?? null : null;

  return {
    selection,
    activeTool,
    selectedNode,
    selectedEdge,
    // actions
    setActiveTool,
    selectNode,
    selectEdge,
    clearSelection,
    addNodeAt,
    updateNode,
    deleteNode,
    updateEdge,
    deleteEdge,
    deleteSelection,
    duplicateSelection,
    selectAll,
    nudgeSelection,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Defaults para nodes nuevos
// ────────────────────────────────────────────────────────────────────────────

function defaultLabelFor(type: DiagramNodeType): string {
  // `reference` excluido: los ref nodes son creados por
  // `insertJumpConnectors` con su propia letra A/B/C — nunca pasan por
  // este helper (no aparecen en la palette ni se crean manualmente).
  const labels: Record<Exclude<DiagramNodeType, 'reference'>, string> = {
    service: 'Servicio',
    database: 'Base de datos',
    queue: 'Cola',
    gateway: 'Gateway',
    external: 'Externo',
    client: 'Cliente',
    process: 'Proceso',
    decision: '¿Condición?',
    actor: 'Actor',
  };
  if (type === 'reference') return 'A';
  return labels[type] ?? 'Nodo';
}

/**
 * Grupo visual default al CREAR un node manualmente en el editor.
 *
 * Divergencia deliberada respecto al `inferGroupFromType` del backend
 * (`apps/api/src/modules/proyectos/diagrams/generation/diagram-generation.service.ts`):
 * el backend tiene visibilidad del grafo completo al emitir el diagrama
 * y puede inferir `group='end'` para nodes sin aristas salientes. Aquí,
 * al crear un node manualmente, aún no hay edges — aplicar esa regla
 * marcaría como 'end' cualquier node recién creado, lo cual es
 * semánticamente incorrecto (un service sin conexiones aún es conceptualmente
 * `backend`, no un nodo terminal).
 *
 * El user puede cambiar el grupo en el `PropertyPanel` si necesita `end`.
 */
function defaultGroupFor(type: DiagramNodeType): DiagramNodeGroup {
  // `decision` no tiene grupo propio — los rombos heredan la capa donde vive
  // su lógica (normalmente `backend`). El user puede cambiarlo en el
  // `PropertyPanel` si el rombo vive en `frontend` (validación de UI).
  if (type === 'external') return 'external';
  if (type === 'database' || type === 'queue') return 'data';
  if (type === 'gateway') return 'infra';
  if (type === 'client' || type === 'actor') return 'start';
  return 'backend';
}

// `TOOL_DEFINITIONS` se movió a `./editor-constants` (Arch M1 del review):
// la state machine no debería ser fuente de constantes de UI. Los consumidores
// (`EditToolbar`, `PropertyPanel`, `useDropNode`) lo importan directamente
// desde `./editor-constants`.
//
// Re-exportamos desde aquí por retrocompatibilidad temporal con cualquier
// import externo que aún apunte a este archivo. Se puede eliminar en una
// limpieza futura una vez todos los callers migren sus imports.
export { TOOL_DEFINITIONS } from './editor-constants';
