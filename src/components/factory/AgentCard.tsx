'use client';

import { useCallback } from 'react';
import { Clock, Zap, DollarSign, FileCode2, TestTube2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@/types/factory';
import { AgentStatus } from '@/types/factory';

// === PROPS ===

export interface AgentCardProps {
  agent: FactoryAgent;
  isSelected?: boolean;
  onClick?: () => void;
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
    bg: 'bg-zinc-700/40',
    text: 'text-zinc-400',
    border: 'border-zinc-600',
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
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/60',
    pulse: false,
  },
  [AgentStatus.InReview]: {
    label: 'In Review',
    bg: 'bg-fuchsia-500/20',
    text: 'text-fuchsia-400',
    border: 'border-fuchsia-500/60',
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
      <Icon className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="text-xs text-zinc-300">{value}</span>
    </div>
  );
}

function MiniTerminal({ lines }: { lines: string[] }) {
  const visibleLines = lines.slice(-3);
  if (visibleLines.length === 0) {
    return (
      <div
        className="mt-2 rounded bg-[#0A0A0F] px-2.5 py-2 font-mono text-xs text-zinc-600"
        aria-label="Agent terminal output: no output"
        role="log"
      >
        <span className="select-none text-zinc-700">&gt; </span>
        <span className="italic">awaiting output...</span>
      </div>
    );
  }

  return (
    <div
      className="mt-2 overflow-hidden rounded bg-[#0A0A0F] px-2.5 py-2"
      role="log"
      aria-label="Agent terminal output"
    >
      {visibleLines.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 20)}`}
          className="truncate font-mono text-xs leading-relaxed text-green-400"
        >
          <span className="select-none text-zinc-600" aria-hidden="true">&gt; </span>
          {line}
        </div>
      ))}
    </div>
  );
}

// === MAIN COMPONENT ===

export function AgentCard({ agent, isSelected = false, onClick }: AgentCardProps) {
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
        'group relative flex flex-col rounded-lg border bg-[#141419] p-3.5 transition-all duration-200',
        'border-[#2A2A35]',
        'hover:border-zinc-600 hover:shadow-[0_0_12px_rgba(255,255,255,0.03)]',
        isSelected && 'scale-[1.02] border-opacity-100 shadow-[0_0_16px_rgba(255,255,255,0.05)]',
        isSelected && config.border,
        isActive && !isSelected && 'border-[#2A2A35]',
        onClick && 'cursor-pointer',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      aria-pressed={onClick ? isSelected : undefined}
      aria-label={`${agent.name}, status: ${config.label}${agent.storyKey ? `, working on ${agent.storyKey}` : ''}`}
    >
      {/* Header: name + status pill */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-zinc-100">{agent.name}</h3>
        <StatusPill status={agent.status} />
      </div>

      {/* Assignment */}
      <div className="mt-1.5 min-h-[20px]">
        {agent.storyKey ? (
          <p className="truncate text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">{agent.storyKey}</span>
            {agent.currentFile && (
              <span className="text-zinc-500"> &middot; {agent.currentFile.split('/').pop()}</span>
            )}
          </p>
        ) : (
          <p className="text-xs italic text-zinc-600">Idle</p>
        )}
      </div>

      {/* Metrics row */}
      <div className="mt-3 flex items-center gap-3">
        <MetricItem icon={Clock} value={formatDuration(agent.duration)} label="Duration" />
        <MetricItem icon={Zap} value={formatTokens(agent.tokens)} label="Tokens" />
        <MetricItem icon={DollarSign} value={formatCost(agent.cost)} label="Cost" />
      </div>

      {/* Progress indicators */}
      <div className="mt-2.5 flex items-center gap-3">
        <div className="flex items-center gap-1" aria-label={`Lines written: ${agent.linesWritten}`}>
          <FileCode2 className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="text-xs text-zinc-400">
            {agent.linesWritten} <span className="text-zinc-600">lines</span>
          </span>
        </div>
        <div
          className="flex items-center gap-1"
          aria-label={`Tests: ${agent.testsPassed} passed of ${agent.testsRun} run`}
        >
          <TestTube2 className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="text-xs text-zinc-400">
            <span
              className={cn(
                agent.testsRun > 0 && agent.testsPassed === agent.testsRun
                  ? 'text-green-400'
                  : agent.testsRun > 0 && agent.testsPassed < agent.testsRun
                    ? 'text-amber-400'
                    : 'text-zinc-400',
              )}
            >
              {agent.testsPassed}/{agent.testsRun}
            </span>{' '}
            <span className="text-zinc-600">tests</span>
          </span>
        </div>
      </div>

      {/* Mini terminal */}
      <MiniTerminal lines={agent.lastOutput} />
    </div>
  );
}
