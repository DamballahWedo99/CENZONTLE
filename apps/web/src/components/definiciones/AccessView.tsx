'use client';

import React, { useState, useMemo } from 'react';
import { Folder, FolderOpen, FileText, ChevronRight, Shield, Lock, Search } from 'lucide-react';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { useAuthContext } from '@/context/AuthContext';
import { DefinicionNode } from '@/types/definiciones';
import { Permission } from '@cenzontle/shared';
import { Input } from '@/components/ui/input';
import { AccessPanel } from './AccessPanel';

export function AccessView() {
  const { state, accessConfig, selectNode, getEffectiveAccessForNode } = useDefiniciones();
  const { currentUser, hasPermission } = useAuthContext();

  if (!hasPermission(Permission.MANAGE_USERS)) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <Lock className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No tienes permisos para gestionar acceso.</p>
          <p className="text-xs text-muted-foreground">Se requiere el permiso &ldquo;Gestionar Usuarios&rdquo;.</p>
        </div>
      </div>
    );
  }

  const [searchQuery, setSearchQuery] = useState('');

  const selectedNode = state.selectedId ? findNodeInTree(state.tree, state.selectedId) : null;
  const parentNode = selectedNode ? findParentInTree(state.tree, selectedNode.id) : null;

  const displayTree = useMemo(() => {
    if (!searchQuery.trim()) return state.tree;
    return filterAccessTree(state.tree, searchQuery.toLowerCase());
  }, [state.tree, searchQuery]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar: full tree (unfiltered) */}
      <div className="w-72 shrink-0 border-r border-border/50 flex flex-col bg-muted/20 min-h-0">
        <div className="p-3 border-b border-border/50 space-y-2.5">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Gestión de acceso</span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar carpetas..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm bg-background"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {displayTree.map(node => (
            <AccessTreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={state.selectedId}
              onSelect={selectNode}
              forceExpand={false}
            />
          ))}
        </div>
      </div>

      {/* Right panel */}
      {selectedNode ? (
        <AccessPanel node={selectedNode} parentNode={parentNode} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-2">
            <Shield className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Selecciona una carpeta o documento para gestionar su acceso.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// === Simplified tree node for access management ===

function AccessTreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  forceExpand = false,
}: {
  node: DefinicionNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  forceExpand?: boolean;
}) {
  const isFolder = node.type === 'folder';
  const isSelected = selectedId === node.id;
  const hasChildren = isFolder && node.children && node.children.length > 0;

  const [manualExpanded, setManualExpanded] = useState(false);
  const expanded = forceExpand || manualExpanded;

  return (
    <div>
      <button
        className={`w-full flex items-center gap-1.5 py-1 px-2 text-left text-sm transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(node.id);
          if (isFolder) setManualExpanded(!expanded);
        }}
      >
        <span className="w-4 shrink-0 flex items-center justify-center">
          {hasChildren && (
            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </span>
        {isFolder ? (
          expanded ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="truncate flex-1">{node.name}</span>
      </button>
      {expanded && hasChildren && node.children!.map(child => (
        <AccessTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          forceExpand={forceExpand}
        />
      ))}
    </div>
  );
}

// === Helpers ===

function findNodeInTree(nodes: DefinicionNode[], id: string): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findParentInTree(nodes: DefinicionNode[], targetId: string, parent: DefinicionNode | null = null): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === targetId) return parent;
    if (node.children) {
      const found = findParentInTree(node.children, targetId, node);
      if (found !== undefined && found !== null) return found;
    }
  }
  return null;
}

function filterAccessTree(nodes: DefinicionNode[], query: string): DefinicionNode[] {
  return nodes.reduce<DefinicionNode[]>((acc, node) => {
    const nameMatch = node.name.toLowerCase().includes(query);
    if (nameMatch) {
      // Parent matches → include it with ALL its children intact
      acc.push(node);
    } else if (node.type === 'folder' && node.children) {
      // Parent doesn't match → check children recursively
      const filteredChildren = filterAccessTree(node.children, query);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
    }
    return acc;
  }, []);
}
