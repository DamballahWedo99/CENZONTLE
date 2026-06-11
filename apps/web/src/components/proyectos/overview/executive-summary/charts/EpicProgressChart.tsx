'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3';
import type { EpicMetricsRow } from '@cenzontle/shared';
import { StatusBadge } from '@/components/proyectos/shared/StatusBadge';
import { PRIORITY_LABELS, PRIORITY_PILL, progressBarColor } from './chart-theme';
import { useMounted } from './use-mounted';

interface EpicProgressChartProps {
  epics: EpicMetricsRow[];
}

/**
 * Barras horizontales de progreso por épica, ordenadas de mayor a menor
 * avance. d3.scaleLinear mapea progreso a ancho; transición CSS al montar.
 */
export function EpicProgressChart({ epics }: EpicProgressChartProps) {
  const mounted = useMounted();

  const rows = useMemo(() => {
    const toPct = scaleLinear().domain([0, 100]).range([0, 100]).clamp(true);
    return [...epics]
      .sort((a, b) => b.progressPct - a.progressPct)
      .map((epic) => ({ ...epic, widthPct: toPct(epic.progressPct) }));
  }, [epics]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin épicas</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map((epic) => (
        <div key={epic.epicId} title={`${epic.title} — ${epic.progressPct}% · ${epic.pointsDone}/${epic.pointsTotal} SP`}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{epic.title}</span>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${PRIORITY_PILL[epic.priority]}`}
            >
              {PRIORITY_LABELS[epic.priority]}
            </span>
            <StatusBadge status={epic.status} type="epic" className="shrink-0" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${progressBarColor(epic.progressPct)} transition-[width] duration-700 ease-out`}
                style={{ width: mounted ? `${epic.widthPct}%` : '0%' }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
              {epic.progressPct}%
            </span>
            <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {epic.storiesDone}/{epic.storiesTotal}
            </span>
            <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {epic.pointsTotal} SP
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
