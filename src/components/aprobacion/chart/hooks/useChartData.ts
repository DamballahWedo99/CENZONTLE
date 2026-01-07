/**
 * useChartData Hook
 *
 * SOLID Principles:
 * - Single Responsibility: Transform data for chart consumption
 * - DRY: Centralized data transformation logic
 */

import { useMemo } from 'react';
import type { TransaccionMensualData } from '@/types/aprobacion';
import type { ChartDataPoint, ChartMetric } from '../types';

/**
 * Transforms TransaccionMensualData[] into ChartDataPoint[]
 * Includes only visible metrics to optimize rendering
 */
export function useChartData(
  data: TransaccionMensualData[],
  metrics: ChartMetric[]
): ChartDataPoint[] {
  return useMemo(() => {
    const visibleMetrics = metrics.filter(m => m.visible !== false);

    return data.map((item, index) => {
      const point: ChartDataPoint = {
        month: item.mes,
        monthIndex: index
      };

      // Add only visible metrics to data point
      visibleMetrics.forEach(metric => {
        point[metric.key] = item[metric.key];
      });

      return point;
    });
  }, [data, metrics]);
}
