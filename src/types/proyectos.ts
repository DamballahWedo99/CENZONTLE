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

export interface QATestCase {
  id: string;
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string | null;
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
  jiraKey: string; // e.g. "GAM-123"
  startDate: string;
  targetDate: string;
  documents: EpicDocument[];
  diagrams: EpicDiagram[];
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
  qaApproval: {
    status: 'pending' | 'approved' | 'rejected';
    approvedBy: string | null;
    approvedAt: string | null;
    comment: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
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
  productOwnerId: string;
  sprintId: string | null;
  jiraKey: string; // e.g. "GAM-456"
  labels: string[];
  // Structured sections
  po: StoryPOFields;
  technical: StoryTechnicalFields;
  qa: StoryQAFields;
  createdAt: string;
  updatedAt: string;
}

export interface Pod {
  id: string;
  name: string;
  description: string;
  productOwnerIds: string[]; // a POD can have multiple POs
  color: string; // hex color for UI
}

export interface ProductOwner {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  podIds: string[];
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
  productOwner: ProductOwner;
  sprint: Sprint | null;
}

export interface PodWithRelations extends Pod {
  productOwners: ProductOwner[];
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
  productOwnerIds: string[];
  statuses: StoryStatus[];
  epicStatuses: EpicStatus[];
  priorities: Priority[];
  sprintId: string | null;
  dateRange: { from: string | null; to: string | null };
  storyPointsRange: { min: number | null; max: number | null };
  searchQuery: string;
  jiraKey: string;
}

export const DEFAULT_FILTERS: ProyectosFilters = {
  initiativeIds: [],
  podIds: [],
  productOwnerIds: [],
  statuses: [],
  epicStatuses: [],
  priorities: [],
  sprintId: null,
  dateRange: { from: null, to: null },
  storyPointsRange: { min: null, max: null },
  searchQuery: '',
  jiraKey: '',
};
