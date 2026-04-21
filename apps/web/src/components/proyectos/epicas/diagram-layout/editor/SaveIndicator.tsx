'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { AutoSaveStatus } from './useDiagramAutoSave';
import { formatRelativeTime } from './useDiagramAutoSave';

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

export interface SaveIndicatorProps {
  status: AutoSaveStatus;
  /** Timestamp del último save exitoso. Se usa para renderizar "hace Xs". */
  lastSavedAt: number | null;
  /** Mensaje del último error — se muestra como `title` en el icono en modo 'error'. */
  error: string | null;
  /** Callback del botón "Reintentar" en modo 'error'. Si no se provee, el botón no se renderiza. */
  onRetry?: () => void;
  /** Clase extra para posicionamiento — por default el componente no se posiciona solo. */
  className?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const BASE_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-zinc-900/90 border border-zinc-700 backdrop-blur-sm px-2.5 py-1 text-[10px] font-medium shadow-sm';

/**
 * Badge flotante que refleja el estado del auto-save. Compacto, dark-first
 * (pensado para el canvas del editor de diagramas que usa fondo oscuro).
 *
 * Comportamiento por estado:
 *   - `idle`: renderiza `null` (no hay nada que informar).
 *   - `saving`: spinner + "Guardando..." en zinc-400.
 *   - `saved`: check verde + "Guardado hace Xs" (ticker de 5s).
 *   - `error`: warning rojo + "Error al guardar" + botón "Reintentar"
 *     (solo si `onRetry` fue provisto).
 *
 * Accesibilidad:
 *   - `role="status"` + `aria-live="polite"` para que screen readers
 *     anuncien los cambios sin interrumpir.
 *   - El icono tiene `aria-hidden` — el texto ya transmite el estado.
 *   - El botón "Reintentar" es un `<button>` nativo con label explícito.
 */
export function SaveIndicator({
  status,
  lastSavedAt,
  error,
  onRetry,
  className,
}: SaveIndicatorProps) {
  // Ticker para actualizar "hace Xs" cada 5s sin necesidad de props externos.
  // Solo arranca cuando `status === 'saved' && lastSavedAt !== null` para no
  // gastar ciclos mientras el indicador está en otro modo.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'saved' || lastSavedAt === null) return;
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, [status, lastSavedAt]);
  // `tick` solo existe para forzar re-render del relative time; no se lee.
  void tick;

  if (status === 'idle') return null;

  const rootClass = className ? `${BASE_PILL} ${className}` : BASE_PILL;

  if (status === 'saving') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Guardando diagrama"
        className={`${rootClass} text-zinc-400`}
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        <span>Guardando…</span>
      </div>
    );
  }

  if (status === 'saved') {
    const relative = lastSavedAt !== null ? formatRelativeTime(lastSavedAt) : 'ahora';
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={`Diagrama guardado ${relative}`}
        className={`${rootClass} text-zinc-300`}
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden="true" />
        <span>Guardado {relative}</span>
      </div>
    );
  }

  // status === 'error'
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`${rootClass} text-red-300 border-red-900/60`}
    >
      <AlertTriangle
        className="h-3 w-3 text-red-400"
        aria-hidden="true"
        // El mensaje completo del error va en el title para que el user pueda
        // ver detalle en hover sin inflar el badge. Accesible via tooltip.
        // (title es soportado por screen readers como fallback.)
      />
      <span title={error ?? undefined}>Error al guardar</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-red-200 hover:text-white hover:bg-red-900/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
          aria-label="Reintentar guardado del diagrama"
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
