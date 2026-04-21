'use client';

import { useEffect, useRef } from 'react';

interface InlineLabelEditorProps {
  /** Valor inicial del input cuando se monta. */
  initialValue: string;
  /** Callback con el valor final al confirmar (Enter o blur). */
  onConfirm: (value: string) => void;
  /** Callback sin argumentos al cancelar (Escape). */
  onCancel: () => void;
  /** Placeholder visible si el input está vacío. */
  placeholder?: string;
  /** `maxLength` del input. Útil para labels cortos (edges ≤ 12 chars). */
  maxLength?: number;
}

/**
 * Input flotante para edición inline de labels (nodes o edges).
 *
 * Comportamiento:
 *   - Autofocus al montar + selecciona todo el texto (UX estándar: Enter
 *     para confirmar, empezar a escribir reemplaza el valor).
 *   - Enter confirma con el valor actual.
 *   - Escape cancela (descarta cambios).
 *   - Blur confirma (consistente con Figma; si el user clica fuera, lo
 *     que escribió se respeta — evita descartes accidentales).
 *
 * El componente no hace posicionamiento propio: el caller lo envuelve en
 * un `<div>` con `absolute` + coordenadas. Así el mismo componente sirve
 * para node labels (dentro del node) y edge labels (flotando sobre el path).
 */
export function InlineLabelEditor({
  initialValue,
  onConfirm,
  onCancel,
  placeholder,
  maxLength,
}: InlineLabelEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Mantener el valor más reciente para usarlo en blur/Enter sin re-binds.
  const valueRef = useRef(initialValue);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
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
          onConfirm(valueRef.current.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        // Stop propagation para evitar que atajos globales del editor
        // (Delete, Cmd+Z) se disparen mientras el user está tipeando.
        e.stopPropagation();
      }}
      onBlur={() => {
        onConfirm(valueRef.current.trim());
      }}
      className="h-6 min-w-[80px] max-w-[200px] rounded border border-primary/70 bg-zinc-900/95 px-1.5 text-[11px] font-semibold text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
  );
}
