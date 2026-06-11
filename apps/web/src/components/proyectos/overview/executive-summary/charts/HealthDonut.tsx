'use client';

import { useId, useMemo } from 'react';
import { arc } from 'd3';
import type { ExecutiveSummaryHealth } from '@cenzontle/shared';
import { HEALTH_THEME } from './chart-theme';
import { useMounted } from './use-mounted';

interface HealthDonutProps {
  /** 0-100. */
  progressPct: number;
  health: ExecutiveSummaryHealth;
}

const SIZE = 200;
const OUTER_R = 92;
const INNER_R = 74;
const MID_R = (OUTER_R + INNER_R) / 2;
const TAU = Math.PI * 2;

/**
 * Donut de progreso global. d3.arc() calcula la geometría (anillo de fondo +
 * arco de progreso con esquinas redondeadas); el render es JSX/SVG puro.
 *
 * La animación de barrido al montar es CSS: el arco se revela con una mask
 * circular cuyo stroke-dashoffset transiciona de "oculto" a la fracción de
 * progreso — d3 solo hace matemáticas, nunca toca el DOM.
 */
export function HealthDonut({ progressPct, health }: HealthDonutProps) {
  const mounted = useMounted();
  const maskId = useId();
  const theme = HEALTH_THEME[health];
  const pct = Math.max(0, Math.min(100, progressPct));

  const { ringPath, arcPath } = useMemo(() => {
    const gen = arc().cornerRadius((OUTER_R - INNER_R) / 2);
    return {
      ringPath:
        gen({ innerRadius: INNER_R, outerRadius: OUTER_R, startAngle: 0, endAngle: TAU }) ?? '',
      arcPath:
        pct > 0
          ? gen({
              innerRadius: INNER_R,
              outerRadius: OUTER_R,
              startAngle: 0,
              endAngle: TAU * (pct / 100),
            }) ?? ''
          : '',
    };
  }, [pct]);

  const circumference = TAU * MID_R;
  const revealOffset = circumference * (1 - pct / 100);

  return (
    <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`Progreso global ${pct}%`}>
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="h-full w-full">
        <title>{`Progreso global: ${pct}% — ${theme.label}`}</title>
        <mask id={maskId}>
          <rect x={-SIZE / 2} y={-SIZE / 2} width={SIZE} height={SIZE} fill="black" />
          <circle
            r={MID_R}
            fill="none"
            stroke="white"
            strokeWidth={OUTER_R - INNER_R + 4}
            strokeDasharray={circumference}
            strokeDashoffset={mounted ? revealOffset : circumference}
            transform="rotate(-90)"
            style={{ transition: 'stroke-dashoffset 1000ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </mask>
        <path d={ringPath} className="fill-muted" />
        {arcPath && (
          <g mask={`url(#${maskId})`}>
            <path d={arcPath} className={theme.fill} />
          </g>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold tabular-nums tracking-tight ${theme.text}`}>
          {pct}
          <span className="text-xl font-semibold">%</span>
        </span>
        <span className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          completado
        </span>
      </div>
    </div>
  );
}
