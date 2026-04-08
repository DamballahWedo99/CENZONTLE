'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Layers,
  Clock,
  DollarSign,
  Users,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Cpu,
  ListOrdered,
  Zap,
  ExternalLink,
  Server,
  X,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFactory } from '@/context/FactoryContext';
import type { SprintBatch, QueuedBatch, ComputeNode, ResourcePool, HumanGate } from '@cenzontle/shared';
import { PipelineLayer, AgentStatus, GateDecision } from '@cenzontle/shared';

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
    label: 'Staged',
    color: '#06B6D4',
    bg: 'bg-cyan-500/10',
    border: 'border-l-cyan-500',
    textColor: 'text-cyan-400',
  },
  [PipelineLayer.ReleaseBoard]: {
    label: 'Release Board',
    color: '#0891B2',
    bg: 'bg-cyan-600/10',
    border: 'border-l-cyan-600',
    textColor: 'text-cyan-400',
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
    color: '#2563EB',
    bg: 'bg-blue-600/10',
    border: 'border-l-blue-600',
    textColor: 'text-blue-400',
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
  '#06B6D4', // cyan
  '#0891B2', // cyan-600
  '#22C55E', // green
  '#F59E0B', // amber
  '#2563EB', // blue-600
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
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground tracking-tight">{title}</h2>
      <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
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

function BatchCard({ batch, allStories, gates }: { batch: SprintBatch; allStories: import('@cenzontle/shared').FactoryStory[]; gates: import('@cenzontle/shared').HumanGate[] }) {
  const layerCfg = LAYER_CONFIG[batch.currentLayer] ?? LAYER_CONFIG[PipelineLayer.Forge];
  const isForge = batch.currentLayer === PipelineLayer.Forge;
  const hasPendingGate = gates.some((g) => g.batchId === batch.id && g.decision === GateDecision.Pending);

  // Calculate progress from the stories embedded in the batch, or from the global stories list
  const batchStories = batch.stories.length > 0 ? batch.stories : allStories.filter((s) => {
    // Match by tracker key prefix from the batch's epic key
    return false; // stories are embedded in the batch
  });
  const totalStories = batchStories.length;
  const completedStories = batchStories.filter((s) => s.status === AgentStatus.Done).length;
  const progressPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  return (
    <Link
      href={`/factory/batch/${batch.id}`}
      className={cn(
        'group relative flex flex-col rounded-xl border-l-[3px] border border-border bg-card p-5 transition-all duration-200',
        'hover:bg-muted hover:border-[#3A3A48] hover:shadow-lg hover:shadow-black/20',
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
          <h3 className="text-[15px] font-bold text-foreground truncate group-hover:text-foreground transition-colors">
            {batch.epicTitle}
          </h3>
          <span className="text-xs font-mono text-muted-foreground mt-0.5 block">{batch.tracker.externalKey}</span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-1" />
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
              <span className="text-xs text-muted-foreground">
                {completedStories}/{totalStories} stories
              </span>
              <span className="text-xs font-semibold text-foreground">{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: layerCfg.color,
                }}
              />
            </div>
          </div>
        ) : hasPendingGate ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: layerCfg.color }} />
            <span className="text-xs font-medium" style={{ color: layerCfg.color }}>
              Awaiting approval
            </span>
          </div>
        ) : batch.currentLayer === PipelineLayer.Staging ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Waiting for QA Testing</span>
              <span className="text-xs font-semibold text-foreground">{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%`, backgroundColor: layerCfg.color }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted">
            <span className="text-xs text-muted-foreground">In progress</span>
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
  const [storiesOpen, setStoriesOpen] = useState(false);
  const hasStories = batch.storyDetails && batch.storyDetails.length > 0;
  const totalSP = hasStories ? batch.storyDetails!.reduce((s, d) => s + d.storyPoints, 0) : 0;

  return (
    <div
      className={cn(
        'rounded-lg bg-card border border-border overflow-hidden transition-colors',
        'hover:border-[#3A3A48]',
      )}
    >
      {/* Main row — grid for vertical alignment across rows */}
      <div className="grid grid-cols-[32px_1fr_32px_auto_72px_100px_56px] items-center gap-3 px-4 py-3">
        {/* Position */}
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-muted text-xs font-bold text-muted-foreground">
          {position}
        </span>

        {/* Title + Key */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">{batch.epicTitle}</span>
          <span className="text-[11px] font-mono text-muted-foreground shrink-0">{batch.tracker.externalKey}</span>
        </div>

        {/* Open in tracker — hardcoded URL while backend is not ready */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={batch.tracker.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Open in Linear
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Story count — expandable toggle */}
        <button
          onClick={() => hasStories && setStoriesOpen(!storiesOpen)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
            hasStories
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
              : 'text-muted-foreground cursor-default',
          )}
        >
          <span>{batch.stories} {batch.stories === 1 ? 'story' : 'stories'}</span>
          {hasStories && (
            <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', storiesOpen && 'rotate-180')} />
          )}
        </button>

        {/* Priority */}
        <div className="flex justify-center">
          <PriorityBadge priority={batch.priority} />
        </div>

        {/* ETA */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Zap className="w-3 h-3 shrink-0" />
          <span>ETA {formatTimeUntil(batch.estimatedStartAt)}</span>
        </div>

        {/* Queued time */}
        <span className="text-[11px] text-muted-foreground/70 text-right">
          {formatTimeAgo(batch.queuedAt)}
        </span>
      </div>

      {/* Inline expandable stories table */}
      {storiesOpen && hasStories && (
        <div className="border-t border-border bg-muted/10">
          {/* Table header */}
          <div className="grid grid-cols-[56px_1fr_130px_140px_48px] gap-2 px-4 pl-[60px] py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 border-b border-border/50">
            <span>Key</span>
            <span>Título</span>
            <span>POD</span>
            <span>Product Owner</span>
            <span className="text-right">SP</span>
          </div>
          {/* Table rows */}
          {batch.storyDetails!.map((story, i) => (
            <div
              key={story.key}
              className={cn(
                'grid grid-cols-[56px_1fr_130px_140px_48px] gap-2 px-4 pl-[60px] py-2 text-xs items-center',
                i < batch.storyDetails!.length - 1 && 'border-b border-border/30',
              )}
            >
              <span className="font-mono text-muted-foreground/70">{story.key}</span>
              <span className="text-foreground truncate">{story.title}</span>
              <span className="text-muted-foreground truncate">{story.pod ?? '—'}</span>
              <span className="text-muted-foreground truncate">{story.productOwner ?? '—'}</span>
              <span className="text-right font-semibold text-foreground">{story.storyPoints}</span>
            </div>
          ))}
          {/* Total row */}
          <div className="grid grid-cols-[56px_1fr_130px_140px_48px] gap-2 px-4 pl-[60px] py-2 text-xs border-t border-border/50 bg-muted/20">
            <span />
            <span className="text-muted-foreground/60">{batch.storyDetails!.length} stories</span>
            <span />
            <span />
            <span className="text-right font-bold text-foreground">{totalSP}</span>
          </div>
        </div>
      )}
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
  const usedCount = machine.agents.length;
  const totalCount = machine.totalSlots;
  const pct = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
  const barColor = pct > 80 ? '#EF4444' : pct > 50 ? '#F59E0B' : '#3B82F6';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {/* Machine header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{machine.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', statusCfg.color)} />
          <span className="text-[11px] text-muted-foreground">{statusCfg.label}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-muted-foreground/70">{usedCount}/{totalCount} agents</span>
          <span className="text-[11px] font-semibold text-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
      </div>

      {/* Location + OS */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50">{machine.os}</span>
        <span className="text-[10px] text-muted-foreground/50">{machine.location}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource Pool Section
// ---------------------------------------------------------------------------

function ResourcePoolSection({ pool }: { pool: ResourcePool }) {


  return (
    <div>
      <SectionHeader icon={Cpu} title="Resource Pool" count={pool.nodes.length} />

      {/* Node grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {pool.nodes.map((machine) => (
          <MachineSlotGrid key={machine.id} machine={machine} />
        ))}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kanban Column
// ---------------------------------------------------------------------------

interface KanbanColumn {
  id: string;
  label: string;
  color: string;
  dotColor: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'queue', label: 'In Queue', color: 'text-muted-foreground', dotColor: '#6B7280' },
  { id: PipelineLayer.Forge, label: 'Forge', color: 'text-blue-400', dotColor: '#3B82F6' },
  { id: PipelineLayer.Staging, label: 'Staged', color: 'text-cyan-400', dotColor: '#06B6D4' },
  { id: PipelineLayer.QAGate, label: 'QA Testing', color: 'text-green-400', dotColor: '#22C55E' },
  { id: 'released', label: 'Released', color: 'text-cyan-400', dotColor: '#0891B2' },
];

function KanbanColumnHeader({ column, count }: { column: KanbanColumn; count: number }) {
  return (
    <div className="flex items-center justify-between px-1 mb-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: column.dotColor }} />
        <span className={cn('text-xs font-semibold uppercase tracking-wider', column.color)}>
          {column.label}
        </span>
      </div>
      <span className="text-[10px] font-medium text-muted-foreground/60 bg-muted rounded-full px-1.5 py-0.5">
        {count}
      </span>
    </div>
  );
}

/** Compact card for batches inside kanban columns */
function KanbanBatchCard({ batch, gates }: { batch: SprintBatch; gates: HumanGate[] }) {
  const layerCfg = LAYER_CONFIG[batch.currentLayer] ?? LAYER_CONFIG[PipelineLayer.Forge];
  const isForge = batch.currentLayer === PipelineLayer.Forge;
  const hasPendingGate = gates.some((g) => g.batchId === batch.id && g.decision === GateDecision.Pending);

  const totalStories = batch.stories.length;
  const completedStories = batch.stories.filter((s) => s.status === AgentStatus.Done).length;
  const progressPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  return (
    <Link
      href={`/factory/batch/${batch.id}`}
      className={cn(
        'group flex flex-col rounded-lg border border-border bg-card p-3.5 transition-all duration-200',
        'hover:bg-muted/50 hover:border-[#3A3A48] hover:shadow-md hover:shadow-black/10',
      )}
    >
      {/* Title */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground truncate leading-snug">{batch.epicTitle}</h4>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
      </div>

      {/* Key + Priority */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[10px] text-muted-foreground/70">{batch.tracker.externalKey}</span>
        <PriorityBadge priority={batch.priority} />
      </div>

      {/* Progress */}
      {isForge && totalStories > 0 ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">{completedStories}/{totalStories} stories</span>
            <span className="text-[10px] font-semibold text-foreground">{progressPercent}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%`, backgroundColor: layerCfg.color }}
            />
          </div>
        </div>
      ) : hasPendingGate ? (
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded bg-muted/80">
          <AlertCircle className="w-3 h-3 shrink-0" style={{ color: layerCfg.color }} />
          <span className="text-[10px] font-medium" style={{ color: layerCfg.color }}>Awaiting approval</span>
        </div>
      ) : batch.currentLayer === PipelineLayer.Staging ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Waiting for QA</span>
            <span className="text-[10px] font-semibold text-foreground">{progressPercent}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%`, backgroundColor: layerCfg.color }}
            />
          </div>
        </div>
      ) : null}

      {/* Bottom metrics */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />{batch.agentCount}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="w-3 h-3" />${batch.totalCost.toFixed(0)}
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <Clock className="w-3 h-3" />{formatElapsed(batch.startedAt)}
        </span>
      </div>
    </Link>
  );
}

/** Compact card for queued batches */
function KanbanQueueCard({ batch }: { batch: QueuedBatch }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-3.5 transition-all hover:bg-muted/50 hover:border-[#3A3A48]">
      {/* Title */}
      <h4 className="text-sm font-semibold text-foreground truncate leading-snug mb-2">{batch.epicTitle}</h4>

      {/* Key + Priority */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[10px] text-muted-foreground/70">{batch.tracker.externalKey}</span>
        <PriorityBadge priority={batch.priority} />
      </div>

      {/* Stories + ETA */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span>{batch.stories} {batch.stories === 1 ? 'story' : 'stories'}</span>
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />ETA {formatTimeUntil(batch.estimatedStartAt)}
        </span>
      </div>

      {/* External link */}
      {batch.tracker.externalUrl && (
        <a
          href={batch.tracker.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-blue-400 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />Open in Linear
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource Pool Drawer
// ---------------------------------------------------------------------------

function ResourcePoolDrawer({ pool, open, onClose }: { pool: ResourcePool; open: boolean; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const usagePercent = pool.totalSlots > 0 ? Math.round((pool.usedSlots / pool.totalSlots) * 100) : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[380px] flex-col bg-card border-l border-border shadow-2xl cursor-default',
          'transform transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Resource Pool"
      >
        {/* Header — h-14 matches the app navbar so border-b lines align */}
        <div className="shrink-0 h-14 flex items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Resource Pool</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {pool.nodes.length} nodes
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Capacity summary */}
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground/60">Total Capacity</span>
              <span className="text-xs font-semibold text-foreground">{pool.usedSlots}/{pool.totalSlots} slots</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-blue-500',
                )}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground/50">{usagePercent}% utilization</span>
          </div>

          {/* Nodes */}
          {pool.nodes.map((machine) => (
            <MachineSlotGrid key={machine.id} machine={machine} />
          ))}

          {/* Add node CTA */}
          <Link
            href="/factory/settings?section=nodes"
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/50 bg-card p-4 text-muted-foreground/40 hover:text-muted-foreground/70 hover:border-border transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs font-medium">Add Compute Node</span>
          </Link>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function FactoryOverview() {
  const { state } = useFactory();

  const { activeBatches, queuedBatches, resourcePool } = state.factory;
  const [poolOpen, setPoolOpen] = useState(false);

  // Group batches by kanban column
  const kanbanData = useMemo(() => {
    const columns = new Map<string, { active: SprintBatch[]; queued: QueuedBatch[] }>();

    for (const col of KANBAN_COLUMNS) {
      columns.set(col.id, { active: [], queued: [] });
    }

    for (const q of queuedBatches) {
      columns.get('queue')!.queued.push(q);
    }

    for (const batch of activeBatches) {
      const layer = batch.currentLayer;
      if (columns.has(layer)) {
        columns.get(layer)!.active.push(batch);
      } else {
        columns.get(PipelineLayer.Forge)!.active.push(batch);
      }
    }

    return columns;
  }, [activeBatches, queuedBatches]);

  const totalItems = activeBatches.length + queuedBatches.length;

  return (
    <div>
      {/* Header with resource pool button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
            <Layers className="w-4 h-4 text-muted-foreground" />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">Pipeline Board</h2>
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalItems}
          </span>
        </div>

        <button
          onClick={() => setPoolOpen(true)}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          <Server className="h-3.5 w-3.5" />
          <span>Resource Pool</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {resourcePool.usedSlots}/{resourcePool.totalSlots}
          </span>
        </button>
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-5 gap-3 min-w-[900px]" style={{ minHeight: 'calc(100vh - 160px)' }}>
        {KANBAN_COLUMNS.map((column) => {
          const data = kanbanData.get(column.id);
          const activeCards = data?.active ?? [];
          const queuedCards = data?.queued ?? [];
          const count = activeCards.length + queuedCards.length;

          return (
            <div key={column.id} className="flex flex-col">
              <KanbanColumnHeader column={column} count={count} />

              <div
                className={cn(
                  'flex-1 flex flex-col gap-2 rounded-lg p-2 transition-colors border border-border/50',
                  count > 0 ? 'bg-muted/10' : 'bg-muted/5 border-dashed',
                )}
              >
                {queuedCards.map((q) => (
                  <KanbanQueueCard key={q.id} batch={q} />
                ))}

                {activeCards.map((batch) => (
                  <KanbanBatchCard key={batch.id} batch={batch} gates={state.gates} />
                ))}

                {count === 0 && (
                  <div className="flex-1 flex items-center justify-center min-h-[120px]">
                    <span className="text-[10px] text-muted-foreground/30">No batches</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resource Pool Drawer */}
      <ResourcePoolDrawer pool={resourcePool} open={poolOpen} onClose={() => setPoolOpen(false)} />
    </div>
  );
}
