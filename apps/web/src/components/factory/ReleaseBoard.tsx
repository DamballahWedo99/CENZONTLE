'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { ReleaseBoardEpic } from '@cenzontle/shared';
import {
  Package,
  Rocket,
  Clock,
  CheckCircle2,
  FileCode2,
  TestTube2,
  DollarSign,
  AlertTriangle,
  Calendar,
  ArrowUpRight,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const priorityConfig = {
  critical: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  high: { label: 'High', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  medium: { label: 'Medium', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  low: { label: 'Low', color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/30' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h ago`;
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  return `${mins}m ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function EpicCard({ epic }: { epic: ReleaseBoardEpic }) {
  const pCfg = priorityConfig[epic.priority];

  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:border-[#3A3A45] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-muted-foreground">{epic.tracker.externalKey}</span>
            <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', pCfg.bg, pCfg.border, pCfg.color)}>
              {pCfg.label}
            </span>
          </div>
          <h3 className="text-foreground font-semibold text-sm truncate">{epic.title}</h3>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <FileCode2 className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-muted-foreground">Changes</span>
          <span className="ml-auto font-mono">
            <span className="text-emerald-400">+{epic.totalAdditions}</span>
            <span className="text-[#6B7280]"> / </span>
            <span className="text-red-400">-{epic.totalDeletions}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <TestTube2 className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-muted-foreground">Tests</span>
          <span className={cn('ml-auto font-mono font-medium', epic.testPassRate >= 0.95 ? 'text-emerald-400' : 'text-amber-400')}>
            {(epic.testPassRate * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Package className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-muted-foreground">Stories</span>
          <span className="ml-auto font-mono text-foreground">{epic.storiesCompleted}/{epic.storiesTotal}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <DollarSign className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-muted-foreground">Cost</span>
          <span className="ml-auto font-mono text-foreground">${epic.cost.toFixed(2)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
          <Clock className="h-3 w-3" />
          <span>Approved {timeAgo(epic.approvedAt)}</span>
        </div>
        <span className="text-[10px] text-[#6B7280] font-mono">{epic.batchName}</span>
      </div>
    </div>
  );
}

export function ReleaseBoard() {
  const { state } = useFactory();
  const { releaseBoard } = state;

  const sortedEpics = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...releaseBoard.epics].sort((a, b) => order[a.priority] - order[b.priority]);
  }, [releaseBoard.epics]);

  const totals = useMemo(() => ({
    stories: releaseBoard.epics.reduce((s, e) => s + e.storiesCompleted, 0),
    additions: releaseBoard.epics.reduce((s, e) => s + e.totalAdditions, 0),
    deletions: releaseBoard.epics.reduce((s, e) => s + e.totalDeletions, 0),
    cost: releaseBoard.epics.reduce((s, e) => s + e.cost, 0),
  }), [releaseBoard.epics]);

  const hasCritical = sortedEpics.some((e) => e.priority === 'critical');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
              <Rocket className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-foreground font-semibold text-base">Release Board</h2>
              <p className="text-muted-foreground text-xs">
                {releaseBoard.epics.length} epic{releaseBoard.epics.length !== 1 ? 's' : ''} ready for production
              </p>
            </div>
          </div>

          <Button
            className="bg-cyan-600 hover:bg-cyan-500 text-white gap-2"
            disabled={releaseBoard.epics.length === 0}
          >
            <Rocket className="h-4 w-4" />
            Trigger Release
          </Button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg bg-background border border-border p-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">Epics</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{releaseBoard.epics.length}</p>
          </div>
          <div className="rounded-lg bg-background border border-border p-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">Stories</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{totals.stories}</p>
          </div>
          <div className="rounded-lg bg-background border border-border p-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">Changes</p>
            <p className="text-xl font-bold tabular-nums">
              <span className="text-emerald-400">+{totals.additions}</span>
              <span className="text-[#6B7280] text-sm"> / </span>
              <span className="text-red-400">-{totals.deletions}</span>
            </p>
          </div>
          <div className="rounded-lg bg-background border border-border p-3">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">Total Cost</p>
            <p className="text-xl font-bold text-foreground tabular-nums">${totals.cost.toFixed(2)}</p>
          </div>
        </div>

        {/* Alert if critical epic */}
        {hasCritical && (
          <div className="flex items-center gap-2 mt-4 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-400">Critical priority epic waiting for release</span>
          </div>
        )}

        {/* Release info */}
        <div className="flex items-center gap-4 mt-4 text-xs text-[#6B7280]">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            <span>Trigger: <span className="text-foreground capitalize">{releaseBoard.triggerMode}</span></span>
          </div>
          {releaseBoard.lastReleasedAt && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Last release: <span className="text-foreground">{formatDate(releaseBoard.lastReleasedAt)}</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Epic cards */}
      {sortedEpics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Package className="h-8 w-8 text-[#6B7280] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No epics waiting for release</p>
          <p className="text-xs text-[#6B7280] mt-1">Epics will appear here after passing Staging approval</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedEpics.map((epic) => (
            <EpicCard key={epic.id} epic={epic} />
          ))}
        </div>
      )}
    </div>
  );
}
