import { useMemo } from 'react';
import type { EpicGenerationPhase, DiagramGenerationPhase } from '@cenzontle/shared';
import type { EpicGenerationEventWithMeta } from '@/lib/epic-agent';
import type { DiagramGenerationEventWithMeta } from '@/lib/diagram-agent';

/** Unión de eventos de agentes SSE soportados por este hook de progreso. */
export type AgentThinkingEvent = EpicGenerationEventWithMeta | DiagramGenerationEventWithMeta;

/** Fase agregada del agente — derivada de los tipos del shared package. */
export type AgentPhase = EpicGenerationPhase | DiagramGenerationPhase;

// -- Display block types --

export interface ThinkingBlockData {
  kind: 'thinking';
  id: string;
  text: string;
  isActive: boolean;
}

export interface ToolCallData {
  kind: 'tool_call';
  id: string;
  tool: string;
  label: string;
  status: 'active' | 'done' | 'error';
  args?: Record<string, unknown>;
  argsPreview: string;
  summary?: string;
  resultPreview?: string;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
}

export type ThinkingDisplayBlock = ThinkingBlockData | ToolCallData;

export interface ThinkingState {
  isRunning: boolean;
  runStartedAt: number | null;
  totalDurationMs: number | null;
  currentPhase: AgentPhase;
  phaseLabel: string;
  blocks: ThinkingDisplayBlock[];
  toolCount: number;
  doneToolCount: number;
  error: string | null;
}

// -- Helpers --

// Re-use the canonical TOOL_LABELS from the component module
import { TOOL_LABELS } from '@/components/proyectos/overview/agent-thinking/constants';

function getTimestamp(event: AgentThinkingEvent): number {
  if (event.timestamp) return new Date(event.timestamp).getTime();
  if (event._receivedAt) return new Date(event._receivedAt).getTime();
  return Date.now();
}

function buildArgsPreview(args?: Record<string, unknown>): string {
  if (!args) return '';
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
    .join(', ');
}

// -- Processing --

/**
 * Pure function — no mutation of existing objects. Every block is a fresh object.
 * Tool calls are keyed by block index (not tool name) to support repeated calls
 * to the same tool (e.g., two explore_code calls in one run).
 */
function processEvents(events: AgentThinkingEvent[]): ThinkingState {
  const blocks: ThinkingDisplayBlock[] = [];
  let isRunning = false;
  let runStartedAt: number | null = null;
  let totalDurationMs: number | null = null;
  let currentPhase: ThinkingState['currentPhase'] = 'idle';
  let phaseLabel = '';
  let error: string | null = null;
  let toolCount = 0;
  let doneToolCount = 0;

  // Index of current thinking block in `blocks` (-1 = none active)
  let thinkingIdx = -1;
  // Accumulated text for the current thinking block (avoids mutating existing object)
  let thinkingText = '';

  // Map from block index → true for tool blocks that haven't received step_done yet.
  // We match step_done to the MOST RECENT active tool with the same name (LIFO).
  // This handles repeated calls to the same tool correctly.
  const activeToolIndices: number[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'run_started':
        isRunning = true;
        runStartedAt = getTimestamp(event);
        currentPhase = 'researching';
        phaseLabel = 'Investigando contexto';
        break;

      case 'phase_change':
        currentPhase = event.phase;
        phaseLabel = event.label;
        // Si todavía no tenemos `runStartedAt` (caso típico de eventos
        // filtrados por role en el timeline multi-agente — el slice del
        // sub-agente NO tiene un `run_started` propio, pero SÍ recibe un
        // `phase_change` específico de su rol al arrancar), usamos el
        // timestamp del primer phase_change como inicio. Esto da un tiempo
        // por sub-agente que refleja CUÁNDO ARRANCÓ ESE sub-agente, no
        // cuándo arrancó el run global.
        if (runStartedAt === null) {
          runStartedAt = getTimestamp(event);
        }
        // Finalizar el thinking block anterior en cambios de fase, para que el
        // auto-checklist del draft_diagram aparezca como un bloque visual
        // separado del razonamiento previo del LLM. Sin esto, los deltas
        // siguientes se acumulan al mismo bloque aunque semánticamente son
        // otra cosa.
        if (thinkingIdx >= 0) {
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, isActive: false };
          thinkingIdx = -1;
          thinkingText = '';
        }
        break;

      case 'thinking': {
        if (thinkingIdx >= 0) {
          // Accumulate text for existing thinking block
          thinkingText += event.delta;
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, text: thinkingText };
        } else {
          // Start a new thinking block
          thinkingText = event.delta;
          thinkingIdx = blocks.length;
          blocks.push({
            kind: 'thinking',
            id: `thinking-${blocks.length}`,
            text: thinkingText,
            isActive: true,
          });
        }
        break;
      }

      case 'step_start': {
        // Finalize current thinking block (immutably)
        if (thinkingIdx >= 0) {
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, isActive: false };
          thinkingIdx = -1;
          thinkingText = '';
        }

        const toolName = event.tool ?? event.step;
        const blockIdx = blocks.length;
        blocks.push({
          kind: 'tool_call',
          id: `tool-${blockIdx}`,
          tool: toolName,
          label: TOOL_LABELS[toolName] ?? event.label ?? toolName,
          status: 'active',
          args: event.toolArgs,
          argsPreview: buildArgsPreview(event.toolArgs),
          startedAt: getTimestamp(event),
        });
        activeToolIndices.push(blockIdx);
        toolCount++;
        break;
      }

      case 'step_done': {
        const toolName = event.tool ?? event.step;
        // Find the most recent active tool with this name (LIFO order)
        let matchIdx = -1;
        for (let i = activeToolIndices.length - 1; i >= 0; i--) {
          const block = blocks[activeToolIndices[i]] as ToolCallData;
          if (block.tool === toolName) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx >= 0) {
          const blockIdx = activeToolIndices[matchIdx];
          const existing = blocks[blockIdx] as ToolCallData;
          const finishedAt = getTimestamp(event);
          blocks[blockIdx] = {
            ...existing,
            status: 'done',
            summary: event.summary,
            resultPreview: event.resultPreview,
            durationMs: event.durationMs ?? (finishedAt - existing.startedAt),
            finishedAt,
          };
          activeToolIndices.splice(matchIdx, 1);
          doneToolCount++;
        }
        break;
      }

      case 'run_finished':
        isRunning = false;
        totalDurationMs = event.totalDurationMs;
        currentPhase = 'done';
        phaseLabel = 'Completado';
        if (thinkingIdx >= 0) {
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, isActive: false };
          thinkingIdx = -1;
          thinkingText = '';
        }
        break;

      case 'done':
        isRunning = false;
        currentPhase = 'done';
        phaseLabel = 'Completado';
        if (thinkingIdx >= 0) {
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, isActive: false };
          thinkingIdx = -1;
          thinkingText = '';
        }
        break;

      case 'tool_progress': {
        // Find the active tool matching this name (LIFO)
        for (let i = activeToolIndices.length - 1; i >= 0; i--) {
          const block = blocks[activeToolIndices[i]] as ToolCallData;
          if (block.tool === event.tool) {
            blocks[activeToolIndices[i]] = { ...block, summary: event.detail };
            break;
          }
        }
        break;
      }

      case 'proposal_ready':
      case 'diagram_ready':
      case 'document_ready':
        // Terminal payload events — no thinking block / no tool call to render.
        // The owning component handles the side-effect (state dispatch, toast).
        break;

      case 'error':
        isRunning = false;
        error = event.message;
        if (thinkingIdx >= 0) {
          blocks[thinkingIdx] = { ...blocks[thinkingIdx] as ThinkingBlockData, isActive: false };
          thinkingIdx = -1;
          thinkingText = '';
        }
        for (const idx of activeToolIndices) {
          blocks[idx] = { ...blocks[idx] as ToolCallData, status: 'error' };
        }
        activeToolIndices.length = 0;
        break;
    }
  }

  // Infer phase if no explicit phase events (backward compat with old backend)
  if (currentPhase === 'idle' && blocks.length > 0) {
    currentPhase = 'researching';
  }

  // Fallback de runStartedAt: cuando los events son filtrados (e.g., por role
  // en el timeline multi-agente de historias), NO hay `run_started` propio
  // del slice — pero sí hay events. Tomamos el timestamp del primer event
  // como aproximación del inicio. Sin esto, el chip de tiempo no se mostraría
  // para sub-cadenas filtradas.
  if (runStartedAt === null && events.length > 0) {
    runStartedAt = getTimestamp(events[0]);
  }

  // Fallback de duración: si tenemos `runStartedAt` pero no llegó un
  // `run_finished` (run abortado, cache hidratado stale, cliente cerró
  // antes del terminal event), derivamos el tiempo del último event.
  // Esto garantiza que el header SIEMPRE muestre cuánto tardó el agente
  // — el user pidió que todos los flujos lo digan, así que cubrimos
  // todos los casos edge en este punto único.
  if (totalDurationMs === null && runStartedAt !== null && events.length > 0) {
    const lastEvent = events[events.length - 1];
    const lastTs = getTimestamp(lastEvent);
    if (lastTs > runStartedAt) {
      totalDurationMs = lastTs - runStartedAt;
    }
  }

  // El backend del diagrama tiene un flujo multi-agente: el agente principal
  // emite `run_started` → trabaja → `run_finished`, y DESPUÉS arranca un
  // segundo agente (`layout_pass`) que emite su propio `run_started` y
  // `run_finished`. Entre el primer `run_finished` y el segundo `run_started`,
  // pueden llegar `phase_change` + `thinking` deltas — pero `isRunning` se
  // habría quedado en `false` desde el primer terminal event, ocultando la
  // UI del thinking activo.
  //
  // Solución: si hay bloques activos (thinking en stream o tool_call en
  // ejecución) Y no hay error, OVERRIDE isRunning a true. Los terminal
  // events (run_finished/done) cierran los activos antes, así que post-fin
  // real no quedan bloques activos y isRunning es correctamente false.
  //
  // También revertimos `currentPhase` cuando estaba stuck en 'done': el primer
  // `run_finished` lo dejaba ahí, pero si después hay actividad real (sub-
  // agente) el label "Completado" mostraba info engañosa. Lo regresamos a
  // 'analyzing' como default neutral hasta que el siguiente phase_change
  // explícito lo refine.
  const hasActiveBlocks = blocks.some(
    (b) => (b.kind === 'thinking' && b.isActive) || (b.kind === 'tool_call' && b.status === 'active'),
  );
  if (hasActiveBlocks && !error) {
    isRunning = true;
    if (currentPhase === 'done') {
      currentPhase = 'analyzing';
      phaseLabel = 'Analizando';
    }
  }

  return {
    isRunning,
    runStartedAt,
    totalDurationMs,
    currentPhase,
    phaseLabel,
    blocks,
    toolCount,
    doneToolCount,
    error,
  };
}

// -- Hook --

export function useAgentThinkingState(events: AgentThinkingEvent[]): ThinkingState {
  return useMemo(() => processEvents(events), [events]);
}
