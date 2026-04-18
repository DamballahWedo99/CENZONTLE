import { apiFetch } from './client';

export type VaultCloneStatus = 'pending' | 'cloning' | 'ready' | 'error' | 'stale';

export interface VaultConfig {
  id: string;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  isActive: boolean;
  hasToken: boolean;
  tokenPreview: string;
  allowedPodIds: string[];
  roleDefaults: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  cloneStatus: VaultCloneStatus;
  lastSyncedSha: string | null;
  lastPulledAt: string | null;
  lastSyncError: string | null;
}

export interface VaultSyncResult {
  ok: boolean;
  sha?: string;
  message?: string;
}

export interface CreateVaultConfigInput {
  name: string;
  owner: string;
  repo: string;
  branch?: string;
  token: string;
  allowedPodIds?: string[];
  roleDefaults?: Record<string, string>;
}

export interface UpdateVaultConfigInput {
  name?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  allowedPodIds?: string[];
  roleDefaults?: Record<string, string>;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export function getVaultConfigs() {
  return apiFetch<VaultConfig[]>('/vault/configs');
}

export function getAccessibleVaultConfigs() {
  return apiFetch<VaultConfig[]>('/vault/configs/accessible');
}

export function getVaultConfig(id: string) {
  return apiFetch<VaultConfig>(`/vault/configs/${id}`);
}

export function createVaultConfig(data: CreateVaultConfigInput) {
  return apiFetch<VaultConfig>('/vault/configs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateVaultConfig(id: string, data: UpdateVaultConfigInput) {
  return apiFetch<VaultConfig>(`/vault/configs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteVaultConfig(id: string) {
  return apiFetch<void>(`/vault/configs/${id}`, { method: 'DELETE' });
}

export function activateVaultConfig(id: string) {
  return apiFetch<VaultConfig>(`/vault/configs/${id}/activate`, { method: 'POST' });
}

export function testVaultConfig(id: string) {
  return apiFetch<TestConnectionResult>(`/vault/configs/${id}/test`, { method: 'POST' });
}

export function syncVaultConfig(id: string) {
  return apiFetch<VaultSyncResult>(`/vault/configs/${id}/sync`, { method: 'POST' });
}

export function getVaultCloneStatus(id: string) {
  return apiFetch<{
    status: VaultCloneStatus;
    lastPulledAt: string | null;
    sha: string | null;
    error: string | null;
  }>(`/vault/configs/${id}/status`);
}
