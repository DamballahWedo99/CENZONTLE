import { apiFetch } from './client';

export type CodeRepoCloneStatus = 'pending' | 'cloning' | 'ready' | 'error' | 'stale';

export interface CodeRepository {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  isActive: boolean;
  /** Cuando true, el Forge puede clonar+commitear+pushear+abrir PRs en este repo.
   *  Independiente de `isActive` (que solo da acceso de lectura a agentes). */
  forgeWritable: boolean;
  hasToken: boolean;
  tokenPreview: string;
  cloneStatus: CodeRepoCloneStatus;
  clonedAtPath: string | null;
  lastPulledAt: string | null;
  lastSyncedSha: string | null;
  lastSyncError: string | null;
  allowedPodIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCodeRepositoryInput {
  name: string;
  owner: string;
  repo: string;
  branch?: string;
  token: string;
  allowedPodIds?: string[];
}

export interface UpdateCodeRepositoryInput {
  name?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  allowedPodIds?: string[];
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export interface SyncResult {
  ok: boolean;
  sha?: string;
  message?: string;
}

export interface CloneStatusInfo {
  status: CodeRepoCloneStatus;
  lastPulledAt: string | null;
  sha: string | null;
  error: string | null;
}

// ── CRUD ──

export function getCodeRepositories() {
  return apiFetch<CodeRepository[]>('/code-repositories');
}

export function getAccessibleCodeRepositories() {
  return apiFetch<CodeRepository[]>('/code-repositories/accessible');
}

export function getCodeRepository(id: string) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}`);
}

export function createCodeRepository(data: CreateCodeRepositoryInput) {
  return apiFetch<CodeRepository>('/code-repositories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCodeRepository(id: string, data: UpdateCodeRepositoryInput) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteCodeRepository(id: string) {
  return apiFetch<void>(`/code-repositories/${id}`, { method: 'DELETE' });
}

export function enableCodeRepository(id: string) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}/enable`, { method: 'POST' });
}

export function disableCodeRepository(id: string) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}/disable`, { method: 'POST' });
}

/** Activa "el Forge puede ESCRIBIR en este repo" (clone+commit+push+PR).
 *  Requiere que `isActive=true`. Opt-in defensivo. */
export function enableForgeWritable(id: string) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}/forge-writable/enable`, {
    method: 'POST',
  });
}

/** Quita permiso de escritura del Forge (vuelve a read-only). */
export function disableForgeWritable(id: string) {
  return apiFetch<CodeRepository>(`/code-repositories/${id}/forge-writable/disable`, {
    method: 'POST',
  });
}

export function testCodeRepository(id: string) {
  return apiFetch<TestConnectionResult>(`/code-repositories/${id}/test`, { method: 'POST' });
}

// ── Clone lifecycle ──

export function syncCodeRepository(id: string) {
  return apiFetch<SyncResult>(`/code-repositories/${id}/sync`, { method: 'POST' });
}

export function getCodeRepositoryStatus(id: string) {
  return apiFetch<CloneStatusInfo>(`/code-repositories/${id}/status`);
}
