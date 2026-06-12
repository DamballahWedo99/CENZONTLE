'use client';

import { cn } from '@/lib/utils';
import type { VelocityClassification } from '@cenzontle/shared';

/**
 * Umbral simétrico de calibración — espejo del factor 1.5 que usa el backend
 * en /factory/velocity: ratio > 1.5 = la historia/batch costó más de lo que
 * presupuestaban sus SP (sub-estimada), ratio < 1/1.5 = costó menos
 * (sobre-estimada), en medio = calibrada.
 */
const CALIBRATION_FACTOR = 1.5;

/**
 * Clasifica un ratio crudo client-side. Útil para `VelocityBatch`, que trae
 * `ratio` pero NO `classification` (el backend solo clasifica historias).
 */
export function classifyVelocityRatio(ratio: number | null): VelocityClassification {
  if (ratio === null) return 'no-data';
  if (ratio > CALIBRATION_FACTOR) return 'under';
  if (ratio < 1 / CALIBRATION_FACTOR) return 'over';
  return 'calibrated';
}

const TOOLTIP_TEXT =
  'Esfuerzo real vs presupuestado por sus story points (costo + duración + reintentos del agente)';

interface EstimateDeviationBadgeProps {
  /** effortScore/expectedEffort — >1 costó más de lo presupuestado. */
  ratio: number | null;
  classification: VelocityClassification;
  className?: string;
}

/**
 * Píldora de desviación estimado-vs-real (misma familia visual que
 * StoryPointsBadge). Verde = calibrada; ámbar = costó más de lo que
 * decían sus SP; teal = costó menos. Con 'no-data' no renderiza nada —
 * sin esfuerzo medible no hay veredicto que mostrar.
 */
export function EstimateDeviationBadge({
  ratio,
  classification,
  className,
}: EstimateDeviationBadgeProps) {
  if (classification === 'no-data') return null;

  const baseClasses =
    'inline-flex h-5 items-center justify-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap';

  if (classification === 'calibrated') {
    return (
      <span
        title={TOOLTIP_TEXT}
        className={cn(
          baseClasses,
          'bg-green-500/10 text-green-700 dark:text-green-400',
          className
        )}
      >
        calibrada
      </span>
    );
  }

  // 'under'/'over' implican ratio numérico; si llegara null con clasificación
  // direccional (inconsistencia del backend), degradamos a no renderizar.
  if (ratio === null) return null;

  return (
    <span
      title={TOOLTIP_TEXT}
      className={cn(
        baseClasses,
        classification === 'under'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
        className
      )}
    >
      {ratio.toFixed(1)}× estimado
    </span>
  );
}
