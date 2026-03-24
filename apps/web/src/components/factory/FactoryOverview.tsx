'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Layers,
  Clock,
  DollarSign,
  Users,
  ChevronRight,
  AlertCircle,
  Cpu,
  ListOrdered,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { SprintBatch, QueuedBatch, ComputeNode, ResourcePool } from '@cenzontle/shared';
import { PipelineLayer, AgentStatus } from '@cenzontle/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYER_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; textColor: string }
> = {
  [PipelineLayer.Forge]: {
    label: 'Forge',
    color: '#3B82F6',
    bg: 'bg-blue-500/10',
    border: 'border-l-blue-500',
    textColor: 'text-blue-400',
  },
  [PipelineLayer.Staging]: {
    label: 'Staging',
    color: '#EC4899',
    bg: 'bg-pink-500/10',
    border: 'border-l-pink-500',
    textColor: 'text-pink-400',
  },
  [PipelineLayer.ReleaseBoard]: {
    label: 'Release Board',
    color: '#A855F7',
    bg: 'bg-violet-500/10',
    border: 'border-l-violet-500',
    textColor: 'text-violet-400',
  },
  [PipelineLayer.QAGate]: {
    label: 'QA Gate',
    color: '#22C55E',
    bg: 'bg-green-500/10',
    border: 'border-l-green-500',
    textColor: 'text-green-400',
  },
  [PipelineLayer.Requirements]: {
    label: 'Requirements',
    color: '#F59E0B',
    bg: 'bg-amber-500/10',
    border: 'border-l-amber-500',
    textColor: 'text-amber-400',
  },
  [PipelineLayer.Linear]: {
    label: 'Linear',
    color: '#6366F1',
    bg: 'bg-indigo-500/10',
    border: 'border-l-indigo-500',
    textColor: 'text-indigo-400',
  },
};

const PRIORITY_STYLES: Record<
  string,
  { dot: string; text: string; bg: string }
> = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10' },
  high: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10' },
  medium: { dot: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/10' },
  low: { dot: 'bg-gray-500', text: 'text-gray-400', bg: 'bg-gray-500/10' },
};

/** Deterministic color per batch id for the resource grid. */
const BATCH_COLORS = [
  '#3B82F6', // blue
  '#EC4899', // pink
  '#A855F7', // violet
  '#22C55E', // green
  '#F59E0B', // amber
  '#06B6D4', // cyan
];

function batchColor(batchId: string): string {
  let hash = 0;
  for (let i = 0; i < batchId.length; i++) {
    hash = batchId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BATCH_COLORS[Math.abs(hash) % BATCH_COLORS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const totalMinutes = Math.floor(diff / 60_000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTimeUntil(isoDate: string | null): string {
  if (!isoDate) return '--';
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'soon';
  const totalMinutes = Math.floor(diff / 60_000);
  if (totalMinutes < 60) return `~${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  return `~${hours}h`;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const totalMinutes = Math.floor(diff / 60_000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1E1E28]">
        <Icon className="w-4 h-4 text-[#8B8B9A]" />
      </div>
      <h2 className="text-[15px] font-semibold text-[#EDEDF0] tracking-tight">{title}</h2>
      <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#1E1E28] text-[#8B8B9A]">
        {count}
      </span>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.low;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize',
        style.bg,
        style.text,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
      {priority}
    </span>
  );
}

function LayerBadge({ layer }: { layer: PipelineLayer }) {
  const config = LAYER_CONFIG[layer];
  if (!config) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider',
        config.bg,
        config.textColor,
      )}
    >
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ backgroundColor: config.color }}
      />
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Active Batch Card
// ---------------------------------------------------------------------------

function BatchCard({ batch, allStories }: { batch: SprintBatch; allStories: import('@cenzontle/shared').FactoryStory[] }) {
  const layerCfg = LAYER_CONFIG[batch.currentLayer] ?? LAYER_CONFIG[PipelineLayer.Forge];
  const isForge = batch.currentLayer === PipelineLayer.Forge;
  const isStaging = batch.currentLayer === PipelineLayer.Staging;
  const isWaiting = isStaging || batch.currentLayer === PipelineLayer.ReleaseBoard || batch.currentLayer === PipelineLayer.QAGate;

  // Calculate progress from the stories embedded in the batch, or from the global stories list
  const batchStories = batch.stories.length > 0 ? batch.stories : allStories.filter((s) => {
    // Match by jiraKey prefix from the batch's epic key
    return false; // stories are embedded in the batch
  });
  const totalStories = batchStories.length;
  const completedStories = batchStories.filter((s) => s.status === AgentStatus.Done).length;
  const progressPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  return (
    <Link
      href={`/factory/batch/${batch.id}`}
      className={cn(
        'group relative flex flex-col rounded-xl border-l-[3px] border border-[#2A2A35] bg-[#141419] p-5 transition-all duration-200',
        'hover:bg-[#1A1A22] hover:border-[#3A3A48] hover:shadow-lg hover:shadow-black/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0F]',
        layerCfg.border,
      )}
    >
      {/* Subtle glow for forge batches */}
      {isForge && (
        <div
          className="pointer-events-none absolute inset-0 rounded-xl opacity-[0.03]"
          style={{
            background: `radial-gradient(ellipse at 0% 50%, ${layerCfg.color} 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Header: Title + Jira Key */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold text-[#EDEDF0] truncate group-hover:text-white transition-colors">
            {batch.epicTitle}
          </h3>
          <span className="text-xs font-mono text-[#6B6B7A] mt-0.5 block">{batch.jiraKey}</span>
        </div>
        <ChevronRight className="w-4 h-4 text-[#4A4A58] group-hover:text-[#8B8B9A] transition-colors flex-shrink-0 mt-1" />
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <LayerBadge layer={batch.currentLayer} />
        <PriorityBadge priority={batch.priority} />
      </div>

      {/* Progress */}
      <div className="mb-4">
        {isForge && totalStories > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[#8B8B9A]">
                {completedStories}/{totalStories} stories
              </span>
              <span className="text-xs font-semibold text-[#EDEDF0]">{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#1E1E28] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: layerCfg.color,
                }}
              />
            </div>
          </div>
        ) : isWaiting ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1E1E28]">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: layerCfg.color }} />
            <span className="text-xs font-medium" style={{ color: layerCfg.color }}>
              Awaiting approval
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1E1E28]">
            <span className="text-xs text-[#8B8B9A]">In progress</span>
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-4 text-xs text-[#6B6B7A]">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>
            {batch.agentCount} agent{batch.agentCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5" />
          <span>${batch.totalCost.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatElapsed(batch.startedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Queue Row
// ---------------------------------------------------------------------------

function QueueRow({ batch, position }: { batch: QueuedBatch; position: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 rounded-lg bg-[#141419] border border-[#2A2A35]',
        'transition-colors hover:bg-[#1A1A22] hover:border-[#3A3A48]',
      )}
    >
      {/* Position */}
      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#1E1E28] text-xs font-bold text-[#6B6B7A] flex-shrink-0">
        {position}
      </span>

      {/* Title + Key */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#EDEDF0] truncate">{batch.epicTitle}</span>
          <span className="text-[11px] font-mono text-[#6B6B7A] flex-shrink-0">{batch.jiraKey}</span>
        </div>
      </div>

      {/* Story count */}
      <span className="text-xs text-[#8B8B9A] flex-shrink-0">
        {batch.stories} {batch.stories === 1 ? 'story' : 'stories'}
      </span>

      {/* Priority */}
      <PriorityBadge priority={batch.priority} />

      {/* ETA */}
      <div className="flex items-center gap-1.5 text-xs text-[#6B6B7A] flex-shrink-0">
        <Zap className="w-3 h-3" />
        <span>ETA {formatTimeUntil(batch.estimatedStartAt)}</span>
      </div>

      {/* Queued time */}
      <span className="text-[11px] text-[#4A4A58] flex-shrink-0 w-16 text-right">
        {formatTimeAgo(batch.queuedAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Machine Slot Grid
// ---------------------------------------------------------------------------

function MachineSlotGrid({ machine }: { machine: ComputeNode }) {
  const statusIndicator: Record<string, { color: string; label: string }> = {
    online: { color: 'bg-green-500', label: 'Online' },
    offline: { color: 'bg-red-500', label: 'Offline' },
    degraded: { color: 'bg-amber-500', label: 'Degraded' },
  };

  const statusCfg = statusIndicator[machine.status] ?? statusIndicator.offline;

  // Build the 6 slots
  const slots: Array<{ filled: boolean; color: string; batchName: string }> = [];
  for (let i = 0; i < machine.totalSlots; i++) {
    const agent = machine.agents[i];
    if (agent) {
      slots.push({
        filled: true,
        color: batchColor(agent.batchId),
        batchName: agent.batchName,
      });
    } else {
      slots.push({ filled: false, color: '', batchName: '' });
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[#2A2A35] bg-[#141419] p-4">
      {/* Machine header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-[#6B6B7A]" />
          <span className="text-xs font-semibold text-[#EDEDF0]">{machine.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', statusCfg.color)} />
          <span className="text-[11px] text-[#6B6B7A]">{statusCfg.label}</span>
        </div>
      </div>

      {/* Slot grid */}
      <div className="flex items-center gap-1.5">
        {slots.map((slot, i) => (
          <div
            key={i}
            className={cn(
              'w-8 h-8 rounded-md border transition-colors',
              slot.filled
                ? 'border-transparent shadow-sm'
                : 'border-[#2A2A35] bg-[#1E1E28]',
            )}
            style={slot.filled ? { backgroundColor: `${slot.color}20`, borderColor: `${slot.color}40` } : undefined}
            title={slot.filled ? slot.batchName : 'Available'}
          >
            {slot.filled && (
              <div className="flex items-center justify-center w-full h-full">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: slot.color }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Agent count */}
      <span className="text-[11px] text-[#4A4A58]">
        {machine.agents.length}/{machine.totalSlots} slots used
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource Pool Section
// ---------------------------------------------------------------------------

function ResourcePoolSection({ pool }: { pool: ResourcePool }) {
  const usagePercent = pool.totalSlots > 0 ? Math.round((pool.usedSlots / pool.totalSlots) * 100) : 0;

  return (
    <div>
      <SectionHeader icon={Cpu} title="Resource Pool" count={pool.nodes.length} />

      {/* Node grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {pool.nodes.map((machine) => (
          <MachineSlotGrid key={machine.id} machine={machine} />
        ))}
      </div>

      {/* Total capacity bar */}
      <div className="rounded-lg border border-[#2A2A35] bg-[#141419] px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[#EDEDF0]">Total Capacity</span>
          <span className="text-sm text-[#8B8B9A]">
            <span className="font-semibold text-[#EDEDF0]">{pool.usedSlots}</span>
            /{pool.totalSlots} agents active ({usagePercent}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#1E1E28] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-out',
              usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-blue-500',
            )}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function FactoryOverview() {
  const { state } = useFactory();

  const { activeBatches, queuedBatches, resourcePool } = state.factory;

  // Sort active batches: Forge first (most prominent), then by priority weight
  const priorityWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedBatches = useMemo(() => {
    return [...activeBatches].sort((a, b) => {
      // Forge batches first
      const aForge = a.currentLayer === PipelineLayer.Forge ? 0 : 1;
      const bForge = b.currentLayer === PipelineLayer.Forge ? 0 : 1;
      if (aForge !== bForge) return aForge - bForge;
      // Then by priority
      return (priorityWeight[a.priority] ?? 3) - (priorityWeight[b.priority] ?? 3);
    });
  }, [activeBatches]);

  return (
    <div className="space-y-8">
      {/* Active Batches */}
      <section>
        <SectionHeader icon={Layers} title="Active Batches" count={activeBatches.length} />

        {activeBatches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2A2A35] bg-[#141419]/50 py-12 text-center">
            <p className="text-sm text-[#6B6B7A]">No active batches</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedBatches.map((batch) => (
              <BatchCard key={batch.id} batch={batch} allStories={state.stories} />
            ))}
          </div>
        )}
      </section>

      {/* Queue */}
      <section>
        <SectionHeader icon={ListOrdered} title="Queue" count={queuedBatches.length} />

        {queuedBatches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#2A2A35] bg-[#141419]/50 py-8 text-center">
            <p className="text-sm text-[#6B6B7A]">Queue is empty</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {queuedBatches.map((batch, i) => (
              <QueueRow key={batch.id} batch={batch} position={i + 1} />
            ))}
          </div>
        )}
      </section>

      {/* Resource Pool */}
      <section>
        <ResourcePoolSection pool={resourcePool} />
      </section>
    </div>
  );
}
