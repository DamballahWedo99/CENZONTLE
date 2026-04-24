import type { DiscoveredDependency, EpicDesign } from '@cenzontle/shared';
import { apiFetch } from './client';

export interface EpicResponse {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  startDate: string;
  targetDate: string;
  initiativeId: string;
  initiative: { id: string; name: string; status: string };
  podIds: string[];
  pods: { id: string; name: string; color: string }[];
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
  documents: any[];
  diagrams: any[];
  dependencies: any[];
  designs: EpicDesign[];
  designSkipped: boolean;
  poApproval: any;
  tlApproval: any;
  qaApproval: any;
  qaMatrix: any;
  epicQAMatrix: any;
  tracker: any;
  createdAt: string;
  updatedAt: string;
}

export function getEpics(params?: { initiativeId?: string; status?: string; priority?: string; podId?: string }) {
  const query = new URLSearchParams();
  if (params?.initiativeId) query.set('initiativeId', params.initiativeId);
  if (params?.status) query.set('status', params.status);
  if (params?.priority) query.set('priority', params.priority);
  if (params?.podId) query.set('podId', params.podId);
  const qs = query.toString();
  return apiFetch<EpicResponse[]>(`/proyectos/epicas${qs ? `?${qs}` : ''}`);
}

export function getEpic(id: string, includeContent = false) {
  const qs = includeContent ? '?includeContent=true' : '';
  return apiFetch<EpicResponse>(`/proyectos/epicas/${id}${qs}`);
}

export interface CreateEpicInput {
  title: string;
  description: string;
  status?: string;
  priority?: string;
  startDate: string;
  targetDate: string;
  initiativeId: string;
  podIds?: string[];
  // Campos narrativos (el backend los escribe a PG + markdown en el vault)
  qualitativeBenefits?: string;
  quantitativeBenefits?: string;
  benefitsMeasurement?: string;
  scopeDescription?: string;
  acceptanceCriteria?: string;
  technologicalImprovements?: string;
  businessPriority?: string;
  teamsInvolved?: string;
  impactedChannels?: string;
  impactedFlows?: string;
  impactSabreLevel?: string;
  thirdPartyDependencies?: string;
}

export function createEpic(data: CreateEpicInput) {
  return apiFetch<EpicResponse>('/proyectos/epicas', { method: 'POST', body: JSON.stringify(data) });
}

export function updateEpic(id: string, data: Record<string, any>) {
  return apiFetch<EpicResponse>(`/proyectos/epicas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteEpic(id: string) {
  return apiFetch<void>(`/proyectos/epicas/${id}`, { method: 'DELETE' });
}

export function getDiscoveredDependencies(epicId: string) {
  return apiFetch<DiscoveredDependency[]>(`/proyectos/epicas/${epicId}/discovered-dependencies`);
}

/**
 * Item del DAG: historia bloqueada + lista de sus bloqueantes directos.
 * El backend ya resuelve los títulos de ambas puntas para evitar N+1 lookups.
 */
export interface StoryDependencyItem {
  story: { id: string; title: string };
  blockedBy: Array<{
    story: { id: string; title: string };
    hardness: 'hard' | 'soft' | string;
    reason: 'api_contract' | 'migration_order' | 'shared_model' | 'sequential_logic' | 'other' | string;
    description: string;
  }>;
}

export function getStoryDependencies(epicId: string) {
  return apiFetch<StoryDependencyItem[]>(`/proyectos/epicas/${epicId}/story-dependencies`);
}
