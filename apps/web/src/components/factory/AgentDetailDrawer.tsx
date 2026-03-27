'use client';

import { useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { FactoryAgent, FactoryStory, SprintBatch } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import {
  X,
  Bot,
  GitBranch,
  FolderOpen,
  Clock,
  Zap,
  DollarSign,
  FileCode2,
  TestTube2,
  CheckCircle2,
  Circle,
  Layers,
  Link2,
  RefreshCw,
  Target,
  TrendingUp,
  Activity,
  Terminal,
  Cpu,
  BookOpen,
  Hash,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// =============================================================================
// Props
// =============================================================================

export interface AgentDetailDrawerProps {
  agent: FactoryAgent;
  story: FactoryStory | null;
  batch: SprintBatch | null;
  open: boolean;
  onClose: () => void;
}

// =============================================================================
// Status config — mirrored from AgentCard for consistency
// =============================================================================

interface StatusConfig {
  label: string;
  bg: string;
  text: string;
  dot: string;
}

const STATUS_MAP: Record<AgentStatus, StatusConfig> = {
  [AgentStatus.Idle]: {
    label: 'Idle',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  [AgentStatus.Coding]: {
    label: 'Coding',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
  [AgentStatus.Testing]: {
    label: 'Testing',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  [AgentStatus.CreatingPR]: {
    label: 'Creating PR',
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    dot: 'bg-purple-400',
  },
  [AgentStatus.InReview]: {
    label: 'In Review',
    bg: 'bg-fuchsia-500/15',
    text: 'text-fuchsia-400',
    dot: 'bg-fuchsia-400',
  },
  [AgentStatus.Rejected]: {
    label: 'Rejected',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  [AgentStatus.Done]: {
    label: 'Done',
    bg: 'bg-green-500/15',
    text: 'text-green-400',
    dot: 'bg-green-500',
  },
  [AgentStatus.Error]: {
    label: 'Error',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    dot: 'bg-red-500',
  },
};

// =============================================================================
// Formatters
// =============================================================================

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins.toString().padStart(2, '0')}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) {
    const k = tokens / 1_000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const m = tokens / 1_000_000;
  return `${m.toFixed(1).replace(/\.0$/, '')}M`;
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusPill({ status }: { status: AgentStatus }) {
  const cfg = STATUS_MAP[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        cfg.bg,
        cfg.text,
      )}
      role="status"
      aria-label={`Agent status: ${cfg.label}`}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)}
        aria-hidden="true"
      />
      {cfg.label}
    </span>
  );
}

// A single metric card in the 2-column grid
function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
      </div>
      <span className={cn('text-base font-semibold leading-none text-foreground', valueClass)}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px] text-muted-foreground/60 leading-none">{sub}</span>
      )}
    </div>
  );
}

// A horizontal gauge bar with label + value
function GaugeBar({
  label,
  value,
  max,
  unit,
  colorClass,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  colorClass: string;
}) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-medium text-foreground">
          {Number.isFinite(value) ? value.toFixed(2) : '—'}{' '}
          <span className="text-muted-foreground/60">{unit}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colorClass)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={`${label}: ${value} ${unit}`}
        />
      </div>
    </div>
  );
}

// Success criteria checklist item
function CriteriaItem({
  text,
  done,
}: {
  text: string;
  done: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CheckCircle2
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400"
          aria-hidden="true"
        />
      ) : (
        <Circle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          'text-xs leading-relaxed',
          done ? 'text-muted-foreground line-through' : 'text-foreground/80',
        )}
      >
        {text}
      </span>
    </li>
  );
}

// =============================================================================
// Success criteria derivation helpers
// =============================================================================

export function deriveSuccessCriteria(agent: FactoryAgent): { text: string; done: boolean }[] {
  const isDone = agent.status === AgentStatus.Done;
  const isAtLeastPR =
    agent.status === AgentStatus.CreatingPR ||
    agent.status === AgentStatus.InReview ||
    agent.status === AgentStatus.Done;
  const isAtLeastTesting =
    agent.status === AgentStatus.Testing ||
    isAtLeastPR;
  const testPassRate =
    agent.testsRun > 0 ? agent.testsPassed / agent.testsRun : 0;
  const testsPassed = isAtLeastTesting && testPassRate >= 0.9;

  return [
    {
      text: 'All code written and files created',
      done: agent.linesWritten > 0 && isAtLeastTesting,
    },
    {
      text: 'Tests passing (≥ 90% coverage)',
      done: testsPassed,
    },
    {
      text: 'PR created and approved',
      done: isAtLeastPR && isDone,
    },
    {
      text: 'No lint/typecheck errors',
      done: isDone,
    },
  ];
}

// =============================================================================
// Mission sentence derivation
// =============================================================================

function deriveMission(story: FactoryStory | null, agent: FactoryAgent): string {
  if (story) {
    // Use title + description if available
    const base = story.description.trim();
    if (base.length > 0) {
      // Capitalise and ensure it ends with a period
      const sentence = base.charAt(0).toUpperCase() + base.slice(1);
      return sentence.endsWith('.') ? sentence : `${sentence}.`;
    }
    return story.title;
  }
  return `Execute assigned story for agent ${agent.name}.`;
}

// =============================================================================
// Main component
// =============================================================================

export function AgentDetailDrawer({
  agent,
  story,
  batch,
  open,
  onClose,
}: AgentDetailDrawerProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    },
    [open, onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Derived values
  const statusCfg = STATUS_MAP[agent.status];
  const criteria = deriveSuccessCriteria(agent);
  const mission = deriveMission(story, agent);

  const testPassRate =
    agent.testsRun > 0
      ? Math.round((agent.testsPassed / agent.testsRun) * 100)
      : 0;

  const testPassRateClass =
    testPassRate >= 90
      ? 'text-green-400'
      : testPassRate >= 70
        ? 'text-amber-400'
        : 'text-red-400';

  const linesPerMinute =
    agent.duration > 0 ? agent.linesWritten / (agent.duration / 60) : 0;

  const costPerPoint =
    story && story.storyPoints > 0 ? agent.cost / story.storyPoints : 0;

  // Gauge: cost efficiency — normalise against a "good" baseline of $0.50 / point
  const costEfficiencyPct = costPerPoint > 0
    ? Math.max(0, 100 - (costPerPoint / 0.5) * 100)
    : 100;

  // Gauge: speed — normalise against 10 lines/min as a good pace
  const speedPct = Math.min(100, (linesPerMinute / 10) * 100);

  const worktreePath = agent.worktree.startsWith('/worktrees/')
    ? agent.worktree
    : `/worktrees/${agent.storyKey?.toLowerCase() ?? agent.id}`;

  const branchName = batch?.branch ?? `forge/${agent.id}`;

  // Dependencies: get jiraKeys from dependsOn story IDs when possible
  const dependencyLabels: string[] = story?.dependsOn ?? [];

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

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col bg-card border-l border-border shadow-2xl',
          'transform transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={`Agent details: ${agent.name}`}
      >
        {/* ----------------------------------------------------------------- */}
        {/* Header                                                              */}
        {/* ----------------------------------------------------------------- */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-foreground">{agent.name}</h2>
                </div>
                <StatusPill status={agent.status} />
                {(agent.storyKey ?? story?.jiraKey) && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {agent.storyKey ?? story?.jiraKey}
                  </span>
                )}
              </div>
              {story && (
                <p className="mt-1.5 text-xs text-muted-foreground leading-snug line-clamp-2">
                  Working on:{' '}
                  <span className="text-foreground/80">{story.title}</span>
                </p>
              )}
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close agent details"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Scrollable body                                                     */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-5 py-4">

            {/* ------------------------------------------------------------- */}
            {/* 1. Identity Card                                                */}
            {/* ------------------------------------------------------------- */}
            <section aria-labelledby="section-identity">
              <h3
                id="section-identity"
                className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70"
              >
                <Cpu className="h-3 w-3" aria-hidden="true" />
                Identity
              </h3>

              <div className="rounded-lg border border-border bg-[#0d1117] p-4 space-y-4">
                {/* Agent ID row */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground/60">Agent ID</span>
                  <span className="font-mono text-xs text-foreground/90">{agent.id}</span>
                </div>

                {/* Mission */}
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground/60">Mission</span>
                  <p className="text-xs text-foreground/85 leading-relaxed">{mission}</p>
                </div>

                {/* Git branch */}
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground/60 shrink-0">
                    <GitBranch className="h-3 w-3" aria-hidden="true" />
                    Branch
                  </span>
                  <span className="font-mono text-[11px] text-foreground/80 text-right break-all">
                    {branchName}
                  </span>
                </div>

                {/* Worktree */}
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground/60 shrink-0">
                    <FolderOpen className="h-3 w-3" aria-hidden="true" />
                    Worktree
                  </span>
                  <span className="font-mono text-[11px] text-foreground/80 text-right break-all">
                    {worktreePath}
                  </span>
                </div>
              </div>
            </section>

            {/* ------------------------------------------------------------- */}
            {/* 2. Context Card                                                 */}
            {/* ------------------------------------------------------------- */}
            <section aria-labelledby="section-context">
              <h3
                id="section-context"
                className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70"
              >
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                Context
              </h3>

              <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border">
                {/* Epic */}
                {batch && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                      <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="shrink-0">Epic</span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 justify-end">
                      <span className="text-xs text-foreground/85 truncate">
                        {batch.epicTitle}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {batch.jiraKey}
                      </span>
                    </div>
                  </div>
                )}

                {/* Story */}
                {story && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="shrink-0">Story</span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 justify-end">
                      <span className="text-xs text-foreground/85 truncate">
                        {story.title}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {story.jiraKey}
                      </span>
                      <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                        {story.storyPoints} pts
                      </span>
                    </div>
                  </div>
                )}

                {/* Wave */}
                {story && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Hash className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Wave</span>
                    </div>
                    <span className="text-xs font-medium text-foreground">
                      #{story.waveNumber}
                    </span>
                  </div>
                )}

                {/* Dependencies */}
                {story && (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                      <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Depends on</span>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {dependencyLabels.length > 0 ? (
                        dependencyLabels.map((dep) => (
                          <span
                            key={dep}
                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {dep}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/50">none</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Retries */}
                {story && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCw className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Retries</span>
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        story.retryCount > 0 ? 'text-amber-400' : 'text-muted-foreground',
                      )}
                    >
                      {story.retryCount}/{story.maxRetries}
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* ------------------------------------------------------------- */}
            {/* 3. Performance Metrics Grid                                     */}
            {/* ------------------------------------------------------------- */}
            <section aria-labelledby="section-metrics">
              <h3
                id="section-metrics"
                className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70"
              >
                <Activity className="h-3 w-3" aria-hidden="true" />
                Performance
              </h3>

              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  icon={Clock}
                  label="Duration"
                  value={formatDuration(agent.duration)}
                />
                <MetricCard
                  icon={Zap}
                  label="Tokens"
                  value={formatTokens(agent.tokens)}
                />
                <MetricCard
                  icon={DollarSign}
                  label="Cost"
                  value={`$${agent.cost.toFixed(2)}`}
                />
                <MetricCard
                  icon={FileCode2}
                  label="Lines Written"
                  value={String(agent.linesWritten)}
                />
                <MetricCard
                  icon={TestTube2}
                  label="Tests"
                  value={`${agent.testsPassed}/${agent.testsRun}`}
                  sub={agent.testsRun > 0 ? `${testPassRate}% pass rate` : undefined}
                />
                <MetricCard
                  icon={Target}
                  label="Test Pass Rate"
                  value={agent.testsRun > 0 ? `${testPassRate}%` : '—'}
                  valueClass={agent.testsRun > 0 ? testPassRateClass : undefined}
                />
                <MetricCard
                  icon={FileCode2}
                  label="Current File"
                  value={agent.currentFile ? agent.currentFile.split('/').pop() ?? '—' : 'none'}
                  sub={agent.currentFile ?? undefined}
                />
                <MetricCard
                  icon={Bot}
                  label="Status"
                  value={STATUS_MAP[agent.status].label}
                  valueClass={STATUS_MAP[agent.status].text}
                />
              </div>
            </section>

            {/* ------------------------------------------------------------- */}
            {/* 4. Efficiency Gauges                                            */}
            {/* ------------------------------------------------------------- */}
            <section aria-labelledby="section-efficiency">
              <h3
                id="section-efficiency"
                className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70"
              >
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                Efficiency
              </h3>

              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3.5 space-y-3.5">
                {story && story.storyPoints > 0 && (
                  <GaugeBar
                    label="Cost efficiency"
                    value={costPerPoint}
                    max={0.5}
                    unit="$/pt"
                    colorClass={
                      costPerPoint <= 0.2
                        ? 'bg-green-500'
                        : costPerPoint <= 0.4
                          ? 'bg-amber-400'
                          : 'bg-red-500'
                    }
                  />
                )}

                <GaugeBar
                  label="Speed"
                  value={parseFloat(linesPerMinute.toFixed(2))}
                  max={10}
                  unit="lines/min"
                  colorClass={
                    linesPerMinute >= 7
                      ? 'bg-green-500'
                      : linesPerMinute >= 3
                        ? 'bg-blue-400'
                        : 'bg-muted-foreground/40'
                  }
                />

                <GaugeBar
                  label="Quality"
                  value={testPassRate}
                  max={100}
                  unit="%"
                  colorClass={
                    testPassRate >= 90
                      ? 'bg-green-500'
                      : testPassRate >= 70
                        ? 'bg-amber-400'
                        : 'bg-red-500'
                  }
                />
              </div>
            </section>


            {/* Bottom padding so last section isn't flush with edge */}
            <div className="h-2" aria-hidden="true" />
          </div>
        </div>
      </div>
    </>
  );
}
