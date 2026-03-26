'use client';

import React, { createContext, useContext, useReducer, useMemo, useCallback, ReactNode } from 'react';
import type {
  FactoryAgent,
  FactoryState,
  FactoryStory,
  SprintBatch,
  FactoryPR,
  LogEntry,
  CostBreakdown,
  PipelineLayerState,
  TestSuite,
  HumanGate,
  EvolutionMetrics,
  ReleaseBoardState,
  QueuedBatch,
  ResourcePool,
  Wave,
} from '@cenzontle/shared';
import {
  FactoryStatus,
  PipelineLayer,
  LayerStatus,
  AgentStatus,
  PRStatus,
  TestResult,
  TestCategory,
  GateDecision,
  WaveStatus,
} from '@cenzontle/shared';
import { mockLogEntries, mockFactoryPRs } from '@/data/mock/factory';
import { generatedBatchHistory, generatedLogEntries } from '@/data/mock/generator';

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
}

// === MOCK DATA ===

const mockPipeline: PipelineLayerState[] = [
  { layer: PipelineLayer.Requirements, status: LayerStatus.Completed, label: 'Requirements', icon: 'ClipboardList', itemCount: 6, startedAt: '2026-03-23T07:00:00Z', completedAt: '2026-03-23T07:55:00Z' },
  { layer: PipelineLayer.Linear, status: LayerStatus.Completed, label: 'Linear', icon: 'LayoutList', itemCount: 6, startedAt: '2026-03-23T07:55:00Z', completedAt: '2026-03-23T08:00:00Z' },
  { layer: PipelineLayer.Forge, status: LayerStatus.Active, label: 'Forge', icon: 'Hammer', itemCount: 3, startedAt: '2026-03-23T08:00:00Z', completedAt: null },
  { layer: PipelineLayer.Staging, status: LayerStatus.Waiting, label: 'Staging', icon: 'Eye', itemCount: 0, startedAt: null, completedAt: null },
  { layer: PipelineLayer.ReleaseBoard, status: LayerStatus.Idle, label: 'Release Board', icon: 'Package', itemCount: 0, startedAt: null, completedAt: null },
  { layer: PipelineLayer.QAGate, status: LayerStatus.Idle, label: 'QA Gate', icon: 'Shield', itemCount: 0, startedAt: null, completedAt: null },
];

const mockAgents: FactoryAgent[] = [
  { id: 'agent-1', name: 'Forge-Alpha', storyId: 's-3', storyKey: 'CZ-142', status: AgentStatus.Coding, worktree: '/worktrees/cz-142', tmuxSession: 'forge-alpha', startedAt: '2026-03-23T09:35:00Z', duration: 1200, tokens: 320_000, cost: 1.92, lastOutput: ['Writing auth middleware...', 'Generated 3 files'], currentFile: 'src/middleware/auth.ts', linesWritten: 247, testsRun: 0, testsPassed: 0 },
  { id: 'agent-2', name: 'Forge-Beta', storyId: 's-4', storyKey: 'CZ-143', status: AgentStatus.Testing, worktree: '/worktrees/cz-143', tmuxSession: 'forge-beta', startedAt: '2026-03-23T09:35:00Z', duration: 1180, tokens: 280_000, cost: 1.68, lastOutput: ['Running test suite...', '12/15 passed'], currentFile: 'tests/api.test.ts', linesWritten: 189, testsRun: 15, testsPassed: 12 },
  { id: 'agent-3', name: 'Forge-Gamma', storyId: 's-5', storyKey: 'CZ-144', status: AgentStatus.CreatingPR, worktree: '/worktrees/cz-144', tmuxSession: 'forge-gamma', startedAt: '2026-03-23T09:36:00Z', duration: 1140, tokens: 410_000, cost: 2.46, lastOutput: ['Creating pull request...', 'PR #89 opened'], currentFile: null, linesWritten: 312, testsRun: 22, testsPassed: 22 },
];

const mockStories: FactoryStory[] = [
  { id: 's-1', jiraKey: 'CZ-140', title: 'User preferences API', description: 'GET/PUT user preferences', waveNumber: 1, dependsOn: [], agentId: 'agent-1', prNumber: 87, status: AgentStatus.Done, storyPoints: 3, startedAt: '2026-03-23T08:00:00Z', completedAt: '2026-03-23T08:42:00Z', retryCount: 0, maxRetries: 3, tokens: 320_000, cost: 1.92 },
  { id: 's-2', jiraKey: 'CZ-141', title: 'Notification service', description: 'WebSocket push notification service', waveNumber: 1, dependsOn: [], agentId: 'agent-2', prNumber: 88, status: AgentStatus.Done, storyPoints: 5, startedAt: '2026-03-23T08:00:00Z', completedAt: '2026-03-23T09:15:00Z', retryCount: 1, maxRetries: 3, tokens: 280_000, cost: 1.68 },
  { id: 's-3', jiraKey: 'CZ-142', title: 'Auth middleware', description: 'JWT auth middleware with refresh', waveNumber: 2, dependsOn: ['s-1'], agentId: 'agent-1', prNumber: null, status: AgentStatus.Coding, storyPoints: 5, startedAt: '2026-03-23T09:35:00Z', completedAt: null, retryCount: 0, maxRetries: 3, tokens: 180_000, cost: 1.08 },
  { id: 's-4', jiraKey: 'CZ-143', title: 'API rate limiter', description: 'Token-bucket rate limiter', waveNumber: 2, dependsOn: ['s-1'], agentId: 'agent-2', prNumber: null, status: AgentStatus.Testing, storyPoints: 3, startedAt: '2026-03-23T09:35:00Z', completedAt: null, retryCount: 0, maxRetries: 3, tokens: 210_000, cost: 1.26 },
  { id: 's-5', jiraKey: 'CZ-144', title: 'Dashboard analytics', description: 'Aggregate metrics dashboard', waveNumber: 2, dependsOn: ['s-2'], agentId: 'agent-3', prNumber: 89, status: AgentStatus.CreatingPR, storyPoints: 5, startedAt: '2026-03-23T09:36:00Z', completedAt: null, retryCount: 0, maxRetries: 3, tokens: 410_000, cost: 2.46 },
  { id: 's-6', jiraKey: 'CZ-145', title: 'Admin RBAC guard', description: 'Role-based access control', waveNumber: 3, dependsOn: ['s-3', 's-4'], agentId: null, prNumber: null, status: AgentStatus.Idle, storyPoints: 3, startedAt: null, completedAt: null, retryCount: 0, maxRetries: 3, tokens: 0, cost: 0 },
];

const mockPRs: FactoryPR[] = mockFactoryPRs;

const mockTests: TestSuite[] = [
  { id: 'ts-1', category: TestCategory.Unit, storyId: 's-1', name: 'User Preferences Unit', result: TestResult.Passed, total: 18, passed: 18, failed: 0, skipped: 0, duration: 4200, coverage: 92, startedAt: '2026-03-23T08:40:00Z', completedAt: '2026-03-23T08:40:04Z' },
  { id: 'ts-2', category: TestCategory.Unit, storyId: 's-2', name: 'Notification Service Unit', result: TestResult.Passed, total: 24, passed: 23, failed: 0, skipped: 1, duration: 5800, coverage: 88, startedAt: '2026-03-23T08:55:00Z', completedAt: '2026-03-23T08:55:06Z' },
  { id: 'ts-3', category: TestCategory.Integration, storyId: null, name: 'API Integration Suite', result: TestResult.Running, total: 42, passed: 36, failed: 2, skipped: 4, duration: 0, coverage: null, startedAt: '2026-03-23T10:00:00Z', completedAt: null },
];

const mockCost: CostBreakdown = {
  agentCosts: [
    { agentId: 'agent-1', agentName: 'Forge-Alpha', cost: 5.12, tokens: 850_000 },
    { agentId: 'agent-2', agentName: 'Forge-Beta', cost: 4.93, tokens: 820_000 },
    { agentId: 'agent-3', agentName: 'Forge-Gamma', cost: 4.82, tokens: 780_000 },
  ],
  storyCosts: [
    { storyId: 's-1', storyKey: 'CZ-140', cost: 1.92, tokens: 320_000 },
    { storyId: 's-2', storyKey: 'CZ-141', cost: 1.68, tokens: 280_000 },
    { storyId: 's-3', storyKey: 'CZ-142', cost: 1.08, tokens: 180_000 },
    { storyId: 's-4', storyKey: 'CZ-143', cost: 1.26, tokens: 210_000 },
    { storyId: 's-5', storyKey: 'CZ-144', cost: 2.46, tokens: 410_000 },
    { storyId: 's-6', storyKey: 'CZ-145', cost: 0, tokens: 0 },
  ],
  totalCost: 14.87,
  totalTokens: 2_450_000,
  projectedMonthlyCost: 446.10,
  temporalActionsCost: 0.42,
};

const mockLogs: LogEntry[] = generatedLogEntries;

const mockGates: HumanGate[] = [
  {
    id: 'gate-staging-46',
    type: 'staging',
    batchId: 'batch-46',
    decision: GateDecision.Pending,
    reviewer: null,
    notes: null,
    qaReport: null,
    requestedAt: '2026-03-22T16:00:00Z',
    decidedAt: null,
  },
  {
    id: 'gate-staging',
    type: 'staging',
    batchId: 'batch-47',
    decision: GateDecision.Pending,
    reviewer: null,
    notes: null,
    qaReport: null,
    requestedAt: '2026-03-23T14:30:00Z',
    decidedAt: null,
  },
  {
    id: 'gate-release',
    type: 'release',
    batchId: 'batch-47',
    decision: GateDecision.Pending,
    reviewer: null,
    notes: null,
    qaReport: {
      id: 'qa-1',
      batchId: 'batch-47',
      recommendation: 'rollout',
      confidence: 94,
      e2eResults: {
        id: 'test-e2e-batch', category: TestCategory.E2E, storyId: null, name: 'E2E Suite',
        result: TestResult.Passed, total: 48, passed: 46, failed: 2, skipped: 0,
        duration: 124_000, coverage: null,
        startedAt: '2026-03-23T14:00:00Z', completedAt: '2026-03-23T14:02:04Z',
      },
      integrationResults: {
        id: 'test-int-batch', category: TestCategory.Integration, storyId: null, name: 'Integration Suite',
        result: TestResult.Passed, total: 132, passed: 130, failed: 2, skipped: 0,
        duration: 45_000, coverage: 87,
        startedAt: '2026-03-23T13:55:00Z', completedAt: '2026-03-23T13:55:45Z',
      },
      performanceResults: {
        id: 'test-perf-batch', category: TestCategory.Performance, storyId: null, name: 'Performance Suite',
        result: TestResult.Passed, total: 12, passed: 11, failed: 1, skipped: 0,
        duration: 180_000, coverage: null,
        startedAt: '2026-03-23T14:03:00Z', completedAt: '2026-03-23T14:06:00Z',
      },
      logAnalysis: {
        httpErrors: 3,
        latencySpikes: 1,
        memoryLeaks: 0,
        unexpectedErrors: 2,
        anomalyScore: 12,
        summary: 'Low anomaly score. 3 HTTP 5xx errors during load test peak. 1 latency spike (p99 > 800ms) on /api/analytics. No memory leaks detected. System stability is within acceptable thresholds.',
      },
      generatedAt: '2026-03-23T14:10:00Z',
    },
    requestedAt: '2026-03-23T14:15:00Z',
    decidedAt: null,
  },
];

const mockEvolution: EvolutionMetrics = {
  currentPromptVersion: 'v3.2.1',
  previousVersions: [
    { version: 'v3.2.1', createdAt: '2026-03-20T00:00:00Z', changes: 'Added structured error recovery prompts, improved test assertion generation, refined PR description templates', rejectionRate: 0.08, avgRetries: 0.4, avgCostPerStory: 0.58 },
    { version: 'v3.1.0', createdAt: '2026-03-13T00:00:00Z', changes: 'Introduced chain-of-thought planning phase, added type-safety enforcement, better dependency analysis', rejectionRate: 0.14, avgRetries: 0.9, avgCostPerStory: 0.72 },
    { version: 'v3.0.0', createdAt: '2026-03-05T00:00:00Z', changes: 'Major rewrite: multi-agent wave execution, parallel coding support, automated test generation', rejectionRate: 0.22, avgRetries: 1.6, avgCostPerStory: 0.95 },
    { version: 'v2.4.0', createdAt: '2026-02-20T00:00:00Z', changes: 'Single-agent sequential execution, basic test scaffolding, manual PR descriptions', rejectionRate: 0.35, avgRetries: 2.1, avgCostPerStory: 1.24 },
  ],
  batchHistory: generatedBatchHistory,
};

const initialState: FactoryContextState = {
  factory: {
    status: FactoryStatus.Online,
    currentBatch: {
      id: 'batch-47',
      name: 'Sprint Batch #47',
      epicTitle: 'Checkout Redesign',
      jiraKey: 'CZ-EP-14',
      linearProjectId: 'proj-1',
      stories: [],
      waves: [
        { id: 'w-1', number: 1, status: WaveStatus.Completed, storyIds: ['s-1', 's-2'], startedAt: '2026-03-23T08:00:00Z', completedAt: '2026-03-23T09:30:00Z' },
        { id: 'w-2', number: 2, status: WaveStatus.Running, storyIds: ['s-3', 's-4', 's-5'], startedAt: '2026-03-23T09:35:00Z', completedAt: null },
        { id: 'w-3', number: 3, status: WaveStatus.Pending, storyIds: ['s-6'], startedAt: null, completedAt: null },
      ],
      branch: 'forge/sprint-batch-47',
      status: 'in-progress',
      currentLayer: PipelineLayer.Forge,
      agentCount: 3,
      priority: 'high' as const,
      startedAt: '2026-03-23T08:00:00Z',
      completedAt: null,
      totalCost: 14.87,
      totalTokens: 2_450_000,
    },
    activeBatches: [
      { id: 'batch-47', name: 'Sprint Batch #47', epicTitle: 'Checkout Redesign', jiraKey: 'CZ-EP-14', linearProjectId: 'proj-1', stories: [], waves: [], branch: 'forge/sprint-batch-47', status: 'in-progress', currentLayer: PipelineLayer.Forge, agentCount: 3, priority: 'high' as const, startedAt: '2026-03-23T08:00:00Z', completedAt: null, totalCost: 14.87, totalTokens: 2_450_000 },
      { id: 'batch-48', name: 'Sprint Batch #48', epicTitle: 'API Gateway v2', jiraKey: 'CZ-EP-15', linearProjectId: 'proj-2', stories: [], waves: [], branch: 'forge/sprint-batch-48', status: 'in-progress', currentLayer: PipelineLayer.Forge, agentCount: 2, priority: 'medium' as const, startedAt: '2026-03-23T09:00:00Z', completedAt: null, totalCost: 8.20, totalTokens: 1_360_000 },
      { id: 'batch-46', name: 'Sprint Batch #46', epicTitle: 'Mobile Checkout', jiraKey: 'CZ-EP-13', linearProjectId: 'proj-3', stories: [], waves: [], branch: 'forge/sprint-batch-46', status: 'in-progress', currentLayer: PipelineLayer.Staging, agentCount: 0, priority: 'high' as const, startedAt: '2026-03-22T10:00:00Z', completedAt: null, totalCost: 12.40, totalTokens: 2_060_000 },
    ],
    queuedBatches: [
      { id: 'q-1', epicTitle: 'Auth System Overhaul', jiraKey: 'CZ-EP-16', stories: 5, priority: 'high', queuedAt: '2026-03-23T14:00:00Z', estimatedStartAt: '2026-03-23T18:00:00Z' },
      { id: 'q-2', epicTitle: 'Analytics Dashboard', jiraKey: 'CZ-EP-17', stories: 3, priority: 'medium', queuedAt: '2026-03-23T15:00:00Z', estimatedStartAt: '2026-03-23T19:30:00Z' },
    ],
    resourcePool: {
      nodes: [
        { id: 'node-local', name: 'My MacBook Pro', type: 'local' as const, os: 'macOS 15.3 (Apple M3 Pro)', location: 'Local', ip: '127.0.0.1', status: 'online' as const, totalSlots: 3, agents: [{ agentId: 'agent-1', batchId: 'batch-47', batchName: 'Checkout Redesign' }, { agentId: 'agent-2', batchId: 'batch-47', batchName: 'Checkout Redesign' }, { agentId: 'agent-3', batchId: 'batch-47', batchName: 'Checkout Redesign' }], addedAt: '2026-03-20T10:00:00Z', lastHeartbeat: '2026-03-24T04:50:00Z' },
        { id: 'node-mm1', name: 'Mac Mini Office 1', type: 'mac-mini' as const, os: 'macOS 15.3 (Apple M2)', location: 'CDMX Office', ip: '100.64.0.2', status: 'online' as const, totalSlots: 6, agents: [{ agentId: 'agent-4', batchId: 'batch-48', batchName: 'API Gateway v2' }, { agentId: 'agent-5', batchId: 'batch-48', batchName: 'API Gateway v2' }], addedAt: '2026-03-21T09:00:00Z', lastHeartbeat: '2026-03-24T04:50:00Z' },
      ],
      totalSlots: 9,
      usedSlots: 5,
    },
    activeLayers: [PipelineLayer.Forge, PipelineLayer.Staging],
    totalCost: 35.47,
    totalTokens: 5_870_000,
    uptime: 18_432,
  },
  pipeline: mockPipeline,
  agents: mockAgents,
  stories: mockStories,
  prs: mockPRs,
  tests: mockTests,
  gates: mockGates,
  logs: mockLogs,
  cost: mockCost,
  evolution: mockEvolution,
  releaseBoard: {
    epics: [
      { id: 'rb-1', title: 'Guest Checkout Flow', jiraKey: 'CZ-EP-12', storiesCompleted: 5, storiesTotal: 5, batchId: 'batch-46', batchName: 'Sprint Batch 46', approvedAt: '2026-03-22T16:30:00Z', totalAdditions: 1240, totalDeletions: 89, testPassRate: 0.96, cost: 7.10, priority: 'high' as const },
      { id: 'rb-2', title: 'Order Tracking Redesign', jiraKey: 'CZ-EP-10', storiesCompleted: 4, storiesTotal: 4, batchId: 'batch-44', batchName: 'Sprint Batch 44', approvedAt: '2026-03-18T11:00:00Z', totalAdditions: 890, totalDeletions: 234, testPassRate: 0.93, cost: 5.80, priority: 'medium' as const },
      { id: 'rb-3', title: 'Payment Method Selector v2', jiraKey: 'CZ-EP-11', storiesCompleted: 6, storiesTotal: 6, batchId: 'batch-45', batchName: 'Sprint Batch 45', approvedAt: '2026-03-20T09:15:00Z', totalAdditions: 1560, totalDeletions: 310, testPassRate: 0.95, cost: 10.32, priority: 'critical' as const },
    ],
    triggerMode: 'manual' as never,
    scheduledAt: null,
    thresholdCount: null,
    lastReleasedAt: '2026-03-15T18:00:00Z',
    nextScheduledRelease: null,
  },
  // UI defaults
  selectedAgentId: null,
  selectedStoryId: null,
  inspectorOpen: false,
  terminalOpen: false,
  activeView: 'pipeline',
};

// === ACTIONS ===
type FactoryAction =
  | { type: 'SET_FACTORY_DATA'; payload: {
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
    }}
  | { type: 'SET_VIEW'; payload: FactoryView }
  | { type: 'SET_FACTORY_STATUS'; payload: FactoryState }
  | { type: 'UPDATE_FACTORY'; payload: Partial<FactoryState> }
  | { type: 'SET_AGENTS'; payload: FactoryAgent[] }
  | { type: 'UPDATE_AGENT'; payload: FactoryAgent }
  | { type: 'UPDATE_STORY'; payload: FactoryStory }
  | { type: 'UPDATE_PR'; payload: FactoryPR }
  | { type: 'UPDATE_PIPELINE'; payload: PipelineLayerState[] }
  | { type: 'UPDATE_TESTS'; payload: TestSuite }
  | { type: 'ADD_LOG'; payload: LogEntry }
  | { type: 'UPDATE_COST'; payload: CostBreakdown }
  | { type: 'UPDATE_GATE'; payload: HumanGate }
  | { type: 'UPDATE_EVOLUTION'; payload: EvolutionMetrics }
  | { type: 'SET_BATCH'; payload: SprintBatch | null }
  | { type: 'SELECT_AGENT'; payload: string | null }
  | { type: 'SELECT_STORY'; payload: string | null }
  | { type: 'TOGGLE_INSPECTOR' }
  | { type: 'TOGGLE_TERMINAL' };

function factoryReducer(state: FactoryContextState, action: FactoryAction): FactoryContextState {
  switch (action.type) {
    case 'SET_FACTORY_DATA': {
      const { factory, pipeline, agents, stories, prs, tests, gates, logs, cost, evolution } = action.payload;
      return {
        ...state,
        factory,
        pipeline,
        agents,
        stories,
        prs,
        tests,
        gates,
        logs,
        cost,
        evolution,
      };
    }
    case 'SET_VIEW':
      return { ...state, activeView: action.payload };
    case 'SET_FACTORY_STATUS':
      return { ...state, factory: action.payload };
    case 'UPDATE_FACTORY':
      return { ...state, factory: { ...state.factory, ...action.payload } };
    case 'SET_AGENTS':
      return { ...state, agents: action.payload };
    case 'UPDATE_AGENT': {
      const agent = action.payload;
      const exists = state.agents.some((a) => a.id === agent.id);
      return {
        ...state,
        agents: exists
          ? state.agents.map((a) => a.id === agent.id ? agent : a)
          : [...state.agents, agent],
      };
    }
    case 'UPDATE_STORY': {
      const story = action.payload;
      const exists = state.stories.some((s) => s.id === story.id);
      return {
        ...state,
        stories: exists
          ? state.stories.map((s) => s.id === story.id ? story : s)
          : [...state.stories, story],
      };
    }
    case 'UPDATE_PR': {
      const pr = action.payload;
      const exists = state.prs.some((p) => p.id === pr.id);
      return {
        ...state,
        prs: exists
          ? state.prs.map((p) => p.id === pr.id ? pr : p)
          : [...state.prs, pr],
      };
    }
    case 'UPDATE_PIPELINE':
      return { ...state, pipeline: action.payload };
    case 'UPDATE_TESTS': {
      const test = action.payload;
      const exists = state.tests.some((t) => t.id === test.id);
      return {
        ...state,
        tests: exists
          ? state.tests.map((t) => t.id === test.id ? test : t)
          : [...state.tests, test],
      };
    }
    case 'ADD_LOG':
      return { ...state, logs: [action.payload, ...state.logs].slice(0, 500) };
    case 'UPDATE_COST':
      return { ...state, cost: action.payload };
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
    case 'UPDATE_EVOLUTION':
      return { ...state, evolution: action.payload };
    case 'SET_BATCH':
      return {
        ...state,
        factory: { ...state.factory, currentBatch: action.payload },
      };
    case 'SELECT_AGENT':
      return { ...state, selectedAgentId: action.payload };
    case 'SELECT_STORY':
      return { ...state, selectedStoryId: action.payload };
    case 'TOGGLE_INSPECTOR':
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case 'TOGGLE_TERMINAL':
      return { ...state, terminalOpen: !state.terminalOpen };
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

// === PROVIDER ===
export function FactoryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(factoryReducer, initialState);

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
