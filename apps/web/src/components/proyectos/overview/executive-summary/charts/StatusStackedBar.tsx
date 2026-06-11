'use client';

import { useMemo } from 'react';
import { scaleLinear } from 'd3';
import type { StoryStatusSlice } from '@cenzontle/shared';
import { STATUS_ORDER, STATUS_BG, STATUS_LABELS } from './chart-theme';
import { useMounted } from './use-mounted';

interface StatusStackedBarProps {
  distribution: StoryStatusSlice[];
}

/**
 * Barra horizontal apilada con la distribución de historias por status.
 * d3.scaleLinear convierte conteos a porcentaje de ancho; el render son divs
 * con transición CSS de width al montar.
 */
export function StatusStackedBar({ distribution }: StatusStackedBarProps) {
  const mounted = useMounted();

  const segments = useMemo(() => {
    const byStatus = new Map(distribution.map((s) => [s.status, s]));
    const total = distribution.reduce((sum, s) => sum + s.count, 0);
    if (total === 0) return [];
    const toPct = scaleLinear().domain([0, total]).range([0, 100]);
    return STATUS_ORDER.flatMap((status) => {
      const slice = byStatus.get(status);
      if (!slice || slice.count === 0) return [];
      return [{ ...slice, widthPct: toPct(slice.count) }];
    });
  }, [distribution]);

  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin historias</p>;
  }

  return (
    <div>
      <div className="flex h-7 overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => (
          <div
            key={seg.status}
            className={`${STATUS_BG[seg.status]} transition-[width] duration-700 ease-out hover:brightness-110`}
            style={{ width: mounted ? `${seg.widthPct}%` : '0%' }}
            title={`${STATUS_LABELS[seg.status]}: ${seg.count} historias · ${seg.points} SP`}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.status} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_BG[seg.status]}`} />
            <span className="text-muted-foreground">{STATUS_LABELS[seg.status]}</span>
            <span className="font-medium tabular-nums">{seg.count}</span>
            <span className="text-muted-foreground/60 tabular-nums">· {seg.points} SP</span>
          </div>
        ))}
      </div>
    </div>
  );
}
