'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3';
import { CalendarOff } from 'lucide-react';
import type { InitiativeMetrics } from '@cenzontle/shared';
import { formatShortDate } from './chart-theme';
import { useMounted } from './use-mounted';

interface TimelineGaugeProps {
  timeline: InitiativeMetrics['timeline'];
  /** 0-100 — progreso real de historias, para contrastar contra el tiempo. */
  progressPct: number;
}

/**
 * Línea temporal start→target con marcador de "hoy", contrastada contra el
 * avance real. Las dos barras comparten escala y están alineadas — el gap
 * visual entre ambas ES la historia: tiempo consumido vs trabajo entregado.
 */
export function TimelineGauge({ timeline, progressPct }: TimelineGaugeProps) {
  const mounted = useMounted();
  const { startDate, targetDate, elapsedPct, daysRemaining } = timeline;

  const toPct = useMemo(
    () => scaleLinear().domain([0, 100]).range([0, 100]).clamp(true),
    [],
  );

  if (!startDate || !targetDate || elapsedPct === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 text-center">
        <CalendarOff className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Sin fechas comprometidas</p>
        <p className="text-xs text-muted-foreground/70">
          Define fecha de inicio y objetivo para ver la proyección temporal
        </p>
      </div>
    );
  }

  const overdue = elapsedPct > 100;
  const elapsedWidth = toPct(elapsedPct);
  const progressWidth = toPct(progressPct);
  // Gap schedule-vs-avance en puntos porcentuales (positivo = adelantado).
  const delta = Math.round(progressPct - Math.min(elapsedPct, 100));

  return (
    <div>
      {/* Encabezado: rango de fechas + días restantes */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatShortDate(startDate)}
          <span className="mx-1.5 text-muted-foreground/50">→</span>
          {formatShortDate(targetDate)}
        </span>
        {daysRemaining !== null && (
          <span
            className={`text-sm font-semibold tabular-nums ${
              daysRemaining < 0
                ? 'text-red-500'
                : daysRemaining <= 14
                  ? 'text-amber-500'
                  : 'text-foreground'
            }`}
          >
            {daysRemaining < 0
              ? `Vencida hace ${Math.abs(daysRemaining)} días`
              : `${daysRemaining} días restantes`}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* Barra de tiempo transcurrido con marcador de hoy */}
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
            Tiempo
          </span>
          <div className="relative h-3 flex-1 rounded-full bg-muted" title={`Tiempo transcurrido: ${Math.round(elapsedPct)}%`}>
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${overdue ? 'bg-red-500' : 'bg-sky-500'} transition-[width] duration-700 ease-out`}
              style={{ width: mounted ? `${elapsedWidth}%` : '0%' }}
            />
            {/* Marcador "hoy" — línea vertical sobre la posición elapsed */}
            <div
              className="absolute -inset-y-1 w-px bg-foreground/70 transition-[left] duration-700 ease-out"
              style={{ left: mounted ? `${elapsedWidth}%` : '0%' }}
            >
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-medium text-muted-foreground">
                hoy
              </span>
            </div>
          </div>
          <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
            {Math.round(elapsedPct)}%
          </span>
        </div>

        {/* Barra de avance real, alineada a la misma escala */}
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
            Avance
          </span>
          <div className="relative h-3 flex-1 rounded-full bg-muted" title={`Avance real: ${progressPct}%`}>
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width] duration-700 ease-out"
              style={{ width: mounted ? `${progressWidth}%` : '0%' }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
            {progressPct}%
          </span>
        </div>
      </div>

      {/* Lectura del gap */}
      <p className="mt-4 text-xs text-muted-foreground">
        {delta >= 0 ? (
          <span className="font-medium text-emerald-500">
            +{delta} pts por delante del calendario
          </span>
        ) : (
          <span className={`font-medium ${delta <= -20 ? 'text-red-500' : 'text-amber-500'}`}>
            {delta} pts por detrás del calendario
          </span>
        )}
        <span className="text-muted-foreground/70"> — avance real vs tiempo transcurrido</span>
      </p>
    </div>
  );
}
