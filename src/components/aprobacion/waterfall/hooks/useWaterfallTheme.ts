/**
 * useWaterfallTheme Hook
 *
 * SOLID Principles:
 * - Single Responsibility: Provide theme configuration
 * - Dependency Inversion: Abstract theme from implementation
 */

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import type { WaterfallTheme } from '../types';

/**
 * Provides theme configuration for waterfall chart
 * Adapts to light/dark mode
 */
export function useWaterfallTheme(): WaterfallTheme {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return useMemo(
    () => ({
      colors: {
        increase: 'hsl(142.1 76.2% 36.3%)', // green-600
        decrease: 'hsl(0 84.2% 60.2%)', // red-600
        total: 'hsl(24.6 95% 53.1%)', // orange-600
        connector: isDark ? 'hsl(240 3.7% 25%)' : 'hsl(240 5.9% 80%)'
      },
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
      labels: {
        fill: isDark ? 'hsl(0 0% 98%)' : 'hsl(240 10% 3.9%)',
        fontSize: 11
      }
    }),
    [isDark]
  );
}
