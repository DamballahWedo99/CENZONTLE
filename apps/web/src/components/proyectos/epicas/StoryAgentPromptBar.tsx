'use client';

import { PromptInput } from '../overview/agent-thinking/PromptInput';
import { StoryThinkingTimeline } from './StoryThinkingTimeline';
import type { StoryGenerationEvent } from '@cenzontle/shared';

interface StoryAgentPromptBarProps {
  /**
   * - 'prompting' → muestra el input para escribir prompt + flags
   * - 'streaming' → muestra cadena de pensamiento en vivo, con boton cancelar
   * - 'staging'   → muestra cadena de pensamiento finalizada (collapsable, sin
   *                 boton cancelar) para que el usuario pueda revisar el reasoning
   *                 mientras revisa las propuestas
   */
  mode: 'prompting' | 'streaming' | 'staging';
  events: StoryGenerationEvent[];
  onSubmit: (prompt: string, webSearch: boolean) => void;
  onCancel: () => void;
}

export function StoryAgentPromptBar({ mode, events, onSubmit, onCancel }: StoryAgentPromptBarProps) {
  if (mode === 'prompting') {
    // Defaults especificos del agente de historias:
    //  - Modo Auto ON: el agente decide foco sin prompt manual (textarea bloqueado)
    //  - Busqueda en internet ON: aprovecha el contexto externo para enriquecer historias
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

  // Timeline multi-agente: render UNA cadena por sub-agente (PO / TL / QA).
  // Reemplaza el AgentThinkingDisplay único previo donde los 3 agentes
  // se mezclaban en una sola lista difícil de seguir.
  return <StoryThinkingTimeline events={events} isStreaming={mode === 'streaming'} onCancel={onCancel} />;
}
