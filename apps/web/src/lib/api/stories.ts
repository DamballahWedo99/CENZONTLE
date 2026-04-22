import { apiFetch } from './client';

export interface StoryPoFields {
  background?: string;
  objective?: string;
  userStory?: string;
  whatHowWhen?: string;
  acceptanceCriteria?: string;
  additionalNotes?: string;
}

export interface StoryTechnicalFields {
  architecture?: string;
  integrationFlow?: string;
  validations?: string[];
  errorHandling?: string[];
  implementationChecklist?: string[];
}

export interface StoryQaFields {
  testingStrategy?: string;
  linkedQAMatrixId?: string;
}

export interface StoryResponse {
  id: string;
  title: string;
  status: string;
  storyPoints: number;
  epicId: string;
  podId: string;
  sprintId: string | null;
  labels: string[];
  tracker: any;
  vaultPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryWithContentResponse extends StoryResponse {
  content?: {
    po: StoryPoFields;
    technical: StoryTechnicalFields;
    qa: StoryQaFields;
  };
}

export interface RelatedDocumentInput {
  docId: string;
  docName: string;
  bucketUrl: string;
  relevanceSummary: string;
}

export interface DiscoveredDependencyInput {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'api' | 'service' | 'data' | 'team' | 'other';
  mdContent: string;
}

export interface StoryOrderDependencyInput {
  /** clientId (staging) o storyId real de la historia que bloquea. */
  storyClientId: string;
  hardness: 'hard' | 'soft';
  reason: 'api_contract' | 'migration_order' | 'shared_model' | 'sequential_logic' | 'other';
  description: string;
}

export interface CreateStoryInput {
  title: string;
  epicId: string;
  podId: string;
  status?: string;
  storyPoints?: number;
  sprintId?: string;
  labels?: string[];
  po?: StoryPoFields;
  technical?: StoryTechnicalFields;
  qa?: StoryQaFields;
  relatedDocuments?: RelatedDocumentInput[];
  discoveredDependencies?: DiscoveredDependencyInput[];
  /** clientId de staging — ancla para resolución de DAG de orden. */
  sourceClientId?: string;
  /** DAG de orden entre historias del MISMO batch (emitido por el TL). */
  blockedBy?: StoryOrderDependencyInput[];
}

export function getStories(params?: { epicId?: string; podId?: string; status?: string }) {
  const query = new URLSearchParams();
  if (params?.epicId) query.set('epicId', params.epicId);
  if (params?.podId) query.set('podId', params.podId);
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch<StoryResponse[]>(`/proyectos/historias${qs ? `?${qs}` : ''}`);
}

export function getStory(id: string, includeContent = false) {
  const qs = includeContent ? '?includeContent=true' : '';
  return apiFetch<StoryWithContentResponse>(`/proyectos/historias/${id}${qs}`);
}

export function createStory(data: CreateStoryInput) {
  return apiFetch<StoryResponse>('/proyectos/historias', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateStory(id: string, data: Partial<CreateStoryInput>) {
  return apiFetch<StoryResponse>(`/proyectos/historias/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteStory(id: string) {
  return apiFetch<void>(`/proyectos/historias/${id}`, { method: 'DELETE' });
}
