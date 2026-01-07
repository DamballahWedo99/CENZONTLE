/**
 * useChartScales Hook
 *
 * SOLID Principles:
 * - Single Responsibility: Only creates and configures D3 scales
 * - DRY: Centralized scale logic
 *
 * Pattern: D3 for calculations, React for rendering
 */

import { useMemo } from 'react';
import * as d3 from 'd3';
import type { ChartDimensions, ChartScales, ChartDataPoint } from '../types';

interface UseChartScalesParams {
  data: ChartDataPoint[];
  dimensions: ChartDimensions;
}

/**
 * Creates D3 scales for x and y axes
 * Memoized to prevent unnecessary recalculations
 */
export function useChartScales({
  data,
  dimensions
}: UseChartScalesParams): ChartScales {
  const { width, height, margin } = dimensions;

  const scales = useMemo(() => {
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // X Scale: Band scale for months (categorical)
    const xScale = d3
      .scaleBand<string>()
      .domain(data.map(d => d.month))
      .range([0, innerWidth])
      .padding(0.1);

    // Y Scale: Linear scale for percentages (0-100%)
    // Find max value across all metrics for dynamic scaling
    const maxValue = d3.max(data, d => {
      const values = Object.entries(d)
        .filter(([key]) => key !== 'month' && key !== 'monthIndex')
        .map(([, value]) => value as number);
      return Math.max(...values);
    }) || 100;

    const yScale = d3
      .scaleLinear()
      .domain([0, Math.ceil(maxValue / 10) * 10]) // Round up to nearest 10
      .range([innerHeight, 0])
      .nice(); // Extend domain to nice round values

    return {
      x: xScale,
      y: yScale
    };
  }, [data, width, height, margin]);

  return scales;
}
