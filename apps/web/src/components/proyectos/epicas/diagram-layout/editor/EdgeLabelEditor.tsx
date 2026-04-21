'use client';

import { useEffect, useRef } from 'react';

interface EdgeLabelEditorProps {
  /** Valor inicial del input cuando se monta. */
  initialValue: string;
  /** Coordenada X del centro del edge (proyectada por React Flow). */
  labelX: number;
  /** Coordenada Y del centro del edge (proyectada por React Flow). */
  labelY: number;
  /** Callback con el valor final al confirmar (Enter o blur). Solo se llama UNA vez. */
  onConfirm: (value: string) => void;
  /** Callback sin argumentos al cancelar (Escape). */
  onCancel: () => void;
  /** Placeholder visible si el input está vacío. */
  placeholder?: string;
  /**
   * `maxLength` del input. Defaults a 24 — recomendado ≤12 para legibilidad,
   * pero 24 permite descripciones cortas tipo "valida token & rate-limit".
   */
  maxLength?: number;
}

/**
 * Editor flotante para labels de edges (aristas).
 *
 * Diferencias vs `InlineLabelEditor`:
 *   - Este componente se posiciona solo en `labelX/labelY` (el caller le pasa
 *     las coords del centro del edge; React Flow las expone via props del
 *     custom edge o via `getSmoothStepPath`). Se monta dentro de
 *     `EdgeLabelRenderer` — por eso usa transform absolute.
 *   - Usa `confirmedRef` para garantizar que `onConfirm` se dispare UNA vez:
 *     si el user presiona Enter, el blur subsecuente NO vuelve a llamar.
 *     Sin esto, Figma-style blur confirm + Enter dispara el handler dos
 *     veces (findings del QA review previo).
 *
 * El componente NO renderiza el label final: cuando `onConfirm` resuelva, el
 * caller debe desmontar este editor y dejar que el `<span>` del edge muestre
 * el valor actualizado (se asume que `updateEdge(...)` ya lo escribió al store).
 */
export function EdgeLabelEditor({
  initialValue,
  labelX,
  labelY,
  onConfirm,
  onCancel,
  placeholder,
  maxLength = 24,
}: EdgeLabelEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Mantener valor más reciente para Enter/blur sin re-renders.
  const valueRef = useRef(initialValue);
  // Latch: una vez confirmado/cancelado, no volver a disparar (evita el
  // doble-confirm cuando Enter dispara blur programáticamente al perder foco).
  const confirmedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm(valueRef.current.trim());
  };

  const cancel = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onCancel();
  };

  return (
    <div
      // pointer-events auto para que el input reciba clicks (el contenedor
      // padre del EdgeLabelRenderer suele tener pointer-events: none).
      className="absolute pointer-events-auto nodrag nopan"
      style={{
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        defaultValue={initialValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => {
          valueRef.current = e.target.value;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirm();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
          // Stop propagation para evitar que Delete/Backspace/Cmd+Z del
          // editor disparen mientras se tipea dentro del input.
          e.stopPropagation();
        }}
        onBlur={() => {
          // Si Enter ya confirmó, confirmedRef bloquea esta llamada.
          confirm();
        }}
        className="h-6 min-w-[80px] max-w-[200px] rounded border border-primary/70 bg-zinc-900/95 px-1.5 text-[11px] font-semibold text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}
