'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { FactoryAgent } from '@cenzontle/shared';
import { AgentStatus } from '@cenzontle/shared';
import { X, Circle, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTerminal } from '@/hooks/use-agent-terminal';

interface AgentTerminalProps {
  agent: FactoryAgent;
  onClose: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'text-muted-foreground/70',
  [AgentStatus.Coding]: 'text-blue-400',
  [AgentStatus.Testing]: 'text-amber-400',
  [AgentStatus.CreatingPR]: 'text-purple-400',
  [AgentStatus.InReview]: 'text-fuchsia-400',
  [AgentStatus.Rejected]: 'text-red-400',
  [AgentStatus.Done]: 'text-green-400',
  [AgentStatus.Error]: 'text-red-400',
};

const statusLabels: Record<AgentStatus, string> = {
  [AgentStatus.Idle]: 'Idle',
  [AgentStatus.Coding]: 'Coding',
  [AgentStatus.Testing]: 'Testing',
  [AgentStatus.CreatingPR]: 'Creating PR',
  [AgentStatus.InReview]: 'In Review',
  [AgentStatus.Rejected]: 'Rejected',
  [AgentStatus.Done]: 'Done',
  [AgentStatus.Error]: 'Error',
};

export function AgentTerminal({ agent, onClose }: AgentTerminalProps) {
  const { ttydUrl, sessionActive, loading, error, startSession } = useAgentTerminal(agent.id);

  const defaultWorkdir = agent.worktree.startsWith('/worktrees/')
    ? process.env.NEXT_PUBLIC_PROJECT_ROOT || '.'
    : agent.worktree;

  useEffect(() => {
    if (!sessionActive && !loading && !ttydUrl) {
      startSession(defaultWorkdir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden flex flex-col h-full bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Circle
              className={cn('h-2.5 w-2.5 fill-current shrink-0', statusColors[agent.status])}
            />
            <h3 className="text-sm font-semibold text-foreground truncate">{agent.name}</h3>
            <span
              className={cn(
                'text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
                statusColors[agent.status],
                'bg-current/10',
              )}
            >
              {statusLabels[agent.status]}
            </span>
            {agent.storyKey && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {agent.storyKey}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClose}
            aria-label="Close terminal"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-800/40 text-xs text-red-300 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
          {error}
        </div>
      )}

      {/* Terminal */}
      {ttydUrl ? (
        <iframe
          src={ttydUrl}
          className="flex-1 min-h-0 w-full border-0 bg-[#0d1117]"
          allow="clipboard-read; clipboard-write"
          title={`Terminal — ${agent.name}`}
        />
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0d1117]">
          <Loader2 className="h-6 w-6 animate-spin text-[#484f58]" />
        </div>
      )}
    </div>
  );
}
