'use client';

import { useRef, useEffect } from 'react';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import type { ThinkingDisplayBlock } from '@/hooks/useAgentThinkingState';

interface ThinkingContentProps {
  blocks: ThinkingDisplayBlock[];
  isStreaming: boolean;
}

export function ThinkingContent({ blocks, isStreaming }: ThinkingContentProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [blocks.length, isStreaming]);

  if (blocks.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground/60">
        <span className="animate-[agent-pulse_2s_ease-in-out_infinite]">Iniciando agente...</span>
      </div>
    );
  }

  return (
    <div className="relative max-h-96 overflow-y-auto space-y-2 py-2 [mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)]">
      {blocks.map((block) => {
        if (block.kind === 'thinking') {
          return (
            <ThinkingBlock key={block.id} text={block.text} isActive={block.isActive} />
          );
        }
        return (
          <ToolCallCard
            key={block.id}
            tool={block.tool}
            label={block.label}
            status={block.status}
            argsPreview={block.argsPreview}
            summary={block.summary}
            resultPreview={block.resultPreview}
            durationMs={block.durationMs}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
