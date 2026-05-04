'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useAgentThinkingState, type AgentThinkingEvent } from '@/hooks/useAgentThinkingState';
import { ThinkingHeader } from './ThinkingHeader';
import { ThinkingContent } from './ThinkingContent';

interface AgentThinkingDisplayProps {
  events: AgentThinkingEvent[];
  isStreaming: boolean;
  onCancel?: () => void;
  /**
   * Override del totalDurationMs cuando el caller tiene info externa de
   * cuánto duró realmente el agente (ej. el siguiente sub-agente ya empezó
   * y su primer event marca el end real del actual). Pasado al ThinkingHeader.
   */
  overrideDurationMs?: number | null;
  /**
   * Estado inicial del Collapsible. Default `true` para mantener compat con
   * consumidores existentes (EpicAgentPromptBar, EpicDiagrams, InitiativeFullPage)
   * donde el comportamiento histórico era empezar abierto. El timeline de
   * stories pasa `false` — el user decide qué expandir, no la UI.
   */
  defaultOpen?: boolean;
  /**
   * Label que se muestra cuando el agente terminó. Pasado tal cual a
   * `ThinkingHeader.finishedLabel`. Sin esto, el header muestra el genérico
   * "Cadena de pensamiento". El caller que conoce el rol del agente lo
   * setea con algo concreto (ej. "Diseño técnico generado").
   */
  finishedLabel?: string;
}

export function AgentThinkingDisplay({
  events,
  isStreaming,
  onCancel,
  overrideDurationMs,
  defaultOpen = true,
  finishedLabel,
}: AgentThinkingDisplayProps) {
  const state = useAgentThinkingState(events);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    // Auto-open durante streaming SOLO si el caller pidió default abierto.
    // Cuando `defaultOpen=false`, el user manda — no se re-abre solo aunque
    // esté streameando. Se mantiene el auto-collapse al 'done' en ambos modos
    // porque refuerza la regla de "default colapsado al terminar".
    if (isStreaming && defaultOpen) {
      setOpen(true);
      return;
    }
    if (state.currentPhase === 'done') {
      const timer = setTimeout(() => setOpen(false), 600);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, state.currentPhase, defaultOpen]);

  const showCancel = isStreaming && state.currentPhase !== 'done' && !!onCancel;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-primary/20 bg-primary/[0.02] overflow-hidden">
        <div className="flex items-center w-full">
          <CollapsibleTrigger className="flex-1 px-4 py-2.5 hover:bg-primary/[0.03] transition-colors cursor-pointer text-left">
            <ThinkingHeader
              state={state}
              isOpen={open}
              isStreaming={isStreaming}
              overrideDurationMs={overrideDurationMs}
              finishedLabel={finishedLabel}
            />
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
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
