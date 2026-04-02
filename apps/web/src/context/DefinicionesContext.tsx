'use client';

import React, { createContext, useContext, useReducer, useMemo, useCallback, useRef, ReactNode } from 'react';
import { DefinicionNode } from '@/types/definiciones';
import { mockDefiniciones } from '@/data/mock/definiciones';
import { useAuthContext } from '@/context/AuthContext';

export type SortOption = 'name-asc' | 'name-desc' | 'created-newest' | 'created-oldest' | 'updated-newest' | 'updated-oldest';

export type ChangelogAction = 'create' | 'edit' | 'delete' | 'rename' | 'move' | 'tags' | 'reorder';

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
  | { type: 'COLLAPSE_ALL' };

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

function findParentId(nodes: DefinicionNode[], targetId: string, currentParent: string | null = null): string | null {
  for (const node of nodes) {
    if (node.id === targetId) return currentParent;
    if (node.children) {
      const found = findParentId(node.children, targetId, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined as unknown as null;
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

    if (node.type === 'folder' && node.children) {
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0 || nameMatch) {
        acc.push({ ...node, children: filteredChildren });
      }
    } else if (nameMatch || tagMatch || contentMatch) {
      acc.push(node);
    }
    return acc;
  }, []);
}

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

const initialState: DefinicionesState = {
  tree: mockDefiniciones,
  selectedId: null,
  expandedFolders: new Set<string>(),
  searchQuery: '',
  isEditing: false,
  sortBy: 'name-asc' as SortOption,
  changelog: [],
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
      return {
        ...state,
        tree: deleteNodeFromTree(state.tree, action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
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

    default:
      return state;
  }
}

interface DefinicionesContextValue {
  state: DefinicionesState;
  selectedNode: DefinicionNode | null;
  filteredTree: DefinicionNode[];
  changelog: ChangelogEntry[];
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
}

const DefinicionesContext = createContext<DefinicionesContextValue | null>(null);

export function DefinicionesProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuthContext();
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

  const selectedNode = useMemo(
    () => (state.selectedId ? findNodeById(state.tree, state.selectedId) : null),
    [state.tree, state.selectedId],
  );

  const filteredTree = useMemo(
    () => sortTree(filterTree(state.tree, state.searchQuery), state.sortBy),
    [state.tree, state.searchQuery, state.sortBy],
  );

  const selectNode = useCallback((id: string | null) => dispatch({ type: 'SELECT_NODE', id }), []);
  const toggleFolder = useCallback((id: string) => dispatch({ type: 'TOGGLE_FOLDER', id }), []);
  const expandFolder = useCallback((id: string) => dispatch({ type: 'EXPAND_FOLDER', id }), []);
  const setSearch = useCallback((query: string) => dispatch({ type: 'SET_SEARCH', query }), []);
  const toggleEditing = useCallback(() => dispatch({ type: 'TOGGLE_EDITING' }), []);
  const updateContent = useCallback((id: string, content: string, previousContent?: string) => dispatch({ type: 'UPDATE_CONTENT', id, content, previousContent }), []);
  const addFolder = useCallback((parentId: string | null, name: string) => dispatch({ type: 'ADD_FOLDER', parentId, name }), []);
  const addDocument = useCallback((parentId: string, name: string) => dispatch({ type: 'ADD_DOCUMENT', parentId, name }), []);
  const renameNode = useCallback((id: string, name: string) => dispatch({ type: 'RENAME_NODE', id, name }), []);
  const updateTags = useCallback((id: string, tags: string[]) => dispatch({ type: 'UPDATE_TAGS', id, tags }), []);
  const deleteNode = useCallback((id: string) => dispatch({ type: 'DELETE_NODE', id }), []);
  const moveNode = useCallback((nodeId: string, newParentId: string | null) => dispatch({ type: 'MOVE_NODE', nodeId, newParentId }), []);
  const reorderNode = useCallback((nodeId: string, targetSiblingId: string, position: 'before' | 'after') => dispatch({ type: 'REORDER_NODE', nodeId, targetSiblingId, position }), []);
  const setSortBy = useCallback((sortBy: SortOption) => dispatch({ type: 'SET_SORT', sortBy }), []);
  const expandAll = useCallback(() => dispatch({ type: 'EXPAND_ALL' }), []);
  const collapseAll = useCallback(() => dispatch({ type: 'COLLAPSE_ALL' }), []);

  const value = useMemo<DefinicionesContextValue>(() => ({
    state,
    selectedNode,
    filteredTree,
    changelog: state.changelog,
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
  }), [state, selectedNode, filteredTree, selectNode, toggleFolder, expandFolder, setSearch, toggleEditing, updateContent, addFolder, addDocument, renameNode, updateTags, deleteNode, moveNode, reorderNode, setSortBy, expandAll, collapseAll]);

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
