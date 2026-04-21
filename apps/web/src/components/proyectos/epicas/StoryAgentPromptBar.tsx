'use client';

import { useMemo } from 'react';
import { PromptInput } from '../overview/agent-thinking/PromptInput';
import { AgentThinkingDisplay } from '../overview/agent-thinking/AgentThinkingDisplay';
import type { EpicGenerationEvent, StoryGenerationEvent, StoryGenerationPhase } from '@cenzontle/shared';

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

/**
 * Mapea los phases especificos del agente de historias (drafting_po/_technical/_qa)
 * al enum de phases de epicas que el AgentThinkingDisplay reutilizado entiende.
 * El componente solo usa `currentPhase` para rotular la barra de progreso; asi
 * podemos reusarlo sin duplicar todo el subsistema de thinking UI.
 */
function mapStoryPhaseToEpicPhase(phase: StoryGenerationPhase): 'idle' | 'researching' | 'analyzing' | 'proposing' | 'done' {
  switch (phase) {
    case 'drafting_po':
    case 'drafting_technical':
    case 'drafting_qa':
      return 'analyzing';
    default:
      return phase;
  }
}

function adaptEvent(event: StoryGenerationEvent): EpicGenerationEvent {
  if (event.type === 'phase_change') {
    return {
      type: 'phase_change',
      phase: mapStoryPhaseToEpicPhase(event.phase),
      label: event.label,
      timestamp: event.timestamp,
    };
  }
  // Para proposal_ready el AgentThinkingDisplay lo ignora (hace `break`),
  // asi que basta con dar un objeto dummy con shape de EpicGenerationEvent.
  if (event.type === 'proposal_ready') {
    return { type: 'done', timestamp: event.timestamp };
  }
  // El resto de los tipos tienen shape identico, descartamos el `role` opcional.
  // Usamos un cast controlado en lugar de estructurar campo por campo.
  const { role: _role, ...rest } = event as typeof event & { role?: unknown };
  return rest as unknown as EpicGenerationEvent;
}

export function StoryAgentPromptBar({ mode, events, onSubmit, onCancel }: StoryAgentPromptBarProps) {
  const adaptedEvents = useMemo(() => events.map(adaptEvent), [events]);

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

  return <AgentThinkingDisplay events={adaptedEvents} isStreaming={mode === 'streaming'} onCancel={onCancel} />;
}
