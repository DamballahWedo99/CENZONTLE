'use client';

import { useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { useCostAnalytics } from '@/hooks/use-cost-analytics';
import {
  fmtCost,
  fmtPct,
  fmtTokens,
  linearRegression,
  useContainerWidth,
} from './chart-utils';
import type {
  CostAnalyticsResponse,
  CostAnalyticsStory,
  CostComponentKey,
  CostComponentTotals,
} from '@/lib/api/factory';
import {
  DollarSign,
  Coins,
  TrendingUp,
  TrendingDown,
  BookOpen,
  PieChart,
  BarChart3,
  Activity,
  Layers,
  Calculator,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';

// Formatters (fmtCost, fmtTokens, fmtPct), linearRegression y
// useContainerWidth viven en ./chart-utils — compartidos con VelocityTracker.

// =============================================================================
// Color Constants
// =============================================================================

const C = {
  totalCostArea: 'rgba(37,99,232,0.12)',
  totalCostStroke: '#2563EB',
  costPerStoryLine: '#38BDF8',
  retryLine: '#F59E0B',
  axisTick: '#9CA3AF',
  gridLine: 'rgba(107,114,128,0.15)',
  donutGenerator: '#2563EB',
  donutVerifier: '#10B981',
  donutPlanner: '#F59E0B',
  stackToken: 'rgba(37,99,232,0.55)',
  stackCompute: 'rgba(16,185,129,0.55)',
  stackOrch: 'rgba(245,158,11,0.55)',
  effGood: '#10B981',
  effPoor: '#EF4444',
  deltaGreen: '#22C55E',
  deltaRed: '#EF4444',
} as const;

// Orden del stack (bottom → top) y metadata compartida entre composición,
// ranking y donut — un solo lugar para labels/colores.
const COMPONENT_ORDER: CostComponentKey[] = ['generator', 'verifier', 'planner'];

const COMPONENT_LABELS: Record<CostComponentKey, string> = {
  generator: 'Generator (coder)',
  verifier: 'DoD Verifier',
  planner: 'Planner',
};

const COMPONENT_STACK_COLORS: Record<CostComponentKey, string> = {
  generator: C.stackToken,
  verifier: C.stackCompute,
  planner: C.stackOrch,
};

const COMPONENT_SOLID_COLORS: Record<CostComponentKey, string> = {
  generator: C.donutGenerator,
  verifier: C.donutVerifier,
  planner: C.donutPlanner,
};

// =============================================================================
// Derived batch point — los batchIds reales son UUIDs, así que cada batch
// recibe un label secuencial #1..#n por orden cronológico (el backend ya
// devuelve ASC por enqueuedAt). El epicTitle vive en los tooltips.
// =============================================================================

interface BatchPoint {
  label: string;
  batchId: string;
  epicTitle: string;
  costUsd: number;
  costPerStory: number;
  retryRate: number;
  /** Runs con attempts > 1 (reintentos del DoD) y total de runs del batch. */
  retriedRuns: number;
  runsCount: number;
  storiesWithCost: number;
  tokensNew: number;
  byComponent: Record<CostComponentKey, CostComponentTotals>;
}

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
  sublabel,
  invertDelta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  /** Subtítulo sin semántica de delta (ej. "+ 1.2M cached"). */
  sublabel?: string;
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
      {/* delta === 0 se trata como neutral — sin flecha que sugiera cambio. */}
      {delta != null && delta !== 0 && (
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
      {(delta == null || delta === 0) && sublabel && (
        <span className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
          {sublabel}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Loading / Empty States
// =============================================================================

function CostAnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando datos de costo">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-[360px] rounded-xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[320px] rounded-xl bg-muted animate-pulse" />
        <div className="h-[320px] rounded-xl bg-muted animate-pulse" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[260px] rounded-xl bg-muted animate-pulse" />
        <div className="h-[260px] rounded-xl bg-muted animate-pulse" />
      </div>
      <div className="h-[420px] rounded-xl bg-muted animate-pulse" />
      <div className="h-[280px] rounded-xl bg-muted animate-pulse" />
    </div>
  );
}

function CostAnalyticsEmpty() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
      <Coins className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="text-base font-semibold text-foreground">
        Sin datos de costo todavía
      </h3>
      <p className="text-sm text-muted-foreground">
        Los costos aparecerán cuando el Forge procese su primer batch.
      </p>
    </div>
  );
}

// =============================================================================
// Row 2: Multi-Line Trend Chart (Declarative SVG)
// =============================================================================

function MultiLineTrendChart({ batches }: { batches: BatchPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 280;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 20, right: 56, bottom: 36, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(batches.map((d) => d.label))
        .range([0, innerW])
        .padding(0.5),
    [batches, innerW],
  );

  const yCostScale = useMemo(() => {
    const max = d3.max(batches, (d) => Math.max(d.costUsd, d.costPerStory * 2)) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max * 1.15, 1)]).nice().range([innerH, 0]);
  }, [batches, innerH]);

  const yRetryScale = useMemo(() => {
    const max = d3.max(batches, (d) => d.retryRate) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max * 1.3, 0.1)]).nice().range([innerH, 0]);
  }, [batches, innerH]);

  const areaPath = useMemo(() => {
    const gen = d3
      .area<BatchPoint>()
      .x((d) => xScale(d.label) ?? 0)
      .y0(innerH)
      .y1((d) => yCostScale(d.costUsd))
      .curve(d3.curveMonotoneX);
    return gen(batches) ?? '';
  }, [batches, xScale, yCostScale, innerH]);

  const costPerStoryPath = useMemo(() => {
    const gen = d3
      .line<BatchPoint>()
      .x((d) => xScale(d.label) ?? 0)
      .y((d) => yCostScale(d.costPerStory))
      .curve(d3.curveMonotoneX);
    return gen(batches) ?? '';
  }, [batches, xScale, yCostScale]);

  const retryPath = useMemo(() => {
    const gen = d3
      .line<BatchPoint>()
      .x((d) => xScale(d.label) ?? 0)
      .y((d) => yRetryScale(d.retryRate))
      .curve(d3.curveMonotoneX);
    return gen(batches) ?? '';
  }, [batches, xScale, yRetryScale]);

  const yCostTicks = yCostScale.ticks(5);
  const yRetryTicks = yRetryScale.ticks(4);

  return (
    <ChartCard icon={Activity} title="Batch Performance Trends" subtitle={`${batches.length} batches`}>
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

            {/* Retry rate dashed line */}
            <path
              d={retryPath}
              fill="none"
              stroke={C.retryLine}
              strokeWidth={2}
              strokeDasharray="6 4"
            />

            {/* Data points + hover zones */}
            {batches.map((d, i) => {
              const cx = xScale(d.label) ?? 0;
              const isHovered = hoveredIdx === i;
              return (
                <g key={d.label}>
                  <rect
                    x={cx - innerW / batches.length / 2}
                    y={0}
                    width={innerW / batches.length}
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
                    cy={yRetryScale(d.retryRate)}
                    r={isHovered ? 5 : 4}
                    fill={C.retryLine}
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

            {/* Right Y axis: retry % */}
            {yRetryTicks.map((t) => (
              <text
                key={t}
                x={innerW + 10}
                y={yRetryScale(t)}
                textAnchor="start"
                alignmentBaseline="middle"
                fill={C.retryLine}
                fontSize={11}
              >
                {(t * 100).toFixed(0)}%
              </text>
            ))}

            {/* X axis labels */}
            {batches.map((d) => (
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
        {hoveredIdx !== null && batches[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(
                margin.left + (xScale(batches[hoveredIdx].label) ?? 0),
                width - 220,
              ),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">
              Batch {batches[hoveredIdx].label}
            </p>
            <p className="text-muted-foreground max-w-[200px] truncate">
              {batches[hoveredIdx].epicTitle}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.totalCostStroke }} />
              Total: {fmtCost(batches[hoveredIdx].costUsd)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.costPerStoryLine }} />
              $/Story: {fmtCost(batches[hoveredIdx].costPerStory)}
            </p>
            <p className="text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: C.retryLine }} />
              Retry: {(batches[hoveredIdx].retryRate * 100).toFixed(1)}%
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
            <span className="w-6 h-0 border-t-2 border-dashed" style={{ borderColor: C.retryLine }} />
            <span className="text-muted-foreground">Retry Rate (%)</span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 3 Left: Efficiency Scatter Chart
// =============================================================================

function EfficiencyScatterChart({ batches }: { batches: BatchPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 260;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 16, right: 16, bottom: 44, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(() => {
    const max = d3.max(batches, (d) => d.storiesWithCost) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max + 2, 4)]).nice().range([0, innerW]);
  }, [batches, innerW]);

  const yScale = useMemo(() => {
    const max = d3.max(batches, (d) => d.costPerStory) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max * 1.2, 1)]).nice().range([innerH, 0]);
  }, [batches, innerH]);

  const rScale = useMemo(() => {
    const max = d3.max(batches, (d) => d.tokensNew) ?? 0;
    return d3.scaleSqrt().domain([0, Math.max(max, 1)]).range([4, 18]);
  }, [batches]);

  const regression = useMemo(() => {
    const pts = batches.map((d) => ({ x: d.storiesWithCost, y: d.costPerStory }));
    return linearRegression(pts);
  }, [batches]);

  const xTicks = xScale.ticks(5);
  const yTicks = yScale.ticks(5);

  const regX1 = xScale.domain()[0];
  const regX2 = xScale.domain()[1];
  const regY1 = regression.slope * regX1 + regression.intercept;
  const regY2 = regression.slope * regX2 + regression.intercept;

  return (
    <ChartCard icon={BarChart3} title="Efficiency Scatter" subtitle={`R²=${regression.rSquared.toFixed(2)}`}>
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
            {batches.map((d, i) => (
              <circle
                key={d.label}
                cx={xScale(d.storiesWithCost)}
                cy={yScale(d.costPerStory)}
                r={rScale(d.tokensNew)}
                fill={C.totalCostStroke}
                fillOpacity={0.6}
                stroke={C.totalCostStroke}
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
        {hoveredIdx !== null && batches[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(margin.left + xScale(batches[hoveredIdx].storiesWithCost), width - 200),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">{batches[hoveredIdx].label}</p>
            <p className="text-muted-foreground max-w-[180px] truncate">
              {batches[hoveredIdx].epicTitle}
            </p>
            <p className="text-muted-foreground">Stories: {batches[hoveredIdx].storiesWithCost}</p>
            <p className="text-muted-foreground">$/Story: {fmtCost(batches[hoveredIdx].costPerStory)}</p>
            <p className="text-muted-foreground">Tokens: {fmtTokens(batches[hoveredIdx].tokensNew)}</p>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 3 Right: Stacked Area Chart - Cost Composition
// =============================================================================

function CostCompositionChart({ batches }: { batches: BatchPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 260;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 16, right: 16, bottom: 44, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const data = useMemo(
    () =>
      batches.map((b) => ({
        label: b.label,
        epicTitle: b.epicTitle,
        generator: b.byComponent.generator.costUsd,
        verifier: b.byComponent.verifier.costUsd,
        planner: b.byComponent.planner.costUsd,
      })),
    [batches],
  );

  const stacked = useMemo(() => {
    const gen = d3
      .stack<(typeof data)[number]>()
      .keys(COMPONENT_ORDER)
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);
    return gen(data);
  }, [data]);

  // Barras apiladas (no área): los batches son puntos discretos, no una
  // serie continua. Un área interpolaría entre batch #1 y #2 sugiriendo una
  // continuidad inexistente — y con un solo batch el área degenera a un path
  // de ancho cero (invisible). Las barras se ven bien con 1, 2 o N batches.
  const xScale = useMemo(
    () =>
      d3
        .scaleBand<string>()
        .domain(data.map((d) => d.label))
        .range([0, innerW])
        .padding(0.3),
    [data, innerW],
  );

  // Ancho de barra acotado para que un solo batch no produzca una columna
  // que ocupe todo el panel.
  const barWidth = Math.min(xScale.bandwidth(), 72);

  const yScale = useMemo(() => {
    const max = d3.max(stacked[stacked.length - 1] ?? [], (d) => d[1]) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max * 1.1, 1)]).nice().range([innerH, 0]);
  }, [stacked, innerH]);

  const yTicks = yScale.ticks(5);

  // x centrado de cada batch dentro de su banda — reutilizado por barras,
  // ejes y hover.
  const bandCenter = (label: string) => (xScale(label) ?? 0) + xScale.bandwidth() / 2;

  return (
    <ChartCard icon={Layers} title="Cost Composition" subtitle="Stacked by component">
      <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {yTicks.map((t) => (
              <line key={t} x1={0} y1={yScale(t)} x2={innerW} y2={yScale(t)} stroke={C.gridLine} strokeDasharray="3 3" />
            ))}

            {/* Barras apiladas: una columna por batch, un segmento por
                componente (generator → verifier → planner de abajo a arriba). */}
            {stacked.map((layer, li) =>
              layer.map((seg, di) => {
                const segHeight = yScale(seg[0]) - yScale(seg[1]);
                if (!(segHeight > 0)) return null; // omite segmentos de costo 0
                return (
                  <rect
                    key={`${COMPONENT_ORDER[li]}-${data[di].label}`}
                    x={bandCenter(data[di].label) - barWidth / 2}
                    y={yScale(seg[1])}
                    width={barWidth}
                    height={segHeight}
                    fill={COMPONENT_STACK_COLORS[COMPONENT_ORDER[li]]}
                  />
                );
              }),
            )}

            {/* Hover zones — toda la banda del batch */}
            {data.map((d, i) => (
              <rect
                key={d.label}
                x={xScale(d.label) ?? 0}
                y={0}
                width={xScale.bandwidth()}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            ))}

            {/* Y axis */}
            {yTicks.map((t) => (
              <text key={t} x={-8} y={yScale(t)} textAnchor="end" alignmentBaseline="middle" fill={C.axisTick} fontSize={11}>
                ${t.toFixed(0)}
              </text>
            ))}

            {/* X axis */}
            {data.map((d) => (
              <text key={d.label} x={bandCenter(d.label)} y={innerH + 18} textAnchor="middle" fill={C.axisTick} fontSize={11}>
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
              left: Math.min(margin.left + bandCenter(data[hoveredIdx].label), width - 210),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">Batch {data[hoveredIdx].label}</p>
            <p className="text-muted-foreground max-w-[190px] truncate">
              {data[hoveredIdx].epicTitle}
            </p>
            {COMPONENT_ORDER.map((key) => (
              <p key={key} className="text-muted-foreground">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ background: COMPONENT_STACK_COLORS[key] }}
                />
                {COMPONENT_LABELS[key]}: {fmtCost(data[hoveredIdx][key])}
              </p>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {COMPONENT_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: COMPONENT_STACK_COLORS[key] }} />
              <span className="text-muted-foreground">{COMPONENT_LABELS[key]}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Row 4 Left: Costo de reintentos del DoD
// =============================================================================
//
// Reemplaza al antiguo "Component Efficiency Ranking" (costo/1K tokens), que
// era una constante del modelo asignado a cada componente — no accionable. Este
// panel mide algo que SÍ varía con el trabajo: cuánto del gasto se va en
// reintentos del DoD loop y si la tendencia mejora batch a batch.
//
// El costo del reintento es un ESTIMADO proporcional: wasteUsd = costUsd ×
// (retriedRuns / runsCount). El backend no serializa el costo per-attempt, así
// que esto SUBESTIMA el desperdicio real (un retry suele costar más que un run
// limpio). De ahí el rótulo "estimado" — no damos falsa precisión financiera.

function RetryCostChart({
  batches,
  stories,
}: {
  batches: BatchPoint[];
  stories: CostAnalyticsStory[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      batches.map((b) => {
        const wasteUsd = b.costUsd * b.retryRate;
        return {
          batchId: b.batchId,
          label: b.label,
          epicTitle: b.epicTitle,
          costUsd: b.costUsd,
          cleanUsd: b.costUsd - wasteUsd,
          wasteUsd,
          retryRate: b.retryRate,
          retriedRuns: b.retriedRuns,
          runsCount: b.runsCount,
        };
      }),
    [batches],
  );

  // Solo los más recientes caben en media card; el resto se resume en una nota.
  const MAX_ROWS = 6;
  const visible = rows.slice(-MAX_ROWS);
  const hiddenCount = rows.length - visible.length;
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 0.01);

  const totalRetried = rows.reduce((s, r) => s + r.retriedRuns, 0);

  // KPI: estado del batch MÁS reciente (¿cómo corre la fábrica ahora?) +
  // tendencia vs el anterior. invertDelta conceptual: menos desperdicio = bueno.
  const last = rows.length >= 1 ? rows[rows.length - 1] : null;
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const deltaPts = last && prev ? last.retryRate - prev.retryRate : null;

  // Stories con reintento del batch hovereado, para el drill-down accionable.
  const hoveredStories = useMemo(() => {
    if (!hoveredId) return [];
    return stories
      .filter((s) => s.batchId === hoveredId && (s.attempts ?? 0) > 1)
      .sort((a, b) => b.costUsd - a.costUsd);
  }, [hoveredId, stories]);

  const hoveredRow = hoveredId ? rows.find((r) => r.batchId === hoveredId) ?? null : null;

  return (
    <ChartCard icon={RotateCcw} title="Costo de reintentos del DoD" subtitle="estimado (proporcional)">
      {totalRetried === 0 ? (
        <div className="flex flex-col items-center text-center gap-2 py-8">
          <CheckCircle2 className="h-8 w-8" style={{ color: C.effGood }} aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Sin reintentos del DoD todavía</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            La fábrica corrió limpia: ningún run necesitó reintentos. Cuando los
            agentes regresen historias, aquí verás cuánto cuesta esa inestabilidad.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* KPI: desperdicio del último batch + tendencia */}
          {last && (
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {fmtPct(last.retryRate)}
              </span>
              <span className="text-xs text-muted-foreground">desperdicio ({last.label})</span>
              {deltaPts != null && deltaPts !== 0 && (
                <span
                  className="flex items-center gap-0.5 text-[11px] font-medium tabular-nums ml-auto"
                  style={{ color: deltaPts < 0 ? C.deltaGreen : C.deltaRed }}
                >
                  {deltaPts < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : (
                    <TrendingUp className="h-3 w-3" />
                  )}
                  {deltaPts < 0 ? '' : '+'}
                  {(deltaPts * 100).toFixed(0)} pts vs {prev?.label}
                </span>
              )}
            </div>
          )}

          {/* Barras apiladas: limpio (verde) + reintento (ámbar) por batch */}
          <div className="space-y-2">
            {visible.map((r) => {
              const cleanPct = (r.cleanUsd / maxCost) * 100;
              const wastePct = (r.wasteUsd / maxCost) * 100;
              return (
                <div
                  key={r.batchId}
                  className="flex items-center gap-3 cursor-default"
                  onMouseEnter={() => setHoveredId(r.batchId)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span className="text-xs font-mono text-muted-foreground w-7 text-right shrink-0">
                    {r.label}
                  </span>
                  <div className="flex-1 h-5 rounded bg-muted overflow-hidden flex">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${cleanPct}%`, backgroundColor: C.effGood }}
                    />
                    <div
                      className="h-full transition-all"
                      style={{ width: `${wastePct}%`, backgroundColor: C.retryLine }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground w-20 text-right shrink-0">
                    {r.wasteUsd > 0 ? `${fmtCost(r.wasteUsd)} retry` : 'limpio'}
                  </span>
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <p className="text-[11px] text-muted-foreground mt-2">
              + {hiddenCount} batch{hiddenCount > 1 ? 'es' : ''} anterior
              {hiddenCount > 1 ? 'es' : ''} no mostrado{hiddenCount > 1 ? 's' : ''}
            </p>
          )}

          {/* Leyenda */}
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.effGood }} />
              <span className="text-muted-foreground">Primer intento</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.retryLine }} />
              <span className="text-muted-foreground">Reintentos</span>
            </div>
          </div>

          {/* Tooltip drill-down: stories con reintento del batch hovereado */}
          {hoveredRow && hoveredRow.wasteUsd > 0 && (
            <div className="absolute top-0 right-0 pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10 max-w-[230px]">
              <p className="font-semibold text-foreground mb-0.5">Batch {hoveredRow.label}</p>
              <p className="text-muted-foreground truncate mb-1">{hoveredRow.epicTitle}</p>
              <p className="text-muted-foreground">
                {hoveredRow.retriedRuns} de {hoveredRow.runsCount} runs reintentaron
              </p>
              <p style={{ color: C.retryLine }} className="font-medium">
                {fmtCost(hoveredRow.wasteUsd)} estimado en reintentos
              </p>
              {hoveredStories.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-border">
                  <p className="text-muted-foreground mb-0.5">Historias con reintento:</p>
                  {hoveredStories.slice(0, 3).map((s) => (
                    <p key={s.storyId} className="text-foreground truncate">
                      · {s.storyTitle} <span className="text-muted-foreground">({s.attempts}×)</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
// Row 5: Cost Forecast Chart
// =============================================================================

type ForecastHorizon = '5' | '10' | '20';
const FORECAST_HORIZONS: { value: ForecastHorizon; label: string; batches: number }[] = [
  { value: '5', label: '+5 batches', batches: 5 },
  { value: '10', label: '+10 batches', batches: 10 },
  { value: '20', label: '+20 batches', batches: 20 },
];

interface ForecastPoint {
  idx: number;
  label: string;
  epicTitle: string | null;
  costPerStory: number;
  totalCost: number;
  stories: number;
  isForecast: boolean;
}

function CostForecastChart({ batches }: { batches: BatchPoint[] }) {
  const HUMAN_COST = 150;
  const [horizon, setHorizon] = useState<ForecastHorizon>('10');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);

  const futureBatches = FORECAST_HORIZONS.find((h) => h.value === horizon)!.batches;

  const forecast = useMemo(() => {
    const histData: ForecastPoint[] = batches.map((b, i) => ({
      idx: i,
      label: b.label,
      epicTitle: b.epicTitle,
      costPerStory: b.costPerStory,
      totalCost: b.costUsd,
      stories: b.storiesWithCost,
      isForecast: false,
    }));

    // Regresión sobre cost/story con el índice cronológico como x.
    const pts = histData.map((d) => ({ x: d.idx, y: d.costPerStory }));
    const reg = linearRegression(pts);

    // El forecast es la regresión PURA clampada a >= 0 — sin ruido sintético.
    // Stories proyectadas = promedio histórico redondeado, solo para estimar
    // el costo total proyectado del tooltip.
    const avgStories = Math.round(d3.mean(histData, (d) => d.stories) ?? 0);
    const forecastData: ForecastPoint[] = Array.from({ length: futureBatches }, (_, i) => {
      const idx = histData.length + i;
      const costPerStory = Math.max(0, reg.slope * idx + reg.intercept);
      return {
        idx,
        label: `#${idx + 1}`,
        epicTitle: null,
        costPerStory,
        totalCost: costPerStory * avgStories,
        stories: avgStories,
        isForecast: true,
      };
    });

    const allData = [...histData, ...forecastData];
    return { allData, histData, forecastData, reg };
  }, [batches, futureBatches]);

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerW = Math.max(width - margin.left - margin.right, 100);
  const innerH = 280;

  const chart = useMemo(() => {
    const { allData, histData, forecastData, reg } = forecast;
    const x = d3.scaleLinear().domain([0, Math.max(allData.length - 1, 1)]).range([0, innerW]);
    const maxCPS = d3.max(allData, (d) => d.costPerStory) ?? 0;
    const y = d3.scaleLinear().domain([0, Math.max(maxCPS * 1.2, 1)]).nice().range([innerH, 0]);

    // Line through historical data (solid)
    const histLine = d3.line<ForecastPoint>().x((d) => x(d.idx)).y((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Line through forecast data (dashed)
    const forecastLine = d3.line<ForecastPoint>().x((d) => x(d.idx)).y((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Area under historical
    const histArea = d3.area<ForecastPoint>().x((d) => x(d.idx)).y0(innerH).y1((d) => y(d.costPerStory)).curve(d3.curveMonotoneX);
    // Regression trend line (straight), clamped >= 0 igual que el forecast
    const trendY0 = Math.max(0, reg.intercept);
    const trendY1 = Math.max(0, reg.slope * (allData.length - 1) + reg.intercept);

    const yTicks = y.ticks(5);
    // Show every 5th batch label
    const xTicks = allData.filter((_, i) => i % 5 === 0 || i === allData.length - 1);

    return { x, y, histLine, forecastLine, histArea, trendY0, trendY1, yTicks, xTicks, allData, histData, forecastData };
  }, [forecast, innerW, innerH]);

  const hd = hoverIdx !== null ? chart.allData[hoverIdx] : null;
  const splitIdx = chart.histData.length;
  const hasEnoughHistory = batches.length >= 2;

  return (
    <ChartCard
      icon={Calculator}
      title="Proyección de costo por story"
      subtitle={
        hasEnoughHistory
          ? `${forecast.histData.length} históricos + ${forecast.forecastData.length} proyectados`
          : `${batches.length} batch histórico`
      }
    >
      {!hasEnoughHistory ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Se necesitan al menos 2 batches para proyectar tendencia.
        </p>
      ) : (
        <>
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
                <path d={chart.histArea(chart.histData) ?? ''} fill="rgba(37,99,232,0.08)" />

                {/* Regression trend line (thin, full width) */}
                <line x1={chart.x(0)} y1={chart.y(chart.trendY0)} x2={chart.x(chart.allData.length - 1)} y2={chart.y(chart.trendY1)} stroke={C.axisTick} strokeWidth={1} strokeDasharray="8 4" opacity={0.3} />

                {/* Historical line (solid indigo) */}
                <path d={chart.histLine(chart.histData) ?? ''} fill="none" stroke={C.totalCostStroke} strokeWidth={2.5} />

                {/* Forecast line (dashed blue) — guard explícito: sin punto
                    histórico de anclaje no hay línea que dibujar */}
                {chart.histData.length >= 1 && (
                  <path
                    d={chart.forecastLine([chart.histData[chart.histData.length - 1], ...chart.forecastData]) ?? ''}
                    fill="none"
                    stroke={C.costPerStoryLine}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                )}

                {/* Historical dots */}
                {chart.histData.map((d, i) => (
                  <circle
                    key={`h-${i}`}
                    cx={chart.x(d.idx)}
                    cy={chart.y(d.costPerStory)}
                    r={hoverIdx === i ? 5 : 3}
                    fill={C.totalCostStroke}
                    stroke="white"
                    strokeWidth={1}
                  />
                ))}

                {/* Forecast dots */}
                {chart.forecastData.map((d) => (
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
                  left: Math.min(margin.left + chart.x(hd.idx) + 12, width - 200),
                  top: margin.top + chart.y(hd.costPerStory) - 10,
                }}
              >
                <p className="font-semibold text-foreground mb-1">{hd.label} {hd.isForecast ? '(proyectado)' : ''}</p>
                {hd.epicTitle && (
                  <p className="text-muted-foreground max-w-[180px] truncate">{hd.epicTitle}</p>
                )}
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
        </>
      )}
    </ChartCard>
  );
}

// =============================================================================
// Row 6: Story Cost Table with inline bars
// =============================================================================

function StoryCostTable({ stories }: { stories: CostAnalyticsStory[] }) {
  // El backend ya filtra costo > 0 y ordena DESC por costUsd.
  const maxCost = stories[0]?.costUsd ?? 0;

  if (!stories.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Sin datos de costo por story todavía.
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
              <th
                scope="col"
                className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right"
              >
                Attempts
              </th>
            </tr>
          </thead>
          <tbody>
            {stories.map((story) => {
              const pct = maxCost > 0 ? (story.costUsd / maxCost) * 100 : 0;
              const retried = story.attempts != null && story.attempts > 1;
              return (
                <tr
                  key={story.storyId}
                  className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <span className="block text-sm text-foreground max-w-[320px] truncate">
                      {story.storyTitle}
                    </span>
                    <span className="block text-[11px] text-muted-foreground max-w-[320px] truncate">
                      {story.epicTitle}
                    </span>
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
                        {fmtCost(story.costUsd)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground text-right">
                    {fmtTokens(story.tokensNew)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-xs tabular-nums text-right',
                      retried ? 'text-amber-500 font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {story.attempts ?? '—'}
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

function CostAnalyticsContent({ data }: { data: CostAnalyticsResponse }) {
  const { totals } = data;

  const batches = useMemo<BatchPoint[]>(
    () =>
      data.batches.map((b, i) => ({
        label: `#${i + 1}`,
        batchId: b.batchId,
        epicTitle: b.epicTitle,
        costUsd: b.costUsd,
        costPerStory: b.storiesWithCost > 0 ? b.costUsd / b.storiesWithCost : 0,
        retryRate: b.runsCount > 0 ? b.retriedRuns / b.runsCount : 0,
        retriedRuns: b.retriedRuns,
        runsCount: b.runsCount,
        storiesWithCost: b.storiesWithCost,
        tokensNew: b.tokensNew,
        byComponent: b.byComponent,
      })),
    [data.batches],
  );

  const kpis = useMemo(() => {
    const n = batches.length;
    const last = n >= 1 ? batches[n - 1] : null;
    const prev = n >= 2 ? batches[n - 2] : null;

    const costDelta =
      last && prev && prev.costUsd > 0 ? (last.costUsd - prev.costUsd) / prev.costUsd : null;
    const costPerStoryDelta =
      last && prev && prev.costPerStory > 0
        ? (last.costPerStory - prev.costPerStory) / prev.costPerStory
        : null;
    const prevLabel = prev ? `vs ${prev.label}` : '';

    const costPerStory = totals.costUsd / Math.max(totals.storiesWithCost, 1);
    const tokensTotal = totals.tokensNew + totals.tokensCached;
    const cacheHit = tokensTotal > 0 ? totals.tokensCached / tokensTotal : 0;

    return { costDelta, costPerStoryDelta, prevLabel, costPerStory, cacheHit };
  }, [batches, totals]);

  const donutSlices = useMemo(
    () =>
      COMPONENT_ORDER.map((key) => ({
        label: COMPONENT_LABELS[key],
        value: totals.byComponent[key].costUsd,
        color: COMPONENT_SOLID_COLORS[key],
      })),
    [totals],
  );

  return (
    <div className="space-y-4">
      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={DollarSign}
          label="Total Cost"
          value={fmtCost(totals.costUsd)}
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
        <KpiCard
          icon={Coins}
          label="Total Tokens"
          value={fmtTokens(totals.tokensNew)}
          sublabel={`+ ${fmtTokens(totals.tokensCached)} cached`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Run-rate 30d"
          value={fmtCost(totals.last30DaysCostUsd)}
        />
        <KpiCard icon={Layers} label="Cache Hit" value={fmtPct(kpis.cacheHit)} />
      </div>

      {/* Row 2: Multi-Line Trend Chart */}
      <MultiLineTrendChart batches={batches} />

      {/* Row 3: Scatter + Stacked Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EfficiencyScatterChart batches={batches} />
        <CostCompositionChart batches={batches} />
      </div>

      {/* Row 4: Component Efficiency + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RetryCostChart batches={batches} stories={data.stories} />
        <ChartCard icon={PieChart} title="Cost Distribution">
          <CostDonutChart slices={donutSlices} />
        </ChartCard>
      </div>

      {/* Row 5: Cost Forecast Chart. El key fuerza remount cuando se cruza el
          umbral de 2 batches: el containerRef del chart no existe en el estado
          "sin tendencia" y el ResizeObserver de useContainerWidth solo se
          conecta en el mount. */}
      <CostForecastChart key={batches.length >= 2 ? 'trend' : 'no-trend'} batches={batches} />

      {/* Row 6: Story Cost Table */}
      <StoryCostTable stories={data.stories} />
    </div>
  );
}

export function CostAnalytics() {
  const { data, loading } = useCostAnalytics();

  if (loading) return <CostAnalyticsSkeleton />;
  if (!data || data.batches.length === 0) return <CostAnalyticsEmpty />;
  return <CostAnalyticsContent data={data} />;
}
