'use client';

import React, { createContext, useContext, useReducer, useMemo, useEffect, ReactNode } from 'react';
import { getForgeQueue, type ForgeQueueItem } from '@/lib/api/factory';
import type {
  FactoryState,
  HumanGate,
  ReleaseBoardState,
  QueuedBatch,
} from '@cenzontle/shared';
import { ReleaseTriggerMode } from '@cenzontle/shared';

// === STATE ===
interface FactoryContextState {
  factory: FactoryState;
  gates: HumanGate[];
  releaseBoard: ReleaseBoardState;
  // UI state
  selectedAgentId: string | null;
  /** true mientras la primera hidratación de `factory.queuedBatches` desde el
   *  backend está en vuelo — el Pipeline Board muestra skeletons hasta que
   *  resuelve. Solo cubre la PRIMERA carga; los polls de 5s no la re-activan. */
  queueLoading: boolean;
}

// === INITIAL STATE ===
//
// initialState arranca VACÍO. Toda la data del factory se hidrata desde el
// backend real:
//  - `queuedBatches` ← GET /factory/queue (polling 5s, ver el useEffect del
//    FactoryProvider abajo).
//  - `resourcePool` + `agents` ← useEffectiveResourcePool en los componentes
//    (GET /factory/nodes + GET /factory/runs).
// Los mocks anteriores (mockAgents, mockStories, mockPRs, mockTests, mockCost,
// mockLogs, mockGates, mockEvolution, mockPipeline y los batches/nodos hard-
// codeados) se eliminaron — el dashboard solo muestra datos reales o empty
// states honestos cuando no hay nada que mostrar.
//
// El slice `prs` se retiró por completo: el dashboard /factory/prs ahora hace
// fetch propio a GET /factory/prs (ver PRPipeline.tsx) y no depende del
// contexto. Quedó sin consumidores tras esa migración.
//
// Los slices `cost` y `evolution` se retiraron igual (2026-06-11): la vista
// /factory/cost hace fetch propio a GET /factory/cost (useCostAnalytics), y
// el tracking de evolución de prompts nunca tuvo fuente real en el backend —
// EvolutionView muestra un empty state honesto hasta que exista el endpoint.
//
// Segundo ciclo (2026-06-11): se retiraron `pipeline` (PipelineFlow era un
// componente órfano, nunca importado), `tests`/`logs` (sin endpoint real —
// TestResults/LogViewer muestran empty state honesto), `stories`/`agents`
// (los consumidores derivan agents/stories de los endpoints reales) y los
// selectors/computed sin consumidores. El contexto queda enfocado en lo
// vivo: factory (queuedBatches hidratado + currentBatch), gates,
// releaseBoard y UI state.
//
// Tercer ciclo (2026-06-11): se retiró el UI state sin lectores ni
// dispatchers (selectedStoryId, inspectorOpen, terminalOpen, activeView +
// el type FactoryView) y los campos muertos de FactoryState en shared
// (status, activeLayers, totalCost, uptime — cero consumidores). Se
// conservan selectedAgentId/SELECT_AGENT (AgentGrid) y factory.totalTokens
// (AgentGrid lo lee, pendiente de hidratación real).

const initialState: FactoryContextState = {
  factory: {
    currentBatch: null,
    activeBatches: [],
    // Hidratado desde GET /factory/queue (ver el useEffect del provider).
    queuedBatches: [],
    // Hidratado en los componentes vía useEffectiveResourcePool
    // (GET /factory/nodes + GET /factory/runs).
    resourcePool: { nodes: [], totalSlots: 0, usedSlots: 0 },
    totalTokens: 0,
  },
  gates: [],
  releaseBoard: {
    epics: [],
    triggerMode: ReleaseTriggerMode.Manual,
    scheduledAt: null,
    thresholdCount: null,
    lastReleasedAt: null,
    nextScheduledRelease: null,
  },
  // UI defaults
  selectedAgentId: null,
  // Arranca en true: el Pipeline Board muestra skeletons hasta que la primera
  // hidratación de la queue resuelve (ver el useEffect del FactoryProvider).
  queueLoading: true,
};

// === ACTIONS ===
//
// Solo quedan los action types con dispatchers reales — ACTIVOS:
// `UPDATE_FACTORY` (hidratación de queuedBatches en el provider +
// currentBatch/activeBatches desde BatchDetail), `SET_QUEUE_LOADING`
// (skeletons del Pipeline Board), `UPDATE_GATE` (HumanGates/BatchDetail) y
// `SELECT_AGENT` (AgentGrid).
//
// Los antiguos `SET_FACTORY_DATA`, `UPDATE_AGENT`, `UPDATE_STORY`, `UPDATE_PR`,
// `UPDATE_PIPELINE`, `UPDATE_TESTS`, `ADD_LOG`, `UPDATE_COST`,
// `UPDATE_EVOLUTION`, `SET_BATCH`, `SET_AGENTS`, `SET_FACTORY_STATUS`,
// `SET_VIEW`, `SELECT_STORY`, `TOGGLE_INSPECTOR`, `TOGGLE_TERMINAL` se
// retiraron del reducer JUNTO con los slices que mutaban (ciclos de
// limpieza 2026-06-11). Si una feature futura los necesita, re-añadir el
// action type explícitamente — convención YAGNI: no mantener superficie
// zombi.
type FactoryAction =
  | { type: 'UPDATE_FACTORY'; payload: Partial<FactoryState> }
  | { type: 'SET_QUEUE_LOADING'; payload: boolean }
  | { type: 'UPDATE_GATE'; payload: HumanGate }
  | { type: 'SELECT_AGENT'; payload: string | null };

function factoryReducer(state: FactoryContextState, action: FactoryAction): FactoryContextState {
  switch (action.type) {
    case 'UPDATE_FACTORY':
      return { ...state, factory: { ...state.factory, ...action.payload } };
    case 'SET_QUEUE_LOADING':
      return { ...state, queueLoading: action.payload };
    case 'UPDATE_GATE': {
      const gate = action.payload;
      const exists = state.gates.some((g) => g.id === gate.id);
      return {
        ...state,
        gates: exists
          ? state.gates.map((g) => g.id === gate.id ? gate : g)
          : [...state.gates, gate],
      };
    }
    case 'SELECT_AGENT':
      return { ...state, selectedAgentId: action.payload };
    default:
      return state;
  }
}

// === CONTEXT ===
interface FactoryContextValue {
  state: FactoryContextState;
  dispatch: React.Dispatch<FactoryAction>;
}

const FactoryContext = createContext<FactoryContextValue | null>(null);

// === MAPPERS ===

/**
 * Mapea el shape del backend (`ForgeQueueItem`) al `QueuedBatch` shared
 * que el FactoryOverview consume. Diferencias clave:
 *
 *  - `id` ← `batchId` del backend
 *  - `epicId` ← propagado para navegación al detail
 *  - `tracker` ← null porque el Forge interno no usa Linear/Jira
 *  - `priority` ← default 'medium' (el backend no lo retorna; se hidratará
 *    cuando agreguemos Sprint/SprintBatch en Mes 1)
 *  - `estimatedStartAt` ← null hasta que tengamos el orquestador real
 *
 * Cuando `tracker` es null, los componentes del FactoryOverview deben hacer
 * fallback a `epicId` (con `getShortId`) para mostrar identificador legible.
 */
function mapForgeQueueItemToQueuedBatch(item: ForgeQueueItem): QueuedBatch {
  return {
    id: item.batchId,
    epicId: item.epicId,
    epicTitle: item.epicTitle,
    tracker: null,
    stories: item.storiesCount,
    storyDetails: undefined,
    // Priority real desde el backend (antes hardcoded 'medium').
    priority: item.priority,
    queuedAt: item.enqueuedAt,
    estimatedStartAt: null,
    // Runtime data — propagado al frontend para que `FactoryOverview`
    // pueda mover la épica de "queue" a "forge" cuando agentCount > 0.
    storiesDone: item.storiesDone,
    storiesInProgress: item.storiesInProgress,
    agentCount: item.agentCount,
    runStartedAt: item.runStartedAt,
    forgeBranch: item.forgeBranch,
    awaitingHumanGate: item.awaitingHumanGate,
    // Aggregates del epic — permiten que KanbanBatchCard muestre cost,
    // tokens y congele el reloj cuando completedAt está set.
    completedAt: item.completedAt,
    totalCostUsd: item.totalCostUsd,
    totalTokensNew: item.totalTokensNew,
    totalTokensCached: item.totalTokensCached,
    // Staging approval propagado del backend — el FactoryOverview lo usa
    // para derivar `currentLayer = Staging` y mover el batch a la columna
    // STAGED sin esperar al próximo poll del detail endpoint.
    stagingApprovedAt: item.stagingApprovedAt ?? null,
  };
}

// === PROVIDER ===
export function FactoryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(factoryReducer, initialState);

  // Hidrata `queuedBatches` desde el endpoint real con polling 5s para
  // que los runtime fields (`storiesDone`, `agentCount`, `runStartedAt`)
  // se actualicen cuando los workers reclaman/completan stories. Sin
  // polling, el dashboard mostraría datos congelados hasta que el user
  // recargue la página.
  //
  // Best-effort: si falla (no autenticado, network), el state queda como
  // estaba y el dashboard sigue funcional. Sprint 5+ podemos migrar a
  // SSE/WebSocket para evitar polling y reducir latencia.
  useEffect(() => {
    let cancelled = false;
    const fetchAndUpdate = async () => {
      try {
        const items = await getForgeQueue();
        if (cancelled) return;
        const queuedBatches = items.map(mapForgeQueueItemToQueuedBatch);
        dispatch({
          type: 'UPDATE_FACTORY',
          payload: { queuedBatches },
        });
      } catch {
        // Silencio — el state queda como estaba.
      }
    };
    // La PRIMERA hidratación apaga `queueLoading` al resolver (éxito o fallo —
    // de ahí el `.finally`) → el Pipeline Board pasa de skeletons al board
    // real. Los polls de 5s NO tocan el flag: refresco silencioso en background.
    void fetchAndUpdate().finally(() => {
      if (!cancelled) dispatch({ type: 'SET_QUEUE_LOADING', payload: false });
    });
    const interval = setInterval(() => void fetchAndUpdate(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // --- Context value ---
  //
  // Los helper selectors (getStoryById, getActiveAgents, etc.) y el objeto
  // `computed` se retiraron junto con los slices mock que leían: con los
  // arrays permanentemente vacíos devolvían siempre undefined/0, y sus dos
  // únicos consumidores (AgentGrid, AgentTerminal) derivan ahora esos datos
  // de los endpoints reales.

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <FactoryContext.Provider value={value}>
      {children}
    </FactoryContext.Provider>
  );
}

export function useFactory() {
  const context = useContext(FactoryContext);
  if (!context) {
    throw new Error('useFactory must be used within a FactoryProvider');
  }
  return context;
}
