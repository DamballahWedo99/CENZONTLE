'use client';

import { useState, useEffect } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import type { ThinkingState } from '@/hooks/useAgentThinkingState';

interface ThinkingHeaderProps {
  state: ThinkingState;
  isOpen: boolean;
  isStreaming: boolean;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ThinkingHeader({ state, isOpen, isStreaming }: ThinkingHeaderProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !state.runStartedAt) {
      if (state.totalDurationMs) setElapsed(state.totalDurationMs);
      return;
    }
    const start = state.runStartedAt;
    setElapsed(Date.now() - start);
    const interval = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(interval);
  }, [isStreaming, state.runStartedAt, state.totalDurationMs]);

  const isDone = state.currentPhase === 'done';

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        {isStreaming && !isDone ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        )}

        <span className="text-xs font-medium text-foreground">
          {isStreaming && !isDone
            ? state.phaseLabel || 'Generando épicas…'
            : `Cadena de pensamiento (${state.toolCount} herramientas)`}
        </span>

        {elapsed > 0 && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      <ChevronDown
        className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
          isOpen ? '' : '-rotate-90'
        }`}
      />
    </div>
  );
}
