/**
 * useChartTheme Hook
 *
 * SOLID Principles:
 * - Single Responsibility: Provide theme configuration
 * - Dependency Inversion: Abstract theme from implementation
 */

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import type { ChartTheme } from '../types';

/**
 * Provides theme configuration based on current theme (light/dark)
 * Memoized to prevent unnecessary recalculations
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return useMemo(
    () => ({
      background: isDark ? 'hsl(240 10% 3.9%)' : 'hsl(0 0% 100%)',
      grid: {
        stroke: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
        strokeWidth: 1,
        strokeDasharray: '3 3'
      },
      axis: {
        stroke: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
        tickColor: isDark ? 'hsl(240 5% 64.9%)' : 'hsl(240 3.8% 46.1%)',
        fontSize: 12
      },
      tooltip: {
        background: isDark ? 'hsl(240 10% 3.9%)' : 'hsl(0 0% 100%)',
        border: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
        text: isDark ? 'hsl(0 0% 98%)' : 'hsl(240 10% 3.9%)'
      }
    }),
    [isDark]
  );
}
