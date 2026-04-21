import type { TrackerReference } from './factory';

// === ENUMS ===

export enum InitiativeStatus {
  Planning = 'planning',
  Active = 'active',
  Completed = 'completed',
  OnHold = 'on_hold',
}

export enum EpicStatus {
  Draft = 'draft',
  InProgress = 'in_progress',
  Done = 'done',
  Blocked = 'blocked',
}

export enum StoryStatus {
  Backlog = 'backlog',
  ToDo = 'to_do',
  InProgress = 'in_progress',
  InReview = 'in_review',
  QA = 'qa',
  Done = 'done',
  Blocked = 'blocked',
}

export enum Priority {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export enum SprintStatus {
  Planning = 'planning',
  Active = 'active',
  Completed = 'completed',
}

export enum ChangelogAction {
  Created = 'created',
  Updated = 'updated',
  Deleted = 'deleted',
  Moved = 'moved',
  Reassigned = 'reassigned',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum ChangelogEntityType {
  Initiative = 'initiative',
  Epic = 'epic',
  Story = 'story',
}

// === DIAGRAM TYPES ===

export type DiagramNodeType = 'service' | 'database' | 'queue' | 'gateway' | 'external' | 'client' | 'process' | 'decision' | 'actor';

export interface DiagramNode {
  id: string;
  type: DiagramNodeType;
  label: string;
  description?: string;
  group?: string; // visual grouping (e.g. "backend", "frontend", "external")
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  sourceHandle?: string; // e.g. 'right', 'left', 'bottom'
  targetHandle?: string;
}

export interface EpicDiagram {
  id: string;
  name: string;
  type: 'technical' | 'business';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  generatedAt: string;
  generatedBy: 'ai' | 'manual';
}

// === QA MATRIX TYPES ===

export type TestCaseStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped';
export type TestCasePriority = 'critical' | 'high' | 'medium' | 'low';
export type AutomationStatus = 'manual' | 'automated' | 'to_automate';

export type TestEnvironment = 'development' | 'staging' | 'production';

export interface TestExecution {
  id: string;
  executedAt: string; // ISO datetime
  environment: TestEnvironment;
  status: TestCaseStatus;
  duration: number; // milliseconds
  executedBy: string | null;
  notes: string;
}

export interface TestTrend {
  passRate: number; // 0-100, rolling average of last N executions
  flakyScore: number; // 0-100, frequency of status flips
  avgDuration: number; // milliseconds, average execution time
  failureFrequency: number; // failures in last N executions
  lastExecutions: TestExecution[];
}

export interface GherkinScenario {
  id: string;
  name: string;
  given: string; // precondition
  when: string; // action/trigger
  then: string; // expected outcome
  tags: string[]; // e.g. ['@smoke', '@regression', '@critical']
}

// --- Story-level (functional) QA types ---

export interface QATestCase {
  id: string;
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string | null;
  automationStatus: AutomationStatus;
  linkedDefects: string[];
  executionHistory: TestExecution[];
  trend: TestTrend | null;
}

export interface QAMatrixRow {
  storyId: string;
  storyTitle: string;
  storyJiraKey: string;
  acceptanceCriteria: string[];
  testCases: QATestCase[];
  coverage: number; // 0-100 percentage
}

export interface QAMatrix {
  id: string;
  epicId: string;
  rows: QAMatrixRow[];
  generatedAt: string; // ISO date
  generatedBy: 'ai' | 'manual';
  updatedAt: string;
}

// --- Epic-level (systemic) QA types ---

export type EpicQATestCategory =
  | 'integration'
  | 'e2e'
  | 'performance'
  | 'security'
  | 'compatibility'
  | 'reliability'
  | 'safety'
  | 'usability'
  | 'maintainability';

export const EPIC_QA_CATEGORY_LABELS: Record<EpicQATestCategory, string> = {
  integration: 'Integración',
  e2e: 'End-to-End',
  performance: 'Performance',
  security: 'Seguridad',
  compatibility: 'Compatibilidad',
  reliability: 'Fiabilidad',
  safety: 'Seguridad Operativa',
  usability: 'Usabilidad',
  maintainability: 'Mantenibilidad',
};

export const EPIC_QA_CATEGORY_DESCRIPTIONS: Record<EpicQATestCategory, string> = {
  integration: 'Interacción entre módulos y servicios de la épica',
  e2e: 'Flujos completos de usuario de punta a punta',
  performance: 'Tiempos de respuesta, carga y throughput',
  security: 'Vulnerabilidades, acceso y encriptación',
  compatibility: 'Cross-browser, cross-platform y API versioning',
  reliability: 'Tolerancia a fallos y recuperación',
  safety: 'Restricciones operativas, fail-safe y advertencias de riesgo',
  usability: 'Accesibilidad, inclusividad y experiencia de interacción',
  maintainability: 'Modularidad, testabilidad y facilidad de modificación',
};

export interface EpicQATest {
  id: string;
  category: EpicQATestCategory;
  title: string;
  description: string;
  scenarios: string[];
  gherkinScenarios: GherkinScenario[];
  dependencies: string[];
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string | null;
  automationStatus: AutomationStatus;
  linkedDefects: string[];
  riskLikelihood: 1 | 2 | 3 | 4 | 5;
  riskImpact: 1 | 2 | 3 | 4 | 5;
  executionHistory: TestExecution[];
  trend: TestTrend | null;
}

export interface EpicQAMatrix {
  id: string;
  epicId: string;
  tests: EpicQATest[];
  nfrCoverage: Record<EpicQATestCategory, number>; // category → 0-100%
  generatedAt: string;
  generatedBy: 'ai' | 'manual';
  updatedAt: string;
}

export type QAApproval = {
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  comment: string | null;
};

// === DEPENDENCY TYPES ===

export type DependencyType = 'technical' | 'resource' | 'knowledge' | 'external' | 'cross-team';
export type DependencyDirection = 'depends_on' | 'depended_on_by';
export type DependencyStatus = 'identified' | 'in_progress' | 'resolved' | 'blocked' | 'mitigated';
export type DependencyScheduling = 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';

export interface EpicDependency {
  id: string;
  title: string;
  description: string;
  type: DependencyType;
  direction: DependencyDirection;
  scheduling: DependencyScheduling;
  status: DependencyStatus;
  severity: Priority; // reuse Priority enum: critical, high, medium, low
  isBlocking: boolean;
  targetEpicId: string | null; // null for external dependencies
  targetExternalName: string | null; // for external deps: team/vendor name
  owner: string; // person responsible for resolution
  dueDate: string | null; // ISO date
  resolutionNotes: string;
  createdAt: string;
  updatedAt: string;
}

// === DOCUMENT TYPE ===

export type DocumentFormat = 'pdf' | 'excel' | 'word' | 'csv';

export interface EpicDocumentSection {
  id: string;
  title: string;
  content: string; // Markdown-like text content
}

export interface EpicDocument {
  id: string;
  name: string;
  type: 'pdf' | 'excel' | 'diagram' | 'image' | 'other';
  url: string; // mock URL or blob path
  uploadedBy: string;
  uploadedAt: string; // ISO date
  size: string; // human-readable, e.g. "2.4 MB"
  // AI-generated document fields
  sections?: EpicDocumentSection[];
  generatedBy?: 'ai' | 'manual';
  format?: DocumentFormat;
}

// === INTERFACES ===

export interface Initiative {
  id: string;
  name: string;
  description: string;
  status: InitiativeStatus;
  startDate: string; // ISO date
  targetDate: string; // ISO date
  owner: string; // name of the initiative owner
  epicIds: string[];
  documents: EpicDocument[];
}

export interface Epic {
  id: string;
  title: string;
  description: string;
  qualitativeBenefits: string;
  quantitativeBenefits: string;
  benefitsMeasurement: string;
  scopeDescription: string;
  acceptanceCriteria: string;
  technologicalImprovements: string;
  businessPriority: string;
  teamsInvolved: string;
  impactedChannels: string;
  impactedFlows: string;
  impactSabreLevel: string;
  thirdPartyDependencies: string;
  status: EpicStatus;
  priority: Priority;
  initiativeId: string;
  podIds: string[]; // many-to-many: epic can belong to multiple PODs
  tracker?: TrackerReference;
  startDate: string;
  targetDate: string;
  documents: EpicDocument[];
  diagrams: EpicDiagram[];
  dependencies: EpicDependency[];
  poApproval: {
    status: 'pending' | 'approved' | 'rejected';
    approvedBy: string | null; // PO id
    approvedAt: string | null; // ISO date
    comment: string | null;
  } | null;
  tlApproval: {
    status: 'pending' | 'approved' | 'rejected';
    approvedBy: string | null; // TL name
    approvedAt: string | null; // ISO date
    comment: string | null;
  } | null;
  qaMatrix: QAMatrix | null;
  qaApproval: QAApproval | null;
  epicQAMatrix: EpicQAMatrix | null;
  createdAt: string;
  updatedAt: string;
}

/** Epica propuesta por el agente IA, antes de ser persistida. */
export type ProposedEpic = Omit<
  Epic,
  | 'id' | 'createdAt' | 'updatedAt'
  | 'documents' | 'diagrams' | 'dependencies'
  | 'poApproval' | 'tlApproval' | 'qaMatrix' | 'qaApproval' | 'epicQAMatrix'
  | 'tracker'
> & {
  clientId: string; // ID local para tracking en staging
};

/** Fases del agente de generacion de epicas. */
export type EpicGenerationPhase = 'idle' | 'researching' | 'analyzing' | 'proposing' | 'done';

/** Base fields present on every SSE event. */
interface EpicGenerationEventBase {
  timestamp?: string;
}

/** Eventos SSE emitidos durante la generacion de epicas. */
export type EpicGenerationEvent =
  | (EpicGenerationEventBase & { type: 'run_started' })
  | (EpicGenerationEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (EpicGenerationEventBase & { type: 'phase_change'; phase: EpicGenerationPhase; label: string })
  | (EpicGenerationEventBase & { type: 'thinking'; delta: string })
  | (EpicGenerationEventBase & { type: 'step_start'; step: string; label?: string; tool?: string; toolArgs?: Record<string, unknown> })
  | (EpicGenerationEventBase & { type: 'step_done'; step: string; tool?: string; summary?: string; durationMs?: number; resultPreview?: string })
  | (EpicGenerationEventBase & { type: 'tool_progress'; tool: string; detail: string })
  | (EpicGenerationEventBase & { type: 'proposal_ready'; epic: ProposedEpic })
  | (EpicGenerationEventBase & { type: 'done' })
  | (EpicGenerationEventBase & { type: 'error'; message: string });

/** Cached generation session stored in Redis. */
export interface CachedGenerationSession {
  initiativeId: string;
  status: 'streaming' | 'staging';
  proposals: ProposedEpic[];
  events: EpicGenerationEvent[];
  createdAt: string;
  completedAt?: string;
  ttlSeconds: number;
}

// --- Story generation (AI agent) types ---

/** Fases de los 3 agentes especializados durante la generacion de historias. */
export type StoryGenerationPhase =
  | 'idle'
  | 'researching'      // Investigacion inicial (documentos + vault + codigo)
  | 'drafting_po'      // Agente PO redactando antecedentes/objetivo/criterios
  | 'drafting_technical' // Agente Tech Lead detallando arquitectura/flujo/validaciones
  | 'drafting_qa'      // Agente QA generando estrategia de testing + casos unitarios
  | 'proposing'        // Consolidando y emitiendo propuestas
  | 'done';

/**
 * Rol del agente activo durante un step. Permite a la UI rotular que "sombrero"
 * esta usando el agente en cada momento (PO / Tech Lead / QA).
 */
export type StoryAgentRole = 'po' | 'technical' | 'qa' | 'orchestrator';

interface StoryGenerationEventBase {
  timestamp?: string;
}

/** Eventos SSE emitidos durante la generacion de historias. */
export type StoryGenerationEvent =
  | (StoryGenerationEventBase & { type: 'run_started' })
  | (StoryGenerationEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (StoryGenerationEventBase & { type: 'phase_change'; phase: StoryGenerationPhase; label: string; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'thinking'; delta: string; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'step_start'; step: string; label?: string; tool?: string; toolArgs?: Record<string, unknown>; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'step_done'; step: string; tool?: string; summary?: string; durationMs?: number; resultPreview?: string; role?: StoryAgentRole })
  | (StoryGenerationEventBase & { type: 'proposal_ready'; story: ProposedStory })
  | (StoryGenerationEventBase & { type: 'done' })
  | (StoryGenerationEventBase & { type: 'error'; message: string });

/** Cached story generation session stored in Redis, keyed por epicId. */
export interface CachedStoryGenerationSession {
  epicId: string;
  status: 'streaming' | 'staging';
  proposals: ProposedStory[];
  events: StoryGenerationEvent[];
  createdAt: string;
  completedAt?: string;
  ttlSeconds: number;
}

// --- Story section types ---

export interface StoryPOFields {
  background: string; // Antecedentes
  objective: string; // Objetivo
  userStory: string; // Historia de usuario (Como... Quiero... Para...)
  whatHowWhen: { what: string; how: string; when: string };
  acceptanceCriteria: string[];
  additionalNotes: string; // Notas adicionales (opcional)
}

export interface StoryTechnicalFields {
  architecture: string; // Arquitectura y componentes
  integrationFlow: string; // Flujo de integración propuesto
  validations: string[]; // Validaciones requeridas
  errorHandling: string[]; // Manejo de errores
  implementationChecklist: string[]; // Checklist de implementación
}

export interface StoryQAFields {
  testingStrategy: string; // Testing Strategy
  linkedQAMatrixId: string | null; // Reference to epic's QAMatrix row for this story
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  status: StoryStatus;
  storyPoints: number; // fibonacci: 1, 2, 3, 5, 8, 13
  epicId: string;
  podId: string; // each story belongs to ONE pod
  sprintId: string | null;
  tracker?: TrackerReference;
  labels: string[];
  // Structured sections
  po: StoryPOFields;
  technical: StoryTechnicalFields;
  qa: StoryQAFields;
  createdAt: string;
  updatedAt: string;
}

/**
 * Output del Agente PO (Product Owner). Contiene los meta-datos de la historia
 * y la seccion de negocio. Se pasa literalmente al Agente Tech Lead como input.
 */
export interface StoryOutline {
  title: string;
  description: string;
  storyPoints: number; // fibonacci
  podId: string;
  labels: string[];
  po: StoryPOFields;
}

/**
 * Documento de la iniciativa/epica padre que el agente PO identifico como
 * relevante para la historia. Se persiste como .md individual en
 * `stories/<folder>/documentos-epica/<slug>.md`.
 */
export interface RelatedDocument {
  docId: string;          // id del documento en initiative.documents
  docName: string;        // nombre original del archivo
  bucketUrl: string;      // ruta del bucket (ej: /api/documents/file/initiatives/xxx/...)
  relevanceSummary: string; // 1-2 parrafos del agente explicando por que aplica
}

/** Severidad de una dependencia descubierta (align con Priority enum). */
export type DependencySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Clasificacion de una dependencia descubierta por el agente QA.
 * Diferente de `DependencyType` (usado en EpicDependency) — aquel tiene
 * semantica de direccion entre epicas; este solo categoriza el origen.
 */
export type DiscoveredDependencyType = 'api' | 'service' | 'data' | 'team' | 'other';

/**
 * Dependencia descubierta por el agente QA al trazar la estrategia de testing.
 * Se persiste como .md individual en `stories/<folder>/dependencias/<slug>.md`.
 */
export interface DiscoveredDependency {
  id: string;               // clientId local (ai-dep-<uuid>)
  title: string;            // titulo corto
  description: string;      // resumen ejecutivo 1-2 lineas
  severity: DependencySeverity;
  type: DiscoveredDependencyType;
  mdContent: string;        // markdown extenso con detalles, refs, mitigacion
}

/**
 * Historia propuesta por los 3 agentes IA (PO + Tech Lead + QA),
 * antes de ser aceptada y persistida. Omite campos generados por el servidor.
 */
export type ProposedStory = Omit<
  UserStory,
  'id' | 'createdAt' | 'updatedAt' | 'tracker'
> & {
  clientId: string; // ID local para tracking en staging
  /** Documentos de la iniciativa detectados como relevantes por el agente PO. */
  relatedDocuments?: RelatedDocument[];
  /** Dependencias descubiertas por el agente QA durante el trazo de testing. */
  discoveredDependencies?: DiscoveredDependency[];
};

export interface Pod {
  id: string;
  name: string;
  description: string;
  color: string; // hex color for UI
}

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  podId: string;
  status: SprintStatus;
}

export interface ChangelogEntry {
  id: string;
  timestamp: string; // ISO datetime
  entityType: ChangelogEntityType;
  entityId: string;
  entityTitle: string;
  action: ChangelogAction;
  field: string | null; // null for 'created' action
  oldValue: string | null;
  newValue: string | null;
  changedBy: {
    id: string;
    name: string;
    avatarUrl: string;
  };
  changeReason: string | null;
}

// === SPRINT CEREMONY TYPES ===

export type CeremonyType =
  | 'planning'
  | 'review'
  | 'retro'
  | 'release'
  | 'pi_planning'
  | 'e2e'
  | 'cvt'
  | 'integration';

export interface SprintCeremony {
  id: string;
  sprintId: string | null;   // null for PI-level ceremonies
  type: CeremonyType;
  date: string;               // ISO date
  endDate?: string;           // For multi-day ceremonies (CVT, e2e)
  label?: string;             // Override default label
  podId?: string;             // Optional: pod-specific ceremony
  scope: 'sprint' | 'pi';    // Sprint-level or PI-level
}

// === COMPUTED / HELPER TYPES ===

export interface EpicWithRelations extends Epic {
  initiative: Initiative;
  pods: Pod[];
  stories: UserStory[];
  progress: number; // 0-100 percentage of done stories
}

export interface StoryWithRelations extends UserStory {
  epic: Epic;
  pod: Pod;
  sprint: Sprint | null;
}

export interface PodWithRelations extends Pod {
  stories: UserStory[];
  epics: Epic[];
}

export interface MatrizCell {
  podId: string;
  epicId: string;
  stories: UserStory[];
  totalStories: number;
  doneStories: number;
  blockedStories: number;
  totalPoints: number;
  donePoints: number;
  progress: number; // 0-100
}

export interface MatrizRow {
  epic: Epic;
  initiative: Initiative;
  cells: Record<string, MatrizCell>; // keyed by podId
}

// Filter state
export interface ProyectosFilters {
  initiativeIds: string[];
  podIds: string[];
  statuses: StoryStatus[];
  epicStatuses: EpicStatus[];
  priorities: Priority[];
  sprintId: string | null;
  dateRange: { from: string | null; to: string | null };
  storyPointsRange: { min: number | null; max: number | null };
  searchQuery: string;
  trackerKey: string;
}

export const DEFAULT_FILTERS: ProyectosFilters = {
  initiativeIds: [],
  podIds: [],
  statuses: [],
  epicStatuses: [],
  priorities: [],
  sprintId: null,
  dateRange: { from: null, to: null },
  storyPointsRange: { min: null, max: null },
  searchQuery: '',
  trackerKey: '',
};

