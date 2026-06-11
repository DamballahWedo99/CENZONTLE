'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3';
import type { PodMetricsRow } from '@cenzontle/shared';
import { useMounted } from './use-mounted';

interface PodLoadChartProps {
  pods: PodMetricsRow[];
}

/**
 * Carga por pod: la longitud del track (muted) representa los puntos totales
 * asignados al pod relativo al pod más cargado; el overlay violeta marca los
 * puntos ya completados. Una sola mirada cuenta carga Y avance.
 */
export function PodLoadChart({ pods }: PodLoadChartProps) {
  const mounted = useMounted();

  const rows = useMemo(() => {
    const maxPoints = Math.max(...pods.map((p) => p.pointsTotal), 1);
    const toPct = scaleLinear().domain([0, maxPoints]).range([0, 100]).clamp(true);
    return [...pods]
      .sort((a, b) => b.pointsTotal - a.pointsTotal)
      .map((pod) => ({
        ...pod,
        totalPct: toPct(pod.pointsTotal),
        donePct: toPct(pod.pointsDone),
      }));
  }, [pods]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos de PODs</p>;
  }

  return (
    <div className="space-y-3.5">
      {rows.map((pod) => (
        <div
          key={pod.podId}
          className="flex items-center gap-3"
          title={`${pod.podName}: ${pod.pointsDone}/${pod.pointsTotal} SP · ${pod.storiesDone}/${pod.storiesTotal} historias · ${pod.progressPct}%`}
        >
          <span className="w-24 shrink-0 truncate text-xs font-medium">{pod.podName}</span>
          <div className="relative h-3.5 flex-1">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-muted transition-[width] duration-700 ease-out"
              style={{ width: mounted ? `${pod.totalPct}%` : '0%' }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-violet-500 transition-[width] duration-700 ease-out"
              style={{ width: mounted ? `${pod.donePct}%` : '0%' }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {pod.pointsDone}/{pod.pointsTotal} SP
          </span>
          <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
            {pod.progressPct}%
          </span>
        </div>
      ))}
      <div className="flex items-center gap-4 pt-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-violet-500" /> Puntos completados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-muted" /> Carga total
        </span>
      </div>
    </div>
  );
}
