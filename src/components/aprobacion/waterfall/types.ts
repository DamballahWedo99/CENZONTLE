/**
 * Waterfall Chart Types
 *
 * SOLID Principles:
 * - Single Responsibility: Type definitions only
 * - Interface Segregation: Granular, focused types
 */

import type { TransaccionMensualData } from '@/types/aprobacion';

/**
 * Represents a segment in the waterfall chart
 */
export interface WaterfallSegment {
  /** Display label for the segment */
  label: string;

  /** Value of the segment (can be positive or negative) */
  value: number;

  /** Starting Y position (percentage) */
  start: number;

  /** Ending Y position (percentage) */
  end: number;

  /** Type of segment determines color and direction */
  type: 'increase' | 'decrease' | 'total';

  /** Display color */
  color: string;

  /** Whether this is a connector (invisible bar) */
  isConnector?: boolean;
}

/**
 * Configuration for waterfall chart
 */
export interface WaterfallChartConfig {
  /** Chart height in pixels */
  height?: number;

  /** Chart margins */
  margin?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  /** Show grid lines */
  showGrid?: boolean;

  /** Show value labels on bars */
  showLabels?: boolean;

  /** Animation duration in ms */
  animationDuration?: number;

  /** Bar width as percentage of available space */
  barWidthRatio?: number;
}

/**
 * Waterfall chart dimensions
 */
export interface WaterfallDimensions {
  width: number;
  height: number;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

/**
 * Theme configuration for waterfall chart
 */
export interface WaterfallTheme {
  colors: {
    increase: string;
    decrease: string;
    total: string;
    connector: string;
  };
  grid: {
    stroke: string;
    strokeWidth: number;
    strokeDasharray: string;
  };
  axis: {
    stroke: string;
    tickColor: string;
    fontSize: number;
  };
  labels: {
    fill: string;
    fontSize: number;
  };
}

/**
 * Props for AprobacionWaterfallChart component
 */
export interface AprobacionWaterfallChartProps {
  /** Monthly transaction data */
  data: TransaccionMensualData;

  /** Optional configuration */
  config?: Partial<WaterfallChartConfig>;

  /** Optional CSS classes */
  className?: string;
}
