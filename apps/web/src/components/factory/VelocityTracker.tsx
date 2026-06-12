'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useVelocity } from '@/hooks/use-velocity';
import type {
  VelocityAnalyticsResponse,
  VelocityBatch,
  VelocityCalibrationRow,
  VelocityClassification,
  VelocityStoryBreakdown,
  VelocityTotals,
} from '@/lib/api/factory';
import {
  fmtCost,
  fmtDurationMs,
  useContainerWidth,
} from './chart-utils';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Gauge,
  Layers,
  Scale,
  Target,
} from 'lucide-react';

// =============================================================================
// Constantes de dominio
// =============================================================================

// Factor simétrico de la banda de calibración — espejo del backend: una
// historia es 'calibrated' si su ratio cae en [1/1.5, 1.5].
const CALIBRATION_FACTOR = 1.5;

// Buckets Fibonacci canónicos del estimador — el dominio del scatter y de las
// barras siempre los incluye para que la línea ideal no degenere con 1 bucket.
const FIB_BUCKETS = [1, 2, 3, 5, 8, 13];

// =============================================================================
// Paleta (misma familia que CostAnalytics.tsx)
// =============================================================================

const V = {
  velocityArea: 'rgba(37,99,232,0.12)',
  velocityStroke: '#2563EB',
  axisTick: '#9CA3AF',
  gridLine: 'rgba(107,114,128,0.15)',
  idealLine: '#9CA3AF',
  band: 'rgba(16,185,129,0.08)',
  good: '#10B981',
  warn: '#F59E0B',
  bad: '#EF4444',
  over: '#38BDF8',
  noData: '#9CA3AF',
} as const;

// Metadata de clasificación compartida entre scatter, badges y leyendas —
// un solo lugar para labels/colores. Semántica: 'over' = la historia costó
// MENOS que sus SP (sobre-estimada), 'under' = costó MÁS (sub-estimada).
const CLASSIFICATION_META: Record<
  VelocityClassification,
  { label: string; color: string }
> = {
  over: { label: 'sobre-estimada', color: V.over },
  calibrated: { label: 'calibrada', color: V.good },
  under: { label: 'sub-estimada', color: V.warn },
  'no-data': { label: 'sin datos', color: V.noData },
};

// =============================================================================
// Helpers
// =============================================================================

/** ¿El ratio cae dentro de la banda de calibración [1/1.5, 1.5]? */
function isRatioInBand(ratio: number): boolean {
  return ratio >= 1 / CALIBRATION_FACTOR && ratio <= CALIBRATION_FACTOR;
}

function fmtRatio(ratio: number | null): string {
  return ratio == null ? '—' : `${ratio.toFixed(2)}×`;
}

/**
 * Jitter horizontal determinista a partir del storyId (djb2 → [-1, 1]).
 * NO Math.random: el componente se hidrata en SSR y el jitter debe ser
 * idéntico entre server y cliente para no romper la hidratación.
 */
function hashJitter(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 500 - 1;
}

const MESES_CORTOS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

/** `2026-06-08` → `8 jun`. Parse UTC para no correr la semana por timezone. */
function fmtWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;
}

/** ISO completo → `8 jun 2026`. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// =============================================================================
// ChartCard / KpiCard (mismo lenguaje visual que CostAnalytics)
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

function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  valueColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sublabel?: string;
  /** Color explícito del valor (ej. semáforo del ratio global). */
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div
        className="text-2xl font-semibold tabular-nums text-foreground"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {sublabel && (
        <span className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
          {sublabel}
        </span>
      )}
    </div>
  );
}

function ClassificationBadge({ classification }: { classification: VelocityClassification }) {
  const meta = CLASSIFICATION_META[classification];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: meta.color, backgroundColor: `${meta.color}1f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

// =============================================================================
// Loading / Empty States (mismo estilo que CostAnalytics)
// =============================================================================

function VelocityTrackerSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando datos de velocity">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-[320px] rounded-xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[320px] rounded-xl bg-muted animate-pulse" />
        <div className="h-[320px] rounded-xl bg-muted animate-pulse" />
      </div>
      <div className="h-[360px] rounded-xl bg-muted animate-pulse" />
    </div>
  );
}

function VelocityTrackerEmpty() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
      <Gauge className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="text-base font-semibold text-foreground">
        Sin datos de velocity todavía
      </h3>
      <p className="text-sm text-muted-foreground">
        La calibración estimación vs esfuerzo real aparecerá cuando el Forge
        procese su primer batch.
      </p>
    </div>
  );
}

/** Aviso cuando hay batches pero la población no alcanza para calibrar. */
function CalibrationNotice() {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: V.warn }} />
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Población insuficiente para calibrar.</span>{' '}
        Se necesitan al menos 3 historias completadas con costo medible para
        calcular las medianas de referencia. Mientras tanto se muestran los
        datos crudos (SP, costo, duración) sin clasificación.
      </p>
    </div>
  );
}

// =============================================================================
// Sección b: Trend semanal de SP entregados
// =============================================================================

function WeeklyVelocityChart({ data }: { data: VelocityAnalyticsResponse }) {
  const { weekly } = data;
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 260;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const margin = { top: 20, right: 20, bottom: 36, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(weekly.map((w) => w.weekStart))
        .range([0, innerW])
        .padding(0.5),
    [weekly, innerW],
  );

  const yScale = useMemo(() => {
    const max = d3.max(weekly, (w) => w.pointsDelivered) ?? 0;
    return d3.scaleLinear().domain([0, Math.max(max * 1.2, 5)]).nice().range([innerH, 0]);
  }, [weekly, innerH]);

  const areaPath = useMemo(() => {
    const gen = d3
      .area<(typeof weekly)[number]>()
      .x((w) => xScale(w.weekStart) ?? 0)
      .y0(innerH)
      .y1((w) => yScale(w.pointsDelivered))
      .curve(d3.curveMonotoneX);
    return gen(weekly) ?? '';
  }, [weekly, xScale, yScale, innerH]);

  const linePath = useMemo(() => {
    const gen = d3
      .line<(typeof weekly)[number]>()
      .x((w) => xScale(w.weekStart) ?? 0)
      .y((w) => yScale(w.pointsDelivered))
      .curve(d3.curveMonotoneX);
    return gen(weekly) ?? '';
  }, [weekly, xScale, yScale]);

  const yTicks = yScale.ticks(5);
  // Con muchas semanas los labels se pisan — mostramos 1 de cada N.
  const labelStep = Math.max(1, Math.ceil(weekly.length / 8));

  if (weekly.length === 0) {
    return (
      <ChartCard icon={Activity} title="Velocity semanal" subtitle="SP entregados por semana">
        <p className="text-sm text-muted-foreground py-10 text-center">
          Ninguna historia ha sido entregada todavía — el trend aparecerá con la
          primera semana con SP completados.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      icon={Activity}
      title="Velocity semanal"
      subtitle={`${weekly.length} semana${weekly.length === 1 ? '' : 's'}`}
    >
      <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Grid */}
            {yTicks.map((t) => (
              <line
                key={t}
                x1={0}
                y1={yScale(t)}
                x2={innerW}
                y2={yScale(t)}
                stroke={V.gridLine}
                strokeDasharray="3 3"
              />
            ))}

            {/* Área + línea de SP entregados */}
            <path d={areaPath} fill={V.velocityArea} />
            <path d={linePath} fill="none" stroke={V.velocityStroke} strokeWidth={2.5} />

            {/* Puntos + zonas de hover */}
            {weekly.map((w, i) => {
              const cx = xScale(w.weekStart) ?? 0;
              const isHovered = hoveredIdx === i;
              return (
                <g key={w.weekStart}>
                  <rect
                    x={cx - innerW / weekly.length / 2}
                    y={0}
                    width={innerW / weekly.length}
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
                      stroke={V.axisTick}
                      strokeWidth={1}
                      strokeOpacity={0.3}
                      strokeDasharray="3 3"
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={yScale(w.pointsDelivered)}
                    r={isHovered ? 5 : 3.5}
                    fill={V.velocityStroke}
                    stroke="#fff"
                    strokeWidth={2}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })}

            {/* Eje Y */}
            {yTicks.map((t) => (
              <text
                key={t}
                x={-10}
                y={yScale(t)}
                textAnchor="end"
                alignmentBaseline="middle"
                fill={V.axisTick}
                fontSize={11}
              >
                {t}
              </text>
            ))}

            {/* Eje X */}
            {weekly.map((w, i) =>
              i % labelStep === 0 || i === weekly.length - 1 ? (
                <text
                  key={w.weekStart}
                  x={xScale(w.weekStart) ?? 0}
                  y={innerH + 22}
                  textAnchor="middle"
                  fill={V.axisTick}
                  fontSize={11}
                >
                  {fmtWeekLabel(w.weekStart)}
                </text>
              ) : null,
            )}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredIdx !== null && weekly[hoveredIdx] && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
            style={{
              left: Math.min(
                margin.left + (xScale(weekly[hoveredIdx].weekStart) ?? 0),
                width - 180,
              ),
              top: margin.top,
            }}
          >
            <p className="font-semibold text-foreground mb-1">
              Semana del {fmtWeekLabel(weekly[hoveredIdx].weekStart)}
            </p>
            <p className="text-muted-foreground">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5"
                style={{ background: V.velocityStroke }}
              />
              {weekly[hoveredIdx].pointsDelivered} SP entregados
            </p>
            <p className="text-muted-foreground">
              {weekly[hoveredIdx].storiesDone} historia
              {weekly[hoveredIdx].storiesDone === 1 ? '' : 's'} done
            </p>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Sección c: Scatter de calibración SP vs effort score
// =============================================================================

interface ScatterPoint {
  story: VelocityStoryBreakdown;
  /** Posición x final (banda del bucket + jitter determinista). */
  cx: number;
  cy: number;
}

function CalibrationScatterChart({
  stories,
  medians,
}: {
  stories: VelocityStoryBreakdown[];
  medians: VelocityTotals['medians'];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 300;
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const margin = { top: 16, right: 16, bottom: 48, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Solo historias con score — las 'no-data' no tienen y que graficar.
  const scored = useMemo(
    () => stories.filter((s) => s.effortScore != null),
    [stories],
  );

  // Dominio X: buckets Fibonacci canónicos + cualquier SP fuera de serie que
  // aparezca en los datos, ordenados. Siempre ≥6 buckets → la línea ideal y
  // la banda nunca degeneran a un punto.
  const buckets = useMemo(() => {
    const set = new Set<number>(FIB_BUCKETS);
    for (const s of scored) set.add(s.storyPoints);
    return Array.from(set).sort((a, b) => a - b);
  }, [scored]);

  const xScale = useMemo(
    () =>
      d3
        .scalePoint<string>()
        .domain(buckets.map(String))
        .range([0, innerW])
        .padding(0.6),
    [buckets, innerW],
  );

  const yScale = useMemo(() => {
    const maxEffort = d3.max(scored, (s) => s.effortScore ?? 0) ?? 0;
    // Guard medianSP > 0: con 0 la división daría Infinity y rompería el
    // dominio de la escala (el scatter entero se renderizaría en blanco).
    const maxExpected = medians && medians.storyPoints > 0
      ? (buckets[buckets.length - 1] / medians.storyPoints) * CALIBRATION_FACTOR
      : 0;
    const max = Math.max(maxEffort, maxExpected, 1);
    return d3.scaleLinear().domain([0, max * 1.1]).nice().range([innerH, 0]);
  }, [scored, medians, buckets, innerH]);

  // Amplitud del jitter: fracción del paso entre buckets para que las nubes
  // de puntos no invadan al bucket vecino.
  const jitterAmp = xScale.step() * 0.18;

  const points = useMemo<ScatterPoint[]>(
    () =>
      scored.map((s) => ({
        story: s,
        cx: (xScale(String(s.storyPoints)) ?? 0) + hashJitter(s.storyId) * jitterAmp,
        cy: yScale(s.effortScore ?? 0),
      })),
    [scored, xScale, yScale, jitterAmp],
  );

  // Línea de calibración ideal y = sp / medianSP, y banda ±1.5× alrededor.
  // Sin medianas o con medianSP 0 (población sin estimar) no hay esfuerzo
  // esperado contra el cual trazar: el scatter degrada a puntos sin línea
  // ideal ni banda en lugar de dividir por cero (sp/0 = Infinity).
  const ideal = useMemo(() => {
    if (!medians || medians.storyPoints <= 0) return null;
    const medSP = medians.storyPoints;
    const lineGen = d3
      .line<number>()
      .x((sp) => xScale(String(sp)) ?? 0)
      .y((sp) => yScale(sp / medSP));
    const bandGen = d3
      .area<number>()
      .x((sp) => xScale(String(sp)) ?? 0)
      .y0((sp) => yScale(sp / medSP / CALIBRATION_FACTOR))
      .y1((sp) => yScale((sp / medSP) * CALIBRATION_FACTOR));
    return { linePath: lineGen(buckets) ?? '', bandPath: bandGen(buckets) ?? '' };
  }, [medians, buckets, xScale, yScale]);

  const yTicks = yScale.ticks(5);
  const hovered = hoveredId
    ? points.find((p) => p.story.storyId === hoveredId) ?? null
    : null;

  return (
    <ChartCard
      icon={Crosshair}
      title="Calibración por historia"
      subtitle={`${scored.length} historia${scored.length === 1 ? '' : 's'} con score`}
    >
      {scored.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Ninguna historia tiene effort score todavía — se necesitan historias
          completadas con costo medible.
        </p>
      ) : (
        <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
          <svg width={width} height={height} className="overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {/* Grid */}
              {yTicks.map((t) => (
                <line
                  key={t}
                  x1={0}
                  y1={yScale(t)}
                  x2={innerW}
                  y2={yScale(t)}
                  stroke={V.gridLine}
                  strokeDasharray="3 3"
                />
              ))}

              {/* Banda ±1.5× y línea ideal (solo con medianas disponibles) */}
              {ideal && (
                <>
                  <path d={ideal.bandPath} fill={V.band} />
                  <path
                    d={ideal.linePath}
                    fill="none"
                    stroke={V.idealLine}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    opacity={0.7}
                  />
                </>
              )}

              {/* Puntos coloreados por clasificación */}
              {points.map((p) => (
                <circle
                  key={p.story.storyId}
                  cx={p.cx}
                  cy={p.cy}
                  r={hoveredId === p.story.storyId ? 6 : 4.5}
                  fill={CLASSIFICATION_META[p.story.classification].color}
                  fillOpacity={0.75}
                  stroke={CLASSIFICATION_META[p.story.classification].color}
                  strokeWidth={hoveredId === p.story.storyId ? 2 : 1}
                  style={{ cursor: 'default', transition: 'r 150ms' }}
                  onMouseEnter={() => setHoveredId(p.story.storyId)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              ))}

              {/* Eje Y */}
              {yTicks.map((t) => (
                <text
                  key={t}
                  x={-8}
                  y={yScale(t)}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  fill={V.axisTick}
                  fontSize={11}
                >
                  {t}
                </text>
              ))}

              {/* Eje X: buckets de SP */}
              {buckets.map((sp) => (
                <text
                  key={sp}
                  x={xScale(String(sp)) ?? 0}
                  y={innerH + 18}
                  textAnchor="middle"
                  fill={V.axisTick}
                  fontSize={11}
                >
                  {sp}
                </text>
              ))}

              <text x={innerW / 2} y={innerH + 36} textAnchor="middle" fill={V.axisTick} fontSize={10}>
                Story Points estimados
              </text>
              <text
                transform={`translate(-34,${innerH / 2}) rotate(-90)`}
                textAnchor="middle"
                fill={V.axisTick}
                fontSize={10}
              >
                Effort score (1.0 = historia mediana)
              </text>
            </g>
          </svg>

          {/* Tooltip */}
          {hovered && (
            <div
              className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10 max-w-[240px]"
              style={{
                left: Math.min(margin.left + hovered.cx + 10, width - 230),
                top: Math.max(margin.top + hovered.cy - 70, 0),
              }}
            >
              <p className="font-semibold text-foreground mb-1 truncate">
                {hovered.story.storyTitle}
              </p>
              <p className="text-muted-foreground">SP: {hovered.story.storyPoints}</p>
              <p className="text-muted-foreground">Costo: {fmtCost(hovered.story.costUsd)}</p>
              <p className="text-muted-foreground">
                Duración: {fmtDurationMs(hovered.story.durationMs)}
              </p>
              <p className="text-muted-foreground">Attempts: {hovered.story.totalAttempts}</p>
              <p className="text-muted-foreground">
                Ratio:{' '}
                <span
                  className="font-medium"
                  style={{ color: CLASSIFICATION_META[hovered.story.classification].color }}
                >
                  {fmtRatio(hovered.story.ratio)}
                </span>
              </p>
            </div>
          )}

          {/* Leyenda */}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {(['over', 'calibrated', 'under'] as const).map((key) => (
              <div key={key} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: CLASSIFICATION_META[key].color }}
                />
                <span className="text-muted-foreground">{CLASSIFICATION_META[key].label}</span>
              </div>
            ))}
            {ideal && (
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-6 h-0 border-t-2 border-dashed"
                  style={{ borderColor: V.idealLine }}
                />
                <span className="text-muted-foreground">ideal (±{CALIBRATION_FACTOR}×)</span>
              </div>
            )}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// =============================================================================
// Sección d: Barras de ratio por bucket de SP
// =============================================================================

function CalibrationBucketChart({ calibration }: { calibration: VelocityCalibrationRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);
  const height = 300;
  const [hoveredSp, setHoveredSp] = useState<number | null>(null);

  const margin = { top: 16, right: 16, bottom: 48, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = useMemo(
    () =>
      d3
        .scaleBand<string>()
        .domain(calibration.map((r) => String(r.storyPoints)))
        .range([0, innerW])
        .padding(0.35),
    [calibration, innerW],
  );

  const yScale = useMemo(() => {
    const max = d3.max(calibration, (r) => r.ratioVsExpected ?? 0) ?? 0;
    // El dominio siempre incluye holgura sobre 1.0 para que la línea de
    // referencia nunca quede pegada al techo.
    return d3
      .scaleLinear()
      .domain([0, Math.max(max * 1.2, CALIBRATION_FACTOR + 0.3)])
      .nice()
      .range([innerH, 0]);
  }, [calibration, innerH]);

  const barWidth = Math.min(xScale.bandwidth(), 64);
  const yTicks = yScale.ticks(5);

  // Color del bucket según dónde cae su ratio vs la banda de calibración.
  const barColor = (ratio: number): string => {
    if (isRatioInBand(ratio)) return V.good;
    return ratio > CALIBRATION_FACTOR ? V.warn : V.over;
  };

  const hoveredRow = hoveredSp != null
    ? calibration.find((r) => r.storyPoints === hoveredSp) ?? null
    : null;

  return (
    <ChartCard
      icon={BarChart3}
      title="Ratio por bucket de SP"
      subtitle=">1 = el bucket se sub-estima"
    >
      {calibration.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Sin buckets con historias completadas todavía.
        </p>
      ) : (
        <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
          <svg width={width} height={height} className="overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {/* Grid */}
              {yTicks.map((t) => (
                <line
                  key={t}
                  x1={0}
                  y1={yScale(t)}
                  x2={innerW}
                  y2={yScale(t)}
                  stroke={V.gridLine}
                  strokeDasharray="3 3"
                />
              ))}

              {/* Barras de ratioVsExpected (con placeholder para null) */}
              {calibration.map((r) => {
                const bandX = xScale(String(r.storyPoints)) ?? 0;
                const cx = bandX + xScale.bandwidth() / 2;
                if (r.ratioVsExpected == null) {
                  // Bucket con samples pero sin medianas (población chica):
                  // marcador hueco en y=0 para que el bucket no "desaparezca".
                  return (
                    <rect
                      key={r.storyPoints}
                      x={cx - barWidth / 2}
                      y={innerH - 4}
                      width={barWidth}
                      height={4}
                      fill="none"
                      stroke={V.noData}
                      strokeDasharray="3 2"
                      rx={2}
                    />
                  );
                }
                return (
                  <rect
                    key={r.storyPoints}
                    x={cx - barWidth / 2}
                    y={yScale(r.ratioVsExpected)}
                    width={barWidth}
                    height={innerH - yScale(r.ratioVsExpected)}
                    fill={barColor(r.ratioVsExpected)}
                    fillOpacity={0.7}
                    rx={3}
                  />
                );
              })}

              {/* Línea de referencia en 1.0 (calibración perfecta) */}
              <line
                x1={0}
                y1={yScale(1)}
                x2={innerW}
                y2={yScale(1)}
                stroke={V.axisTick}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <text x={innerW} y={yScale(1) - 5} textAnchor="end" fill={V.axisTick} fontSize={9}>
                1.0 esperado
              </text>

              {/* Zonas de hover por banda */}
              {calibration.map((r) => (
                <rect
                  key={`hover-${r.storyPoints}`}
                  x={xScale(String(r.storyPoints)) ?? 0}
                  y={0}
                  width={xScale.bandwidth()}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredSp(r.storyPoints)}
                  onMouseLeave={() => setHoveredSp(null)}
                />
              ))}

              {/* Eje Y */}
              {yTicks.map((t) => (
                <text
                  key={t}
                  x={-8}
                  y={yScale(t)}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  fill={V.axisTick}
                  fontSize={11}
                >
                  {t.toFixed(1)}
                </text>
              ))}

              {/* Eje X: bucket + tamaño de muestra — SIEMPRE visible, con
                  poblaciones chicas las medianas son volátiles. */}
              {calibration.map((r) => {
                const cx = (xScale(String(r.storyPoints)) ?? 0) + xScale.bandwidth() / 2;
                return (
                  <g key={`label-${r.storyPoints}`}>
                    <text x={cx} y={innerH + 16} textAnchor="middle" fill={V.axisTick} fontSize={11}>
                      {r.storyPoints} SP
                    </text>
                    <text
                      x={cx}
                      y={innerH + 30}
                      textAnchor="middle"
                      fill={V.axisTick}
                      fontSize={9}
                      opacity={0.8}
                    >
                      n={r.samples}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Tooltip */}
          {hoveredRow && (
            <div
              className="absolute pointer-events-none rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs z-10"
              style={{
                left: Math.min(
                  margin.left + (xScale(String(hoveredRow.storyPoints)) ?? 0),
                  width - 200,
                ),
                top: margin.top,
              }}
            >
              <p className="font-semibold text-foreground mb-1">
                Bucket {hoveredRow.storyPoints} SP · n={hoveredRow.samples}
              </p>
              <p className="text-muted-foreground">
                Ratio vs esperado: {fmtRatio(hoveredRow.ratioVsExpected)}
              </p>
              <p className="text-muted-foreground">
                Costo promedio: {fmtCost(hoveredRow.avgCostUsd)}
              </p>
              <p className="text-muted-foreground">
                Duración promedio: {fmtDurationMs(hoveredRow.avgDurationMs)}
              </p>
              <p className="text-muted-foreground">
                Attempts promedio: {hoveredRow.avgAttempts.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

// =============================================================================
// Sección e: Tabla por batch con drill-down a historias
// =============================================================================

function RatioBadge({ ratio }: { ratio: number | null }) {
  if (ratio == null) {
    return <span className="text-xs text-muted-foreground tabular-nums">—</span>;
  }
  const color = isRatioInBand(ratio) ? V.good : V.warn;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ color, backgroundColor: `${color}1f` }}
    >
      {fmtRatio(ratio)}
    </span>
  );
}

function BatchStoriesSubTable({ stories }: { stories: VelocityStoryBreakdown[] }) {
  if (stories.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Sin historias registradas para este batch.
      </p>
    );
  }
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Historia
          </th>
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            SP
          </th>
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            Costo
          </th>
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            Duración
          </th>
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            Attempts
          </th>
          <th scope="col" className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            Calibración
          </th>
        </tr>
      </thead>
      <tbody>
        {stories.map((s) => (
          <tr key={s.storyId} className="border-b border-border/50 last:border-b-0">
            <td className="px-4 py-2 text-xs text-foreground max-w-[300px] truncate">
              {s.storyTitle}
            </td>
            <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground text-right">
              {s.storyPoints}
            </td>
            <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground text-right">
              {fmtCost(s.costUsd)}
            </td>
            <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground text-right">
              {s.durationMs > 0 ? fmtDurationMs(s.durationMs) : '—'}
            </td>
            <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground text-right">
              {s.totalAttempts > 0 ? s.totalAttempts : '—'}
            </td>
            <td className="px-4 py-2 text-right">
              <ClassificationBadge classification={s.classification} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VelocityBatchTable({
  batches,
  stories,
}: {
  batches: VelocityBatch[];
  stories: VelocityStoryBreakdown[];
}) {
  // El backend devuelve ASC por enqueuedAt — aquí lo más reciente arriba.
  const ordered = useMemo(
    () =>
      [...batches].sort(
        (a, b) => new Date(b.enqueuedAt).getTime() - new Date(a.enqueuedAt).getTime(),
      ),
    [batches],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (batchId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  return (
    <ChartCard icon={Layers} title="Batches" subtitle={`${ordered.length} batch${ordered.length === 1 ? '' : 'es'}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left" role="grid" aria-label="Velocity por batch">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-8 px-2 py-2" aria-label="Expandir" />
              <th scope="col" className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Épica
              </th>
              <th scope="col" className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                SP entregados
              </th>
              <th scope="col" className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                Historias
              </th>
              <th scope="col" className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                Costo
              </th>
              <th scope="col" className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                Ratio
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => {
              const isExpanded = expanded.has(b.batchId);
              const pct =
                b.pointsPlanned > 0
                  ? Math.min((b.pointsDelivered / b.pointsPlanned) * 100, 100)
                  : 0;
              return (
                <Fragment key={b.batchId}>
                  <tr
                    className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => toggle(b.batchId)}
                  >
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Colapsar batch' : 'Expandir batch'}
                        className="flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(b.batchId);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block text-sm text-foreground max-w-[280px] truncate">
                        {b.epicTitle}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        encolado {fmtDate(b.enqueuedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 w-[32%]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: V.velocityStroke }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-16 text-right">
                          {b.pointsDelivered}/{b.pointsPlanned} SP
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground text-right">
                      {b.storiesDone}/{b.storiesCount}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground text-right">
                      {fmtCost(b.costUsd)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <RatioBadge ratio={b.ratio} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-border last:border-b-0">
                      <td colSpan={6} className="bg-muted/30 p-0">
                        <BatchStoriesSubTable
                          stories={stories.filter((s) => s.batchId === b.batchId)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

// =============================================================================
// Componente principal
// =============================================================================

function VelocityTrackerContent({ data }: { data: VelocityAnalyticsResponse }) {
  const { totals } = data;

  // Semáforo del ratio global: verde dentro de la banda ±1.5×, ámbar fuera.
  const ratioColor =
    totals.globalRatio == null
      ? undefined
      : isRatioInBand(totals.globalRatio)
        ? V.good
        : V.warn;

  return (
    <div className="space-y-4">
      {/* Aviso de población insuficiente: hay batches pero sin medianas no
          hay clasificación — se muestran los datos crudos igual. */}
      {totals.medians === null && <CalibrationNotice />}

      {/* Sección a: KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Gauge}
          label="Velocity 4 semanas"
          value={totals.avgWeeklyVelocity4w.toFixed(1)}
          sublabel="SP/semana (promedio)"
        />
        <KpiCard
          icon={Target}
          label="Historias calibradas"
          // calibratedPct ya viene en unidades de porcentaje (0–100).
          value={`${totals.calibratedPct.toFixed(0)}%`}
          sublabel={`n=${totals.sampleSize} historias con datos`}
        />
        <KpiCard
          icon={Scale}
          label="Ratio global"
          value={fmtRatio(totals.globalRatio)}
          sublabel="1.0 = perfecto"
          valueColor={ratioColor}
        />
        <KpiCard
          icon={CalendarRange}
          label="SP entregados 30d"
          value={String(totals.last30DaysPointsDelivered)}
          sublabel={`${totals.pointsDelivered}/${totals.pointsPlanned} SP históricos`}
        />
      </div>

      {/* Sección b: trend semanal */}
      <WeeklyVelocityChart data={data} />

      {/* Secciones c + d: scatter de calibración + barras por bucket */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CalibrationScatterChart stories={data.stories} medians={totals.medians} />
        <CalibrationBucketChart calibration={data.calibration} />
      </div>

      {/* Sección e: tabla por batch con drill-down */}
      <VelocityBatchTable batches={data.batches} stories={data.stories} />
    </div>
  );
}

export function VelocityTracker() {
  const { data, loading } = useVelocity();

  if (loading) return <VelocityTrackerSkeleton />;
  if (!data || data.batches.length === 0) return <VelocityTrackerEmpty />;
  return <VelocityTrackerContent data={data} />;
}
