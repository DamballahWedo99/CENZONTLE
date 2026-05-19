'use client';

import { useCallback } from 'react';
import { Clock, Zap, DollarSign, FileDiff, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { deriveDod } from './AgentDetailDrawer';

// === PROPS ===

export interface AgentCardProps {
  agent: FactoryAgent;
  isSelected?: boolean;
  onClick?: () => void;
  onInfoClick?: () => void;
}

// === STATUS CONFIG ===

interface StatusConfig {
  label: string;
  bg: string;
  text: string;
  border: string;
  pulse: boolean;
}

const STATUS_MAP: Record<AgentStatus, StatusConfig> = {
  [AgentStatus.Idle]: {
    label: 'Idle',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    pulse: false,
  },
  [AgentStatus.Coding]: {
    label: 'Coding',
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/60',
    pulse: true,
  },
  [AgentStatus.Testing]: {
    label: 'Testing',
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    border: 'border-amber-500/60',
    pulse: false,
  },
  [AgentStatus.CreatingPR]: {
    label: 'Creating PR',
    bg: 'bg-cyan-500/20',
    text: 'text-cyan-400',
    border: 'border-cyan-500/60',
    pulse: false,
  },
  [AgentStatus.InReview]: {
    label: 'In Review',
    bg: 'bg-cyan-500/20',
    text: 'text-cyan-400',
    border: 'border-cyan-500/60',
    pulse: false,
  },
  [AgentStatus.Rejected]: {
    label: 'Rejected',
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/60',
    pulse: false,
  },
  [AgentStatus.Done]: {
    label: 'Done',
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/60',
    pulse: false,
  },
  [AgentStatus.Error]: {
    label: 'Error',
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/60',
    pulse: false,
  },
};

// === FORMATTERS ===

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins.toString().padStart(2, '0')}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const m = tokens / 1_000_000;
  return `${m.toFixed(1).replace(/\.0$/, '')}M`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

// === SUBCOMPONENTS ===

function StatusPill({ status, retryCount }: { status: AgentStatus; retryCount?: number }) {
  const config = STATUS_MAP[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
          config.bg,
          config.text,
          config.pulse && 'animate-pulse',
        )}
        role="status"
        aria-label={`Agent status: ${config.label}`}
      >
        {config.label}
      </span>
      {status === AgentStatus.Rejected && retryCount !== undefined && retryCount > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/30 px-1 text-[10px] font-semibold text-red-400"
          aria-label={`${retryCount} retries`}
        >
          {retryCount}
        </span>
      )}
    </span>
  );
}

function MetricItem({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" aria-label={`${label}: ${value}`}>
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}

// === MAIN COMPONENT ===

export function AgentCard({ agent, isSelected = false, onClick, onInfoClick }: AgentCardProps) {
  const config = STATUS_MAP[agent.status];
  const isActive = agent.status !== AgentStatus.Idle && agent.status !== AgentStatus.Done;

  const handleClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
      }
    },
    [onClick],
  );

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border bg-card p-3.5 transition-all duration-200',
        'border-border',
        'hover:border-border hover:shadow-sm',
        isSelected && 'scale-[1.02] border-opacity-100 shadow-md',
        isSelected && config.border,
        isActive && !isSelected && 'border-border',
        onClick && 'cursor-pointer',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      aria-pressed={onClick ? isSelected : undefined}
      aria-label={`${agent.name}, status: ${config.label}`}
    >
      {/* Header: name + info button + status pill */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{agent.name}</h3>
          <button
            onClick={(e) => { e.stopPropagation(); onInfoClick?.(); }}
            className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Agent details"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
        <StatusPill status={agent.status} />
      </div>

      {/* Metrics row — 4 KPIs: tiempo, tokens new, cost, archivos del diff.
          filesModified=null se muestra como "—" (sandbox mode o run sin push). */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <MetricItem icon={Clock} value={formatDuration(agent.duration)} label="Duration" />
        <MetricItem icon={Zap} value={formatTokens(agent.tokens)} label="Tokens" />
        <MetricItem icon={DollarSign} value={formatCost(agent.cost)} label="Cost" />
        <MetricItem
          icon={FileDiff}
          value={
            agent.filesModified !== null && agent.filesModified !== undefined
              ? `${agent.filesModified}`
              : '—'
          }
          label="files"
        />
      </div>

      {/* DoD checkpoints */}
      <div className="mt-2 flex items-center gap-2">
        {deriveDod(agent).map((c, i) => (
          <div key={i} className="flex items-center gap-1 min-w-0">
            {c.done ? (
              <svg className="h-2.5 w-2.5 shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <div className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/30" />
            )}
            <span className={cn('text-[10px] truncate', c.done ? 'text-muted-foreground' : 'text-muted-foreground/40')}>
              {c.text}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}
