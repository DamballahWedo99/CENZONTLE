/**
 * ChartTooltip Component
 *
 * Interactive tooltip for chart data points
 *
 * SOLID Principles:
 * - Single Responsibility: Renders tooltip UI only
 * - Open/Closed: Extensible via TooltipData interface
 * - Dependency Inversion: Uses theme from parent
 */

'use client';

import { useMemo } from 'react';
import type { TooltipData, ChartMetric } from './types';
import type { TransaccionMensualData } from '@/types/aprobacion';

interface ChartTooltipProps {
  tooltip: TooltipData | null;
  metric: ChartMetric;
  monthData: TransaccionMensualData;
  containerWidth: number;
  containerHeight: number;
}

export function ChartTooltip({
  tooltip,
  metric,
  monthData,
  containerWidth,
  containerHeight
}: ChartTooltipProps) {
  // Calculate tooltip position with boundary detection
  const tooltipStyle = useMemo(() => {
    if (!tooltip) return { display: 'none' };

    const tooltipWidth = 280;
    const tooltipHeight = 240;
    const offset = 12;

    let left = tooltip.x + offset;
    let top = tooltip.y - tooltipHeight / 2;

    // Boundary detection - horizontal
    if (left + tooltipWidth > containerWidth) {
      left = tooltip.x - tooltipWidth - offset;
    }

    // Boundary detection - vertical
    if (top < 0) {
      top = offset;
    } else if (top + tooltipHeight > containerHeight) {
      top = containerHeight - tooltipHeight - offset;
    }

    return {
      position: 'absolute' as const,
      left: `${left}px`,
      top: `${top}px`,
      pointerEvents: 'none' as const,
      zIndex: 50
    };
  }, [tooltip, containerWidth, containerHeight]);

  if (!tooltip) return null;

  // Format numbers
  const formatPercent = (value: number) => `${value.toFixed(2)}%`;
  const formatNumber = (value: number) => value.toLocaleString('es-MX');

  // Get metric value
  const metricValue = monthData[metric.key as keyof TransaccionMensualData] as number;

  return (
    <div
      style={tooltipStyle}
      className="animate-in fade-in-0 zoom-in-95 duration-200"
      role="tooltip"
      aria-live="polite"
    >
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-4 w-[280px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {monthData.mes}
          </h4>
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: metric.color }}
          />
        </div>

        {/* Primary Metric */}
        <div className="mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            {metric.label}
          </div>
          <div
            className="text-2xl font-bold"
            style={{ color: metric.color }}
          >
            {formatPercent(metricValue)}
          </div>
        </div>

        {/* Additional Metrics */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Transacciones Totales
            </span>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {formatNumber(monthData.trxEnviadasTotales)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Transacciones Aprobadas
            </span>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {formatNumber(monthData.trxAprobadasTotales)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Aprobación Final
            </span>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {formatPercent(monthData.aprobacionFinal)}
            </span>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Autenticación 3DS
            </span>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {formatPercent(monthData.pctAutenticadoCon3DS)}
            </span>
          </div>
        </div>

        {/* Arrow indicator */}
        <div
          className="absolute w-0 h-0 border-solid"
          style={{
            left: tooltip.x < containerWidth / 2 ? '-6px' : 'auto',
            right: tooltip.x >= containerWidth / 2 ? '-6px' : 'auto',
            top: '50%',
            transform: 'translateY(-50%)',
            borderWidth: tooltip.x < containerWidth / 2 ? '6px 6px 6px 0' : '6px 0 6px 6px',
            borderColor: tooltip.x < containerWidth / 2
              ? 'transparent rgb(228 228 231) transparent transparent'
              : 'transparent transparent transparent rgb(228 228 231)'
          }}
        />
      </div>
    </div>
  );
}
