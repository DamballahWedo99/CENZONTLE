/**
 * AprobacionWaterfallChart Component
 *
 * D3.js waterfall chart showing approval journey
 * Pattern: D3 for calculations, React for rendering
 *
 * SOLID Principles:
 * - Single Responsibility: Renders waterfall visualization
 * - Open/Closed: Extensible via config prop
 * - Dependency Inversion: Uses hooks for data/theme
 */

'use client';

import { useRef, useMemo, useState, useEffect } from 'react';
import * as d3 from 'd3';
import { useWaterfallData } from './hooks/useWaterfallData';
import { useWaterfallTheme } from './hooks/useWaterfallTheme';
import type {
  AprobacionWaterfallChartProps,
  WaterfallChartConfig,
  WaterfallDimensions
} from './types';

const DEFAULT_CONFIG: WaterfallChartConfig = {
  height: 400,
  margin: { top: 20, right: 30, bottom: 60, left: 60 },
  showGrid: true,
  showLabels: true,
  animationDuration: 750,
  barWidthRatio: 0.6
};

export function AprobacionWaterfallChart({
  data,
  config: userConfig,
  className = ''
}: AprobacionWaterfallChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Merge configuration
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  // Get theme
  const theme = useWaterfallTheme();

  // Transform data to waterfall segments
  const segments = useWaterfallData(data);

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Chart dimensions
  const dimensions: WaterfallDimensions = useMemo(() => {
    const margin = config.margin || DEFAULT_CONFIG.margin!;
    return {
      width: containerWidth,
      height: config.height || 400,
      margin
    };
  }, [containerWidth, config.height, config.margin]);

  // Calculate inner dimensions
  const innerWidth = dimensions.width - dimensions.margin.left - dimensions.margin.right;
  const innerHeight = dimensions.height - dimensions.margin.top - dimensions.margin.bottom;

  // D3 Scales
  const scales = useMemo(() => {
    // X Scale: Band scale for segments
    const xScale = d3
      .scaleBand<number>()
      .domain(segments.map((_, i) => i))
      .range([0, innerWidth])
      .padding(1 - (config.barWidthRatio || 0.6));

    // Y Scale: Linear scale for percentage values
    const maxValue = Math.max(
      ...segments.map(s => Math.max(Math.abs(s.start), Math.abs(s.end)))
    );
    const yMax = Math.ceil(maxValue / 10) * 10; // Round up to nearest 10

    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([innerHeight, 0])
      .nice();

    return { x: xScale, y: yScale };
  }, [segments, innerWidth, innerHeight, config.barWidthRatio]);

  // Y-axis ticks
  const yTicks = scales.y.ticks(5);

  // Filter out connector segments for rendering
  const visibleSegments = segments.filter(s => !s.isConnector);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <svg
        width={dimensions.width}
        height={dimensions.height}
        className="overflow-visible w-full"
        role="img"
        aria-label="Gráfica de waterfall de aprobación"
      >
        <g transform={`translate(${dimensions.margin.left},${dimensions.margin.top})`}>
          {/* Grid lines */}
          {config.showGrid && (
            <g className="grid">
              {yTicks.map(tick => (
                <line
                  key={tick}
                  x1={0}
                  y1={scales.y(tick)}
                  x2={innerWidth}
                  y2={scales.y(tick)}
                  stroke={theme.grid.stroke}
                  strokeWidth={theme.grid.strokeWidth}
                  strokeDasharray={theme.grid.strokeDasharray}
                />
              ))}
            </g>
          )}

          {/* Connector lines */}
          {segments.map((segment, i) => {
            if (i === 0 || i >= segments.length - 1) return null;

            const prevSegment = segments[i - 1];
            const x1 = (scales.x(i - 1) || 0) + scales.x.bandwidth();
            const x2 = scales.x(i) || 0;
            const y = scales.y(prevSegment.end);

            return (
              <line
                key={`connector-${i}`}
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={theme.colors.connector}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            );
          })}

          {/* Waterfall bars */}
          {segments.map((segment, i) => {
            if (segment.isConnector) return null;

            const x = scales.x(i) || 0;
            const barWidth = scales.x.bandwidth();
            const y = scales.y(Math.max(segment.start, segment.end));
            const barHeight = Math.abs(scales.y(segment.start) - scales.y(segment.end));

            // Determine bar color
            let fillColor = segment.color;
            let fillOpacity = 0.8;

            if (segment.type === 'total') {
              fillOpacity = 0.9;
            }

            return (
              <g key={`bar-${i}`}>
                {/* Bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  stroke={fillColor}
                  strokeWidth={2}
                  className="transition-all cursor-pointer hover:opacity-100"
                />

                {/* Value label */}
                {config.showLabels && segment.value !== 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 5}
                    textAnchor="middle"
                    fill={theme.labels.fill}
                    fontSize={theme.labels.fontSize}
                    fontWeight="600"
                  >
                    {segment.type === 'total'
                      ? `${segment.value.toFixed(1)}%`
                      : `${segment.value > 0 ? '+' : ''}${segment.value.toFixed(1)}%`}
                  </text>
                )}
              </g>
            );
          })}

          {/* X Axis */}
          <g className="x-axis" transform={`translate(0,${innerHeight})`}>
            <line
              x1={0}
              y1={0}
              x2={innerWidth}
              y2={0}
              stroke={theme.axis.stroke}
            />
            {visibleSegments.map((segment, i) => {
              const actualIndex = segments.indexOf(segment);
              return (
                <g
                  key={`label-${i}`}
                  transform={`translate(${(scales.x(actualIndex) || 0) + scales.x.bandwidth() / 2},0)`}
                >
                  <text
                    y={20}
                    textAnchor="middle"
                    fill={theme.axis.tickColor}
                    fontSize={theme.axis.fontSize}
                    className="max-w-[80px]"
                  >
                    {segment.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Y Axis */}
          <g className="y-axis">
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={innerHeight}
              stroke={theme.axis.stroke}
            />
            {yTicks.map(tick => (
              <g key={tick} transform={`translate(0,${scales.y(tick)})`}>
                <text
                  x={-10}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  fill={theme.axis.tickColor}
                  fontSize={theme.axis.fontSize}
                >
                  {tick}%
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 justify-center text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(142.1 76.2% 36.3%)' }} />
          <span className="text-zinc-600 dark:text-zinc-400">Aprobación Base</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(217.2 91.2% 59.8%)' }} />
          <span className="text-zinc-600 dark:text-zinc-400">Recovery Retry</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(262.1 83.3% 57.8%)' }} />
          <span className="text-zinc-600 dark:text-zinc-400">Contribución 3DS</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: 'hsl(24.6 95% 53.1%)' }} />
          <span className="text-zinc-600 dark:text-zinc-400">Total Final</span>
        </div>
      </div>
    </div>
  );
}
