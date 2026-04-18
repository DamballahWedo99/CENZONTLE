'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useAgentThinkingState } from '@/hooks/useAgentThinkingState';
import { ThinkingHeader } from './ThinkingHeader';
import { ThinkingContent } from './ThinkingContent';
import { PhaseProgressBar } from './PhaseProgressBar';
import type { EpicGenerationEvent } from '@cenzontle/shared';

interface AgentThinkingDisplayProps {
  events: EpicGenerationEvent[];
  isStreaming: boolean;
  onCancel?: () => void;
}

export function AgentThinkingDisplay({ events, isStreaming, onCancel }: AgentThinkingDisplayProps) {
  const state = useAgentThinkingState(events);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
      return;
    }
    if (state.currentPhase === 'done') {
      const timer = setTimeout(() => setOpen(false), 600);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, state.currentPhase]);

  const showCancel = isStreaming && state.currentPhase !== 'done' && !!onCancel;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-primary/20 bg-primary/[0.02] overflow-hidden">
        <div className="flex items-center w-full">
          <CollapsibleTrigger className="flex-1 px-4 py-2.5 hover:bg-primary/[0.03] transition-colors cursor-pointer text-left">
            <ThinkingHeader state={state} isOpen={open} isStreaming={isStreaming} />
          </CollapsibleTrigger>

          {showCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onCancel!(); }}
              className="h-6 text-[10px] gap-1 text-muted-foreground shrink-0 mr-3"
            >
              <X className="h-3 w-3" />
              Cancelar
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="px-4 pb-3 border-t border-primary/10 space-y-3">
            <ThinkingContent blocks={state.blocks} isStreaming={isStreaming} />
            <PhaseProgressBar currentPhase={state.currentPhase} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
