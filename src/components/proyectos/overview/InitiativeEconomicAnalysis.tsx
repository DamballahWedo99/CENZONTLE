'use client';

import { useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useTheme } from 'next-themes';
import { Sparkles, Trash2, Clock, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type EconomicAnalysisReport,
  type VisualizationType,
  type AnalysisResponse,
  VISUALIZATION_TYPE_LABELS,
} from '@/lib/economic-analysis-agent';
import { ChartTypeSwitcher } from './ChartTypeSwitcher';
import type { Initiative, Epic, UserStory } from '@/types/proyectos';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InitiativeEconomicAnalysisProps {
  initiative: Initiative;
  epics: Epic[];
  stories: UserStory[];
  doneStories: UserStory[];
  totalPoints: number;
  donePoints: number;
  onOpenCopilot: () => void;
  analyses: AnalysisResponse[];
  selectedAnalysisId: string | null;
  onSelectAnalysis: (id: string) => void;
  onDeleteAnalysis: (id: string) => void;
  globalVizPreference?: VisualizationType[];
}

// ---------------------------------------------------------------------------
// Data section definitions with visualization compatibility
// ---------------------------------------------------------------------------

type DataSection = 'roi-projection' | 'cost-benefit' | 'impact-dimensions' | 'resource-allocation' | 'risk-matrix';

interface DataSectionDef {
  key: DataSection;
  title: string;
  defaultViz: VisualizationType;
  supports: VisualizationType[];
}

const DATA_SECTIONS: DataSectionDef[] = [
  { key: 'roi-projection', title: 'Proyeccion de ROI (12 meses)', defaultViz: 'area', supports: ['area', 'line', 'bar'] },
  { key: 'cost-benefit', title: 'Costos vs Beneficios', defaultViz: 'bar', supports: ['bar', 'pie'] },
  { key: 'impact-dimensions', title: 'Dimensiones de Impacto', defaultViz: 'radar', supports: ['radar', 'bar', 'pie'] },
  { key: 'resource-allocation', title: 'Asignacion de Recursos', defaultViz: 'pie', supports: ['pie', 'bar'] },
  { key: 'risk-matrix', title: 'Matriz de Riesgos', defaultViz: 'radar', supports: ['radar', 'bar'] },
];

function resolveViz(sectionDef: DataSectionDef, vizType: VisualizationType | 'auto'): VisualizationType {
  if (vizType === 'auto') return sectionDef.defaultViz;
  return sectionDef.supports.includes(vizType) ? vizType : sectionDef.defaultViz;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  'hsl(142.1 76.2% 36.3%)',
  'hsl(217.2 91.2% 59.8%)',
  'hsl(328 100% 45%)',
  'hsl(24.6 95% 53.1%)',
  'hsl(346.8 77.2% 49.8%)',
  'hsl(199.4 95.5% 73.4%)',
  'hsl(47.9 95.8% 53.1%)',
  'hsl(173.4 80.4% 40%)',
];

const MARGIN = { top: 24, right: 24, bottom: 40, left: 56 };

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return useMemo(
    () => ({
      grid: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
      text: isDark ? 'hsl(240 5% 64.9%)' : 'hsl(240 3.8% 46.1%)',
      axis: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
      background: isDark ? 'hsl(240 10% 3.9%)' : 'hsl(0 0% 100%)',
      tooltipBg: isDark ? 'hsl(240 6% 10%)' : 'hsl(0 0% 100%)',
      tooltipBorder: isDark ? 'hsl(240 3.7% 15.9%)' : 'hsl(240 5.9% 90%)',
      tooltipText: isDark ? 'hsl(0 0% 95%)' : 'hsl(240 10% 3.9%)',
      investmentFill: isDark ? 'hsla(24.6, 95%, 53.1%, 0.25)' : 'hsla(24.6, 95%, 53.1%, 0.15)',
      investmentStroke: 'hsl(24.6 95% 53.1%)',
      returnFill: isDark ? 'hsla(142.1, 76.2%, 36.3%, 0.25)' : 'hsla(142.1, 76.2%, 36.3%, 0.15)',
      returnStroke: 'hsl(142.1 76.2% 36.3%)',
      netStroke: isDark ? 'hsl(217.2 91.2% 59.8%)' : 'hsl(217.2 91.2% 59.8%)',
      costBar: isDark ? 'hsl(346.8 77.2% 49.8%)' : 'hsl(346.8 77.2% 49.8%)',
      benefitBar: isDark ? 'hsl(142.1 76.2% 36.3%)' : 'hsl(142.1 76.2% 36.3%)',
      radarFill: isDark ? 'hsla(217.2, 91.2%, 59.8%, 0.25)' : 'hsla(217.2, 91.2%, 59.8%, 0.2)',
      radarStroke: 'hsl(217.2 91.2% 59.8%)',
      riskQuadrantGreen: isDark ? 'hsla(142.1, 76.2%, 36.3%, 0.08)' : 'hsla(142.1, 76.2%, 36.3%, 0.06)',
      riskQuadrantYellow: isDark ? 'hsla(47.9, 95.8%, 53.1%, 0.08)' : 'hsla(47.9, 95.8%, 53.1%, 0.06)',
      riskQuadrantRed: isDark ? 'hsla(346.8, 77.2%, 49.8%, 0.12)' : 'hsla(346.8, 77.2%, 49.8%, 0.08)',
    }),
    [isDark],
  );
}

// ---------------------------------------------------------------------------
// Responsive width hook (callback ref pattern)
// ---------------------------------------------------------------------------

function useContainerWidth(): [React.RefCallback<HTMLDivElement>, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const callbackRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (node) {
      const update = () => {
        const w = node.offsetWidth;
        if (w > 0) setWidth(w);
      };
      requestAnimationFrame(update);
      roRef.current = new ResizeObserver(() => requestAnimationFrame(update));
      roRef.current.observe(node);
    }
  }, []);

  return [callbackRef, width];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtK(v: number): string {
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}K`;
}

function fmtPct(v: number): string {
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

// ---------------------------------------------------------------------------
// Loading placeholder (inline, no ref)
// ---------------------------------------------------------------------------

function ChartLoadingPlaceholder({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <span className="text-sm text-muted-foreground">Cargando...</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({ title, children, headerAction }: { title: string; children: React.ReactNode; headerAction?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {headerAction}
      </div>
      {children}
    </div>
  );
}

function KPIGrid({ report }: { report: EconomicAnalysisReport }) {
  const items = [
    { label: 'Inversion Total', value: fmtK(report.estimatedTotalInvestment) },
    { label: 'Retorno Anual', value: fmtK(report.estimatedAnnualReturn) },
    { label: 'ROI', value: fmtPct(report.roiPercentage) },
    { label: 'Payback', value: `${report.paybackMonths} meses` },
    { label: 'VPN', value: fmtK(report.npv) },
    { label: 'TIR', value: fmtPct(report.irr) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border p-4 flex flex-col gap-1">
          <span className="text-2xl font-bold tabular-nums tracking-tight">{item.value}</span>
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ====================== ROI PROJECTION ======================

function ROIProjectionArea({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const data = report.roiProjection;
  const height = 320;

  const innerWidth = (width ?? 600) - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, data.length - 1]).range([0, innerWidth]), [data.length, innerWidth]);
  const yMax = useMemo(() => d3.max(data, (d) => Math.max(d.investment, d.returnValue, Math.abs(d.netValue))) ?? 100, [data]);
  const yMin = useMemo(() => d3.min(data, (d) => Math.min(0, d.netValue)) ?? 0, [data]);
  const yScale = useMemo(() => d3.scaleLinear().domain([yMin - yMax * 0.05, yMax * 1.1]).nice().range([innerHeight, 0]), [yMin, yMax, innerHeight]);

  const investmentArea = useMemo(() => {
    const gen = d3.area<(typeof data)[0]>().x((_, i) => xScale(i)).y0(yScale(0)).y1((d) => yScale(d.investment)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const returnArea = useMemo(() => {
    const gen = d3.area<(typeof data)[0]>().x((_, i) => xScale(i)).y0(yScale(0)).y1((d) => yScale(d.returnValue)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const netLine = useMemo(() => {
    const gen = d3.line<(typeof data)[0]>().x((_, i) => xScale(i)).y((d) => yScale(d.netValue)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const yTicks = yScale.ticks(5);

  // Thin out X-axis labels when space is tight
  const labelSkip = useMemo(() => {
    const availablePerLabel = innerWidth / data.length;
    if (availablePerLabel < 30) return 3;
    if (availablePerLabel < 45) return 2;
    return 1;
  }, [innerWidth, data.length]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={height} className="overflow-visible w-full" role="img" aria-label="Proyeccion de ROI a 12 meses">
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {yTicks.map((tick) => (<line key={tick} x1={0} y1={yScale(tick)} x2={innerWidth} y2={yScale(tick)} stroke={colors.grid} strokeWidth={1} />))}
              <line x1={0} y1={yScale(0)} x2={innerWidth} y2={yScale(0)} stroke={colors.text} strokeWidth={1} strokeOpacity={0.3} />
              <path d={investmentArea} fill={colors.investmentFill} stroke={colors.investmentStroke} strokeWidth={2} />
              <path d={returnArea} fill={colors.returnFill} stroke={colors.returnStroke} strokeWidth={2} />
              <path d={netLine} fill="none" stroke={colors.netStroke} strokeWidth={2} strokeDasharray="6 4" />
              {data.map((d, i) => {
                const cx = xScale(i);
                return (
                  <g key={i}>
                    <rect x={cx - innerWidth / data.length / 2} y={0} width={innerWidth / data.length} height={innerHeight} fill="transparent" onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} />
                    {hoveredIndex === i && <line x1={cx} y1={0} x2={cx} y2={innerHeight} stroke={colors.text} strokeWidth={1} strokeOpacity={0.2} strokeDasharray="3 3" />}
                    <circle cx={cx} cy={yScale(d.investment)} r={hoveredIndex === i ? 5 : 3} fill={colors.investmentStroke} stroke={colors.background} strokeWidth={2} className="transition-all duration-150" style={{ pointerEvents: 'none' }} />
                    <circle cx={cx} cy={yScale(d.returnValue)} r={hoveredIndex === i ? 5 : 3} fill={colors.returnStroke} stroke={colors.background} strokeWidth={2} className="transition-all duration-150" style={{ pointerEvents: 'none' }} />
                    <circle cx={cx} cy={yScale(d.netValue)} r={hoveredIndex === i ? 5 : 3} fill={colors.netStroke} stroke={colors.background} strokeWidth={2} className="transition-all duration-150" style={{ pointerEvents: 'none' }} />
                  </g>
                );
              })}
              {yTicks.map((tick) => (<text key={tick} x={-10} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{fmtK(tick)}</text>))}
              {data.map((d, i) => (i % labelSkip === 0 ? <text key={i} x={xScale(i)} y={innerHeight + 24} textAnchor="middle" fill={colors.text} fontSize={11}>{d.month.replace('Mes ', 'M')}</text> : null))}
            </g>
          </svg>
          {hoveredIndex !== null && (
            <div className="absolute pointer-events-none rounded-lg border shadow-lg px-3 py-2 text-xs z-10" style={{ background: colors.tooltipBg, borderColor: colors.tooltipBorder, color: colors.tooltipText, left: Math.min(MARGIN.left + xScale(hoveredIndex), (width ?? 600) - 180), top: MARGIN.top }}>
              <p className="font-semibold mb-1">{data[hoveredIndex].month}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.investmentStroke }} />Inversion: {fmtK(data[hoveredIndex].investment)}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.returnStroke }} />Retorno: {fmtK(data[hoveredIndex].returnValue)}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.netStroke }} />Neto: {fmtK(data[hoveredIndex].netValue)}</p>
            </div>
          )}
          <ROILegend colors={colors} />
        </>
      ) : (
        <ChartLoadingPlaceholder height={height} />
      )}
    </div>
  );
}

function ROILegend({ colors }: { colors: ReturnType<typeof useChartColors> }) {
  return (
    <div className="flex flex-wrap gap-4 mt-3 justify-center">
      <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: colors.investmentStroke }} /><span className="text-muted-foreground">Inversion</span></div>
      <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: colors.returnStroke }} /><span className="text-muted-foreground">Retorno</span></div>
      <div className="flex items-center gap-1.5 text-xs"><span className="w-8 h-0 border-t-2 border-dashed" style={{ borderColor: colors.netStroke }} /><span className="text-muted-foreground">Valor Neto</span></div>
    </div>
  );
}

function ROIProjectionLine({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const data = report.roiProjection;
  const height = 320;
  const innerWidth = (width ?? 600) - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, data.length - 1]).range([0, innerWidth]), [data.length, innerWidth]);
  const yMax = useMemo(() => d3.max(data, (d) => Math.max(d.investment, d.returnValue, Math.abs(d.netValue))) ?? 100, [data]);
  const yMin = useMemo(() => d3.min(data, (d) => Math.min(0, d.netValue)) ?? 0, [data]);
  const yScale = useMemo(() => d3.scaleLinear().domain([yMin - yMax * 0.05, yMax * 1.1]).nice().range([innerHeight, 0]), [yMin, yMax, innerHeight]);

  const investmentLine = useMemo(() => {
    const gen = d3.line<(typeof data)[0]>().x((_, i) => xScale(i)).y((d) => yScale(d.investment)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const returnLine = useMemo(() => {
    const gen = d3.line<(typeof data)[0]>().x((_, i) => xScale(i)).y((d) => yScale(d.returnValue)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const netLine = useMemo(() => {
    const gen = d3.line<(typeof data)[0]>().x((_, i) => xScale(i)).y((d) => yScale(d.netValue)).curve(d3.curveMonotoneX);
    return gen(data) ?? '';
  }, [data, xScale, yScale]);

  const yTicks = yScale.ticks(5);

  // Thin out X-axis labels when space is tight
  const labelSkip = useMemo(() => {
    const availablePerLabel = innerWidth / data.length;
    if (availablePerLabel < 30) return 3;
    if (availablePerLabel < 45) return 2;
    return 1;
  }, [innerWidth, data.length]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={height} className="overflow-visible w-full">
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {yTicks.map((tick) => (<line key={tick} x1={0} y1={yScale(tick)} x2={innerWidth} y2={yScale(tick)} stroke={colors.grid} strokeWidth={1} />))}
              <line x1={0} y1={yScale(0)} x2={innerWidth} y2={yScale(0)} stroke={colors.text} strokeWidth={1} strokeOpacity={0.3} />
              <path d={investmentLine} fill="none" stroke={colors.investmentStroke} strokeWidth={2.5} />
              <path d={returnLine} fill="none" stroke={colors.returnStroke} strokeWidth={2.5} />
              <path d={netLine} fill="none" stroke={colors.netStroke} strokeWidth={2} strokeDasharray="6 4" />
              {data.map((d, i) => {
                const cx = xScale(i);
                return (
                  <g key={i}>
                    <rect x={cx - innerWidth / data.length / 2} y={0} width={innerWidth / data.length} height={innerHeight} fill="transparent" onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} />
                    <circle cx={cx} cy={yScale(d.investment)} r={hoveredIndex === i ? 5 : 3} fill={colors.investmentStroke} stroke={colors.background} strokeWidth={2} style={{ pointerEvents: 'none' }} />
                    <circle cx={cx} cy={yScale(d.returnValue)} r={hoveredIndex === i ? 5 : 3} fill={colors.returnStroke} stroke={colors.background} strokeWidth={2} style={{ pointerEvents: 'none' }} />
                    <circle cx={cx} cy={yScale(d.netValue)} r={hoveredIndex === i ? 5 : 3} fill={colors.netStroke} stroke={colors.background} strokeWidth={2} style={{ pointerEvents: 'none' }} />
                  </g>
                );
              })}
              {yTicks.map((tick) => (<text key={tick} x={-10} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{fmtK(tick)}</text>))}
              {data.map((d, i) => (i % labelSkip === 0 ? <text key={i} x={xScale(i)} y={innerHeight + 24} textAnchor="middle" fill={colors.text} fontSize={11}>{d.month.replace('Mes ', 'M')}</text> : null))}
            </g>
          </svg>
          {hoveredIndex !== null && (
            <div className="absolute pointer-events-none rounded-lg border shadow-lg px-3 py-2 text-xs z-10" style={{ background: colors.tooltipBg, borderColor: colors.tooltipBorder, color: colors.tooltipText, left: Math.min(MARGIN.left + xScale(hoveredIndex), (width ?? 600) - 180), top: MARGIN.top }}>
              <p className="font-semibold mb-1">{data[hoveredIndex].month}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.investmentStroke }} />Inversion: {fmtK(data[hoveredIndex].investment)}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.returnStroke }} />Retorno: {fmtK(data[hoveredIndex].returnValue)}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.netStroke }} />Neto: {fmtK(data[hoveredIndex].netValue)}</p>
            </div>
          )}
          <ROILegend colors={colors} />
        </>
      ) : (
        <ChartLoadingPlaceholder height={height} />
      )}
    </div>
  );
}

function ROIProjectionBar({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const data = report.roiProjection;
  const height = 320;
  const innerWidth = (width ?? 600) - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(() => d3.scaleBand().domain(data.map((_, i) => String(i))).range([0, innerWidth]).padding(0.25), [data, innerWidth]);
  const yMax = useMemo(() => d3.max(data, (d) => Math.max(d.investment, d.returnValue)) ?? 100, [data]);
  const yScale = useMemo(() => d3.scaleLinear().domain([0, yMax * 1.1]).nice().range([innerHeight, 0]), [yMax, innerHeight]);

  const yTicks = yScale.ticks(5);
  const barW = Math.max(2, (xScale.bandwidth() - 4) / 2);

  // Thin out X-axis labels when space is tight
  const labelSkip = useMemo(() => {
    const availablePerLabel = innerWidth / data.length;
    if (availablePerLabel < 30) return 3;
    if (availablePerLabel < 45) return 2;
    return 1;
  }, [innerWidth, data.length]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: height }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={height} className="overflow-visible w-full">
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {yTicks.map((tick) => (<line key={tick} x1={0} y1={yScale(tick)} x2={innerWidth} y2={yScale(tick)} stroke={colors.grid} strokeWidth={1} />))}
              {data.map((d, i) => {
                const x = xScale(String(i)) ?? 0;
                const isHov = hoveredIndex === i;
                return (
                  <g key={i} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
                    <rect x={x} y={yScale(d.investment)} width={barW} height={innerHeight - yScale(d.investment)} fill={colors.investmentStroke} rx={3} opacity={isHov ? 1 : 0.8} />
                    <rect x={x + barW + 2} y={yScale(d.returnValue)} width={barW} height={innerHeight - yScale(d.returnValue)} fill={colors.returnStroke} rx={3} opacity={isHov ? 1 : 0.8} />
                  </g>
                );
              })}
              {yTicks.map((tick) => (<text key={tick} x={-10} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{fmtK(tick)}</text>))}
              {data.map((d, i) => (i % labelSkip === 0 ? <text key={i} x={(xScale(String(i)) ?? 0) + xScale.bandwidth() / 2} y={innerHeight + 24} textAnchor="middle" fill={colors.text} fontSize={11}>{d.month.replace('Mes ', 'M')}</text> : null))}
            </g>
          </svg>
          {hoveredIndex !== null && (
            <div className="absolute pointer-events-none rounded-lg border shadow-lg px-3 py-2 text-xs z-10" style={{ background: colors.tooltipBg, borderColor: colors.tooltipBorder, color: colors.tooltipText, left: Math.min(MARGIN.left + (xScale(String(hoveredIndex)) ?? 0), (width ?? 600) - 180), top: MARGIN.top }}>
              <p className="font-semibold mb-1">{data[hoveredIndex].month}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.investmentStroke }} />Inversion: {fmtK(data[hoveredIndex].investment)}</p>
              <p><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors.returnStroke }} />Retorno: {fmtK(data[hoveredIndex].returnValue)}</p>
            </div>
          )}
          <ROILegend colors={colors} />
        </>
      ) : (
        <ChartLoadingPlaceholder height={height} />
      )}
    </div>
  );
}

function ROIProjectionChart({ report, vizType }: { report: EconomicAnalysisReport; vizType: VisualizationType }) {
  if (vizType === 'line') return <ROIProjectionLine report={report} />;
  if (vizType === 'bar') return <ROIProjectionBar report={report} />;
  return <ROIProjectionArea report={report} />;
}

// ====================== COST-BENEFIT ======================

function CostBenefitBarChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const sorted = useMemo(() => [...report.costBenefitItems].sort((a, b) => Math.abs(b.estimated) - Math.abs(a.estimated)), [report.costBenefitItems]);

  const labelWidth = Math.min(180, (width ?? 600) * 0.3);
  const barMargin = { top: 8, right: 60, bottom: 8, left: labelWidth };
  const barHeight = 28;
  const gap = 6;
  const svgHeight = barMargin.top + barMargin.bottom + sorted.length * (barHeight + gap);
  const innerW = (width ?? 600) - barMargin.left - barMargin.right;

  const xMax = useMemo(() => d3.max(sorted, (d) => d.estimated) ?? 100, [sorted]);
  const xScale = useMemo(() => d3.scaleLinear().domain([0, xMax * 1.15]).range([0, innerW]), [xMax, innerW]);

  // Dynamic label truncation based on available label width
  const maxLabelChars = useMemo(() => Math.max(8, Math.floor(labelWidth / 7)), [labelWidth]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 200 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={svgHeight} className="overflow-visible w-full">
            <g transform={`translate(${barMargin.left},${barMargin.top})`}>
              {sorted.map((item, i) => {
                const y = i * (barHeight + gap);
                const barW = xScale(item.estimated);
                const barColor = item.type === 'cost' ? colors.costBar : colors.benefitBar;
                const truncatedLabel = item.category.length > maxLabelChars ? item.category.substring(0, maxLabelChars - 2) + '...' : item.category;
                return (
                  <g key={item.category}>
                    <text x={-8} y={y + barHeight / 2} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11} className="select-none">{truncatedLabel}</text>
                    <rect x={0} y={y} width={Math.max(barW, 2)} height={barHeight} fill={barColor} rx={4} opacity={0.85} />
                    <text x={barW + 8} y={y + barHeight / 2} alignmentBaseline="middle" fill={colors.text} fontSize={11} fontWeight={600}>{fmtK(item.estimated)}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="flex gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: colors.costBar }} /><span className="text-muted-foreground">Costos</span></div>
            <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: colors.benefitBar }} /><span className="text-muted-foreground">Beneficios</span></div>
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={200} />
      )}
    </div>
  );
}

function CostBenefitPieChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const items = report.costBenefitItems;
  const totalCost = useMemo(() => items.filter((i) => i.type === 'cost').reduce((s, i) => s + i.estimated, 0), [items]);
  const totalBenefit = useMemo(() => items.filter((i) => i.type === 'benefit').reduce((s, i) => s + i.estimated, 0), [items]);

  const data = useMemo(() => [
    { label: 'Costos', value: totalCost, color: colors.costBar },
    { label: 'Beneficios', value: totalBenefit, color: colors.benefitBar },
  ], [totalCost, totalBenefit, colors]);

  const size = Math.min((width ?? 400) - 40, 260);
  const svgCx = (width ?? 400) / 2;
  const svgCy = size / 2 + 10;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.6;

  const pieGen = useMemo(() => d3.pie<(typeof data)[0]>().value((d) => d.value).sort(null), []);
  const arcGen = useMemo(() => d3.arc<d3.PieArcDatum<(typeof data)[0]>>().innerRadius(innerRadius).outerRadius(outerRadius).padAngle(0.02).cornerRadius(3), [innerRadius, outerRadius]);
  const arcs = useMemo(() => pieGen(data), [pieGen, data]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 300 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={size + 20} className="overflow-visible w-full">
            <g transform={`translate(${svgCx},${svgCy})`}>
              {arcs.map((arc) => (<path key={arc.data.label} d={arcGen(arc) ?? ''} fill={arc.data.color} opacity={0.85} />))}
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.tooltipText} fontSize={13} fontWeight={700} y={-6}>{fmtK(totalBenefit - totalCost)}</text>
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.text} fontSize={10} y={12}>neto</text>
            </g>
          </svg>
          <div className="flex gap-4 mt-3 justify-center">
            {data.map((d) => (
              <div key={d.label} className="flex items-center gap-1.5 text-xs">
                <span className="w-3 h-3 rounded" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.label}: {fmtK(d.value)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={300} />
      )}
    </div>
  );
}

function CostBenefitChart({ report, vizType }: { report: EconomicAnalysisReport; vizType: VisualizationType }) {
  if (vizType === 'pie') return <CostBenefitPieChart report={report} />;
  return <CostBenefitBarChart report={report} />;
}

// ====================== IMPACT DIMENSIONS ======================

function ImpactRadarChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const dims = report.impactDimensions;
  const numAxes = dims.length;
  const size = Math.min((width ?? 400) - 80, 340);
  const cx = (width ?? 400) / 2;
  const cy = size / 2 + 30;
  const radius = size / 2 - 10;
  const svgHeight = size + 70;
  const angleSlice = (Math.PI * 2) / numAxes;
  const levels = [25, 50, 75, 100];

  const dataPoints = useMemo(
    () => dims.map((d, i) => {
      const r = (d.score / 100) * radius;
      const angle = angleSlice * i - Math.PI / 2;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }),
    [dims, radius, angleSlice, cx, cy],
  );

  const polygonPath = useMemo(() => dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z', [dataPoints]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 380 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={svgHeight} className="overflow-visible w-full" role="img" aria-label="Grafica de impacto dimensional">
            {levels.map((level) => {
              const r = (level / 100) * radius;
              return (<g key={level}><circle cx={cx} cy={cy} r={r} fill="none" stroke={colors.grid} strokeWidth={1} /><text x={cx + 4} y={cy - r + 4} fill={colors.text} fontSize={9} opacity={0.5}>{level}</text></g>);
            })}
            {dims.map((d, i) => {
              const angle = angleSlice * i - Math.PI / 2;
              const lineX = cx + radius * Math.cos(angle);
              const lineY = cy + radius * Math.sin(angle);
              const labelR = radius + 18;
              const labelX = cx + labelR * Math.cos(angle);
              const labelY = cy + labelR * Math.sin(angle);
              let anchor: 'start' | 'middle' | 'end' = 'middle';
              if (Math.cos(angle) > 0.1) anchor = 'start';
              if (Math.cos(angle) < -0.1) anchor = 'end';
              return (<g key={d.dimension}><line x1={cx} y1={cy} x2={lineX} y2={lineY} stroke={colors.grid} strokeWidth={1} /><text x={labelX} y={labelY} textAnchor={anchor} alignmentBaseline="middle" fill={colors.text} fontSize={11} fontWeight={500}>{d.dimension}</text></g>);
            })}
            <path d={polygonPath} fill={colors.radarFill} stroke={colors.radarStroke} strokeWidth={2} />
            {dataPoints.map((p, i) => (<circle key={i} cx={p.x} cy={p.y} r={4} fill={colors.radarStroke} stroke={colors.background} strokeWidth={2} />))}
          </svg>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            {dims.map((d) => (<div key={d.dimension} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{d.score}</span> {d.dimension}</div>))}
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={380} />
      )}
    </div>
  );
}

function ImpactBarChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const dims = report.impactDimensions;
  const labelWidth = Math.min(160, (width ?? 600) * 0.28);
  const barMargin = { top: 8, right: 50, bottom: 8, left: labelWidth };
  const barHeight = 28;
  const gap = 6;
  const svgHeight = barMargin.top + barMargin.bottom + dims.length * (barHeight + gap);
  const innerW = (width ?? 600) - barMargin.left - barMargin.right;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, 100]).range([0, innerW]), [innerW]);

  const maxLabelChars = useMemo(() => Math.max(8, Math.floor(labelWidth / 7)), [labelWidth]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 200 }}>
      {width !== null && width > 0 ? (
        <svg width={width} height={svgHeight} className="overflow-visible w-full">
          <g transform={`translate(${barMargin.left},${barMargin.top})`}>
            {dims.map((d, i) => {
              const y = i * (barHeight + gap);
              const barW = xScale(d.score);
              const truncatedLabel = d.dimension.length > maxLabelChars ? d.dimension.substring(0, maxLabelChars - 2) + '...' : d.dimension;
              return (
                <g key={d.dimension}>
                  <text x={-8} y={y + barHeight / 2} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{truncatedLabel}</text>
                  <rect x={0} y={y} width={innerW} height={barHeight} fill={colors.grid} rx={4} opacity={0.3} />
                  <rect x={0} y={y} width={Math.max(barW, 2)} height={barHeight} fill={CHART_COLORS[i % CHART_COLORS.length]} rx={4} opacity={0.85} />
                  <text x={barW + 8} y={y + barHeight / 2} alignmentBaseline="middle" fill={colors.text} fontSize={11} fontWeight={600}>{d.score}</text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <ChartLoadingPlaceholder height={200} />
      )}
    </div>
  );
}

function ImpactPieChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const dims = report.impactDimensions;
  const size = Math.min((width ?? 400) - 40, 280);
  const svgCx = (width ?? 400) / 2;
  const svgCy = size / 2 + 10;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.55;

  const pieGen = useMemo(() => d3.pie<(typeof dims)[0]>().value((d) => d.score).sort(null), []);
  const arcGen = useMemo(() => d3.arc<d3.PieArcDatum<(typeof dims)[0]>>().innerRadius(innerRadius).outerRadius(outerRadius).padAngle(0.02).cornerRadius(3), [innerRadius, outerRadius]);
  const arcs = useMemo(() => pieGen(dims), [pieGen, dims]);

  const avg = useMemo(() => Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length), [dims]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 300 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={size + 20} className="overflow-visible w-full">
            <g transform={`translate(${svgCx},${svgCy})`}>
              {arcs.map((arc, i) => (<path key={arc.data.dimension} d={arcGen(arc) ?? ''} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={0.85} />))}
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.tooltipText} fontSize={18} fontWeight={700} y={-4}>{avg}</text>
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.text} fontSize={10} y={14}>promedio</text>
            </g>
          </svg>
          <div className="space-y-1.5 mt-3">
            {dims.map((d, i) => (
              <div key={d.dimension} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 text-foreground font-medium truncate">{d.dimension}</span>
                <span className="text-muted-foreground tabular-nums">{d.score}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={300} />
      )}
    </div>
  );
}

function ImpactChart({ report, vizType }: { report: EconomicAnalysisReport; vizType: VisualizationType }) {
  if (vizType === 'bar') return <ImpactBarChart report={report} />;
  if (vizType === 'pie') return <ImpactPieChart report={report} />;
  return <ImpactRadarChart report={report} />;
}

// ====================== RESOURCE ALLOCATION ======================

function ResourceDonutChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const data = report.resourceAllocation;
  const size = Math.min((width ?? 400) - 40, 280);
  const svgCx = (width ?? 400) / 2;
  const svgCy = size / 2 + 10;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.6;
  const svgHeight = size + 20;

  const totalMonthlyCost = useMemo(() => data.reduce((sum, d) => sum + d.cost, 0), [data]);
  const pieGen = useMemo(() => d3.pie<(typeof data)[0]>().value((d) => d.allocation).sort(null), []);
  const arcGen = useMemo(() => d3.arc<d3.PieArcDatum<(typeof data)[0]>>().innerRadius(innerRadius).outerRadius(outerRadius).padAngle(0.02).cornerRadius(3), [innerRadius, outerRadius]);
  const arcs = useMemo(() => pieGen(data), [pieGen, data]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 300 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={svgHeight} className="overflow-visible w-full">
            <g transform={`translate(${svgCx},${svgCy})`}>
              {arcs.map((arc, i) => (<path key={arc.data.team} d={arcGen(arc) ?? ''} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={0.85} />))}
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.tooltipText} fontSize={14} fontWeight={700} y={-6}>{fmtK(totalMonthlyCost)}</text>
              <text textAnchor="middle" alignmentBaseline="middle" fill={colors.text} fontSize={10} y={12}>/ mes</text>
            </g>
          </svg>
          <div className="space-y-2 mt-3">
            {data.map((d, i) => (
              <div key={d.team} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 text-foreground font-medium truncate">{d.team}</span>
                <span className="text-muted-foreground tabular-nums">{d.allocation}%</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">{fmtK(d.cost)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={300} />
      )}
    </div>
  );
}

function ResourceBarChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const data = report.resourceAllocation;
  const labelWidth = Math.min(140, (width ?? 600) * 0.25);
  const barMargin = { top: 8, right: 50, bottom: 8, left: labelWidth };
  const barHeight = 28;
  const gap = 6;
  const svgHeight = barMargin.top + barMargin.bottom + data.length * (barHeight + gap);
  const innerW = (width ?? 600) - barMargin.left - barMargin.right;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, 100]).range([0, innerW]), [innerW]);

  const maxLabelChars = useMemo(() => Math.max(8, Math.floor(labelWidth / 7)), [labelWidth]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 200 }}>
      {width !== null && width > 0 ? (
        <svg width={width} height={svgHeight} className="overflow-visible w-full">
          <g transform={`translate(${barMargin.left},${barMargin.top})`}>
            {data.map((d, i) => {
              const y = i * (barHeight + gap);
              const barW = xScale(d.allocation);
              const truncatedLabel = d.team.length > maxLabelChars ? d.team.substring(0, maxLabelChars - 2) + '...' : d.team;
              return (
                <g key={d.team}>
                  <text x={-8} y={y + barHeight / 2} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{truncatedLabel}</text>
                  <rect x={0} y={y} width={innerW} height={barHeight} fill={colors.grid} rx={4} opacity={0.3} />
                  <rect x={0} y={y} width={Math.max(barW, 2)} height={barHeight} fill={CHART_COLORS[i % CHART_COLORS.length]} rx={4} opacity={0.85} />
                  <text x={barW + 8} y={y + barHeight / 2} alignmentBaseline="middle" fill={colors.text} fontSize={11} fontWeight={600}>{d.allocation}% · {fmtK(d.cost)}</text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <ChartLoadingPlaceholder height={200} />
      )}
    </div>
  );
}

function ResourceChart({ report, vizType }: { report: EconomicAnalysisReport; vizType: VisualizationType }) {
  if (vizType === 'bar') return <ResourceBarChart report={report} />;
  return <ResourceDonutChart report={report} />;
}

// ====================== RISK MATRIX ======================

function RiskScatterChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();
  const [hoveredRisk, setHoveredRisk] = useState<number | null>(null);

  const risks = report.risks;
  const size = Math.min((width ?? 400) - 40, 360);
  const margin = { top: 20, right: 20, bottom: 36, left: 44 };
  const innerW = size - margin.left - margin.right;
  const innerH = size - margin.top - margin.bottom;
  const svgWidth = width ?? 400;
  const offsetX = (svgWidth - size) / 2;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([0, innerW]), [innerW]);
  const yScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([innerH, 0]), [innerH]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ minHeight: 380 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={svgWidth} height={size + 20} className="overflow-visible w-full" role="img" aria-label="Matriz de riesgos">
            <g transform={`translate(${offsetX + margin.left},${margin.top})`}>
              <rect x={0} y={yScale(0.5)} width={xScale(0.5)} height={innerH - yScale(0.5)} fill={colors.riskQuadrantGreen} />
              <rect x={xScale(0.5)} y={yScale(0.5)} width={innerW - xScale(0.5)} height={innerH - yScale(0.5)} fill={colors.riskQuadrantYellow} />
              <rect x={0} y={0} width={xScale(0.5)} height={yScale(0.5)} fill={colors.riskQuadrantYellow} />
              <rect x={xScale(0.5)} y={0} width={innerW - xScale(0.5)} height={yScale(0.5)} fill={colors.riskQuadrantRed} />
              <line x1={xScale(0.5)} y1={0} x2={xScale(0.5)} y2={innerH} stroke={colors.grid} />
              <line x1={0} y1={yScale(0.5)} x2={innerW} y2={yScale(0.5)} stroke={colors.grid} />
              <rect x={0} y={0} width={innerW} height={innerH} fill="none" stroke={colors.grid} />
              {risks.map((risk, i) => {
                const cx = xScale(risk.probability);
                const cy = yScale(risk.impact);
                const r = 8 + risk.probability * risk.impact * 12;
                const isHovered = hoveredRisk === i;
                return (
                  <circle key={i} cx={cx} cy={cy} r={isHovered ? r + 3 : r}
                    fill={risk.probability > 0.5 && risk.impact > 0.5 ? colors.costBar : risk.probability > 0.5 || risk.impact > 0.5 ? CHART_COLORS[6] : colors.benefitBar}
                    opacity={isHovered ? 0.95 : 0.7} stroke={colors.background} strokeWidth={2}
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredRisk(i)} onMouseLeave={() => setHoveredRisk(null)}
                  />
                );
              })}
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => (<text key={`x-${tick}`} x={xScale(tick)} y={innerH + 20} textAnchor="middle" fill={colors.text} fontSize={10}>{tick}</text>))}
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => (<text key={`y-${tick}`} x={-8} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={10}>{tick}</text>))}
              <text x={innerW / 2} y={innerH + 32} textAnchor="middle" fill={colors.text} fontSize={11} fontWeight={500}>Probabilidad</text>
              <text transform={`translate(-34,${innerH / 2}) rotate(-90)`} textAnchor="middle" fill={colors.text} fontSize={11} fontWeight={500}>Impacto</text>
            </g>
          </svg>
          {hoveredRisk !== null && (
            <div className="absolute pointer-events-none rounded-lg border shadow-lg px-3 py-2 text-xs z-10 max-w-[280px]"
              style={{ background: colors.tooltipBg, borderColor: colors.tooltipBorder, color: colors.tooltipText,
                left: Math.min(offsetX + margin.left + xScale(risks[hoveredRisk].probability) + 16, (width ?? 400) - 290),
                top: margin.top + yScale(risks[hoveredRisk].impact) - 10 }}>
              <p className="font-semibold mb-1">{risks[hoveredRisk].name}</p>
              <p className="text-muted-foreground">P: {risks[hoveredRisk].probability} | I: {risks[hoveredRisk].impact}</p>
              <p className="mt-1 text-muted-foreground leading-relaxed">{risks[hoveredRisk].mitigation}</p>
            </div>
          )}
          <div className="space-y-2 mt-4">
            {risks.map((risk, i) => (
              <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-muted/30 transition-colors" onMouseEnter={() => setHoveredRisk(i)} onMouseLeave={() => setHoveredRisk(null)}>
                <span className="text-muted-foreground tabular-nums shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-foreground">{risk.name}</span>
                  <span className="text-muted-foreground ml-1">(P:{risk.probability} I:{risk.impact})</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={380} />
      )}
    </div>
  );
}

function RiskBarChart({ report }: { report: EconomicAnalysisReport }) {
  const [containerRef, width] = useContainerWidth();
  const colors = useChartColors();

  const risks = report.risks;
  const labelWidth = Math.min(200, (width ?? 600) * 0.33);
  const barMargin = { top: 8, right: 50, bottom: 8, left: labelWidth };
  const barHeight = 22;
  const groupGap = 8;
  const svgHeight = barMargin.top + barMargin.bottom + risks.length * (barHeight * 2 + groupGap + 4);
  const innerW = (width ?? 600) - barMargin.left - barMargin.right;

  const xScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([0, innerW]), [innerW]);

  const maxLabelChars = useMemo(() => Math.max(8, Math.floor(labelWidth / 7)), [labelWidth]);

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: 300 }}>
      {width !== null && width > 0 ? (
        <>
          <svg width={width} height={svgHeight} className="overflow-visible w-full">
            <g transform={`translate(${barMargin.left},${barMargin.top})`}>
              {risks.map((risk, i) => {
                const y = i * (barHeight * 2 + groupGap + 4);
                const truncatedLabel = risk.name.length > maxLabelChars ? risk.name.substring(0, maxLabelChars - 2) + '...' : risk.name;
                return (
                  <g key={i}>
                    <text x={-8} y={y + barHeight} textAnchor="end" alignmentBaseline="middle" fill={colors.text} fontSize={11}>{truncatedLabel}</text>
                    <rect x={0} y={y} width={Math.max(xScale(risk.probability), 2)} height={barHeight} fill={CHART_COLORS[6]} rx={3} opacity={0.85} />
                    <text x={xScale(risk.probability) + 6} y={y + barHeight / 2} alignmentBaseline="middle" fill={colors.text} fontSize={10}>P: {risk.probability}</text>
                    <rect x={0} y={y + barHeight + 2} width={Math.max(xScale(risk.impact), 2)} height={barHeight} fill={colors.costBar} rx={3} opacity={0.85} />
                    <text x={xScale(risk.impact) + 6} y={y + barHeight + 2 + barHeight / 2} alignmentBaseline="middle" fill={colors.text} fontSize={10}>I: {risk.impact}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="flex gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: CHART_COLORS[6] }} /><span className="text-muted-foreground">Probabilidad</span></div>
            <div className="flex items-center gap-1.5 text-xs"><span className="w-3 h-3 rounded" style={{ background: colors.costBar }} /><span className="text-muted-foreground">Impacto</span></div>
          </div>
        </>
      ) : (
        <ChartLoadingPlaceholder height={300} />
      )}
    </div>
  );
}

function RiskChart({ report, vizType }: { report: EconomicAnalysisReport; vizType: VisualizationType }) {
  if (vizType === 'bar') return <RiskBarChart report={report} />;
  return <RiskScatterChart report={report} />;
}

// ---------------------------------------------------------------------------
// Section resolver
// ---------------------------------------------------------------------------

function DataSectionRenderer({ section, report, vizType }: { section: DataSection; report: EconomicAnalysisReport; vizType: VisualizationType }) {
  switch (section) {
    case 'roi-projection': return <ROIProjectionChart report={report} vizType={vizType} />;
    case 'cost-benefit': return <CostBenefitChart report={report} vizType={vizType} />;
    case 'impact-dimensions': return <ImpactChart report={report} vizType={vizType} />;
    case 'resource-allocation': return <ResourceChart report={report} vizType={vizType} />;
    case 'risk-matrix': return <RiskChart report={report} vizType={vizType} />;
  }
}

// ---------------------------------------------------------------------------
// Analysis Report View — always shows all 5 sections with per-section overrides
// ---------------------------------------------------------------------------

type SectionChartOverrides = Partial<Record<DataSection, VisualizationType>>;

function AnalysisReportView({ analysis, globalVizPreference = [] }: { analysis: AnalysisResponse; globalVizPreference?: VisualizationType[] }) {
  const { report } = analysis;
  const [overrides, setOverrides] = useState<SectionChartOverrides>({});

  const handleSectionVizChange = useCallback((sectionKey: DataSection, value: VisualizationType | 'auto') => {
    setOverrides((prev) => {
      if (value === 'auto') {
        const next = { ...prev };
        delete next[sectionKey];
        return next;
      }
      return { ...prev, [sectionKey]: value };
    });
  }, []);

  const fullWidthSections: DataSection[] = ['roi-projection'];
  const topSections = DATA_SECTIONS.filter((s) => fullWidthSections.includes(s.key));
  const gridSections = DATA_SECTIONS.filter((s) => !fullWidthSections.includes(s.key));

  const renderSection = (sec: DataSectionDef) => {
    const override = overrides[sec.key];
    // Priority: per-section override > global preference (if compatible) > section default
    // Find the first globally-selected type that this section supports
    const globalMatch = !override ? globalVizPreference.find((vt) => sec.supports.includes(vt)) : undefined;
    const globalApplies = !!globalMatch;
    const effectiveViz = override && sec.supports.includes(override)
      ? override
      : globalMatch
        ? globalMatch
        : sec.defaultViz;
    const isOverridden = !!override || globalApplies;

    return (
      <SectionCard
        key={sec.key}
        title={sec.title}
        headerAction={
          <ChartTypeSwitcher
            currentViz={effectiveViz}
            defaultViz={sec.defaultViz}
            supportedVizTypes={sec.supports}
            isOverridden={isOverridden}
            onSelect={(v) => handleSectionVizChange(sec.key, v)}
          />
        }
      >
        <DataSectionRenderer section={sec.key} report={report} vizType={effectiveViz} />
      </SectionCard>
    );
  };

  return (
    <div className="space-y-8">
      {/* Executive Summary + KPIs */}
      <SectionCard title="Resumen Ejecutivo">
        <p className="text-sm leading-relaxed text-foreground/80 mb-6">{report.executiveSummary}</p>
        <KPIGrid report={report} />
      </SectionCard>

      {/* Full-width sections */}
      {topSections.map(renderSection)}

      {/* Grid sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {gridSections.map(renderSection)}
      </div>

      {/* Recommendations */}
      <SectionCard title="Recomendaciones">
        <ol className="space-y-3">
          {report.recommendations.map((rec, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-muted-foreground text-xs font-medium shrink-0 mt-0.5">{i + 1}</span>
              <span className="text-foreground/80 leading-relaxed">{rec}</span>
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis History List
// ---------------------------------------------------------------------------

function AnalysisHistoryList({
  analyses,
  selectedId,
  onSelect,
  onDelete,
}: {
  analyses: AnalysisResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
      {analyses.map((a) => {
        const isSelected = a.id === selectedId;
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={`group relative shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
              isSelected
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-400'
                : 'hover:bg-muted/50'
            }`}
            style={{ maxWidth: 220 }}
          >
            <p className="text-xs font-medium truncate">{a.title}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {new Date(a.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}
              className="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              aria-label="Eliminar analisis"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component (Orchestrator)
// ---------------------------------------------------------------------------

export function InitiativeEconomicAnalysis({
  initiative,
  epics,
  stories,
  doneStories,
  totalPoints,
  donePoints,
  onOpenCopilot,
  analyses,
  selectedAnalysisId,
  onSelectAnalysis,
  onDeleteAnalysis,
  globalVizPreference = [],
}: InitiativeEconomicAnalysisProps) {
  const selectedAnalysis = analyses.find((a) => a.id === selectedAnalysisId) ?? null;

  // ---- Empty state ----
  if (analyses.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-xl border-2 border-dashed max-w-md w-full flex flex-col items-center gap-4 py-12 px-6 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Analisis Ejecutivo con IA</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-sm">
              Genera analisis ejecutivos personalizados con graficas dinamicas. Elige el tipo de visualizacion (barras, linea, pastel, radar, area) y el agente genera el analisis completo.
            </p>
          </div>
          <Button onClick={onOpenCopilot} className="gap-2 mt-2">
            <Sparkles className="h-3.5 w-3.5" />
            Generar Analisis con IA
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Analisis Ejecutivos</h2>
            <p className="text-xs text-muted-foreground">{analyses.length} analisis generados</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenCopilot}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generar Analisis con IA
        </Button>
      </div>

      {/* History strip */}
      {analyses.length > 0 && (
        <AnalysisHistoryList
          analyses={analyses}
          selectedId={selectedAnalysisId}
          onSelect={onSelectAnalysis}
          onDelete={onDeleteAnalysis}
        />
      )}

      {/* Selected report */}
      {selectedAnalysis ? (
        <AnalysisReportView analysis={selectedAnalysis} globalVizPreference={globalVizPreference} />
      ) : (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">Selecciona un analisis del historial para visualizarlo</p>
        </div>
      )}
    </div>
  );
}
