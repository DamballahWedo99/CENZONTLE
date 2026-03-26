'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { CostBreakdown } from '@cenzontle/shared';
import {
  DollarSign,
  Coins,
  TrendingUp,
  TrendingDown,
  Bot,
  BookOpen,
  PieChart,
  BarChart3,
  Activity,
  Layers,
  Calculator,
  Award,
} from 'lucide-react';

// =============================================================================
// Formatters
// =============================================================================

function fmtCost(v: number): string {
  return `$${v.toFixed(2)}`;
}

function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toString();
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function extractBatchNumber(name: string): string {
  const match = name.match(/\d+$/);
  return match ? `#${match[0]}` : name;
}

// =============================================================================
// Shared Utilities
// =============================================================================

function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, rSquared: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const ssTot = points.reduce((s, p) => s + (p.y - sumY / n) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, rSquared };
}

function logRegression(points: { x: number; y: number }[]): { a: number; b: number; rSquared: number } {
  // y = a * ln(x) + b — transform to linear: y = a * X + b where X = ln(x)
  const filtered = points.filter((p) => p.x > 0);
  if (filtered.length < 2) return { a: 0, b: filtered[0]?.y ?? 0, rSquared: 0 };
  const transformed = filtered.map((p) => ({ x: Math.log(p.x), y: p.y }));
  const reg = linearRegression(transformed);
  return { a: reg.slope, b: reg.intercept, rSquared: reg.rSquared };
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    obs.observe(ref.current);
    setWidth(ref.current.clientWidth || 600);
    return () => obs.disconnect();
  }, [ref]);
  return width;
}

// =============================================================================
// Color Constants
// =============================================================================

const C = {
  totalCostArea: 'rgba(99,102,241,0.12)',
  totalCostStroke: '#6366F1',
  costPerStoryLine: '#A78BFA',
  rejectionLine: '#F59E0B',
  axisTick: '#9CA3AF',
  gridLine: 'rgba(107,114,128,0.15)',
  donutToken: '#6366F1',
  donutCompute: '#10B981',
  donutOrch: '#F59E0B',
  scatterVersions: ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
  stackToken: 'rgba(99,102,241,0.55)',
  stackCompute: 'rgba(16,185,129,0.55)',
  stackOrch: 'rgba(245,158,11,0.55)',
  effGood: '#10B981',
  effMid: '#6366F1',
  effPoor: '#EF4444',
  deltaGreen: '#22C55E',
  deltaRed: '#EF4444',
} as const;

// =============================================================================
// ChartCard Wrapper
// =============================================================================

function ChartCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <span className="text-[11px] text-muted-foreground ml-auto">{subtitle}</span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// =============================================================================
// KPI Card
// =============================================================================

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  invertDelta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  invertDelta?: boolean;
}) {
  const isPositive = delta != null && delta > 0;
  const isNegative = delta != null && delta < 0;
  const isGood = invertDelta ? isNegative : isPositive;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {delta != null && (
        <div className="flex items-center gap-1 mt-0.5">
          {isGood ? (
            <TrendingDown className="h-3 w-3" style={{ color: C.deltaGreen }} />
          ) : (
            <TrendingUp className="h-3 w-3" style={{ color: C.deltaRed }} />
          )}
          <span
            className="text-[11px] font-medium tabular-nums"
            style={{ color: isGood ? C.deltaGreen : C.deltaRed }}
          >
            {isNegative ? '' : '+'}
            {fmtPct(Math.abs(delta))}
          </span>
          {deltaLabel && (
            <span className="text-[11px] text-muted-foreground">{deltaLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Row 2: Multi-Line Trend Chart (Declarative SVG)
// =============================================================================

function MultiLineTrendChart() {
  const { state } = useFactory();
  const history = state.evolution.batchHistory;
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 280;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const data = useMemo(
    () =>
      [...history].map((b) => ({
        label: extractBatchNumber(b.batchName),
        totalCost: b.totalCost,
        costPerStory: b.stories > 0 ? b.totalCost / b.stories : 0,
        rejectionRate: b.rejectionRate,
      })),
    [history],
  );

  const margin = { top: 20, right: 56, bottom: 36, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(data.map((d) => d.label))
        .range([0, innerW])
        .padding(0.5),
    [data, innerW],
  );

  const yCostScale = useMemo(() => {
    const max = d3.max(data, (d) => Math.max(d.totalCost, d.costPerStory * 2)) ?? 30;
    return d3.scaleLinear().domain([0, max * 1.15]).nice().range([innerH, 0]);
  }, [data, innerH]);

  const yRejScale = useMemo(() => {
    const max = d3.max(data, (d) => d.rejectionRate) ?? 0.5;
    return d3.scaleLinear().domain([0, Math.max(max * 1.3, 0.1)]).nice().range([innerH, 0]);
  }, [data, innerH]);

  const areaPath = useMemo(() => {
    const gen = d3
      .area<(typeof data)[number]>()
      .x((d) => xScale(d.label) ?? 0)
      .y0(innerH)
      .y1((d) => yCostScale(d.totalCost))
      .curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yCostScale, innerH]);

  const costPerStoryPath = useMemo(() => {
    const gen = d3
      .line<(typeof data)[number]>()
      .x((d) => xScale(d.label) ?? 0)
      .y((d) => yCostScale(d.costPerStory))
      .curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yCostScale]);

  const rejectionPath = useMemo(() => {
    const gen = d3
      .line<(typeof data)[number]>()
      .x((d) => xScale(d.label) ?? 0)
      .y((d) => yRejScale(d.rejectionRate))
      .curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yRejScale]);

  const yCostTicks = yCostScale.ticks(5);
  const yRejTicks = yRejScale.ticks(4);

  if (!data.length) return null;

  return (
    <ChartCard icon={Activity} title="Batch Performance Trends" subtitle={`${data.length} batches`}>
      <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid lines */}
            {yCostTicks.map((t) => (
              <line
                key={t}
                x1={0}
                y1={yCostScale(t)}
                x2={innerW}
                y2={yCostScale(t)}
                stroke={C.gridLine}
                strokeDasharray="3 3"
              />
            ))}

            {/* Area fill for total cost */}
            <path d={areaPath} fill={C.totalCostArea} stroke={C.totalCostStroke} strokeWidth={1.5} />

            {/* Cost per story line */}
            <path d={costPerStoryPath} fill="none" stroke={C.costPerStoryLine} strokeWidth={2.5} />

            {/* Rejection rate dashed line */}
            <path
              d={rejectionPath}
              fill="none"
              stroke={C.rejectionLine}
              strokeWidth={2}
              strokeDasharray="6 4"
            />

            {/* Data points + hover zones */}
            {data.map((d, i) => {
              const cx = xScale(d.label) ?? 0;
              const isHovered = hoveredIdx === i;
              return (
                <g key={d.label}>
                  <rect
                    x={cx - innerW / data.length / 2}
                    y={0}
                    width={innerW / data.length}
                    height={innerH}
                    fill="transparent"
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  />
                  {isHovered && (
                    <line
                      x1={cx}
                      y1={0}
                      x2={cx}
                      y2={innerH}
                      stroke={C.axisTick}
                      strokeWidth={1}
                      strokeOpacity={0.3}
                      strokeDasharray="3 3"
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={yCostScale(d.costPerStory)}
                    r={isHovered ? 5 : 4}
                    fill={C.costPerStoryLine}
                    stroke="#fff"
                    strokeWidth={2}
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle
                    cx={cx}
                    cy={yRejScale(d.rejectionRate)}
                    r={isHovered ? 5 : 4}
                    fill={C.rejectionLine}
                    stroke="#fff"
                    strokeWidth={2}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })}

            {/* Left Y axis: cost */}
            {yCostTicks.map((t) => (
              <text
                key={t}
                x={-10}
                y={yCostScale(t)}
                textAnchor="end"
                alignmentBaseline="middle"
                fill={C.axisTick}
                fontSize={11}
              >
                ${t}
              </text>
            ))}

            {/* Right Y axis: rejection % */}
            {yRejTicks.map((t) => (
              <text
                key={t}
                x={innerW + 10}
                y={yRejScale(t)}
                textAnchor="start"
                alignmentBaseline="middle"
                fill={C.rejectionLine}
                fontSize={11}
              >
                {(t * 100).toFixed(0)}%
              </text>
            ))}

            {/* X axis labels */}
            {data.map((d) => (
              <text
                key={d.label}
                x={xScale(d.label) ?? 0}
                y={innerH + 22}
                textAnchor="middle"
                fill={C.axisTick}
                fontSize={11}
              >
                {d.label}
              </text>
            ))}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredIdx !== null && data[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(
                margin.left + (xScale(data[hoveredIdx].label) ?? 0),
                width - 190,
              ),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">Batch {data[hoveredIdx].label}</p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.totalCostStroke }} />
              Total: {fmtCost(data[hoveredIdx].totalCost)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.costPerStoryLine }} />
              $/Story: {fmtCost(data[hoveredIdx].costPerStory)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.rejectionLine }} />
              Rejection: {(data[hoveredIdx].rejectionRate * 100).toFixed(1)}%
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-2 justify-center">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-3 h-3 rounded" style={{ background: C.totalCostStroke, opacity: 0.3 }} />
            <span className="text-muted-foreground">Total Cost (area)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-6 h-0.5 rounded" style={{ background: C.costPerStoryLine }} />
            <span className="text-muted-foreground">Cost/Story</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-6 h-0 border-t-2 border-dashed" style={{ borderColor: C.rejectionLine }} />
            <span className="text-muted-foreground">Rejection Rate (%)</span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 3 Left: Efficiency Scatter Chart
// =============================================================================

function EfficiencyScatterChart() {
  const { state } = useFactory();
  const history = state.evolution.batchHistory;
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 260;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 16, right: 16, bottom: 44, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const data = useMemo(
    () =>
      [...history].map((b) => ({
        label: extractBatchNumber(b.batchName),
        stories: b.stories,
        costPerStory: b.stories > 0 ? b.totalCost / b.stories : 0,
        totalTokens: b.totalTokens,
        promptVersion: b.promptVersion,
      })),
    [history],
  );

  const versions = useMemo(
    () => Array.from(new Set(data.map((d) => d.promptVersion))),
    [data],
  );

  const colorScale = useMemo(
    () => d3.scaleOrdinal<string>().domain(versions).range(C.scatterVersions),
    [versions],
  );

  const xScale = useMemo(() => {
    const max = d3.max(data, (d) => d.stories) ?? 10;
    return d3.scaleLinear().domain([0, max + 2]).nice().range([0, innerW]);
  }, [data, innerW]);

  const yScale = useMemo(() => {
    const max = d3.max(data, (d) => d.costPerStory) ?? 5;
    return d3.scaleLinear().domain([0, max * 1.2]).nice().range([innerH, 0]);
  }, [data, innerH]);

  const rScale = useMemo(() => {
    const max = d3.max(data, (d) => d.totalTokens) ?? 1;
    return d3.scaleSqrt().domain([0, max]).range([4, 18]);
  }, [data]);

  const regression = useMemo(() => {
    const pts = data.map((d) => ({ x: d.stories, y: d.costPerStory }));
    return linearRegression(pts);
  }, [data]);

  const xTicks = xScale.ticks(5);
  const yTicks = yScale.ticks(5);

  if (!data.length) return null;

  const regX1 = xScale.domain()[0];
  const regX2 = xScale.domain()[1];
  const regY1 = regression.slope * regX1 + regression.intercept;
  const regY2 = regression.slope * regX2 + regression.intercept;

  return (
    <ChartCard icon={BarChart3} title="Efficiency Scatter" subtitle={`R\u00B2=${regression.rSquared.toFixed(2)}`}>
      <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {yTicks.map((t) => (
              <line key={t} x1={0} y1={yScale(t)} x2={innerW} y2={yScale(t)} stroke={C.gridLine} strokeDasharray="3 3" />
            ))}

            {/* Regression line */}
            <line
              x1={xScale(regX1)}
              y1={yScale(Math.max(0, regY1))}
              x2={xScale(regX2)}
              y2={yScale(Math.max(0, regY2))}
              stroke={C.axisTick}
              strokeWidth={1}
              strokeDasharray="6 3"
              opacity={0.5}
            />

            {/* Bubbles */}
            {data.map((d, i) => (
              <circle
                key={d.label}
                cx={xScale(d.stories)}
                cy={yScale(d.costPerStory)}
                r={rScale(d.totalTokens)}
                fill={colorScale(d.promptVersion)}
                fillOpacity={0.6}
                stroke={colorScale(d.promptVersion)}
                strokeWidth={hoveredIdx === i ? 2 : 1}
                style={{ cursor: 'default', transition: 'stroke-width 150ms' }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            ))}

            {/* Y axis */}
            {yTicks.map((t) => (
              <text key={t} x={-8} y={yScale(t)} textAnchor="end" alignmentBaseline="middle" fill={C.axisTick} fontSize={11}>
                ${t.toFixed(1)}
              </text>
            ))}

            {/* X axis */}
            {xTicks.map((t) => (
              <text key={t} x={xScale(t)} y={innerH + 18} textAnchor="middle" fill={C.axisTick} fontSize={11}>
                {t}
              </text>
            ))}

            <text x={innerW / 2} y={innerH + 34} textAnchor="middle" fill={C.axisTick} fontSize={10}>
              Stories per Batch
            </text>
            <text
              transform={`translate(-36,${innerH / 2}) rotate(-90)`}
              textAnchor="middle"
              fill={C.axisTick}
              fontSize={10}
            >
              Cost / Story ($)
            </text>
          </g>
        </svg>

        {/* Hover tooltip */}
        {hoveredIdx !== null && data[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(margin.left + xScale(data[hoveredIdx].stories), width - 170),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">{data[hoveredIdx].label}</p>
            <p className="text-muted-foreground">Stories: {data[hoveredIdx].stories}</p>
            <p className="text-muted-foreground">$/Story: {fmtCost(data[hoveredIdx].costPerStory)}</p>
            <p className="text-muted-foreground">Tokens: {fmtTokens(data[hoveredIdx].totalTokens)}</p>
            <p className="text-muted-foreground">Prompt: {data[hoveredIdx].promptVersion}</p>
          </div>
        )}

        {/* Version legend */}
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {versions.map((v) => (
            <div key={v} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorScale(v) }} />
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 3 Right: Stacked Area Chart - Cost Composition
// =============================================================================

function CostCompositionChart() {
  const { state } = useFactory();
  const history = state.evolution.batchHistory;
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 260;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 16, right: 16, bottom: 44, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const data = useMemo(
    () =>
      [...history].map((b) => ({
        label: extractBatchNumber(b.batchName),
        tokens: b.totalCost * 0.82,
        compute: b.totalCost * 0.15,
        orchestration: b.totalCost * 0.03,
      })),
    [history],
  );

  const stackKeys = ['tokens', 'compute', 'orchestration'] as const;
  const stackColors = [C.stackToken, C.stackCompute, C.stackOrch];
  const stackLabels = ['Token Inference', 'Compute', 'Orchestration'];

  const stacked = useMemo(() => {
    const gen = d3.stack<(typeof data)[number]>().keys(stackKeys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    return gen(data);
  }, [data]);

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(data.map((d) => d.label))
        .range([0, innerW])
        .padding(0.5),
    [data, innerW],
  );

  const yScale = useMemo(() => {
    const max = d3.max(stacked[stacked.length - 1] ?? [], (d) => d[1]) ?? 30;
    return d3.scaleLinear().domain([0, max * 1.1]).nice().range([innerH, 0]);
  }, [stacked, innerH]);

  const areaPaths = useMemo(
    () =>
      stacked.map((layer) => {
        const gen = d3
          .area<(typeof layer)[number]>()
          .x((_, i) => xScale(data[i].label) ?? 0)
          .y0((d) => yScale(d[0]))
          .y1((d) => yScale(d[1]))
          .curve(d3.curveMonotoneX);
        return gen(layer) ?? '';
      }),
    [stacked, xScale, yScale, data],
  );

  const yTicks = yScale.ticks(5);

  if (!data.length) return null;

  return (
    <ChartCard icon={Layers} title="Cost Composition" subtitle="Stacked by category">
      <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {yTicks.map((t) => (
              <line key={t} x1={0} y1={yScale(t)} x2={innerW} y2={yScale(t)} stroke={C.gridLine} strokeDasharray="3 3" />
            ))}

            {/* Stacked areas */}
            {areaPaths.map((path, i) => (
              <path key={stackKeys[i]} d={path} fill={stackColors[i]} stroke="none" />
            ))}

            {/* Hover zones */}
            {data.map((d, i) => {
              const cx = xScale(d.label) ?? 0;
              return (
                <rect
                  key={d.label}
                  x={cx - innerW / data.length / 2}
                  y={0}
                  width={innerW / data.length}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}

            {/* Y axis */}
            {yTicks.map((t) => (
              <text key={t} x={-8} y={yScale(t)} textAnchor="end" alignmentBaseline="middle" fill={C.axisTick} fontSize={11}>
                ${t.toFixed(0)}
              </text>
            ))}

            {/* X axis */}
            {data.map((d) => (
              <text key={d.label} x={xScale(d.label) ?? 0} y={innerH + 18} textAnchor="middle" fill={C.axisTick} fontSize={11}>
                {d.label}
              </text>
            ))}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredIdx !== null && data[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(margin.left + (xScale(data[hoveredIdx].label) ?? 0), width - 180),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">Batch {data[hoveredIdx].label}</p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.stackToken }} />
              Tokens: {fmtCost(data[hoveredIdx].tokens)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.stackCompute }} />
              Compute: {fmtCost(data[hoveredIdx].compute)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.stackOrch }} />
              Orch: {fmtCost(data[hoveredIdx].orchestration)}
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {stackLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: stackColors[i] }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 4 Left: Agent Efficiency Ranking
// =============================================================================

function AgentEfficiencyRanking({ agents }: { agents: CostBreakdown['agentCosts'] }) {
  const ranked = useMemo(() => {
    const withEff = agents
      .filter((a) => a.tokens > 0)
      .map((a) => ({
        ...a,
        costPer1K: (a.cost / a.tokens) * 1000,
      }));
    return withEff.sort((a, b) => a.costPer1K - b.costPer1K);
  }, [agents]);

  const maxCostPer1K = ranked[ranked.length - 1]?.costPer1K ?? 1;

  if (!ranked.length) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No agent cost data.</p>;
  }

  return (
    <ChartCard icon={Award} title="Agent Efficiency Ranking" subtitle="Cost per 1K tokens">
      <div className="space-y-2">
        {ranked.map((agent, idx) => {
          const pct = maxCostPer1K > 0 ? (agent.costPer1K / maxCostPer1K) * 100 : 0;
          const t = maxCostPer1K > 0 ? agent.costPer1K / maxCostPer1K : 0;
          const barColor = d3.interpolateRgb(C.effGood, C.effPoor)(t);

          return (
            <div key={agent.agentId} className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                #{idx + 1}
              </span>
              <span className="text-sm text-foreground w-16 shrink-0 truncate">
                {agent.agentName}
              </span>
              <div className="flex-1 h-5 rounded bg-muted overflow-hidden relative">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: barColor }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground w-16 text-right shrink-0">
                ${agent.costPer1K.toFixed(3)}/1K
              </span>
              {idx === 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                  Most efficient
                </span>
              )}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 4 Right: Donut Chart (Declarative SVG)
// =============================================================================

function CostDonutChart({
  slices,
}: {
  slices: { label: string; value: number; color: string }[];
}) {
  const size = 180;
  const outerR = size / 2 - 8;
  const innerR = outerR * 0.58;
  const total = d3.sum(slices, (s) => s.value);

  const arcs = useMemo(() => {
    if (total === 0) return [];
    const pie = d3
      .pie<(typeof slices)[number]>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(0.03);
    const arcGen = d3
      .arc<d3.PieArcDatum<(typeof slices)[number]>>()
      .innerRadius(innerR)
      .outerRadius(outerR);
    const labelArcGen = d3
      .arc<d3.PieArcDatum<(typeof slices)[number]>>()
      .innerRadius(outerR + 14)
      .outerRadius(outerR + 14);
    return pie(slices).map((d) => ({
      path: arcGen(d) ?? '',
      labelPos: labelArcGen.centroid(d),
      pct: (d.data.value / total) * 100,
      color: d.data.color,
    }));
  }, [slices, total, innerR, outerR]);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} className="overflow-visible">
        <g transform={`translate(${size / 2},${size / 2})`}>
          {arcs.map((a, i) => (
            <path key={i} d={a.path} fill={a.color} stroke="none" />
          ))}
          {arcs.map((a, i) =>
            a.pct >= 5 ? (
              <text
                key={`l-${i}`}
                x={a.labelPos[0]}
                y={a.labelPos[1]}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill={C.axisTick}
                fontSize={11}
                fontWeight={500}
              >
                {a.pct.toFixed(0)}%
              </text>
            ) : null,
          )}
          <text textAnchor="middle" dy="-0.2em" fill={C.axisTick} fontSize={11}>
            Total
          </text>
          <text textAnchor="middle" dy="1.1em" fill={C.axisTick} fontSize={15} fontWeight={600}>
            {fmtCost(total)}
          </text>
        </g>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-muted-foreground">
              {s.label}{' '}
              <span className="tabular-nums font-medium text-foreground">{fmtCost(s.value)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Row 5: Cost Forecast Table
// =============================================================================

type ForecastHorizon = '5' | '10' | '20';
const FORECAST_HORIZONS: { value: ForecastHorizon; label: string; batches: number }[] = [
  { value: '5', label: '+5 batches', batches: 5 },
  { value: '10', label: '+10 batches', batches: 10 },
  { value: '20', label: '+20 batches', batches: 20 },
];

function CostForecastChart() {
  const { state } = useFactory();
  const history = state.evolution.batchHistory;
  const HUMAN_COST = 150;
  const [horizon, setHorizon] = useState<ForecastHorizon>('10');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);

  const futureBatches = FORECAST_HORIZONS.find((h) => h.value === horizon)!.batches;

  const forecast = useMemo(() => {
    // Historical: cost/story per batch (chronological)
    const hist = [...history];
    const histData = hist.map((b, i) => ({
      idx: i,
      label: `#${b.batchId.replace('batch-', '')}`,
      costPerStory: b.stories > 0 ? b.totalCost / b.stories : 0,
      totalCost: b.totalCost,
      stories: b.stories,
      isForecast: false,
    }));

    // Regression on cost/story over time (index-based)
    const pts = histData.map((d) => ({ x: d.idx, y: d.costPerStory }));
    const reg = linearRegression(pts);

    // Generate forecast points continuing the trend
    const forecastData = Array.from({ length: futureBatches }, (_, i) => {
      const idx = hist.length + i;
      const predicted = Math.max(0.3, reg.slope * idx + reg.intercept);
      // Add simulated noise to forecast (increasing with distance)
      const noise = (Math.sin(idx * 2.7) * 0.3 + Math.cos(idx * 1.3) * 0.2) * (1 + i * 0.05);
      const costPerStory = Math.max(0.3, predicted + noise);
      const stories = 5 + Math.round(Math.sin(idx * 0.8) * 2.5);
      return {
        idx,
        label: `#${18 + idx}`,
        costPerStory,
        totalCost: costPerStory * stories,
        stories,
        isForecast: true,
      };
    });

    const allData = [...histData, ...forecastData];
    return { allData, histData, forecastData, reg };
  }, [history, futureBatches]);

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerW = Math.max(width - margin.left - margin.right, 100);
  const innerH = 280;

  const chart = useMemo(() => {
    const { allData, histData, forecastData, reg } = forecast;
    const x = d3.scaleLinear().domain([0, allData.length - 1]).range([0, innerW]);
    const maxCPS = d3.max(allData, (d) => d.costPerStory) ?? 4;
    const y = d3.scaleLinear().domain([0, maxCPS * 1.2]).nice().range([innerH, 0]);

    // Line through historical data (solid)
    const histLine = d3.line<(typeof allData)[0]>().x((_, i) => x(i)).y((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Line through forecast data (dashed)
    const forecastLine = d3.line<(typeof forecastData)[0]>().x((d) => x(d.idx)).y((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Area under historical
    const histArea = d3.area<(typeof allData)[0]>().x((_, i) => x(i)).y0(innerH).y1((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Regression trend line (straight)
    const trendY0 = reg.slope * 0 + reg.intercept;
    const trendY1 = reg.slope * (allData.length - 1) + reg.intercept;

    const yTicks = y.ticks(5);
    // Show every 5th batch label
    const xTicks = allData.filter((_, i) => i % 5 === 0 || i === allData.length - 1);

    return { x, y, histLine, forecastLine, histArea, trendY0, trendY1, yTicks, xTicks, allData, histData, forecastData };
  }, [forecast, innerW, innerH]);

  const hd = hoverIdx !== null ? chart.allData[hoverIdx] : null;
  const splitIdx = chart.histData.length;

  return (
    <ChartCard icon={Calculator} title="Proyección de costo por story" subtitle={`${forecast.histData.length} históricos + ${forecast.forecastData.length} proyectados`}>
      {/* Horizon pills */}
      <div className="flex items-center gap-1 mb-4">
        {FORECAST_HORIZONS.map((h) => (
          <button
            key={h.value}
            onClick={() => setHorizon(h.value)}
            className={cn(
              'px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
              horizon === h.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            {h.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="relative">
        <svg width={width} height={innerH + margin.top + margin.bottom} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {chart.yTicks.map((t) => (
              <line key={t} x1={0} x2={innerW} y1={chart.y(t)} y2={chart.y(t)} stroke={C.gridLine} strokeDasharray="4 3" />
            ))}

            {/* Vertical divider: historical | forecast */}
            <line x1={chart.x(splitIdx - 0.5)} x2={chart.x(splitIdx - 0.5)} y1={0} y2={innerH} stroke={C.axisTick} strokeDasharray="3 3" opacity={0.3} />
            <text x={chart.x(splitIdx - 0.5)} y={-6} textAnchor="middle" fill={C.axisTick} fontSize={9} opacity={0.5}>hoy</text>

            {/* Area under historical line */}
            <path d={chart.histArea(chart.histData) ?? ''} fill="rgba(99,102,241,0.08)" />

            {/* Regression trend line (thin, full width) */}
            <line x1={chart.x(0)} y1={chart.y(chart.trendY0)} x2={chart.x(chart.allData.length - 1)} y2={chart.y(chart.trendY1)} stroke={C.axisTick} strokeWidth={1} strokeDasharray="8 4" opacity={0.3} />

            {/* Historical line (solid indigo) */}
            <path d={chart.histLine(chart.histData) ?? ''} fill="none" stroke={C.totalCostStroke} strokeWidth={2.5} />

            {/* Forecast line (dashed violet) */}
            <path d={chart.forecastLine([chart.histData[chart.histData.length - 1], ...chart.forecastData]) ?? ''} fill="none" stroke={C.costPerStoryLine} strokeWidth={2} strokeDasharray="6 4" />

            {/* Historical dots */}
            {chart.histData.map((d, i) => (
              <circle
                key={`h-${i}`}
                cx={chart.x(i)}
                cy={chart.y(d.costPerStory)}
                r={hoverIdx === i ? 5 : 3}
                fill={C.totalCostStroke}
                stroke="white"
                strokeWidth={1}
              />
            ))}

            {/* Forecast dots */}
            {chart.forecastData.map((d, i) => (
              <circle
                key={`f-${d.idx}`}
                cx={chart.x(d.idx)}
                cy={chart.y(d.costPerStory)}
                r={hoverIdx === d.idx ? 5 : 3}
                fill={C.costPerStoryLine}
                stroke="white"
                strokeWidth={1}
                opacity={0.7}
              />
            ))}

            {/* Human cost reference line ($150/story) — would be way off chart, show as label */}
            <text x={innerW} y={8} textAnchor="end" fill={C.deltaRed} fontSize={9} opacity={0.6}>
              Humano: $150/story (fuera de escala)
            </text>

            {/* Y axis */}
            {chart.yTicks.map((t) => (
              <text key={t} x={-8} y={chart.y(t)} textAnchor="end" dominantBaseline="middle" fill={C.axisTick} fontSize={10}>
                ${t.toFixed(1)}
              </text>
            ))}

            {/* X axis labels */}
            {chart.xTicks.map((d) => (
              <text key={d.idx} x={chart.x(d.idx)} y={innerH + 20} textAnchor="middle" fill={d.isForecast ? C.costPerStoryLine : C.axisTick} fontSize={9} opacity={d.isForecast ? 0.6 : 1}>
                {d.label}
              </text>
            ))}
            <text x={innerW / 2} y={innerH + 36} textAnchor="middle" fill={C.axisTick} fontSize={10}>
              Batch (histórico → proyectado)
            </text>

            {/* Hover rects */}
            {chart.allData.map((d, i) => {
              const step = innerW / (chart.allData.length - 1 || 1);
              return (
                <rect
                  key={`hover-${i}`}
                  x={chart.x(i) - step / 2}
                  y={0}
                  width={step}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}

            {hd && (
              <line x1={chart.x(hd.idx)} x2={chart.x(hd.idx)} y1={0} y2={innerH} stroke={C.axisTick} strokeDasharray="3 3" opacity={0.4} />
            )}
          </g>
        </svg>

        {/* Tooltip */}
        {hd && hoverIdx !== null && (
          <div
            className="absolute pointer-events-none bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs z-10"
            style={{
              left: Math.min(margin.left + chart.x(hd.idx) + 12, width - 180),
              top: margin.top + chart.y(hd.costPerStory) - 10,
            }}
          >
            <p className="font-semibold text-foreground mb-1">{hd.label} {hd.isForecast ? '(proyectado)' : ''}</p>
            <p><span className="text-muted-foreground">$/Story:</span> <span className="text-foreground font-medium">{fmtCost(hd.costPerStory)}</span></p>
            <p><span className="text-muted-foreground">Stories:</span> <span className="text-foreground">{hd.stories}</span></p>
            <p><span className="text-muted-foreground">Costo total:</span> <span className="text-foreground">{fmtCost(hd.totalCost)}</span></p>
            {!hd.isForecast && (
              <p style={{ color: C.deltaGreen }} className="font-medium mt-1">
                vs humano: {fmtCost(HUMAN_COST * hd.stories - hd.totalCost)} ahorro
              </p>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ backgroundColor: C.totalCostStroke }} /> Histórico ($/story)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ backgroundColor: C.costPerStoryLine, opacity: 0.7 }} /> Proyectado</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ backgroundColor: C.axisTick, opacity: 0.3 }} /> Tendencia (regresión)</span>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 6: Story Cost Table with inline bars
// =============================================================================

function StoryCostTable({ stories }: { stories: CostBreakdown['storyCosts'] }) {
  const sorted = useMemo(
    () => [...stories].filter((s) => s.cost > 0).sort((a, b) => b.cost - a.cost),
    [stories],
  );
  const maxCost = sorted[0]?.cost ?? 1;

  if (!sorted.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No story cost data.
      </div>
    );
  }

  return (
    <ChartCard icon={BookOpen} title="Cost per Story">
      <div className="overflow-x-auto">
        <table className="w-full text-left" role="grid" aria-label="Cost breakdown per story">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Story
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Cost
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right"
              >
                Tokens
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((story) => {
              const pct = (story.cost / maxCost) * 100;
              return (
                <tr
                  key={story.storyId}
                  className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <span className="text-sm font-mono text-foreground">{story.storyKey}</span>
                  </td>
                  <td className="px-4 py-2.5 w-[45%]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: C.totalCostStroke }}
                        />
                      </div>
                      <span className="text-sm tabular-nums font-medium text-foreground shrink-0 w-14 text-right">
                        {fmtCost(story.cost)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground text-right">
                    {fmtTokens(story.tokens)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function CostAnalytics() {
  const { state } = useFactory();
  const cost = state.cost;
  const evolution = state.evolution;

  // Derived KPI values
  const kpis = useMemo(() => {
    const history = evolution.batchHistory;
    const storiesWithCost = cost.storyCosts.filter((s) => s.cost > 0);
    const storyCount = storiesWithCost.length || 1;
    const costPerStory = cost.totalCost / storyCount;

    // Deltas vs previous batch
    const prevBatch = history.length >= 2 ? history[1] : null;
    const prevCost = prevBatch?.totalCost ?? cost.totalCost;
    const prevCostPerStory = prevBatch
      ? prevBatch.totalCost / (prevBatch.stories || 1)
      : costPerStory;
    const prevLabel = prevBatch ? `vs ${extractBatchNumber(prevBatch.batchName)}` : '';

    const costDelta = prevCost > 0 ? (cost.totalCost - prevCost) / prevCost : null;
    const costPerStoryDelta =
      prevCostPerStory > 0 ? (costPerStory - prevCostPerStory) / prevCostPerStory : null;

    // Cost per line approximation
    const estimatedLines = cost.totalTokens / 150;
    const costPerLine = estimatedLines > 0 ? cost.totalCost / estimatedLines : 0;

    // Monthly trend
    const monthlyDelta = prevBatch
      ? ((cost.projectedMonthlyCost - prevBatch.totalCost * 30) / (prevBatch.totalCost * 30)) *
        (prevBatch.totalCost > 0 ? 1 : 0)
      : null;

    return { costPerStory, costDelta, costPerStoryDelta, costPerLine, monthlyDelta, prevLabel };
  }, [cost, evolution]);

  // Donut chart: cost distribution
  const donutSlices = useMemo(() => {
    const tokenCost = cost.totalCost - cost.temporalActionsCost;
    const computeEstimate = tokenCost * 0.15;
    const pureTokenCost = tokenCost - computeEstimate;
    return [
      { label: 'Token Inference', value: pureTokenCost, color: C.donutToken },
      { label: 'Compute', value: computeEstimate, color: C.donutCompute },
      { label: 'Orchestration', value: cost.temporalActionsCost, color: C.donutOrch },
    ];
  }, [cost]);

  return (
    <div className="space-y-4">
      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={DollarSign}
          label="Total Cost"
          value={fmtCost(cost.totalCost)}
          delta={kpis.costDelta}
          deltaLabel={kpis.prevLabel}
          invertDelta
        />
        <KpiCard
          icon={BookOpen}
          label="Cost / Story"
          value={fmtCost(kpis.costPerStory)}
          delta={kpis.costPerStoryDelta}
          deltaLabel={kpis.prevLabel}
          invertDelta
        />
        <KpiCard icon={Coins} label="Total Tokens" value={fmtTokens(cost.totalTokens)} />
        <KpiCard
          icon={TrendingUp}
          label="Projected Monthly"
          value={fmtCost(cost.projectedMonthlyCost)}
          delta={kpis.monthlyDelta}
          invertDelta
        />
        <KpiCard
          icon={BarChart3}
          label="Cost / Line"
          value={`$${kpis.costPerLine.toFixed(4)}`}
        />
      </div>

      {/* Row 2: Multi-Line Trend Chart */}
      <MultiLineTrendChart />

      {/* Row 3: Scatter + Stacked Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EfficiencyScatterChart />
        <CostCompositionChart />
      </div>

      {/* Row 4: Agent Efficiency + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentEfficiencyRanking agents={cost.agentCosts} />
        <ChartCard icon={PieChart} title="Cost Distribution">
          <CostDonutChart slices={donutSlices} />
        </ChartCard>
      </div>

      {/* Row 5: Cost Forecast Chart */}
      <CostForecastChart />

      {/* Row 6: Story Cost Table */}
      <StoryCostTable stories={cost.storyCosts} />
    </div>
  );
}
