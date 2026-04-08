'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { FactoryPR } from '@cenzontle/shared';
import { PRStatus } from '@cenzontle/shared';
import {
  GitPullRequest,
  ExternalLink,
  Bot,
  GitBranch,
  FileCode,
  RotateCcw,
  Clock,
  MessageSquare,
  Check,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

// -- Config -------------------------------------------------------------------

const STATUS_CFG: Record<PRStatus, { label: string; dot: string; bg: string; text: string }> = {
  [PRStatus.Draft]:            { label: 'Draft',     dot: 'bg-gray-400',    bg: 'bg-gray-500/15',    text: 'text-gray-400' },
  [PRStatus.Open]:             { label: 'Open',      dot: 'bg-blue-400',    bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  [PRStatus.InReview]:         { label: 'In Review', dot: 'bg-cyan-400', bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  [PRStatus.ChangesRequested]: { label: 'Changes',   dot: 'bg-amber-400',   bg: 'bg-amber-500/15',   text: 'text-amber-400' },
  [PRStatus.Approved]:         { label: 'Approved',  dot: 'bg-emerald-400', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  [PRStatus.Merged]:           { label: 'Merged',    dot: 'bg-emerald-400', bg: 'bg-emerald-500/80', text: 'text-white' },
  [PRStatus.Closed]:           { label: 'Closed',    dot: 'bg-red-400',     bg: 'bg-red-500/15',     text: 'text-red-400' },
};

const CI_DOT: Record<FactoryPR['ciStatus'], string> = {
  pending: 'bg-gray-400',
  running: 'bg-blue-400 animate-pulse',
  passed:  'bg-emerald-400',
  failed:  'bg-red-400',
};

type StatusFilter = 'all' | PRStatus;

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all',                    label: 'All' },
  { value: PRStatus.Open,            label: 'Open' },
  { value: PRStatus.InReview,        label: 'In Review' },
  { value: PRStatus.ChangesRequested,label: 'Changes' },
  { value: PRStatus.Approved,        label: 'Approved' },
  { value: PRStatus.Merged,          label: 'Merged' },
  { value: PRStatus.Draft,           label: 'Draft' },
];

// -- Helpers ------------------------------------------------------------------

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false });
  } catch {
    return '--';
  }
}

// -- Sub-components -----------------------------------------------------------

function StatsBar({ prs }: { prs: FactoryPR[] }) {
  const counts = useMemo(() => {
    const map: Partial<Record<PRStatus, number>> = {};
    for (const pr of prs) map[pr.status] = (map[pr.status] ?? 0) + 1;
    return map;
  }, [prs]);

  const order: PRStatus[] = [
    PRStatus.Merged, PRStatus.Approved, PRStatus.InReview,
    PRStatus.ChangesRequested, PRStatus.Open, PRStatus.Draft, PRStatus.Closed,
  ];

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-[11px] font-medium text-muted-foreground tabular-nums select-none flex-wrap">
      <span>{prs.length} PRs</span>
      {order.map((s) =>
        counts[s] ? (
          <span key={s} className="flex items-center gap-1">
            <span className="text-border">|</span>
            <span className={cn('h-1.5 w-1.5 rounded-full inline-block', STATUS_CFG[s].dot)} />
            {counts[s]} {STATUS_CFG[s].label.toLowerCase()}
          </span>
        ) : null,
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PRStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none shrink-0', cfg.bg, cfg.text)}>
      {cfg.label}
    </span>
  );
}

function ReviewBlock({ feedback, status }: { feedback: string; status: PRStatus }) {
  const isApproved = status === PRStatus.Approved || status === PRStatus.Merged;
  return (
    <div
      className={cn(
        'mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
        isApproved
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-300',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          {isApproved ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          )}
        </div>
        <div>
          <span className="font-semibold text-[11px] uppercase tracking-wider block mb-0.5">
            Claude Review
          </span>
          <p className="text-foreground/80">{feedback}</p>
        </div>
      </div>
    </div>
  );
}

function PRCard({ pr, agentName }: { pr: FactoryPR; agentName: string }) {
  return (
    <article
      className="border-b border-border px-4 py-3 hover:bg-muted/30 transition-colors"
      aria-label={`Pull request ${pr.number}: ${pr.title}`}
    >
      {/* Line 1: number, title, status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-muted-foreground shrink-0">#{pr.number}</span>
          <span className="text-sm font-semibold text-foreground truncate">{pr.title}</span>
        </div>
        <StatusBadge status={pr.status} />
      </div>

      {/* Line 2: story, agent, branches */}
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground flex-wrap">
        <span className="font-mono">{pr.storyKey}</span>
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <Bot className="h-3 w-3" aria-hidden="true" />
          {agentName}
        </span>
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1 font-mono">
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {pr.branch}
        </span>
        <span>&rarr;</span>
        <span className="font-mono">{pr.targetBranch}</span>
      </div>

      {/* Line 3: diff stats, CI, age, retries */}
      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
        <span className="tabular-nums">
          <span className="text-emerald-400">+{pr.additions}</span>
          <span className="mx-0.5 text-muted-foreground/50">/</span>
          <span className="text-red-400">-{pr.deletions}</span>
        </span>
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <FileCode className="h-3 w-3" aria-hidden="true" />
          {pr.files} files
        </span>
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1">
          CI: <span className={cn('h-2 w-2 rounded-full inline-block', CI_DOT[pr.ciStatus])} aria-label={`CI ${pr.ciStatus}`} />
          {pr.ciStatus}
        </span>
        <span className="text-border">&middot;</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {timeAgo(pr.createdAt)}
        </span>
        {pr.retryCount > 0 && (
          <>
            <span className="text-border">&middot;</span>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {pr.retryCount}
            </span>
          </>
        )}
      </div>

      {/* GitHub link */}
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-muted-foreground/60 cursor-not-allowed"
        aria-label={`View pull request ${pr.number} on GitHub (link disabled in demo)`}
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        Ver en GitHub &rarr;
      </button>

      {/* Claude Review feedback */}
      {pr.reviewFeedback && (
        <ReviewBlock feedback={pr.reviewFeedback} status={pr.status} />
      )}
    </article>
  );
}

// -- Main Component -----------------------------------------------------------

export function PRPipeline() {
  const { state } = useFactory();
  const prs = state.prs;
  const agents = state.agents;

  const [filter, setFilter] = useState<StatusFilter>('all');

  const sorted = useMemo(
    () => [...prs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [prs],
  );

  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((pr) => pr.status === filter)),
    [sorted, filter],
  );

  const totals = useMemo(() => {
    let additions = 0, deletions = 0, files = 0;
    for (const pr of prs) { additions += pr.additions; deletions += pr.deletions; files += pr.files; }
    return { additions, deletions, files };
  }, [prs]);

  const targetBranch = prs[0]?.targetBranch ?? 'forge/sprint-batch';

  const getAgentName = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Pull Requests</h2>
          <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {prs.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>
            <span className="text-emerald-400">+{totals.additions}</span>
            <span className="mx-0.5 text-muted-foreground/50">/</span>
            <span className="text-red-400">-{totals.deletions}</span>
          </span>
          <span className="text-border">|</span>
          <span className="inline-flex items-center gap-1">
            <FileCode className="h-3 w-3" aria-hidden="true" />
            {totals.files} files
          </span>
          <span className="text-border">|</span>
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch className="h-3 w-3" aria-hidden="true" />
            {targetBranch}
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-b border-border bg-background">
        <StatsBar prs={prs} />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider select-none">
          Status
        </span>
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Filter by PR status">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={filter === opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                filter === opt.value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {filter !== 'all' && (
          <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
            {filtered.length} of {prs.length}
          </span>
        )}
      </div>

      {/* PR cards */}
      <div className="flex-1 overflow-y-auto bg-background" role="feed" aria-label="Pull request cards">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
            <MessageSquare className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              {filter === 'all'
                ? 'No pull requests in the current batch.'
                : `No PRs with status "${STATUS_CFG[filter as PRStatus].label}".`}
            </span>
          </div>
        ) : (
          filtered.map((pr) => (
            <PRCard key={pr.id} pr={pr} agentName={getAgentName(pr.agentId)} />
          ))
        )}
      </div>
    </div>
  );
}
