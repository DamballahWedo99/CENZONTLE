/**
 * AprobacionD3Chart Component
 *
 * D3.js implementation following React best practices
 * Pattern: D3 for calculations, React for rendering
 *
 * SOLID Principles:
 * - Single Responsibility: Renders chart visualization
 * - Open/Closed: Extensible via config prop
 * - Dependency Inversion: Uses hooks for data/scales/theme
 */

'use client';

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { useChartData } from './hooks/useChartData';
import { useChartScales } from './hooks/useChartScales';
import { useChartTheme } from './hooks/useChartTheme';
import { ChartTooltip } from './ChartTooltip';
import type {
  AprobacionChartConfig,
  ChartMetric,
  ChartDimensions,
  TooltipData
} from './types';
import type { TransaccionMensualData } from '@/types/aprobacion';

// Default metrics configuration
// Order matters: render from highest values (back) to lowest values (front)
const DEFAULT_METRICS: ChartMetric[] = [
  {
    key: 'aprobacionFinal',
    label: 'Aprobación Final',
    color: 'hsl(24.6 95% 53.1%)', // orange-600
    type: 'area',
    fillOpacity: 0.3,
    strokeWidth: 2
  },
  {
    key: 'aprobacionCompuesta',
    label: 'Aprobación Compuesta',
    color: 'hsl(328 100% 45%)', // fuchsia (Aeroméxico)
    type: 'area',
    fillOpacity: 0.3,
    strokeWidth: 2
  },
  {
    key: 'aprobacionBase',
    label: 'Aprobación Base',
    color: 'hsl(142.1 76.2% 36.3%)', // green-600
    type: 'area',
    fillOpacity: 0.3,
    strokeWidth: 2
  },
  {
    key: 'aprobacionRetry',
    label: 'Aprobación Retry',
    color: 'hsl(217.2 91.2% 59.8%)', // blue-600
    type: 'area',
    fillOpacity: 0.3,
    strokeWidth: 2
  }
];

const DEFAULT_CONFIG: AprobacionChartConfig = {
  metrics: DEFAULT_METRICS,
  height: 400,
  showGrid: true,
  showAxes: true,
  showTooltip: true,
  animationDuration: 750,
  margin: { top: 20, right: 30, bottom: 40, left: 50 }
};

interface AprobacionD3ChartProps {
  data: TransaccionMensualData[];
  config?: Partial<AprobacionChartConfig>;
  className?: string;
  onMonthClick?: (monthData: TransaccionMensualData) => void;
}

export function AprobacionD3Chart({
  data,
  config: userConfig,
  className = '',
  onMonthClick
}: AprobacionD3ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [activeMetric, setActiveMetric] = useState<ChartMetric | null>(null);
  const [activeMonthData, setActiveMonthData] = useState<TransaccionMensualData | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Merge configuration
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const metrics = config.metrics || DEFAULT_METRICS;

  // Get theme
  const theme = useChartTheme();

  // Transform data
  const chartData = useChartData(data, metrics);

  // Chart dimensions (must be called before any conditional returns)
  const dimensions: ChartDimensions = useMemo(() => {
    const configMargin = config.margin || {};
    const margin = {
      top: configMargin.top ?? 20,
      right: configMargin.right ?? 30,
      bottom: configMargin.bottom ?? 40,
      left: configMargin.left ?? 50
    };
    return {
      width: containerWidth || 800, // Use fallback if null
      height: config.height || 400,
      margin
    };
  }, [containerWidth, config.height, config.margin]);

  // Create D3 scales
  const scales = useChartScales({ data: chartData, dimensions });

  // Calculate inner dimensions
  const innerWidth = dimensions.width - dimensions.margin.left - dimensions.margin.right;
  const innerHeight = dimensions.height - dimensions.margin.top - dimensions.margin.bottom;

  // Generate D3 line paths using useMemo
  const linePaths = useMemo(() => {
    const lineMetrics = metrics.filter(m => m.type === 'line' && m.visible !== false);

    return lineMetrics.map(metric => {
      const lineGenerator = d3
        .line<typeof chartData[0]>()
        .x(d => (scales.x(d.month) || 0) + scales.x.bandwidth() / 2)
        .y(d => scales.y(d[metric.key] as number))
        .curve(d3.curveMonotoneX); // Smooth curve

      return {
        metric,
        path: lineGenerator(chartData) || ''
      };
    });
  }, [chartData, metrics, scales]);

  // Generate D3 area paths using useMemo
  const areaPaths = useMemo(() => {
    const areaMetrics = metrics.filter(m => m.type === 'area' && m.visible !== false);

    return areaMetrics.map(metric => {
      const areaGenerator = d3
        .area<typeof chartData[0]>()
        .x(d => (scales.x(d.month) || 0) + scales.x.bandwidth() / 2)
        .y0(innerHeight)
        .y1(d => scales.y(d[metric.key] as number))
        .curve(d3.curveMonotoneX); // Smooth curve

      return {
        metric,
        path: areaGenerator(chartData) || ''
      };
    });
  }, [chartData, metrics, scales, innerHeight]);

  // Measure container width (must be after all other hooks)
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

  // Generate Y axis ticks
  const yTicks = scales.y.ticks(5);
  const xTicks = chartData.map(d => d.month);

  // Tooltip event handlers
  const handleMouseEnter = useCallback(
    (
      event: React.MouseEvent<SVGCircleElement>,
      metric: ChartMetric,
      monthData: TransaccionMensualData,
      dataPoint: typeof chartData[0]
    ) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      setTooltip({
        month: dataPoint.month,
        data: dataPoint,
        x,
        y
      });
      setActiveMetric(metric);
      setActiveMonthData(monthData);
    },
    []
  );

  const handleMouseMove = useCallback((event: React.MouseEvent<SVGCircleElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !tooltip) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setTooltip(prev => prev ? { ...prev, x, y } : null);
  }, [tooltip]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setActiveMetric(null);
    setActiveMonthData(null);
  }, []);

  // Touch event handlers for mobile
  const handleTouchStart = useCallback(
    (
      event: React.TouchEvent<SVGCircleElement>,
      metric: ChartMetric,
      monthData: TransaccionMensualData,
      dataPoint: typeof chartData[0]
    ) => {
      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const touch = event.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      setTooltip({
        month: dataPoint.month,
        data: dataPoint,
        x,
        y
      });
      setActiveMetric(metric);
      setActiveMonthData(monthData);
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    // Delay hiding tooltip on touch to allow users to read it
    setTimeout(() => {
      setTooltip(null);
      setActiveMetric(null);
      setActiveMonthData(null);
    }, 2000);
  }, []);

  // Don't render until we have measured the container width
  if (containerWidth === null) {
    return (
      <div ref={containerRef} className={`relative w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 ${className}`}>
        <div className="h-[400px] flex items-center justify-center">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Cargando gráfica...</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 ${className}`}>
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes drawPath {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
      `}</style>
      <svg
        width={dimensions.width}
        height={dimensions.height}
        className="overflow-visible w-full animate-fadeIn"
        role="img"
        aria-label="Gráfica de aprobación"
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

          {/* Area paths */}
          {areaPaths.map(({ metric, path }, index) => (
            <path
              key={`area-${metric.key}`}
              d={path}
              fill={metric.color}
              fillOpacity={metric.fillOpacity || 0.3}
              stroke={metric.color}
              strokeWidth={metric.strokeWidth || 2}
              style={{
                animation: `drawPath 1s ease-out ${index * 0.1}s both`
              }}
            />
          ))}

          {/* Line paths */}
          {linePaths.map(({ metric, path }, index) => (
            <path
              key={`line-${metric.key}`}
              d={path}
              fill="none"
              stroke={metric.color}
              strokeWidth={metric.strokeWidth || 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                animation: `drawPath 1s ease-out ${(areaPaths.length + index) * 0.1}s both`
              }}
            />
          ))}

          {/* Data points (circles) */}
          {metrics
            .filter(m => m.visible !== false)
            .map((metric, metricIndex) => (
              <g key={`points-${metric.key}`}>
                {chartData.map((d, pointIndex) => {
                  const cx = (scales.x(d.month) || 0) + scales.x.bandwidth() / 2;
                  const cy = scales.y(d[metric.key] as number);
                  const monthData = data.find(m => m.mes === d.month);
                  if (!monthData) return null;
                  const isActive = tooltip && activeMetric?.key === metric.key && tooltip.month === d.month;
                  const animationDelay = (areaPaths.length + linePaths.length) * 0.1 + (metricIndex * chartData.length + pointIndex) * 0.03;

                  return (
                    <circle
                      key={`${metric.key}-${d.month}`}
                      cx={cx}
                      cy={cy}
                      r={isActive ? 6 : 4}
                      fill={metric.color}
                      stroke="white"
                      strokeWidth={2}
                      className="cursor-pointer transition-all duration-200"
                      style={{
                        filter: isActive ? 'drop-shadow(0 0 6px rgba(0,0,0,0.3))' : 'none',
                        animation: `scaleIn 0.4s ease-out ${animationDelay}s both`,
                        transformOrigin: `${cx}px ${cy}px`
                      }}
                      onClick={() => onMonthClick?.(monthData)}
                      onMouseEnter={(e) => handleMouseEnter(e, metric, monthData, d)}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                      onTouchStart={(e) => handleTouchStart(e, metric, monthData, d)}
                      onTouchEnd={handleTouchEnd}
                      role="button"
                      aria-label={`${metric.label} para ${d.month}: ${d[metric.key]}%`}
                      tabIndex={0}
                    />
                  );
                })}
              </g>
            ))}

          {/* X Axis */}
          {config.showAxes && (
            <g className="x-axis" transform={`translate(0,${innerHeight})`}>
              <line
                x1={0}
                y1={0}
                x2={innerWidth}
                y2={0}
                stroke={theme.axis.stroke}
              />
              {xTicks.map((tick) => (
                <g
                  key={tick}
                  transform={`translate(${(scales.x(tick) || 0) + scales.x.bandwidth() / 2},0)`}
                >
                  <text
                    y={20}
                    textAnchor="middle"
                    fill={theme.axis.tickColor}
                    fontSize={theme.axis.fontSize}
                  >
                    {tick}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Y Axis */}
          {config.showAxes && (
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
          )}
        </g>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 justify-center">
        {metrics
          .filter(m => m.visible !== false)
          .map(metric => (
            <div key={metric.key} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: metric.color }}
              />
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {metric.label}
              </span>
            </div>
          ))}
      </div>

      {/* Tooltip */}
      {tooltip && activeMetric && activeMonthData && config.showTooltip && (
        <ChartTooltip
          tooltip={tooltip}
          metric={activeMetric}
          monthData={activeMonthData}
          containerWidth={dimensions.width}
          containerHeight={dimensions.height}
        />
      )}
    </div>
  );
}
