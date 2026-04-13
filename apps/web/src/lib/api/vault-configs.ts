import { apiFetch } from './client';

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
