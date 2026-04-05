'use client';

import React, { createContext, useContext, useReducer, useMemo, useCallback, useRef, ReactNode } from 'react';
import { DefinicionNode } from '@/types/definiciones';
import { mockDefiniciones } from '@/data/mock/definiciones';
import { mockAccessConfig, getDefaultAccessConfig } from '@/data/mock/definiciones-access';
import { useAuthContext } from '@/context/AuthContext';
import {
  AccessLevel,
  AccessControlEntry,
  NodeAccessConfig,
  ACCESS_LEVEL_HIERARCHY,
  DEFAULT_ROLE_ACCESS,
  PrincipalType,
  UserRole,
  VaultConfig,
} from '@cenzontle/shared';

export type SortOption = 'name-asc' | 'name-desc' | 'created-newest' | 'created-oldest' | 'updated-newest' | 'updated-oldest';

export type ChangelogAction = 'create' | 'edit' | 'delete' | 'rename' | 'move' | 'tags' | 'reorder' | 'access';

export interface ChangelogEntry {
  id: string;
  timestamp: string;
  action: ChangelogAction;
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'document';
  userId?: string;
  userName?: string;
  details?: {
    oldName?: string;
    newName?: string;
    parentName?: string;
    addedTags?: string[];
    removedTags?: string[];
    contentPreview?: string;
    previousContent?: string;
    newContent?: string;
    accessChange?: {
      principalName: string;
      principalType: PrincipalType;
      oldLevel?: AccessLevel;
      newLevel?: AccessLevel;
    };
  };
}

interface DefinicionesState {
  tree: DefinicionNode[];
  selectedId: string | null;
  expandedFolders: Set<string>;
  searchQuery: string;
  isEditing: boolean;
  sortBy: SortOption;
  changelog: ChangelogEntry[];
  accessConfig: Record<string, NodeAccessConfig>;
  roleDefaults: Record<UserRole, AccessLevel>;
  vaults: VaultConfig[];
  activeVaultId: string;
}

type DefinicionesAction =
  | { type: 'SELECT_NODE'; id: string | null }
  | { type: 'TOGGLE_FOLDER'; id: string }
  | { type: 'EXPAND_FOLDER'; id: string }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_EDITING' }
  | { type: 'UPDATE_CONTENT'; id: string; content: string; previousContent?: string }
  | { type: 'ADD_FOLDER'; parentId: string | null; name: string }
  | { type: 'ADD_DOCUMENT'; parentId: string; name: string }
  | { type: 'RENAME_NODE'; id: string; name: string }
  | { type: 'UPDATE_TAGS'; id: string; tags: string[] }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'MOVE_NODE'; nodeId: string; newParentId: string | null }
  | { type: 'REORDER_NODE'; nodeId: string; targetSiblingId: string; position: 'before' | 'after' }
  | { type: 'SET_SORT'; sortBy: SortOption }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'SET_INHERITANCE'; nodeId: string; inherit: boolean }
  | { type: 'ADD_ACCESS'; entry: AccessControlEntry }
  | { type: 'UPDATE_ACCESS'; entryId: string; nodeId: string; accessLevel: AccessLevel }
  | { type: 'REMOVE_ACCESS'; entryId: string; nodeId: string }
  | { type: 'SET_ROLE_DEFAULT'; role: UserRole; level: AccessLevel }
  | { type: 'ADD_VAULT'; vault: VaultConfig }
  | { type: 'UPDATE_VAULT'; vault: VaultConfig }
  | { type: 'REMOVE_VAULT'; vaultId: string }
  | { type: 'SET_ACTIVE_VAULT'; vaultId: string };

// === Tree helpers ===

function collectAllNodeIds(nodes: DefinicionNode[]): string[] {
  return nodes.flatMap(n => [n.id, ...(n.children ? collectAllNodeIds(n.children) : [])]);
}

function collectAllFolderIds(nodes: DefinicionNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      ids.push(node.id);
      if (node.children) {
        ids.push(...collectAllFolderIds(node.children));
      }
    }
  }
  return ids;
}

function findNodeById(nodes: DefinicionNode[], id: string): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function updateNodeInTree(nodes: DefinicionNode[], id: string, updater: (node: DefinicionNode) => DefinicionNode): DefinicionNode[] {
  return nodes.map(node => {
    if (node.id === id) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updater) };
    }
    return node;
  });
}

function isDescendantOf(nodes: DefinicionNode[], ancestorId: string, targetId: string): boolean {
  const ancestor = findNodeById(nodes, ancestorId);
  if (!ancestor || !ancestor.children) return false;
  for (const child of ancestor.children) {
    if (child.id === targetId) return true;
    if (child.children && isDescendantOf([child], child.id, targetId)) return true;
  }
  return false;
}

function findParentId(nodes: DefinicionNode[], targetId: string, currentParent: string | null = null): string | null | undefined {
  for (const node of nodes) {
    if (node.id === targetId) return currentParent;
    if (node.children) {
      const found = findParentId(node.children, targetId, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined; // not found in this subtree
}

function insertNodeAtPosition(nodes: DefinicionNode[], nodeToInsert: DefinicionNode, targetSiblingId: string, position: 'before' | 'after'): DefinicionNode[] {
  const result: DefinicionNode[] = [];
  for (const node of nodes) {
    if (node.id === targetSiblingId) {
      if (position === 'before') {
        result.push(nodeToInsert, node);
      } else {
        result.push(node, nodeToInsert);
      }
    } else {
      if (node.children) {
        result.push({ ...node, children: insertNodeAtPosition(node.children, nodeToInsert, targetSiblingId, position) });
      } else {
        result.push(node);
      }
    }
  }
  return result;
}

function addNodeToTree(nodes: DefinicionNode[], parentId: string | null, newNode: DefinicionNode): DefinicionNode[] {
  if (parentId === null) return [...nodes, newNode];
  return nodes.map(node => {
    if (node.id === parentId && node.type === 'folder') {
      return { ...node, children: [...(node.children || []), newNode], updatedAt: new Date().toISOString() };
    }
    if (node.children) {
      return { ...node, children: addNodeToTree(node.children, parentId, newNode) };
    }
    return node;
  });
}

function deleteNodeFromTree(nodes: DefinicionNode[], id: string): DefinicionNode[] {
  return nodes
    .filter(node => node.id !== id)
    .map(node => {
      if (node.children) {
        return { ...node, children: deleteNodeFromTree(node.children, id) };
      }
      return node;
    });
}

function sortTree(nodes: DefinicionNode[], sortBy: SortOption): DefinicionNode[] {
  const sorted = [...nodes].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc': return a.name.localeCompare(b.name, 'es');
      case 'name-desc': return b.name.localeCompare(a.name, 'es');
      case 'created-newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'created-oldest': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'updated-newest': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      case 'updated-oldest': return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      default: return 0;
    }
  });
  return sorted.map(node =>
    node.children ? { ...node, children: sortTree(node.children, sortBy) } : node,
  );
}

function filterTree(nodes: DefinicionNode[], query: string): DefinicionNode[] {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();
  return nodes.reduce<DefinicionNode[]>((acc, node) => {
    const nameMatch = node.name.toLowerCase().includes(lower);
    const tagMatch = node.tags?.some(t => t.toLowerCase().includes(lower));
    const contentMatch = node.content?.toLowerCase().includes(lower);

    if (nameMatch || tagMatch || contentMatch) {
      // Node matches → include with ALL children intact
      acc.push(node);
    } else if (node.type === 'folder' && node.children) {
      // Node doesn't match → check children recursively
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
    }
    return acc;
  }, []);
}

// === Access control helpers ===

export interface EffectiveAccess {
  level: AccessLevel;
  source: 'direct' | 'role' | 'inherited';
  sourceNodeId?: string;
}

export function getEffectiveAccess(
  userId: string,
  userRole: UserRole,
  nodeId: string,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel> = DEFAULT_ROLE_ACCESS,
): EffectiveAccess {
  const config = accessConfig[nodeId];

  if (config) {
    // 1. Direct user entry (highest priority)
    const userEntry = config.entries.find(e => e.principalType === 'user' && e.principalId === userId);
    if (userEntry) return { level: userEntry.accessLevel, source: 'direct' };

    // 2. Role entry
    const roleEntry = config.entries.find(e => e.principalType === 'role' && e.principalId === userRole);
    if (roleEntry) return { level: roleEntry.accessLevel, source: 'role' };

    // 3. Inherit from parent if enabled
    if (config.inheritFromParent) {
      const parentId = findParentId(fullTree, nodeId);
      if (parentId) {
        const parentAccess = getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults);
        return { ...parentAccess, source: 'inherited', sourceNodeId: parentAccess.sourceNodeId ?? parentId };
      }
      return { level: roleDefaults[userRole], source: 'role' };
    }

    // Has config, no matching entry, inheritance disabled → deny
    return { level: 'none', source: 'direct' };
  }

  // No config at all → inherit from parent, or use role defaults for root
  const parentId = findParentId(fullTree, nodeId);
  if (parentId) {
    const parentAccess = getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults);
    return { ...parentAccess, source: 'inherited', sourceNodeId: parentAccess.sourceNodeId ?? parentId };
  }
  return { level: roleDefaults[userRole], source: 'role' };
}

export function getParentEffectiveLevel(
  nodeId: string,
  userId: string,
  userRole: UserRole,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel> = DEFAULT_ROLE_ACCESS,
): AccessLevel {
  const parentId = findParentId(fullTree, nodeId);
  if (!parentId) return 'owner'; // root folders can have any level
  return getEffectiveAccess(userId, userRole, parentId, fullTree, accessConfig, roleDefaults).level;
}

function filterTreeByAccess(
  nodes: DefinicionNode[],
  userId: string,
  userRole: UserRole,
  fullTree: DefinicionNode[],
  accessConfig: Record<string, NodeAccessConfig>,
  roleDefaults: Record<UserRole, AccessLevel>,
): DefinicionNode[] {
  return nodes.reduce<DefinicionNode[]>((acc, node) => {
    const access = getEffectiveAccess(userId, userRole, node.id, fullTree, accessConfig, roleDefaults);
    if (access.level === 'none') return acc;

    if (node.type === 'folder' && node.children) {
      const filteredChildren = filterTreeByAccess(node.children, userId, userRole, fullTree, accessConfig, roleDefaults);
      acc.push({ ...node, children: filteredChildren });
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
}

// === Changelog helpers ===

function logEntry(action: ChangelogAction, nodeId: string, nodeName: string, nodeType: 'folder' | 'document', details?: ChangelogEntry['details']): ChangelogEntry {
  return { id: crypto.randomUUID(), timestamp: new Date().toISOString(), action, nodeId, nodeName, nodeType, details };
}

function addToChangelog(changelog: ChangelogEntry[], entry: ChangelogEntry): ChangelogEntry[] {
  // Deduplicate: skip if same action + node within 2 seconds
  const latest = changelog[0];
  if (latest && latest.action === entry.action && latest.nodeId === entry.nodeId) {
    const diff = new Date(entry.timestamp).getTime() - new Date(latest.timestamp).getTime();
    if (diff < 2000) return changelog;
  }
  return [entry, ...changelog];
}

// === State & Reducer ===

const defaultVaults: VaultConfig[] = [
  { id: 'vault-negocio', name: 'Negocio', host: '127.0.0.1', port: '27124', protocol: 'https', apiKey: '', vaultPath: '', status: 'disconnected', allowedPodIds: ['pod-1', 'pod-2', 'pod-3'], createdAt: '2026-01-15T10:00:00Z' },
  { id: 'vault-tecnico', name: 'Técnico', host: '127.0.0.1', port: '27125', protocol: 'https', apiKey: '', vaultPath: '', status: 'disconnected', allowedPodIds: ['pod-4'], createdAt: '2026-02-01T10:00:00Z' },
  { id: 'vault-operaciones', name: 'Operaciones', host: '127.0.0.1', port: '27126', protocol: 'https', apiKey: '', vaultPath: '', status: 'disconnected', allowedPodIds: ['pod-5'], createdAt: '2026-02-15T10:00:00Z' },
];

const initialState: DefinicionesState = {
  tree: mockDefiniciones,
  selectedId: null,
  expandedFolders: new Set<string>(),
  roleDefaults: { ...DEFAULT_ROLE_ACCESS },
  searchQuery: '',
  isEditing: false,
  sortBy: 'name-asc' as SortOption,
  changelog: [],
  accessConfig: mockAccessConfig,
  vaults: defaultVaults,
  activeVaultId: 'vault-negocio',
};

function reducer(state: DefinicionesState, action: DefinicionesAction): DefinicionesState {
  switch (action.type) {
    case 'SELECT_NODE':
      return { ...state, selectedId: action.id, isEditing: false };

    case 'TOGGLE_FOLDER': {
      const next = new Set(state.expandedFolders);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, expandedFolders: next };
    }

    case 'EXPAND_FOLDER': {
      const next = new Set(state.expandedFolders);
      next.add(action.id);
      return { ...state, expandedFolders: next };
    }

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };

    case 'TOGGLE_EDITING':
      return { ...state, isEditing: !state.isEditing };

    case 'UPDATE_CONTENT': {
      const contentNode = findNodeById(state.tree, action.id);
      const prevContent = action.previousContent ?? contentNode?.content ?? '';
      const contentChanged = prevContent.trim() !== action.content.trim();
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          content: action.content,
          updatedAt: new Date().toISOString(),
        })),
        changelog: contentChanged
          ? addToChangelog(state.changelog, logEntry('edit', action.id, contentNode?.name ?? '', contentNode?.type ?? 'document', {
              contentPreview: action.content.slice(0, 80).replace(/\n/g, ' '),
              previousContent: prevContent,
              newContent: action.content,
            }))
          : state.changelog,
      };
    }

    case 'ADD_FOLDER': {
      const newFolder: DefinicionNode = {
        id: `folder-${crypto.randomUUID()}`,
        name: action.name,
        type: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        children: [],
      };
      const next = new Set(state.expandedFolders);
      if (action.parentId) next.add(action.parentId);
      const parentFolder = action.parentId ? findNodeById(state.tree, action.parentId) : null;
      return {
        ...state,
        tree: addNodeToTree(state.tree, action.parentId, newFolder),
        expandedFolders: next,
        accessConfig: {
          ...state.accessConfig,
          [newFolder.id]: getDefaultAccessConfig(newFolder.id),
        },
        changelog: addToChangelog(state.changelog, logEntry('create', newFolder.id, action.name, 'folder', {
          parentName: parentFolder?.name ?? 'raíz',
        })),
      };
    }

    case 'ADD_DOCUMENT': {
      const newDoc: DefinicionNode = {
        id: `doc-${crypto.randomUUID()}`,
        name: action.name,
        type: 'document',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        content: `# ${action.name}\n\nDescribe esta definición aquí...\n`,
      };
      const next = new Set(state.expandedFolders);
      next.add(action.parentId);
      const docParent = findNodeById(state.tree, action.parentId);
      return {
        ...state,
        tree: addNodeToTree(state.tree, action.parentId, newDoc),
        selectedId: newDoc.id,
        expandedFolders: next,
        isEditing: true,
        accessConfig: {
          ...state.accessConfig,
          [newDoc.id]: getDefaultAccessConfig(newDoc.id),
        },
        changelog: addToChangelog(state.changelog, logEntry('create', newDoc.id, action.name, 'document', {
          parentName: docParent?.name ?? 'raíz',
          newContent: newDoc.content,
        })),
      };
    }

    case 'UPDATE_TAGS': {
      const tagNode = findNodeById(state.tree, action.id);
      const oldTags = tagNode?.tags ?? [];
      const added = action.tags.filter(t => !oldTags.includes(t));
      const removed = oldTags.filter(t => !action.tags.includes(t));
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          tags: action.tags,
          updatedAt: new Date().toISOString(),
        })),
        changelog: (added.length > 0 || removed.length > 0) ? addToChangelog(state.changelog, logEntry('tags', action.id, tagNode?.name ?? '', tagNode?.type ?? 'document', {
          addedTags: added.length > 0 ? added : undefined,
          removedTags: removed.length > 0 ? removed : undefined,
        })) : state.changelog,
      };
    }

    case 'RENAME_NODE': {
      const renNode = findNodeById(state.tree, action.id);
      return {
        ...state,
        tree: updateNodeInTree(state.tree, action.id, node => ({
          ...node,
          name: action.name,
          updatedAt: new Date().toISOString(),
        })),
        changelog: addToChangelog(state.changelog, logEntry('rename', action.id, action.name, renNode?.type ?? 'document', {
          oldName: renNode?.name,
          newName: action.name,
        })),
      };
    }

    case 'DELETE_NODE': {
      const delNode = findNodeById(state.tree, action.id);
      // Clean up accessConfig for the node and all its descendants
      const idsToRemove = new Set(delNode ? collectAllNodeIds([delNode]) : [action.id]);
      const cleanedAccess = Object.fromEntries(
        Object.entries(state.accessConfig).filter(([k]) => !idsToRemove.has(k)),
      );
      return {
        ...state,
        tree: deleteNodeFromTree(state.tree, action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        accessConfig: cleanedAccess,
        changelog: addToChangelog(state.changelog, logEntry('delete', action.id, delNode?.name ?? '', delNode?.type ?? 'document', {
          previousContent: delNode?.content,
        })),
      };
    }

    case 'MOVE_NODE': {
      if (action.nodeId === action.newParentId) return state;
      if (action.newParentId && isDescendantOf(state.tree, action.nodeId, action.newParentId)) return state;

      const nodeToMove = findNodeById(state.tree, action.nodeId);
      if (!nodeToMove) return state;

      const treeWithout = deleteNodeFromTree(state.tree, action.nodeId);
      const treeWithNew = addNodeToTree(treeWithout, action.newParentId, nodeToMove);

      const next = new Set(state.expandedFolders);
      if (action.newParentId) next.add(action.newParentId);
      const moveTarget = action.newParentId ? findNodeById(state.tree, action.newParentId) : null;

      return {
        ...state,
        tree: treeWithNew,
        expandedFolders: next,
        changelog: addToChangelog(state.changelog, logEntry('move', action.nodeId, nodeToMove.name, nodeToMove.type, {
          parentName: moveTarget?.name ?? 'raíz',
        })),
      };
    }

    case 'REORDER_NODE': {
      if (action.nodeId === action.targetSiblingId) return state;
      const nodeToReorder = findNodeById(state.tree, action.nodeId);
      if (!nodeToReorder) return state;

      const treeWithout = deleteNodeFromTree(state.tree, action.nodeId);
      const reorderedTree = insertNodeAtPosition(treeWithout, nodeToReorder, action.targetSiblingId, action.position);
      return { ...state, tree: reorderedTree };
    }

    case 'SET_SORT':
      return { ...state, sortBy: action.sortBy };

    case 'EXPAND_ALL':
      return { ...state, expandedFolders: new Set(collectAllFolderIds(state.tree)) };

    case 'COLLAPSE_ALL':
      return { ...state, expandedFolders: new Set() };

    // === Access control actions ===

    case 'SET_INHERITANCE': {
      const inheritNode = findNodeById(state.tree, action.nodeId);
      const existing = state.accessConfig[action.nodeId] ?? getDefaultAccessConfig(action.nodeId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: { ...existing, inheritFromParent: action.inherit },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, inheritNode?.name ?? '', inheritNode?.type ?? 'folder', {
          accessChange: {
            principalName: action.inherit ? 'Herencia activada' : 'Herencia desactivada',
            principalType: 'role',
          },
        })),
      };
    }

    case 'ADD_ACCESS': {
      const accessNode = findNodeById(state.tree, action.entry.nodeId);
      const existing = state.accessConfig[action.entry.nodeId] ?? getDefaultAccessConfig(action.entry.nodeId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.entry.nodeId]: {
            ...existing,
            entries: [...existing.entries, action.entry],
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.entry.nodeId, accessNode?.name ?? '', accessNode?.type ?? 'folder', {
          accessChange: {
            principalName: action.entry.principalId,
            principalType: action.entry.principalType,
            newLevel: action.entry.accessLevel,
          },
        })),
      };
    }

    case 'UPDATE_ACCESS': {
      const updateAccessNode = findNodeById(state.tree, action.nodeId);
      const existingConfig = state.accessConfig[action.nodeId];
      if (!existingConfig) return state;
      const oldEntry = existingConfig.entries.find(e => e.id === action.entryId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: {
            ...existingConfig,
            entries: existingConfig.entries.map(e =>
              e.id === action.entryId ? { ...e, accessLevel: action.accessLevel } : e,
            ),
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, updateAccessNode?.name ?? '', updateAccessNode?.type ?? 'folder', {
          accessChange: {
            principalName: oldEntry?.principalId ?? '',
            principalType: oldEntry?.principalType ?? 'role',
            oldLevel: oldEntry?.accessLevel,
            newLevel: action.accessLevel,
          },
        })),
      };
    }

    case 'REMOVE_ACCESS': {
      const removeNode = findNodeById(state.tree, action.nodeId);
      const removeConfig = state.accessConfig[action.nodeId];
      if (!removeConfig) return state;
      const removedEntry = removeConfig.entries.find(e => e.id === action.entryId);
      return {
        ...state,
        accessConfig: {
          ...state.accessConfig,
          [action.nodeId]: {
            ...removeConfig,
            entries: removeConfig.entries.filter(e => e.id !== action.entryId),
          },
        },
        changelog: addToChangelog(state.changelog, logEntry('access', action.nodeId, removeNode?.name ?? '', removeNode?.type ?? 'folder', {
          accessChange: {
            principalName: removedEntry?.principalId ?? '',
            principalType: removedEntry?.principalType ?? 'role',
            oldLevel: removedEntry?.accessLevel,
          },
        })),
      };
    }

    case 'SET_ROLE_DEFAULT':
      return {
        ...state,
        roleDefaults: { ...state.roleDefaults, [action.role]: action.level },
      };

    case 'ADD_VAULT':
      return { ...state, vaults: [...state.vaults, action.vault] };

    case 'UPDATE_VAULT':
      return { ...state, vaults: state.vaults.map(v => v.id === action.vault.id ? action.vault : v) };

    case 'REMOVE_VAULT': {
      const nextVaults = state.vaults.filter(v => v.id !== action.vaultId);
      const nextActiveId = state.activeVaultId === action.vaultId
        ? (nextVaults[0]?.id ?? '')
        : state.activeVaultId;
      return { ...state, vaults: nextVaults, activeVaultId: nextActiveId };
    }

    case 'SET_ACTIVE_VAULT':
      return { ...state, activeVaultId: action.vaultId };

    default:
      return state;
  }
}

// === Context ===

interface DefinicionesContextValue {
  state: DefinicionesState;
  selectedNode: DefinicionNode | null;
  filteredTree: DefinicionNode[];
  unfilteredTree: DefinicionNode[];
  changelog: ChangelogEntry[];
  accessConfig: Record<string, NodeAccessConfig>;
  selectNode: (id: string | null) => void;
  toggleFolder: (id: string) => void;
  expandFolder: (id: string) => void;
  setSearch: (query: string) => void;
  toggleEditing: () => void;
  updateContent: (id: string, content: string, previousContent?: string) => void;
  addFolder: (parentId: string | null, name: string) => void;
  addDocument: (parentId: string, name: string) => void;
  renameNode: (id: string, name: string) => void;
  updateTags: (id: string, tags: string[]) => void;
  deleteNode: (id: string) => void;
  moveNode: (nodeId: string, newParentId: string | null) => void;
  reorderNode: (nodeId: string, targetSiblingId: string, position: 'before' | 'after') => void;
  setSortBy: (sortBy: SortOption) => void;
  expandAll: () => void;
  collapseAll: () => void;
  getEffectiveAccessForNode: (nodeId: string) => EffectiveAccess;
  setInheritance: (nodeId: string, inherit: boolean) => void;
  addAccess: (entry: AccessControlEntry) => void;
  updateAccess: (entryId: string, nodeId: string, accessLevel: AccessLevel) => void;
  removeAccess: (entryId: string, nodeId: string) => void;
  roleDefaults: Record<UserRole, AccessLevel>;
  setRoleDefault: (role: UserRole, level: AccessLevel) => void;
  vaults: VaultConfig[];
  activeVaultId: string;
  addVault: (vault: VaultConfig) => void;
  updateVault: (vault: VaultConfig) => void;
  removeVault: (vaultId: string) => void;
  setActiveVault: (vaultId: string) => void;
}

const DefinicionesContext = createContext<DefinicionesContextValue | null>(null);

export function DefinicionesProvider({ children }: { children: ReactNode }) {
  const { currentUser, members } = useAuthContext();
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const [state, dispatch] = useReducer((s: DefinicionesState, action: DefinicionesAction) => {
    const newState = reducer(s, action);
    // Decorate new changelog entries with current user info
    if (newState.changelog.length > s.changelog.length && currentUserRef.current) {
      const [newest, ...rest] = newState.changelog;
      return {
        ...newState,
        changelog: [
          { ...newest, userId: currentUserRef.current.id, userName: currentUserRef.current.name },
          ...rest,
        ],
      };
    }
    return newState;
  }, initialState);

  const selectedNode = useMemo(() => {
    if (!state.selectedId) return null;
    const node = findNodeById(state.tree, state.selectedId);
    if (!node || !currentUser) return node;
    // Block access to node content if user has no access
    const access = getEffectiveAccess(currentUser.id, currentUser.role, node.id, state.tree, state.accessConfig, state.roleDefaults);
    if (access.level === 'none') return null;
    return node;
  }, [state.tree, state.selectedId, currentUser, state.accessConfig, state.roleDefaults]);

  // Search + sort (full tree, no access filter)
  const unfilteredTree = useMemo(
    () => sortTree(filterTree(state.tree, state.searchQuery), state.sortBy),
    [state.tree, state.searchQuery, state.sortBy],
  );

  // Access-filtered tree: what the current user can see
  const filteredTree = useMemo(
    () => {
      if (!currentUser) return unfilteredTree;
      return filterTreeByAccess(unfilteredTree, currentUser.id, currentUser.role, state.tree, state.accessConfig, state.roleDefaults);
    },
    [unfilteredTree, currentUser, state.tree, state.accessConfig, state.roleDefaults],
  );

  const getEffectiveAccessForNode = useCallback(
    (nodeId: string): EffectiveAccess => {
      if (!currentUser) return { level: 'none', source: 'direct' };
      return getEffectiveAccess(currentUser.id, currentUser.role, nodeId, state.tree, state.accessConfig, state.roleDefaults);
    },
    [currentUser, state.tree, state.accessConfig, state.roleDefaults],
  );

  // Access-level guard helpers
  const requireEditor = useCallback((nodeId: string): boolean => {
    const level = getEffectiveAccessForNode(nodeId).level;
    return level === 'editor' || level === 'owner';
  }, [getEffectiveAccessForNode]);

  const requireOwner = useCallback((nodeId: string): boolean => {
    return getEffectiveAccessForNode(nodeId).level === 'owner';
  }, [getEffectiveAccessForNode]);

  // Read-only actions (no access gate)
  const selectNode = useCallback((id: string | null) => dispatch({ type: 'SELECT_NODE', id }), []);
  const toggleFolder = useCallback((id: string) => dispatch({ type: 'TOGGLE_FOLDER', id }), []);
  const expandFolder = useCallback((id: string) => dispatch({ type: 'EXPAND_FOLDER', id }), []);
  const setSearch = useCallback((query: string) => dispatch({ type: 'SET_SEARCH', query }), []);
  const setSortBy = useCallback((sortBy: SortOption) => dispatch({ type: 'SET_SORT', sortBy }), []);
  const expandAll = useCallback(() => dispatch({ type: 'EXPAND_ALL' }), []);
  const collapseAll = useCallback(() => dispatch({ type: 'COLLAPSE_ALL' }), []);

  // Write actions (require editor+ access)
  const toggleEditing = useCallback(() => dispatch({ type: 'TOGGLE_EDITING' }), []);
  const updateContent = useCallback((id: string, content: string, previousContent?: string) => {
    if (!requireEditor(id)) return;
    dispatch({ type: 'UPDATE_CONTENT', id, content, previousContent });
  }, [requireEditor]);
  const addFolder = useCallback((parentId: string | null, name: string) => {
    if (parentId && !requireEditor(parentId)) return;
    dispatch({ type: 'ADD_FOLDER', parentId, name });
  }, [requireEditor]);
  const addDocument = useCallback((parentId: string, name: string) => {
    if (!requireEditor(parentId)) return;
    dispatch({ type: 'ADD_DOCUMENT', parentId, name });
  }, [requireEditor]);
  const renameNode = useCallback((id: string, name: string) => {
    if (!requireEditor(id)) return;
    dispatch({ type: 'RENAME_NODE', id, name });
  }, [requireEditor]);
  const updateTags = useCallback((id: string, tags: string[]) => {
    if (!requireEditor(id)) return;
    dispatch({ type: 'UPDATE_TAGS', id, tags });
  }, [requireEditor]);
  const deleteNode = useCallback((id: string) => {
    if (!requireOwner(id)) return;
    dispatch({ type: 'DELETE_NODE', id });
  }, [requireOwner]);
  const moveNode = useCallback((nodeId: string, newParentId: string | null) => {
    if (!requireEditor(nodeId)) return;
    dispatch({ type: 'MOVE_NODE', nodeId, newParentId });
  }, [requireEditor]);
  const reorderNode = useCallback((nodeId: string, targetSiblingId: string, position: 'before' | 'after') => {
    if (!requireEditor(nodeId)) return;
    dispatch({ type: 'REORDER_NODE', nodeId, targetSiblingId, position });
  }, [requireEditor]);

  // ACL actions
  const setInheritance = useCallback((nodeId: string, inherit: boolean) => {
    // Check owner on PARENT (not the node itself) to avoid catch-22:
    // turning off inheritance removes access → can't turn it back on
    const parentId = findParentId(state.tree, nodeId);
    if (parentId && !requireOwner(parentId)) return;
    dispatch({ type: 'SET_INHERITANCE', nodeId, inherit });
  }, [requireOwner, state.tree]);
  const resolveRole = useCallback((principalType: 'user' | 'role', principalId: string): UserRole => {
    if (principalType === 'role') return principalId as UserRole;
    const member = members.find(m => m.id === principalId);
    return member?.role ?? UserRole.Viewer;
  }, [members]);

  const addAccess = useCallback((entry: AccessControlEntry) => {
    if (!requireOwner(entry.nodeId)) return;
    // Enforce restrictive inheritance: new level ≤ parent's level for the TARGET principal
    const principalUserId = entry.principalType === 'user' ? entry.principalId : '';
    const principalRole = resolveRole(entry.principalType, entry.principalId);
    const parentLevel = getParentEffectiveLevel(
      entry.nodeId, principalUserId, principalRole, state.tree, state.accessConfig,
    );
    if (ACCESS_LEVEL_HIERARCHY[entry.accessLevel] > ACCESS_LEVEL_HIERARCHY[parentLevel]) return;
    dispatch({ type: 'ADD_ACCESS', entry });
  }, [requireOwner, resolveRole, state.tree, state.accessConfig]);
  const updateAccess = useCallback((entryId: string, nodeId: string, accessLevel: AccessLevel) => {
    if (!requireOwner(nodeId)) return;
    // Enforce restrictive inheritance: find the entry's principal and check against parent
    const config = state.accessConfig[nodeId];
    const entry = config?.entries.find(e => e.id === entryId);
    const principalUserId = entry?.principalType === 'user' ? entry.principalId : '';
    const principalRole = resolveRole(entry?.principalType ?? 'role', entry?.principalId ?? '');
    const parentLevel = getParentEffectiveLevel(
      nodeId, principalUserId, principalRole, state.tree, state.accessConfig,
    );
    if (ACCESS_LEVEL_HIERARCHY[accessLevel] > ACCESS_LEVEL_HIERARCHY[parentLevel]) return;
    dispatch({ type: 'UPDATE_ACCESS', entryId, nodeId, accessLevel });
  }, [requireOwner, resolveRole, state.tree, state.accessConfig]);
  const removeAccess = useCallback((entryId: string, nodeId: string) => {
    if (!requireOwner(nodeId)) return;
    dispatch({ type: 'REMOVE_ACCESS', entryId, nodeId });
  }, [requireOwner]);
  const setRoleDefault = useCallback((role: UserRole, level: AccessLevel) => dispatch({ type: 'SET_ROLE_DEFAULT', role, level }), []);
  const addVault = useCallback((vault: VaultConfig) => dispatch({ type: 'ADD_VAULT', vault }), []);
  const updateVault = useCallback((vault: VaultConfig) => dispatch({ type: 'UPDATE_VAULT', vault }), []);
  const removeVault = useCallback((vaultId: string) => dispatch({ type: 'REMOVE_VAULT', vaultId }), []);
  const setActiveVault = useCallback((vaultId: string) => dispatch({ type: 'SET_ACTIVE_VAULT', vaultId }), []);

  const value = useMemo<DefinicionesContextValue>(() => ({
    state,
    selectedNode,
    filteredTree,
    unfilteredTree,
    changelog: state.changelog,
    accessConfig: state.accessConfig,
    roleDefaults: state.roleDefaults,
    vaults: state.vaults,
    activeVaultId: state.activeVaultId,
    selectNode,
    toggleFolder,
    expandFolder,
    setSearch,
    toggleEditing,
    updateContent,
    addFolder,
    addDocument,
    renameNode,
    updateTags,
    deleteNode,
    moveNode,
    reorderNode,
    setSortBy,
    expandAll,
    collapseAll,
    getEffectiveAccessForNode,
    setInheritance,
    addAccess,
    updateAccess,
    removeAccess,
    setRoleDefault,
    addVault,
    updateVault,
    removeVault,
    setActiveVault,
  }), [state, selectedNode, filteredTree, unfilteredTree, selectNode, toggleFolder, expandFolder, setSearch, toggleEditing, updateContent, addFolder, addDocument, renameNode, updateTags, deleteNode, moveNode, reorderNode, setSortBy, expandAll, collapseAll, getEffectiveAccessForNode, setInheritance, addAccess, updateAccess, removeAccess, setRoleDefault, addVault, updateVault, removeVault, setActiveVault]);

  return (
    <DefinicionesContext.Provider value={value}>
      {children}
    </DefinicionesContext.Provider>
  );
}

export function useDefiniciones() {
  const ctx = useContext(DefinicionesContext);
  if (!ctx) throw new Error('useDefiniciones must be used within DefinicionesProvider');
  return ctx;
}
