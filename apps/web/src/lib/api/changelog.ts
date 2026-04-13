import { apiFetch } from './client';

export interface ChangelogEntryResponse {
  id: string;
  timestamp: string;
  entityType: string;
  entityId: string;
  entityTitle: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedById: string | null;
  changedByName: string | null;
}

export interface CreateChangelogInput {
  entityType: string;
  entityId: string;
  entityTitle: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}

export function getChangelog(entityType?: string, entityId?: string) {
  const query = new URLSearchParams();
  if (entityType) query.set('entityType', entityType);
  if (entityId) query.set('entityId', entityId);
  const qs = query.toString();
  return apiFetch<ChangelogEntryResponse[]>(`/proyectos/changelog${qs ? `?${qs}` : ''}`);
}

export function createChangelogEntry(data: CreateChangelogInput) {
  return apiFetch<ChangelogEntryResponse>('/proyectos/changelog', { method: 'POST', body: JSON.stringify(data) });
}

export function createChangelogBatch(entries: CreateChangelogInput[]) {
  return apiFetch<{ count: number }>('/proyectos/changelog/batch', { method: 'POST', body: JSON.stringify(entries) });
}
