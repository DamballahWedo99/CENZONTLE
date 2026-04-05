'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Network, List, BookMarked, SlidersHorizontal, History, Shield, ChevronDown, Plus } from 'lucide-react';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { useAuthContext } from '@/context/AuthContext';
import { DefinicionNode } from '@/types/definiciones';
import { Permission } from '@cenzontle/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FolderTree } from './FolderTree';
import { DocumentViewer } from './DocumentViewer';
import { GraphView } from './GraphView';
import { ChangelogView } from './ChangelogView';
import { AccessView } from './AccessView';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type ViewMode = 'tree' | 'graph' | 'changelog' | 'access';

export function DefinicionesExplorer() {
  const { state, setSearch, selectNode, expandFolder, vaults, activeVaultId, setActiveVault } = useDefiniciones();
  const { hasPermission } = useAuthContext();
  const router = useRouter();
  const activeVault = vaults.find(v => v.id === activeVaultId);

  const navigateToNode = useCallback((nodeId: string) => {
    // Find and expand all ancestor folders so the node is visible in the tree
    function findAncestors(nodes: DefinicionNode[], targetId: string, path: string[] = []): string[] | null {
      for (const node of nodes) {
        if (node.id === targetId) return path;
        if (node.children) {
          const found = findAncestors(node.children, targetId, [...path, node.id]);
          if (found) return found;
        }
      }
      return null;
    }
    const ancestors = findAncestors(state.tree, nodeId) || [];
    for (const folderId of ancestors) {
      expandFolder(folderId);
    }
    selectNode(nodeId);
    setViewMode('tree');
  }, [state.tree, selectNode, expandFolder]);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [showForceControls, setShowForceControls] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookMarked className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Vault de Definiciones</h1>
            <p className="text-sm text-muted-foreground">
              {countDocuments(state.tree)} documentos en el vault
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {viewMode === 'graph' && (
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#6366f1' }} />
                <span className="text-muted-foreground">Carpeta</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#06b6d4' }} />
                <span className="text-muted-foreground">Documento</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-5 border-t-2 border-dashed" style={{ borderColor: '#f59e0b' }} />
                <span className="text-muted-foreground">Tags comunes</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-5 border-t-2" style={{ borderColor: '#6366f1' }} />
                <span className="text-muted-foreground">Jerarquía</span>
              </div>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors">
                {activeVault?.name ?? 'Vault'}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={activeVaultId} onValueChange={setActiveVault}>
                {vaults.map(v => (
                  <DropdownMenuRadioItem key={v.id} value={v.id}>
                    {v.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => router.push('/factory/settings?section=obsidian')}>
                <Plus className="h-3 w-3" /> Agregar vault
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider>
          <div className="flex items-center gap-2">
            {viewMode === 'graph' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showForceControls ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShowForceControls(v => !v)}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ajustes de física</TooltipContent>
              </Tooltip>
            )}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setViewMode('tree')}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Vista de explorador</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === 'graph' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setViewMode('graph')}
                  >
                    <Network className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Vista de grafo</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === 'changelog' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setViewMode('changelog')}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Changelog</TooltipContent>
              </Tooltip>
              {hasPermission(Permission.MANAGE_USERS) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={viewMode === 'access' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode('access')}
                    >
                      <Shield className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Gestión de acceso</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </TooltipProvider>
        </div>
      </div>

      {/* Main layout */}
      {viewMode === 'tree' && (
        <div className="flex-1 flex gap-0 border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <div className="w-72 shrink-0 border-r border-border/50 flex flex-col bg-muted/20 min-h-0">
            <div className="p-3 border-b border-border/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar definiciones..."
                  value={state.searchQuery}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-background"
                />
              </div>
            </div>
            <FolderTree />
          </div>
          <DocumentViewer />
        </div>
      )}
      {viewMode === 'graph' && (
        <div className="flex-1 border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <GraphView
            showForceControls={showForceControls}
            onNavigateToNode={navigateToNode}
          />
        </div>
      )}
      {viewMode === 'changelog' && (
        <div className="flex-1 flex border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <ChangelogView onNavigateToNode={navigateToNode} />
        </div>
      )}
      {viewMode === 'access' && (
        <div className="flex-1 flex gap-0 border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <AccessView />
        </div>
      )}
    </div>
  );
}

function countDocuments(nodes: DefinicionNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'document') count++;
    if (node.children) count += countDocuments(node.children);
  }
  return count;
}
