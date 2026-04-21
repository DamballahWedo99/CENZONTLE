'use client';

import { useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Handle, Position } from '@xyflow/react';
import { InlineLabelEditor } from '../editor/InlineLabelEditor';

interface ReferenceNodeData {
  /** Letra/label corto que identifica el par de jump connectors (A, B, C...). */
  label: string;
  /** True en modo edición del diagrama — habilita doble-click para renombrar. */
  editing?: boolean;
  /**
   * Callback inyectado por `DiagramViewer` (ver `enrichedNodes`) que
   * aplica el cambio de label y marca `hasModifiedThisSession` en el
   * mismo tick. Patrón consistente con los edges (`onLabelDoubleClick`)
   * y garantiza que el auto-save captura el nuevo valor sin race
   * conditions (fix QA-HIGH review 2026-04-20).
   */
  onLabelChange?: (nodeId: string, newLabel: string) => void;
}

/**
 * Nodo "Reference" — jump connector visual (ver técnica clásica en flowcharts
 * profesionales, ej. diagramas de procesos de negocio como DCC payment flows).
 *
 * Cuando un edge necesita cruzar >=4 capas del layout (el agente conecta
 * `Admin` del layer 0 con `Access Simulator` del layer 4, p. ej.), dibujarlo
 * como una única línea produce un trazo largo que atraviesa todo el diagrama
 * y choca contra otros nodos. La técnica de "jump connector" rompe ese edge
 * en dos segmentos cortos unidos por un par de marcadores circulares
 * etiquetados con la misma letra.
 *
 * Visualmente: círculo 28×28 con borde sólido y letra en el centro. Los
 * handles `target` (entrada por izquierda) y `source` (salida por derecha)
 * están alineados con el flujo LR dominante del layout.
 *
 * Los pares se generan post-layout en `useGroupedLayout.insertJumpConnectors`
 * y se persisten como `DiagramNode` type='reference' reales. En modo edición
 * el user puede moverlos y renombrarlos; el renombre NO sincroniza
 * automáticamente con el pair del otro lado — si quiere mantenerlos iguales,
 * debe editar ambos (decisión consistente con el borrado individual: cada
 * ref es independiente una vez persistido).
 */
export function ReferenceNode({
  id,
  data,
}: {
  id: string;
  data: ReferenceNodeData;
}) {
  const [isEditing, setIsEditing] = useState(false);

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!data.editing) return;
      e.stopPropagation();
      setIsEditing(true);
    },
    [data.editing],
  );

  const handleConfirm = useCallback(
    (newLabel: string) => {
      // Si el user deja vacío, mantenemos el label anterior — un ref sin
      // letra pierde todo significado y rompería el pareo visual.
      const finalLabel = newLabel.trim() || data.label;
      // Delegamos al callback del viewer para que él actualice state +
      // marque sesión como modificada. Si no hay callback (ej. modo view
      // o test sin enrichment) silenciosamente no persistimos el cambio,
      // pero eso no debería ocurrir porque solo se puede editar cuando
      // `data.editing=true`, y `editing=true` implica que `DiagramViewer`
      // está inyectando el callback via `enrichedNodes`.
      data.onLabelChange?.(id, finalLabel);
      setIsEditing(false);
    },
    [id, data],
  );

  const handleCancel = useCallback(() => setIsEditing(false), []);

  return (
    <div
      className="relative w-7 h-7 rounded-full border-2 border-zinc-300 bg-zinc-900 flex items-center justify-center text-[11px] font-bold text-[color:var(--diagram-title-color,#ffffff)] shadow-sm"
      aria-label={`Conector ${data.label}`}
      onDoubleClick={handleDoubleClick}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      <span>{data.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      {isEditing ? (
        <div className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 nodrag nopan">
          <InlineLabelEditor
            initialValue={data.label}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            maxLength={12}
            placeholder="A"
          />
        </div>
      ) : null}
    </div>
  );
}
