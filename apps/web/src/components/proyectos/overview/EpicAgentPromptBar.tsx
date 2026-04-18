'use client';

import { PromptInput } from './agent-thinking/PromptInput';
import { AgentThinkingDisplay } from './agent-thinking/AgentThinkingDisplay';
import type { EpicGenerationEvent } from '@cenzontle/shared';

interface EpicAgentPromptBarProps {
  mode: 'prompting' | 'streaming';
  events: EpicGenerationEvent[];
  onSubmit: (prompt: string, webSearch: boolean) => void;
  onCancel: () => void;
}

export function EpicAgentPromptBar({ mode, events, onSubmit, onCancel }: EpicAgentPromptBarProps) {
  if (mode === 'prompting') {
    return <PromptInput onSubmit={onSubmit} onCancel={onCancel} />;
  }

  return <AgentThinkingDisplay events={events} isStreaming={mode === 'streaming'} onCancel={onCancel} />;
}
