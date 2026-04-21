import { useEffect, useRef, useState } from 'react';
import { nodeDimensions } from './layout-constants';

const DEBOUNCE_MS = 200;
const MISMATCH_THRESHOLD = 0.15; // 15% de diferencia para disparar relayout

type DimMap = Map<string, { width: number; height: number }>;

/**
 * Observa el tamaño real de los nodos renderizados (tras que Tailwind haya
 * expandido el contenido) y devuelve un mapa con dimensiones actualizadas.
 *
 * IMPORTANTE: compara cada medición contra el ÚLTIMO valor reportado (no
 * contra `nodeDimensions` default). Si comparáramos siempre contra el default,
 * caeríamos en un loop infinito: el re-layout con el nuevo tamaño sigue
 * siendo 15% distinto del default → dispara de nuevo → loop.
 *
 * La comparación contra lo último reportado garantiza estabilización:
 *   - Primer render: mide, reporta si delta > threshold vs default.
 *   - Siguientes renders: solo reporta si el tamaño cambió 15% respecto al
 *     último reportado (el nodo realmente cambió de tamaño, no es el layout).
 *
 * Se ignora cuando `skip === true` (p. ej. durante edición manual).
 */
export function useMeasuredDimensions(
  container: HTMLElement | null,
  skip: boolean,
): DimMap | undefined {
  const [measured, setMeasured] = useState<DimMap | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último mapa reportado — sirve de baseline para detectar cambios reales.
  const lastReportedRef = useRef<DimMap | undefined>(undefined);

  useEffect(() => {
    if (!container || skip) return;

    const observer = new ResizeObserver(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const nodeEls = container.querySelectorAll<HTMLElement>('[data-id]');
        const next = new Map<string, { width: number; height: number }>();
        let changed = false;
        const lastReported = lastReportedRef.current;

        for (const el of Array.from(nodeEls)) {
          const id = el.getAttribute('data-id');
          if (!id) continue;
          const rect = el.getBoundingClientRect();
          // Ignorar elementos no renderizados (0x0) o con tamaños inválidos.
          if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) continue;
          if (rect.width <= 0 || rect.height <= 0) continue;

          // Baseline contra el que comparamos: último reportado si existe,
          // si no el default del shape.
          const baseline =
            lastReported?.get(id) ??
            (() => {
              const shape = el.getAttribute('data-nodeshape') ?? 'serviceNode';
              return nodeDimensions[shape] ?? nodeDimensions.serviceNode;
            })();

          const widthDelta = Math.abs(rect.width - baseline.width) / baseline.width;
          const heightDelta = Math.abs(rect.height - baseline.height) / baseline.height;

          if (widthDelta > MISMATCH_THRESHOLD || heightDelta > MISMATCH_THRESHOLD) {
            next.set(id, { width: rect.width, height: rect.height });
            changed = true;
          } else if (lastReported?.has(id)) {
            // Mantener mediciones estables que ya reportamos, para no
            // "olvidarlas" entre callbacks.
            next.set(id, lastReported.get(id)!);
          }
        }

        if (changed) {
          lastReportedRef.current = next;
          setMeasured(next);
        }
      }, DEBOUNCE_MS);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [container, skip]);

  return measured;
}
