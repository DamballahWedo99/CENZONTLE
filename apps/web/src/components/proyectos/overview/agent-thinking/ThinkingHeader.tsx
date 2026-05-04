'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ThinkingState } from '@/hooks/useAgentThinkingState';

interface ThinkingHeaderProps {
  state: ThinkingState;
  isOpen: boolean;
  isStreaming: boolean;
  /**
   * Override opcional del `totalDurationMs` del hook. Útil cuando el hook
   * sub-estima la duración porque los events del slice no incluyen un
   * `run_finished` propio (caso típico: sub-agentes filtrados por rol en
   * `StoryThinkingTimeline`, donde el `run_finished` es global, no per-rol).
   * Si está definido y `!isStreaming`, prevalece sobre el valor calculado
   * por el hook (`state.totalDurationMs`).
   */
  overrideDurationMs?: number | null;
  /**
   * Label que se muestra cuando el agente terminó, en lugar del genérico
   * "Cadena de pensamiento". El caller (que sabe qué rol está renderizando)
   * pasa algo concreto como "Diseño técnico generado", "Outline de producto
   * emitido", etc. Default: "Cadena de pensamiento" para retrocompat.
   */
  finishedLabel?: string;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function ThinkingHeader({
  state,
  isOpen,
  isStreaming,
  overrideDurationMs,
  finishedLabel,
}: ThinkingHeaderProps) {
  // `now` se actualiza cada 500ms mientras el agente está streaming. El
  // `elapsed` final se DERIVA (no es state) para evitar que cambios en
  // `state.totalDurationMs` (que muta con cada event llegado por el
  // fallback en processEvents) reseteen el interval. Sin esta separación,
  // el interval se cancelaba y recreaba con cada event SSE, haciendo que
  // el contador "salte" en lugar de tickear suavemente.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // El interval depende SOLO de isStreaming + runStartedAt, NO de
    // totalDurationMs. Updates cada 500ms para que el ticking se vea fluido.
    if (!isStreaming || !state.runStartedAt) return;
    setNow(Date.now()); // refresh inmediato al activarse
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [isStreaming, state.runStartedAt]);

  // Elapsed derivado:
  //  - Si está activo: tiempo desde runStartedAt hasta now (tick cada 500ms).
  //  - Si terminó: prioridad de fuentes:
  //      1. `overrideDurationMs` si el caller lo provee (caso sub-agentes
  //         del StoryThinkingTimeline, donde el hook sub-estima porque no
  //         hay run_finished per-rol).
  //      2. `state.totalDurationMs` del hook (run_finished propio recibido).
  //      3. Fallback: now - runStartedAt (last-resort si nada lo setea).
  //  - Edge case sin runStartedAt: 0 (chip oculto).
  let elapsed = 0;
  let elapsedSource: 'tick' | 'override' | 'totalDurationMs' | 'fallback' | 'none' = 'none';
  if (state.runStartedAt !== null) {
    if (isStreaming) {
      elapsed = Math.max(0, now - state.runStartedAt);
      elapsedSource = 'tick';
    } else if (overrideDurationMs !== undefined && overrideDurationMs !== null) {
      elapsed = overrideDurationMs;
      elapsedSource = 'override';
    } else if (state.totalDurationMs !== null) {
      elapsed = state.totalDurationMs;
      elapsedSource = 'totalDurationMs';
    } else {
      elapsed = Math.max(0, now - state.runStartedAt);
      elapsedSource = 'fallback';
    }
  }

  const isDone = state.currentPhase === 'done';
  const isFinished = !isStreaming || isDone;

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        {isStreaming && !isDone ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        ) : (
          // Dot verde estático cuando el agente terminó: misma forma que el
          // dot azul pulsante pero sin animación, para comunicar "completado
          // exitosamente" de forma visualmente equivalente. Sustituye al
          // ícono Sparkles previo (más decorativo y menos consistente con
          // el indicador de estado activo).
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}

        {/* Label: durante el streaming muestra el `phaseLabel` dinámico
            emitido por el agente (ej. "Investigando", "Analizando",
            "Generando…"); cuando el run terminó muestra el `finishedLabel`
            específico del rol (ej. "Diseño técnico generado") + un sufijo
            de "(N herramientas)" más sutil si se usaron tools. Si el caller
            no provee finishedLabel, fallback al genérico anterior. */}
        <span className="text-xs font-medium text-foreground">
          {isFinished ? (
            <>
              {finishedLabel ?? 'Cadena de pensamiento'}
              {state.toolCount > 0 && (
                <span className="font-normal text-muted-foreground/80">
                  {` · ${state.toolCount} ${state.toolCount === 1 ? 'herramienta' : 'herramientas'}`}
                </span>
              )}
            </>
          ) : (
            state.phaseLabel || 'Generando…'
          )}
        </span>

        {/* Chip del tiempo: muted en vivo (no distrae del contenido streaming),
            más visible cuando el run terminó (info principal del run). El
            separador `·` siempre lo une al label de la izquierda. */}
        {elapsed > 0 && (
          <span
            className={`tabular-nums ${
              isFinished
                ? 'text-xs text-muted-foreground font-medium'
                : 'text-[10px] text-muted-foreground/60'
            }`}
            aria-label={`Duración del agente: ${formatElapsed(elapsed)}`}
          >
            {`· ${formatElapsed(elapsed)}`}
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
