// === Access Control Types (ReBAC) ===

import { UserRole } from './auth';

export type AccessLevel = 'owner' | 'editor' | 'viewer' | 'none';

export const ACCESS_LEVEL_HIERARCHY: Record<AccessLevel, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  none: 0,
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector',
  none: 'Sin acceso',
};

export const ACCESS_LEVEL_COLORS: Record<AccessLevel, string> = {
  owner: '#8b5cf6',
  editor: '#3b82f6',
  viewer: '#10b981',
  none: '#6b7280',
};

export type PrincipalType = 'user' | 'role';

export interface AccessControlEntry {
  id: string;
  nodeId: string;
  principalType: PrincipalType;
  principalId: string; // userId or UserRole value
  accessLevel: AccessLevel;
  inherited: boolean;
  inheritedFrom?: string;
  grantedBy: string;
  grantedAt: string;
}

export interface NodeAccessConfig {
  nodeId: string;
  inheritFromParent: boolean;
  entries: AccessControlEntry[];
}

export interface VaultConfig {
  id: string;
  name: string;
  host: string;
  port: string;
  protocol: 'https' | 'http';
  apiKey: string;
  vaultPath: string;
  status: 'connected' | 'disconnected' | 'error';
  allowedPodIds: string[];
  createdAt: string;
}

export const DEFAULT_ROLE_ACCESS: Record<UserRole, AccessLevel> = {
  [UserRole.AltaGerencia]: 'owner',
  [UserRole.ProductOwner]: 'editor',
  [UserRole.TechLead]: 'editor',
  [UserRole.QA]: 'viewer',
  [UserRole.Viewer]: 'viewer',
};
