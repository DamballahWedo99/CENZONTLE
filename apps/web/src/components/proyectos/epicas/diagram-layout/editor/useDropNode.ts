'use client';

import { useCallback } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { ReactFlowInstance, XYPosition } from '@xyflow/react';
import type { DiagramNodeType } from '@cenzontle/shared';
import { NODE_TYPE_DRAG_MIME } from './EditToolbar';
import { TOOL_DEFINITIONS } from './editor-constants';

// Whitelist de tipos válidos derivada de TOOL_DEFINITIONS (single source of
// truth). Antes estaba duplicada como array local — si se añadía un 10º tipo
// al enum `DiagramNodeType`, este guard seguiría rechazándolo silenciosamente
// hasta actualización manual (Arch M2 del review).
const VALID_NODE_TYPE_SET = new Set<string>(TOOL_DEFINITIONS.map((t) => t.type));

function isDiagramNodeType(value: string): value is DiagramNodeType {
  return VALID_NODE_TYPE_SET.has(value);
}

export interface UseDropNodeArgs {
  /**
   * Callback disparado cuando el user suelta un tool sobre el canvas.
   * `position` ya viene proyectada a coords del flow (NO del viewport).
   */
  onDrop: (type: DiagramNodeType, position: XYPosition) => void;
  /**
   * Instancia de ReactFlow obtenida via `useReactFlow()` o `onInit`. Necesaria
   * para la proyección `screenToFlowPosition`. Acepta `null` para permitir
   * uso previo al mount (los handlers son no-op en ese caso).
   */
  rfInstance: ReactFlowInstance | null;
}

/**
 * Hook que produce handlers `onDragOver` + `onDrop` listos para pegar al
 * contenedor que envuelve al `<ReactFlow>`. Convierte coords del cursor a
 * coords del flow via `rfInstance.screenToFlowPosition` — sin esto, el node
 * se deposita con offset incorrecto cuando el viewport está zoomeado o
 * paneado.
 *
 * Uso esperado (caller):
 *   const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
 *   const { onDragOver, onDrop } = useDropNode({ onDrop: handleAdd, rfInstance });
 *   return (
 *     <div onDragOver={onDragOver} onDrop={onDrop}>
 *       <ReactFlow onInit={setRfInstance} ... />
 *     </div>
 *   );
 */
export function useDropNode({ onDrop, rfInstance }: UseDropNodeArgs) {
  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    // preventDefault habilita el drop (sin esto, el browser rechaza el evento
    // y nunca dispara `onDrop`). Es el comportamiento default del HTML5 DnD.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDropHandler = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData(NODE_TYPE_DRAG_MIME);
      if (!raw || !isDiagramNodeType(raw)) {
        // Drop desde fuera del toolbar (archivo, URL, otro app). Ignorar.
        return;
      }
      if (!rfInstance) {
        // Instancia aún no mounted — imposible proyectar coords. Bail.
        return;
      }

      const position = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      onDrop(raw, position);
    },
    [onDrop, rfInstance],
  );

  return { onDragOver, onDrop: onDropHandler };
}
