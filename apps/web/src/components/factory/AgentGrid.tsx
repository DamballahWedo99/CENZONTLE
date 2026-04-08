'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Monitor, Cpu, Layers, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import { AgentCard } from '@/components/factory/AgentCard';
import { AgentDetailDrawer } from '@/components/factory/AgentDetailDrawer';
import { AgentStatus } from '@cenzontle/shared';
import type { FactoryAgent, ComputeNode } from '@cenzontle/shared';

// === TYPES ===

type ViewMode = 'machine' | 'batch' | 'all';
type StatusFilter = 'all' | 'active' | 'idle' | 'error';

const ACTIVE_STATUSES = new Set<AgentStatus>([
  AgentStatus.Coding,
  AgentStatus.Testing,
  AgentStatus.CreatingPR,
  AgentStatus.InReview,
  AgentStatus.Rejected,
]);

function isActive(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function matchesFilter(status: AgentStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActive(status);
  if (filter === 'idle') return status === AgentStatus.Idle || status === AgentStatus.Done;
  return status === AgentStatus.Error;
}

// === BATCH COLOR GENERATOR ===

const BATCH_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#0891B2', '#06B6D4', '#EF4444', '#2563EB', '#F97316'];

function batchColor(batchId: string): string {
  let hash = 0;
  for (let i = 0; i < batchId.length; i++) hash = (hash * 31 + batchId.charCodeAt(i)) | 0;
  return BATCH_COLORS[Math.abs(hash) % BATCH_COLORS.length];
}

// === SEEDED PRNG (deterministic across SSR + client) ===

/** Simple mulberry32 PRNG — same seed always produces the same sequence */
function createSeededRandom(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// === CAPACITY HISTORY CHART (D3) ===

interface CapacitySnapshot {
  time: Date;
  used: number;
}

/** Generate mock hourly snapshots for the last 24h */
function generateCapacityHistory(currentUsed: number, total: number): CapacitySnapshot[] {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const rand = createSeededRandom(total * 1000 + now.getHours());
  const points: CapacitySnapshot[] = [];
  for (let i = 23; i >= 0; i--) {
    const time = new Date(now);
    time.setHours(time.getHours() - i);
    if (i === 0) {
      points.push({ time, used: currentUsed });
    } else {
      const hour = time.getHours();
      const isWorkHours = hour >= 9 && hour <= 18;
      const base = isWorkHours ? total * 0.5 : total * 0.15;
      const jitter = Math.floor(rand() * (total * 0.35));
      points.push({ time, used: Math.min(total, Math.max(0, Math.round(base + jitter))) });
    }
  }
  return points;
}

const BAND_COLORS = {
  low: 'rgba(34, 197, 94, 0.06)',      // green — under 50%
  medium: 'rgba(245, 158, 11, 0.06)',   // amber — 50-80%
  high: 'rgba(239, 68, 68, 0.08)',      // red   — 80-100%
};

const AREA_GRADIENT_ID = 'capacity-area-gradient';

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

function CapacityChart({ used, total, nodeCount }: { used: number; total: number; nodeCount: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  // useState initializer runs once — avoids hydration mismatch from Math.random()
  const [history] = useState(() => generateCapacityHistory(used, total));

  const pct = total > 0 ? (used / total) * 100 : 0;
  const textColor = pct < 50 ? 'text-green-400' : pct < 80 ? 'text-amber-400' : 'text-red-400';
  const dotColor = pct < 50 ? '#22C55E' : pct < 80 ? '#F59E0B' : '#EF4444';

  const height = 140;
  const margin = { top: 12, right: 48, bottom: 24, left: 36 };

  useEffect(() => {
    if (!svgRef.current || width < 100) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(history, (d) => d.time) as [Date, Date])
      .range([0, innerW]);

    const y = d3.scaleLinear()
      .domain([0, total])
      .range([innerH, 0]);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // --- Background bands (dynamic thresholds) ---
    const lowThreshold = total * 0.5;
    const highThreshold = total * 0.8;

    // Low band: 0 → 50%
    g.append('rect')
      .attr('x', 0).attr('y', y(lowThreshold))
      .attr('width', innerW).attr('height', y(0) - y(lowThreshold))
      .attr('fill', BAND_COLORS.low);

    // Medium band: 50% → 80%
    g.append('rect')
      .attr('x', 0).attr('y', y(highThreshold))
      .attr('width', innerW).attr('height', y(lowThreshold) - y(highThreshold))
      .attr('fill', BAND_COLORS.medium);

    // High band: 80% → 100%
    g.append('rect')
      .attr('x', 0).attr('y', y(total))
      .attr('width', innerW).attr('height', y(highThreshold) - y(total))
      .attr('fill', BAND_COLORS.high);

    // --- Threshold dashed lines ---
    [lowThreshold, highThreshold].forEach((threshold) => {
      g.append('line')
        .attr('x1', 0).attr('x2', innerW)
        .attr('y1', y(threshold)).attr('y2', y(threshold))
        .attr('stroke', 'rgba(148,163,184,0.2)')
        .attr('stroke-dasharray', '4,3')
        .attr('stroke-width', 1);
    });

    // --- Threshold labels (right side) ---
    g.append('text')
      .attr('x', innerW + 4).attr('y', y(lowThreshold) + 3)
      .attr('fill', '#F59E0B').attr('font-size', 9).attr('opacity', 0.7)
      .text('50%');

    g.append('text')
      .attr('x', innerW + 4).attr('y', y(highThreshold) + 3)
      .attr('fill', '#EF4444').attr('font-size', 9).attr('opacity', 0.7)
      .text('80%');

    // --- Gradient definition ---
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', AREA_GRADIENT_ID)
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#3B82F6').attr('stop-opacity', 0.35);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#3B82F6').attr('stop-opacity', 0.03);

    // --- Area ---
    const area = d3.area<CapacitySnapshot>()
      .x((d) => x(d.time))
      .y0(innerH)
      .y1((d) => y(d.used))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', area)
      .attr('fill', `url(#${AREA_GRADIENT_ID})`);

    // --- Line ---
    const line = d3.line<CapacitySnapshot>()
      .x((d) => x(d.time))
      .y((d) => y(d.used))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#3B82F6')
      .attr('stroke-width', 1.5);

    // --- Current value dot (pulsing via CSS) ---
    const last = history[history.length - 1];
    g.append('circle')
      .attr('cx', x(last.time))
      .attr('cy', y(last.used))
      .attr('r', 4)
      .attr('fill', dotColor)
      .attr('stroke', '#0F172A')
      .attr('stroke-width', 1.5);

    // --- X Axis ---
    const xAxis = d3.axisBottom(x)
      .ticks(d3.timeHour.every(4))
      .tickFormat((d) => d3.timeFormat('%H:%M')(d as Date))
      .tickSize(0)
      .tickPadding(8);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#9CA3AF')
      .attr('font-size', 9);

    // --- Y Axis ---
    const yAxis = d3.axisLeft(y)
      .ticks(4)
      .tickSize(0)
      .tickPadding(6);

    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#9CA3AF')
      .attr('font-size', 9);

  }, [history, width, total, height, margin.top, margin.right, margin.bottom, margin.left, dotColor]);

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-3">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Factory Capacity</span>
          <span className={cn('text-sm font-mono font-semibold tabular-nums', textColor)}>
            {used}/{total}
            <span className="text-muted-foreground/60 text-[10px] ml-1">({pct.toFixed(0)}%)</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Band legend */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'rgba(34,197,94,0.3)' }} />Low
            </span>
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'rgba(245,158,11,0.3)' }} />Med
            </span>
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'rgba(239,68,68,0.3)' }} />High
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/70">
            {nodeCount} node{nodeCount !== 1 ? 's' : ''} · 24h
          </span>
        </div>
      </div>

      {/* D3 chart */}
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} width={width} height={height} className="overflow-visible" />
      </div>
    </div>
  );
}

// === TOKEN BURN RATE CHART (D3) ===

interface TokenSnapshot {
  time: Date;
  tokens: number;
}

/** Generate mock hourly token consumption for last 24h */
function generateTokenHistory(totalTokens: number): TokenSnapshot[] {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const rand = createSeededRandom(totalTokens + now.getHours() * 7);
  const points: TokenSnapshot[] = [];
  for (let i = 23; i >= 0; i--) {
    const time = new Date(now);
    time.setHours(time.getHours() - i);
    const hour = time.getHours();
    const isWorkHours = hour >= 9 && hour <= 18;
    const base = isWorkHours ? totalTokens * 0.06 : totalTokens * 0.008;
    const jitter = (rand() - 0.3) * base * 0.6;
    points.push({ time, tokens: Math.max(0, Math.round(base + jitter)) });
  }
  return points;
}

function formatTokensShort(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

const TOKEN_GRADIENT_ID = 'token-bar-gradient';

function TokenBurnChart({ totalTokens }: { totalTokens: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef);

  // useState initializer runs once — avoids hydration mismatch from Math.random()
  const [history] = useState(() => generateTokenHistory(totalTokens));

  const currentHourTokens = history[history.length - 1].tokens;
  const avgTokens = Math.round(history.reduce((s, d) => s + d.tokens, 0) / history.length);

  const height = 140;
  const margin = { top: 12, right: 48, bottom: 24, left: 42 };

  useEffect(() => {
    if (!svgRef.current || width < 100) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3.scaleBand<Date>()
      .domain(history.map((d) => d.time))
      .range([0, innerW])
      .padding(0.25);

    const maxTokens = d3.max(history, (d) => d.tokens) ?? 1;
    const y = d3.scaleLinear()
      .domain([0, maxTokens * 1.15])
      .range([innerH, 0]);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // --- Gradient for bars ---
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', TOKEN_GRADIENT_ID)
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#38BDF8').attr('stop-opacity', 0.85);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#1d4ed8').attr('stop-opacity', 0.3);

    // --- Bars ---
    g.selectAll('rect.bar')
      .data(history)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.time) ?? 0)
      .attr('y', (d) => y(d.tokens))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.tokens))
      .attr('fill', `url(#${TOKEN_GRADIENT_ID})`)
      .attr('rx', 1.5);

    // --- Average line ---
    g.append('line')
      .attr('x1', 0).attr('x2', innerW)
      .attr('y1', y(avgTokens)).attr('y2', y(avgTokens))
      .attr('stroke', '#38BDF8')
      .attr('stroke-dasharray', '4,3')
      .attr('stroke-width', 1)
      .attr('opacity', 0.6);

    // --- Avg label ---
    g.append('text')
      .attr('x', innerW + 4).attr('y', y(avgTokens) + 3)
      .attr('fill', '#38BDF8').attr('font-size', 9).attr('opacity', 0.7)
      .text(`avg ${formatTokensShort(avgTokens)}`);

    // --- X Axis (show every 4th hour) ---
    const xAxisScale = d3.scaleTime()
      .domain(d3.extent(history, (d) => d.time) as [Date, Date])
      .range([0, innerW]);

    const xAxis = d3.axisBottom(xAxisScale)
      .ticks(d3.timeHour.every(4))
      .tickFormat((d) => d3.timeFormat('%H:%M')(d as Date))
      .tickSize(0)
      .tickPadding(8);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#9CA3AF')
      .attr('font-size', 9);

    // --- Y Axis ---
    const yAxis = d3.axisLeft(y)
      .ticks(4)
      .tickFormat((d) => formatTokensShort(d as number))
      .tickSize(0)
      .tickPadding(6);

    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#9CA3AF')
      .attr('font-size', 9);

  }, [history, width, totalTokens, avgTokens, height, margin.top, margin.right, margin.bottom, margin.left]);

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Token Burn Rate</span>
          <span className="text-sm font-mono font-semibold tabular-nums text-cyan-400">
            {formatTokensShort(currentHourTokens)}
            <span className="text-muted-foreground/60 text-[10px] ml-1">/hr</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
            <span className="inline-block h-[2px] w-3 rounded" style={{ backgroundColor: '#38BDF8', opacity: 0.6 }} />avg
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            Total: {formatTokensShort(totalTokens)} · 24h
          </span>
        </div>
      </div>

      {/* D3 chart */}
      <div ref={containerRef} className="w-full">
        <svg ref={svgRef} width={width} height={height} className="overflow-visible" />
      </div>
    </div>
  );
}

// === MACHINE STATUS ===

function MachineStatusDot({ status }: { status: ComputeNode['status'] }) {
  const color = status === 'online' ? 'bg-[#22C55E]' : status === 'degraded' ? 'bg-[#F59E0B]' : 'bg-[#EF4444]';
  return <span className={cn('h-2 w-2 rounded-full shrink-0', color)} />;
}

// === EMPTY SLOT ===

function EmptySlot() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/50 p-3.5 flex items-center justify-center min-h-[140px]">
      <span className="text-[10px] text-muted-foreground/50">Available</span>
    </div>
  );
}

// === MACHINE GROUP ===

interface MachineGroupProps {
  machine: ComputeNode;
  agents: FactoryAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onInfoClick: (agentId: string) => void;
  filter: StatusFilter;
}

function MachineGroup({ machine, agents, selectedAgentId, onSelectAgent, onInfoClick, filter }: MachineGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const machineAgents = useMemo(() => {
    const agentIds = new Set(machine.agents.map((a) => a.agentId));
    return agents.filter((a) => agentIds.has(a.id) && matchesFilter(a.status, filter));
  }, [machine.agents, agents, filter]);

  const emptySlots = machine.totalSlots - machine.agents.length;

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Machine header — clickable to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <ChevronRight
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-90',
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <MachineStatusDot status={machine.status} />
              <span className="text-sm font-semibold text-foreground">{machine.name}</span>
              {machine.type === 'local' && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">THIS MACHINE</span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {machine.os} · {machine.location}
            </span>
          </div>
        </div>

        {/* Slot meter */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: machine.totalSlots }).map((_, i) => {
            const slotAgent = machine.agents[i];
            return (
              <div
                key={i}
                className={cn(
                  'h-3 w-3 rounded-sm transition-colors',
                  slotAgent ? '' : 'bg-muted'
                )}
                style={slotAgent ? { backgroundColor: batchColor(slotAgent.batchId) } : undefined}
                title={slotAgent ? slotAgent.batchName : 'Empty'}
              />
            );
          })}
          <span className="text-[10px] text-muted-foreground/70 ml-1.5 font-mono">
            {machine.agents.length}/{machine.totalSlots}
          </span>
        </div>
      </button>

      {/* Collapsible agents grid */}
      {expanded && (
        <div className="px-5 pb-5">
          {machineAgents.length === 0 && emptySlots === machine.totalSlots ? (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground/70">All {machine.totalSlots} slots available</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {machineAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgentId === agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  onInfoClick={() => onInfoClick(agent.id)}
                />
              ))}
              {filter === 'all' && Array.from({ length: Math.min(emptySlots, 3) }).map((_, i) => (
                <EmptySlot key={`empty-${i}`} />
              ))}
              {filter === 'all' && emptySlots > 3 && (
                <div className="rounded-lg border border-dashed border-border bg-background/50 p-3.5 flex items-center justify-center min-h-[140px]">
                  <span className="text-[10px] text-muted-foreground/50">+{emptySlots - 3} more slots</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// === BATCH GROUP ===

interface BatchGroupProps {
  batchId: string;
  batchName: string;
  agents: FactoryAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onInfoClick: (agentId: string) => void;
}

function BatchGroup({ batchId, batchName, agents, selectedAgentId, onSelectAgent, onInfoClick }: BatchGroupProps) {
  const color = batchColor(batchId);

  return (
    <div className="rounded-xl border bg-card p-5" style={{ borderColor: `${color}30` }}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-foreground">{batchName}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => onSelectAgent(agent.id)}
            onInfoClick={() => onInfoClick(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}

// === MAIN COMPONENT ===

interface AgentGridProps {
  initialAgentId?: string | null;
}

export function AgentGrid({ initialAgentId }: AgentGridProps = {}) {
  const { state, dispatch, computed, getStoryById } = useFactory();
  const [viewMode, setViewMode] = useState<ViewMode>('machine');
  const filter: StatusFilter = 'all';
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (initialAgentId) {
      dispatch({ type: 'SELECT_AGENT', payload: initialAgentId });
    }
  }, [initialAgentId, dispatch]);

  const agents = state.agents;
  const machines = state.factory.resourcePool?.nodes ?? [];
  const selectedAgentId = state.selectedAgentId;
  const activeCount = computed.activeAgentCount;
  const totalSlots = state.factory.resourcePool?.totalSlots ?? agents.length;
  const usedSlots = state.factory.resourcePool?.usedSlots ?? activeCount;

  const filteredAgents = useMemo(
    () => agents.filter((a) => matchesFilter(a.status, filter)),
    [agents, filter],
  );

  const selectedAgent = useMemo(
    () => (selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : null),
    [agents, selectedAgentId],
  );

  // Group agents by batch
  const batchGroups = useMemo(() => {
    const map = new Map<string, { batchName: string; agents: FactoryAgent[] }>();
    for (const m of machines) {
      for (const slot of m.agents) {
        const agent = filteredAgents.find((a) => a.id === slot.agentId);
        if (!agent) continue;
        const existing = map.get(slot.batchId);
        if (existing) {
          existing.agents.push(agent);
        } else {
          map.set(slot.batchId, { batchName: slot.batchName, agents: [agent] });
        }
      }
    }
    // Add agents not in any machine (fallback)
    for (const agent of filteredAgents) {
      const inMachine = machines.some((m) => m.agents.some((a) => a.agentId === agent.id));
      if (!inMachine) {
        const existing = map.get('unassigned');
        if (existing) {
          existing.agents.push(agent);
        } else {
          map.set('unassigned', { batchName: 'Unassigned', agents: [agent] });
        }
      }
    }
    return map;
  }, [machines, filteredAgents]);

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      window.open(`/factory/agents/${agentId}/terminal`, '_blank');
    },
    [],
  );

  return (
    <section className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Fleet Monitor</h2>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {activeCount} of {agents.length} active
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode */}
          <div className="flex items-center gap-0.5 bg-card rounded-lg p-0.5 border border-border">
            {([
              { value: 'machine' as ViewMode, label: 'By Machine', icon: Cpu },
              { value: 'batch' as ViewMode, label: 'By Batch', icon: Layers },
              { value: 'all' as ViewMode, label: 'All', icon: Monitor },
            ]).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setViewMode(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  viewMode === value
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground/70 hover:text-muted-foreground',
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Fleet metrics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CapacityChart used={usedSlots} total={totalSlots} nodeCount={machines.length} />
        <TokenBurnChart totalTokens={state.factory.totalTokens} />
      </div>

      {/* Content based on view mode */}
      {viewMode === 'machine' && (
        <div className="space-y-4">
          {machines.map((machine) => (
            <MachineGroup
              key={machine.id}
              machine={machine}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={handleSelectAgent}
              onInfoClick={setDrawerAgentId}
              filter={filter}
            />
          ))}
        </div>
      )}

      {viewMode === 'batch' && (
        <div className="space-y-4">
          {Array.from(batchGroups.entries()).map(([batchId, group]) => (
            <BatchGroup
              key={batchId}
              batchId={batchId}
              batchName={group.batchName}
              agents={group.agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={handleSelectAgent}
              onInfoClick={setDrawerAgentId}
            />
          ))}
          {batchGroups.size === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground/70 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/70">No agents match the current filter</p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'all' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.length > 0 ? (
            filteredAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onClick={() => handleSelectAgent(agent.id)}
                onInfoClick={() => setDrawerAgentId(agent.id)}
              />
            ))
          ) : (
            <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
              <Monitor className="mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground/70">
                {filter === 'all' ? 'No agents registered' : `No ${filter} agents`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Single shared drawer instance */}
      {(() => {
        const drawerAgent = drawerAgentId ? agents.find((a) => a.id === drawerAgentId) : null;
        if (!drawerAgent) return null;
        const drawerStory = drawerAgent.storyId ? getStoryById(drawerAgent.storyId) ?? null : null;
        return (
          <AgentDetailDrawer
            agent={drawerAgent}
            story={drawerStory}
            batch={state.factory.currentBatch}
            open={!!drawerAgentId}
            onClose={() => setDrawerAgentId(null)}
          />
        );
      })()}

    </section>
  );
}
