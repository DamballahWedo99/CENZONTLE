import type { VaultConnectionsStatus } from '@cenzontle/shared';
import { apiFetch } from './client';

export interface VaultTreeNode {
  path: string;        // Full path relative to repo root
  name: string;        // Leaf segment
  type: 'file' | 'folder';
  size?: number;
  sha: string;
  children?: VaultTreeNode[];
}

export interface VaultFile {
  path: string;
  content: string;
  sha: string;
  updatedAt: string | null;
}

export interface VaultConfigInfo {
  owner: string;
  repo: string;
  branch: string;
  connected: boolean;
}

export function getVaultConfig() {
  return apiFetch<VaultConfigInfo>('/vault/config');
}

/**
 * @param vaultId opcional: si viene, lee de ese vault específico (browse-mode)
 *   sin tocar el activo. Sin este param, lee del activo (default).
 */
export function getVaultTree(folder = '', vaultId?: string) {
  const params = new URLSearchParams();
  if (folder) params.set('folder', folder);
  if (vaultId) params.set('vaultId', vaultId);
  const qs = params.toString();
  return apiFetch<VaultTreeNode[]>(`/vault/tree${qs ? `?${qs}` : ''}`);
}

export function getVaultFile(path: string, vaultId?: string) {
  const params = new URLSearchParams({ path });
  if (vaultId) params.set('vaultId', vaultId);
  return apiFetch<VaultFile>(`/vault/file?${params.toString()}`);
}

/**
 * @param vaultId opcional: escribe a un vault distinto del activo (browse-mode CRUD).
 *   Sin este param, escribe al activo (default — usado por flows automáticos
 *   como crear épica/historia que SIEMPRE deben ir al vinculado).
 */
export function writeVaultFile(path: string, content: string, message?: string, vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<VaultFile>(`/vault/file${qs}`, {
    method: 'PUT',
    body: JSON.stringify({ path, content, message }),
  });
}

export function deleteVaultFile(path: string, message?: string, vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<void>(`/vault/file${qs}`, {
    method: 'DELETE',
    body: JSON.stringify({ path, message }),
  });
}

/**
 * Mapa path → tags de TODOS los documentos del vault. Alimenta la vista de
 * grafo: sin esto, los nodos solo tendrían tags de los docs ya abiertos.
 */
export function getAllVaultTags(vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<Record<string, string[]>>(`/vault/tags${qs}`);
}

// Contrato compartido con la API — vive en @cenzontle/shared (types/vault.ts);
// se re-exporta aquí para que los consumidores del cliente HTTP tengan todo
// el contrato del vault en un solo import.
export type { VaultConnectionsStatus };

/**
 * Dispara el agente IA de conexiones (fire-and-forget en el backend).
 * Responde 202 con el snapshot inicial; el progreso se pollea con
 * getVaultConnectionsStatus. 409 si ya hay un job en curso.
 */
export function runVaultConnections(vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<VaultConnectionsStatus>(`/vault/connections${qs}`, { method: 'POST' });
}

export function getVaultConnectionsStatus(vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<VaultConnectionsStatus>(`/vault/connections/status${qs}`);
}

/**
 * Fecha ISO de la última generación de conexiones (derivada del git history
 * del vault), o null si nunca se generaron. Usada por el dashboard para
 * datar la última corrida sin necesidad de un job en curso.
 */
export function getVaultConnectionsLastRun(vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<{ lastRunAt: string | null }>(`/vault/connections/last-run${qs}`);
}

export interface VaultCommit {
  sha: string;
  message: string;
  authorName: string;
  date: string;
}

export function getVaultChangelog(limit = 30, vaultId?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (vaultId) params.set('vaultId', vaultId);
  return apiFetch<VaultCommit[]>(`/vault/changelog?${params.toString()}`);
}

export interface VaultCommitDetail {
  sha: string;
  message: string;
  authorName: string;
  date: string;
  beforeContent: string | null;
  afterContent: string | null;
  filename: string | null;
}

export function getVaultCommitDetail(sha: string, vaultId?: string) {
  const qs = vaultId ? `?vaultId=${encodeURIComponent(vaultId)}` : '';
  return apiFetch<VaultCommitDetail>(`/vault/changelog/${sha}${qs}`);
}
