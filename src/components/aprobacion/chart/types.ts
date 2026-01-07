/**
 * Chart Types for D3.js Implementation
 *
 * SOLID Principles:
 * - Single Responsibility: Each interface has one clear purpose
 * - Open/Closed: Extend interfaces without modifying existing code
 * - Interface Segregation: Small, focused interfaces
 */

import { TransaccionMensualData } from '@/types/aprobacion';

/**
 * Chart metric configuration
 * Defines how each data series should be visualized
 */
export interface ChartMetric {
  key: keyof TransaccionMensualData;
  label: string;
  color: string;
  type: 'line' | 'area';
  strokeWidth?: number;
  fillOpacity?: number;
  visible?: boolean;
}

/**
 * Chart dimensions and margins
 */
export interface ChartDimensions {
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
 * D3 Scale configuration
 */
export interface ChartScales {
  x: d3.ScaleBand<string>;
  y: d3.ScaleLinear<number, number>;
}

/**
 * Processed data point for chart
 */
export interface ChartDataPoint {
  month: string;
  monthIndex: number;
  [key: string]: string | number;
}

/**
 * Chart configuration
 */
export interface AprobacionChartConfig {
  metrics: ChartMetric[];
  height?: number;
  showGrid?: boolean;
  showAxes?: boolean;
  showTooltip?: boolean;
  animationDuration?: number;
  margin?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

/**
 * Chart theme for styling
 */
export interface ChartTheme {
  background: string;
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
  tooltip: {
    background: string;
    border: string;
    text: string;
  };
}

/**
 * Tooltip data when hovering over chart
 */
export interface TooltipData {
  month: string;
  data: ChartDataPoint;
  x: number;
  y: number;
}
