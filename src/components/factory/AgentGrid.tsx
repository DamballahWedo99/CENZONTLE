'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Monitor, Cpu, Server, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import { AgentCard } from '@/components/factory/AgentCard';
import { AgentTerminal } from '@/components/factory/AgentTerminal';
import { AgentStatus } from '@/types/factory';
import type { FactoryAgent, ComputeNode } from '@/types/factory';

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

const BATCH_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#A855F7', '#EC4899', '#EF4444', '#06B6D4', '#F97316'];

function batchColor(batchId: string): string {
  let hash = 0;
  for (let i = 0; i < batchId.length; i++) hash = (hash * 31 + batchId.charCodeAt(i)) | 0;
  return BATCH_COLORS[Math.abs(hash) % BATCH_COLORS.length];
}

// === CAPACITY BAR ===

function CapacityBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color = pct < 50 ? 'bg-[#3B82F6]' : pct < 80 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]';
  const textColor = pct < 50 ? 'text-[#3B82F6]' : pct < 80 ? 'text-[#F59E0B]' : 'text-[#EF4444]';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-[#2A2A35] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-mono font-medium tabular-nums whitespace-nowrap', textColor)}>
        {used}/{total} <span className="text-[#6B7280]">({pct.toFixed(0)}%)</span>
      </span>
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
    <div className="rounded-lg border border-dashed border-[#2A2A35] bg-[#0A0A0F]/50 p-3.5 flex items-center justify-center min-h-[140px]">
      <span className="text-[10px] text-[#3A3A45]">Available</span>
    </div>
  );
}

// === MACHINE GROUP ===

interface MachineGroupProps {
  machine: ComputeNode;
  agents: FactoryAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  filter: StatusFilter;
}

function MachineGroup({ machine, agents, selectedAgentId, onSelectAgent, filter }: MachineGroupProps) {
  const machineAgents = useMemo(() => {
    const agentIds = new Set(machine.agents.map((a) => a.agentId));
    return agents.filter((a) => agentIds.has(a.id) && matchesFilter(a.status, filter));
  }, [machine.agents, agents, filter]);

  const emptySlots = machine.totalSlots - machine.agents.length;

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] p-5">
      {/* Machine header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2A2A35]">
            <Cpu className="h-4 w-4 text-[#8B8B9A]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <MachineStatusDot status={machine.status} />
              <span className="text-sm font-semibold text-[#EDEDF0]">{machine.name}</span>
              {machine.type === 'local' && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">THIS MACHINE</span>
              )}
            </div>
            <span className="text-[10px] text-[#5A5A6E]">
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
                  slotAgent ? '' : 'bg-[#2A2A35]'
                )}
                style={slotAgent ? { backgroundColor: batchColor(slotAgent.batchId) } : undefined}
                title={slotAgent ? slotAgent.batchName : 'Empty'}
              />
            );
          })}
          <span className="text-[10px] text-[#5A5A6E] ml-1.5 font-mono">
            {machine.agents.length}/{machine.totalSlots}
          </span>
        </div>
      </div>

      {/* Agents grid */}
      {machineAgents.length === 0 && emptySlots === machine.totalSlots ? (
        <div className="text-center py-4">
          <p className="text-xs text-[#5A5A6E]">All {machine.totalSlots} slots available</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {machineAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentId === agent.id}
              onClick={() => onSelectAgent(agent.id)}
            />
          ))}
          {filter === 'all' && Array.from({ length: Math.min(emptySlots, 3) }).map((_, i) => (
            <EmptySlot key={`empty-${i}`} />
          ))}
          {filter === 'all' && emptySlots > 3 && (
            <div className="rounded-lg border border-dashed border-[#2A2A35] bg-[#0A0A0F]/50 p-3.5 flex items-center justify-center min-h-[140px]">
              <span className="text-[10px] text-[#3A3A45]">+{emptySlots - 3} more slots</span>
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
  machines: ComputeNode[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

function BatchGroup({ batchId, batchName, agents, machines, selectedAgentId, onSelectAgent }: BatchGroupProps) {
  const color = batchColor(batchId);

  // Find which machines these agents run on
  const machineMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of machines) {
      for (const a of m.agents) {
        map.set(a.agentId, m.name);
      }
    }
    return map;
  }, [machines]);

  return (
    <div className="rounded-xl border bg-[#141419] p-5" style={{ borderColor: `${color}30` }}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-[#EDEDF0]">{batchName}</span>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
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
  const { state, dispatch, computed } = useFactory();
  const [viewMode, setViewMode] = useState<ViewMode>('machine');
  const [filter, setFilter] = useState<StatusFilter>('all');

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
      const nextId = selectedAgentId === agentId ? null : agentId;
      dispatch({ type: 'SELECT_AGENT', payload: nextId });
    },
    [dispatch, selectedAgentId],
  );

  const handleCloseTerminal = useCallback(() => {
    dispatch({ type: 'SELECT_AGENT', payload: null });
  }, [dispatch]);

  return (
    <section className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-zinc-400" />
          <h2 className="text-base font-semibold text-zinc-100">Fleet Monitor</h2>
          <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
            {activeCount} of {agents.length} active
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode */}
          <div className="flex items-center gap-0.5 bg-[#141419] rounded-lg p-0.5 border border-[#2A2A35]">
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
                    ? 'bg-[#2A2A35] text-[#EDEDF0]'
                    : 'text-[#6B7280] hover:text-[#8B8B9A]',
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-0.5">
            {(['all', 'active', 'idle', 'error'] as StatusFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors capitalize',
                  filter === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Capacity bar */}
      <div className="rounded-xl border border-[#2A2A35] bg-[#141419] px-5 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#8B8B9A]">Factory Capacity</span>
          <span className="text-[10px] text-[#5A5A6E]">{machines.length} node{machines.length !== 1 ? 's' : ''}</span>
        </div>
        <CapacityBar used={usedSlots} total={totalSlots} />
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
              machines={machines}
              selectedAgentId={selectedAgentId}
              onSelectAgent={handleSelectAgent}
            />
          ))}
          {batchGroups.size === 0 && (
            <div className="rounded-xl border border-dashed border-[#2A2A35] bg-[#141419] p-12 text-center">
              <Monitor className="h-8 w-8 text-[#6B7280] mx-auto mb-2" />
              <p className="text-sm text-[#5A5A6E]">No agents match the current filter</p>
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
              />
            ))
          ) : (
            <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-12 text-center">
              <Monitor className="mb-2 h-8 w-8 text-zinc-700" />
              <p className="text-sm text-zinc-500">
                {filter === 'all' ? 'No agents registered' : `No ${filter} agents`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Terminal panel */}
      {selectedAgent && (
        <AgentTerminal agent={selectedAgent} onClose={handleCloseTerminal} />
      )}
    </section>
  );
}
