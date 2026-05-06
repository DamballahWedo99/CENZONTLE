// === ENUMS ===

export enum FactoryStatus {
  Online = 'online',
  Degraded = 'degraded',
  Offline = 'offline',
  Maintenance = 'maintenance',
}

export enum PipelineLayer {
  Requirements = 'requirements',
  Linear = 'linear',
  Forge = 'forge',
  Staging = 'staging',
  ReleaseBoard = 'release-board',
  QAGate = 'qa-gate',
}

export enum LayerStatus {
  Idle = 'idle',
  Active = 'active',
  Waiting = 'waiting',
  Completed = 'completed',
  Failed = 'failed',
}

export enum AgentStatus {
  Idle = 'idle',
  Coding = 'coding',
  Testing = 'testing',
  CreatingPR = 'creating-pr',
  InReview = 'in-review',
  Rejected = 'rejected',
  Done = 'done',
  Error = 'error',
}

export enum PRStatus {
  Draft = 'draft',
  Open = 'open',
  InReview = 'in-review',
  ChangesRequested = 'changes-requested',
  Approved = 'approved',
  Merged = 'merged',
  Closed = 'closed',
}

export enum TestCategory {
  Unit = 'unit',
  Integration = 'integration',
  E2E = 'e2e',
  Performance = 'performance',
}

export enum TestResult {
  Pending = 'pending',
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export enum GateDecision {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Deferred = 'deferred',
}

export enum WaveStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

// === CORE TYPES ===

export interface FactoryState {
  status: FactoryStatus;
  currentBatch: SprintBatch | null;
  activeBatches: SprintBatch[];
  queuedBatches: QueuedBatch[];
  resourcePool: ResourcePool;
  activeLayers: PipelineLayer[];
  totalCost: number;
  totalTokens: number;
  uptime: number; // seconds
}

export interface TrackerReference {
  provider: 'jira' | 'linear';
  externalId: string;
  externalKey: string;
  externalUrl: string;
}

export interface QueuedStory {
  key: string;
  title: string;
  pod: string | null;
  productOwner: string | null;
  storyPoints: number;
}

export interface QueuedBatch {
  id: string;
  /**
   * Epic ID interno — usado para navegación al detail page (`/proyectos/epicas/:id`)
   * cuando el batch viene de la cola interna del Forge (no del legacy mock con
   * tracker Linear). Opcional para retrocompat con mocks antiguos que solo
   * tenían `tracker.externalKey`.
   */
  epicId?: string;
  epicTitle: string;
  /**
   * Tracker externo (Linear/Jira). Opcional — desde el Forge interno (Mes 0
   * del roadmap) muchas épicas se envían a la cola sin estar publicadas en
   * un tracker externo. UI debe usar fallback (epicId/getShortId) cuando es null.
   */
  tracker?: TrackerReference | null;
  stories: number;
  storyDetails?: QueuedStory[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  queuedAt: string;
  estimatedStartAt: string | null;
}

export interface ResourcePool {
  nodes: ComputeNode[];
  totalSlots: number;
  usedSlots: number;
}

export interface ComputeNode {
  id: string;
  name: string;
  type: 'local' | 'mac-mini' | 'cloud-vm' | 'gpu-instance' | 'other';
  os: string;              // "macOS 15.3 (Apple M3 Pro)", "Ubuntu 24.04 (x86_64)"
  location: string;        // "Local", "CDMX Office", "AWS us-east-1"
  ip: string;              // "100.64.0.1" (tailscale) or "192.168.1.10"
  status: 'online' | 'offline' | 'degraded';
  totalSlots: number;
  agents: { agentId: string; batchId: string; batchName: string }[];
  addedAt: string;
  lastHeartbeat: string;
}

/** @deprecated Use ComputeNode instead */
export type MacMini = ComputeNode;

export interface PipelineLayerState {
  layer: PipelineLayer;
  status: LayerStatus;
  label: string;
  icon: string;
  itemCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SprintBatch {
  id: string;
  name: string;
  epicTitle: string;
  epicId?: string;
  tracker: TrackerReference;
  stories: FactoryStory[];
  waves: Wave[];
  branch: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  currentLayer: PipelineLayer;
  agentCount: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  startedAt: string;
  completedAt: string | null;
  totalCost: number;
  totalTokens: number;
}

export interface Wave {
  id: string;
  number: number;
  status: WaveStatus;
  storyIds: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface FactoryStory {
  id: string;
  tracker: TrackerReference;
  title: string;
  description: string;
  waveNumber: number;
  dependsOn: string[]; // story IDs
  agentId: string | null;
  prNumber: number | null;
  status: AgentStatus;
  storyPoints: number;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  tokens: number;
  cost: number;
}

export interface FactoryAgent {
  id: string;
  name: string;
  storyId: string | null;
  storyKey: string | null;
  status: AgentStatus;
  worktree: string;
  tmuxSession: string;
  startedAt: string | null;
  duration: number; // seconds
  tokens: number;
  cost: number;
  lastOutput: string[]; // last 5 lines
  currentFile: string | null;
  linesWritten: number;
  testsRun: number;
  testsPassed: number;
}

export interface FactoryPR {
  id: string;
  number: number;
  title: string;
  storyKey: string;
  storyId: string;
  agentId: string;
  branch: string;
  targetBranch: string;
  status: PRStatus;
  reviewFeedback: string | null;
  retryCount: number;
  additions: number;
  deletions: number;
  files: number;
  ciStatus: 'pending' | 'running' | 'passed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface TestSuite {
  id: string;
  category: TestCategory;
  storyId: string | null; // null for batch-level tests
  name: string;
  result: TestResult;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number; // ms
  coverage: number | null; // percentage
  startedAt: string | null;
  completedAt: string | null;
}

export interface HumanGate {
  id: string;
  type: 'staging' | 'release';
  batchId: string;
  decision: GateDecision;
  reviewer: string | null;
  notes: string | null;
  qaReport: QAReport | null;
  requestedAt: string;
  decidedAt: string | null;
}

export interface QAReport {
  id: string;
  batchId: string;
  recommendation: 'rollout' | 'rollback';
  confidence: number; // 0-100
  e2eResults: TestSuite;
  integrationResults: TestSuite;
  performanceResults: TestSuite;
  logAnalysis: LogAnalysis;
  generatedAt: string;
}

export interface LogAnalysis {
  httpErrors: number;
  latencySpikes: number;
  memoryLeaks: number;
  unexpectedErrors: number;
  anomalyScore: number; // 0-100, lower is better
  summary: string;
}

export interface EvolutionMetrics {
  currentPromptVersion: string;
  previousVersions: PromptVersion[];
  batchHistory: BatchMetrics[];
}

export interface PromptVersion {
  version: string;
  createdAt: string;
  changes: string;
  rejectionRate: number;
  avgRetries: number;
  avgCostPerStory: number;
}

export interface BatchMetrics {
  batchId: string;
  batchName: string;
  promptVersion: string;
  stories: number;
  completedAt: string;
  totalCost: number;
  totalTokens: number;
  rejectionRate: number;
  avgRetries: number;
  avgDuration: number; // minutes per story
  testPassRate: number;
}

export interface CostBreakdown {
  agentCosts: { agentId: string; agentName: string; cost: number; tokens: number }[];
  storyCosts: { storyId: string; storyKey: string; cost: number; tokens: number }[];
  totalCost: number;
  totalTokens: number;
  projectedMonthlyCost: number;
  temporalActionsCost: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  source: 'agent' | 'review' | 'ci' | 'temporal' | 'qa';
  sourceId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

// === RELEASE BOARD ===

export enum ReleaseTriggerMode {
  Manual = 'manual',
  Scheduled = 'scheduled',
  Threshold = 'threshold',
}

export interface ReleaseBoardEpic {
  id: string;
  title: string;
  tracker: TrackerReference;
  storiesCompleted: number;
  storiesTotal: number;
  batchId: string;
  batchName: string;
  approvedAt: string; // when staging approved
  totalAdditions: number;
  totalDeletions: number;
  testPassRate: number;
  cost: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ReleaseBoardState {
  epics: ReleaseBoardEpic[];
  triggerMode: ReleaseTriggerMode;
  scheduledAt: string | null; // e.g., "Friday 18:00"
  thresholdCount: number | null; // e.g., trigger at 5 epics
  lastReleasedAt: string | null;
  nextScheduledRelease: string | null;
}

// === EVENT TYPES (for SSE/realtime) ===

export type FactoryEvent =
  | { type: 'factory:status'; data: FactoryState }
  | { type: 'agent:update'; data: FactoryAgent }
  | { type: 'story:update'; data: FactoryStory }
  | { type: 'pr:update'; data: FactoryPR }
  | { type: 'test:update'; data: TestSuite }
  | { type: 'gate:update'; data: HumanGate }
  | { type: 'log:entry'; data: LogEntry }
  | { type: 'cost:update'; data: CostBreakdown }
  | { type: 'pipeline:update'; data: PipelineLayerState[] };

// === TERMINAL / PTY TYPES ===

/** Configuration to spawn a Claude Code PTY session for an agent */
export interface PtySessionConfig {
  agentId: string;
  /** Initial prompt to send after spawning (optional — user can type directly) */
  initialPrompt?: string;
  /** Working directory for the Claude Code process (repo root — used to derive worktree) */
  workdir: string;
  /** Git branch name. When provided, the backend creates an isolated worktree for this agent. */
  branch?: string;
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
}
