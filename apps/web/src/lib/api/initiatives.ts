import { apiFetch } from './client';
import type { EpicDocument, TrackerReference } from '@cenzontle/shared';

export interface InitiativeResponse {
  id: string;
  name: string;
  description: string;
  status: string;
  /** ISO date. Null si la iniciativa está en planning sin fechas comprometidas. */
  startDate: string | null;
  /** ISO date. Null si la iniciativa está en planning sin fechas comprometidas. */
  targetDate: string | null;
  owner: string;
  documents: EpicDocument[];
  tracker: TrackerReference | null;
  epics: {
    id: string;
    title: string;
    status: string;
    priority: string;
    pods: { pod: { id: string; name: string; color: string } }[];
  }[];
  createdAt: string;
  updatedAt: string;
}

export function getInitiatives(params?: { status?: string; search?: string }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  return apiFetch<InitiativeResponse[]>(`/proyectos/iniciativas${qs ? `?${qs}` : ''}`);
}

export function getInitiative(id: string) {
  return apiFetch<InitiativeResponse>(`/proyectos/iniciativas/${id}`);
}

export function createInitiative(data: { name: string; description: string; status?: string; startDate?: string; targetDate?: string; owner: string }) {
  return apiFetch<InitiativeResponse>('/proyectos/iniciativas', { method: 'POST', body: JSON.stringify(data) });
}

export function updateInitiative(id: string, data: Partial<{ name: string; description: string; status: string; startDate: string | null; targetDate: string | null; owner: string }>) {
  return apiFetch<InitiativeResponse>(`/proyectos/iniciativas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteInitiative(id: string) {
  return apiFetch<void>(`/proyectos/iniciativas/${id}`, { method: 'DELETE' });
}
