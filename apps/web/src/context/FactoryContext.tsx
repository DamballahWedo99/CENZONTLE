'use client';

import React, { createContext, useContext, useReducer, useMemo, useCallback, useEffect, ReactNode } from 'react';
import { getForgeQueue, type ForgeQueueItem } from '@/lib/api/factory';
import type {
  FactoryAgent,
  FactoryState,
  FactoryStory,
  FactoryPR,
  LogEntry,
  CostBreakdown,
  PipelineLayerState,
  TestSuite,
  HumanGate,
  EvolutionMetrics,
  ReleaseBoardState,
  QueuedBatch,
  Wave,
} from '@cenzontle/shared';
import {
  FactoryStatus,
  AgentStatus,
  PRStatus,
  GateDecision,
  WaveStatus,
  ReleaseTriggerMode,
} from '@cenzontle/shared';

// === VIEW TYPES ===
export type FactoryView =
  | 'pipeline'
  | 'agents'
  | 'pull-requests'
  | 'prs'
  | 'tests'
  | 'cost'
  | 'logs'
  | 'evolution'
  | 'gates'
  | 'wave-dag';

// === STATE ===
interface FactoryContextState {
  factory: FactoryState;
  pipeline: PipelineLayerState[];
  agents: FactoryAgent[];
  stories: FactoryStory[];
  prs: FactoryPR[];
  tests: TestSuite[];
  gates: HumanGate[];
  logs: LogEntry[];
  cost: CostBreakdown;
  evolution: EvolutionMetrics;
  releaseBoard: ReleaseBoardState;
  // UI state
  selectedAgentId: string | null;
  selectedStoryId: string | null;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  activeView: FactoryView;
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

const initialState: FactoryContextState = {
  factory: {
    status: FactoryStatus.Online,
    currentBatch: null,
    activeBatches: [],
    // Hidratado desde GET /factory/queue (ver el useEffect del provider).
    queuedBatches: [],
    // Hidratado en los componentes vía useEffectiveResourcePool
    // (GET /factory/nodes + GET /factory/runs).
    resourcePool: { nodes: [], totalSlots: 0, usedSlots: 0 },
    activeLayers: [],
    totalCost: 0,
    totalTokens: 0,
    uptime: 0,
  },
  pipeline: [],
  agents: [],
  stories: [],
  prs: [],
  tests: [],
  gates: [],
  logs: [],
  cost: {
    agentCosts: [],
    storyCosts: [],
    totalCost: 0,
    totalTokens: 0,
    projectedMonthlyCost: 0,
    temporalActionsCost: 0,
  },
  evolution: {
    currentPromptVersion: '',
    previousVersions: [],
    batchHistory: [],
  },
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
  selectedStoryId: null,
  inspectorOpen: false,
  terminalOpen: false,
  activeView: 'pipeline',
  // Arranca en true: el Pipeline Board muestra skeletons hasta que la primera
  // hidratación de la queue resuelve (ver el useEffect del FactoryProvider).
  queueLoading: true,
};

// === ACTIONS ===
//
// Solo dejamos los action types que algún consumer activamente dispatchea.
// Los antiguos `SET_FACTORY_DATA`, `UPDATE_AGENT`, `UPDATE_STORY`, `UPDATE_PR`,
// `UPDATE_PIPELINE`, `UPDATE_TESTS`, `ADD_LOG`, `UPDATE_COST`,
// `UPDATE_EVOLUTION`, `SET_BATCH`, `SET_AGENTS`, `SET_FACTORY_STATUS`,
// `SET_VIEW`, `SELECT_STORY`, `TOGGLE_INSPECTOR`, `TOGGLE_TERMINAL` se
// retiraron del reducer (post-eliminación de mocks): el state shape los
// mantiene como arrays/objetos iniciales vacíos para no romper a los
// consumers que leen los slices, pero ya no existe un evento que los
// mute. Si una feature futura los necesita, re-añadir el action type
// explícitamente — convención YAGNI: no mantener superficie zombi.
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
  // Backward-compatible computed object (used by FactoryTopBar, AgentGrid, etc.)
  computed: {
    activeAgentCount: number;
    openPRCount: number;
    testPassRate: number;
    currentWave: number;
    totalWaves: number;
  };
  // Helper selectors
  getActiveAgents: () => FactoryAgent[];
  getCurrentWave: () => Wave | null;
  getStoryById: (id: string) => FactoryStory | undefined;
  getAgentForStory: (storyId: string) => FactoryAgent | undefined;
  getPRForStory: (storyId: string) => FactoryPR | undefined;
  getTotalCost: () => number;
  getAgentCount: () => number;
  // Computed scalars
  pendingGatesCount: number;
  activeStoriesCount: number;
  completionPercent: number;
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

  // --- Helper selectors (stable callbacks) ---

  const getActiveAgents = useCallback((): FactoryAgent[] => {
    return state.agents.filter((a) => a.status !== AgentStatus.Idle);
  }, [state.agents]);

  const getCurrentWave = useCallback((): Wave | null => {
    const batch = state.factory.currentBatch;
    if (!batch) return null;
    const running = batch.waves.find(
      (w) => w.status === WaveStatus.Running || String(w.status) === 'running'
    );
    if (running) return running;
    const completed = batch.waves.filter(
      (w) => w.status === WaveStatus.Completed || String(w.status) === 'completed'
    );
    return completed.length > 0 ? completed[completed.length - 1] : batch.waves[0] ?? null;
  }, [state.factory.currentBatch]);

  const getStoryById = useCallback((id: string): FactoryStory | undefined => {
    return state.stories.find((s) => s.id === id);
  }, [state.stories]);

  const getAgentForStory = useCallback((storyId: string): FactoryAgent | undefined => {
    return state.agents.find((a) => a.storyId === storyId);
  }, [state.agents]);

  const getPRForStory = useCallback((storyId: string): FactoryPR | undefined => {
    return state.prs.find((p) => p.storyId === storyId);
  }, [state.prs]);

  const getTotalCost = useCallback((): number => {
    return state.agents.reduce((sum, a) => sum + a.cost, 0);
  }, [state.agents]);

  const getAgentCount = useCallback((): number => {
    return state.agents.filter((a) => a.status !== AgentStatus.Idle).length;
  }, [state.agents]);

  // --- Computed scalars ---

  const pendingGatesCount = useMemo(() => {
    return state.gates.filter((g) => g.decision === GateDecision.Pending).length;
  }, [state.gates]);

  const activeStoriesCount = useMemo(() => {
    return state.stories.filter(
      (s) => s.status !== AgentStatus.Idle && s.status !== AgentStatus.Done
    ).length;
  }, [state.stories]);

  const completionPercent = useMemo(() => {
    const total = state.stories.length;
    if (total === 0) return 0;
    const done = state.stories.filter((s) => s.status === AgentStatus.Done).length;
    return Math.round((done / total) * 100);
  }, [state.stories]);

  // --- Backward-compatible computed object ---

  const computed = useMemo(() => {
    const activeAgentCount = state.agents.filter(
      (a) => a.status !== AgentStatus.Idle && a.status !== AgentStatus.Done
    ).length;

    const openPRCount = state.prs.filter(
      (p) =>
        p.status === PRStatus.Open ||
        p.status === PRStatus.InReview ||
        p.status === PRStatus.Draft ||
        p.status === PRStatus.ChangesRequested
    ).length;

    const totalTestCases = state.tests.reduce((sum, t) => sum + t.total, 0);
    const passedTestCases = state.tests.reduce((sum, t) => sum + t.passed, 0);
    const testPassRate = totalTestCases > 0
      ? Math.round((passedTestCases / totalTestCases) * 100)
      : 0;

    const batch = state.factory.currentBatch;
    const runningWave = batch?.waves.find(
      (w) => w.status === WaveStatus.Running || String(w.status) === 'running'
    );
    const completedWaves = batch?.waves.filter(
      (w) => w.status === WaveStatus.Completed || String(w.status) === 'completed'
    ).length ?? 0;
    const currentWave = runningWave ? runningWave.number : completedWaves;
    const totalWaves = batch?.waves.length ?? 0;

    return { activeAgentCount, openPRCount, testPassRate, currentWave, totalWaves };
  }, [state.agents, state.prs, state.tests, state.factory.currentBatch]);

  // --- Context value ---

  const value = useMemo(
    () => ({
      state,
      dispatch,
      computed,
      getActiveAgents,
      getCurrentWave,
      getStoryById,
      getAgentForStory,
      getPRForStory,
      getTotalCost,
      getAgentCount,
      pendingGatesCount,
      activeStoriesCount,
      completionPercent,
    }),
    [
      state,
      dispatch,
      computed,
      getActiveAgents,
      getCurrentWave,
      getStoryById,
      getAgentForStory,
      getPRForStory,
      getTotalCost,
      getAgentCount,
      pendingGatesCount,
      activeStoriesCount,
      completionPercent,
    ]
  );

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
