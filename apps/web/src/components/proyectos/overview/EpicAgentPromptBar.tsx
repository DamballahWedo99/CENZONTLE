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
    // Defaults paralelos al StoryAgentPromptBar:
    //  - Modo Auto ON: el agente decide el foco sin instrucciones manuales
    //  - Búsqueda en internet ON: enriquece contexto con fuentes externas
    return (
      <PromptInput
        onSubmit={onSubmit}
        onCancel={onCancel}
        showAutoToggle
        defaultAuto={true}
        defaultWebSearch={true}
      />
    );
  }

  return <AgentThinkingDisplay events={events} isStreaming={mode === 'streaming'} onCancel={onCancel} />;
}
