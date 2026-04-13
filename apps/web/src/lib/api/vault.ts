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

export function getVaultTree(folder = '') {
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  return apiFetch<VaultTreeNode[]>(`/vault/tree${qs}`);
}

export function getVaultFile(path: string) {
  return apiFetch<VaultFile>(`/vault/file?path=${encodeURIComponent(path)}`);
}

export function writeVaultFile(path: string, content: string, message?: string) {
  return apiFetch<VaultFile>('/vault/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content, message }),
  });
}

export function deleteVaultFile(path: string, message?: string) {
  return apiFetch<void>('/vault/file', {
    method: 'DELETE',
    body: JSON.stringify({ path, message }),
  });
}

export interface VaultCommit {
  sha: string;
  message: string;
  authorName: string;
  date: string;
}

export function getVaultChangelog(limit = 30) {
  return apiFetch<VaultCommit[]>(`/vault/changelog?limit=${limit}`);
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

export function getVaultCommitDetail(sha: string) {
  return apiFetch<VaultCommitDetail>(`/vault/changelog/${sha}`);
}
