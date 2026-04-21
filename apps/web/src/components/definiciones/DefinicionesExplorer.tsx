'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, Network, List, BookMarked, SlidersHorizontal, History, Shield, RefreshCw, Loader2, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { useAuthContext } from '@/context/AuthContext';
import { DefinicionNode } from '@/types/definiciones';
import { Permission } from '@cenzontle/shared';
import { FolderTree } from './FolderTree';
import { DocumentViewer } from './DocumentViewer';
import { GraphView } from './GraphView';
import { ChangelogView } from './ChangelogView';
import { AccessView } from './AccessView';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ViewMode = 'tree' | 'graph' | 'changelog' | 'access';

export function DefinicionesExplorer() {
  const { state, setSearch, selectNode, expandFolder, loading, error, reloadTree, vaults, vaultsLoaded, activeVaultId, switchVault } = useDefiniciones();
  const { hasPermission, isLoading: authLoading } = useAuthContext();
  // Solo mostrar "Sin acceso" cuando AMBOS (vaults + auth) terminaron de cargar.
  // Sin esto, hay un flash donde el rol es 'viewer' (default) antes de que el
  // Management API fallback resuelva el rol real → el filtro descarta los vaults.
  const fullyLoaded = vaultsLoaded && !authLoading;
  const activeVault = vaults.find((v) => v.id === activeVaultId);

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

  // Deep-link desde otros módulos (ej: sidepanel de pasos del diagrama):
  // abrir `/proyectos/definiciones?path=epics/{id}-{slug}/diagrams/{type}.md`
  // debe pre-seleccionar ese archivo y expandir sus ancestros. Se dispara
  // una sola vez por mount una vez que el tree tiene contenido — si el user
  // navega a otro nodo manualmente, no queremos re-forzar al del query.
  const searchParams = useSearchParams();
  const queryPath = searchParams?.get('path') ?? null;
  const hasNavigatedFromQueryRef = useRef(false);
  useEffect(() => {
    if (hasNavigatedFromQueryRef.current) return;
    if (!queryPath || state.tree.length === 0) return;
    navigateToNode(queryPath);
    hasNavigatedFromQueryRef.current = true;
  }, [queryPath, state.tree, navigateToNode]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookMarked className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Vault</h1>
            <p className="text-sm text-muted-foreground">
              {!fullyLoaded
                ? 'Cargando...'
                : vaults.length === 0
                  ? 'Sin acceso'
                  : `${countDocuments(state.tree)} documentos en el vault`}
              {activeVault && vaults.length === 1 && (
                <span className="ml-1.5">· <span className="font-mono text-xs">{activeVault.name}</span></span>
              )}
            </p>
          </div>
          {/* Vault selector dropdown: solo visible si hay 2+ vaults configurados */}
          {vaults.length >= 2 && activeVault && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-2 flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors">
                  <span className="font-mono">{activeVault.name}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                {vaults.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    onSelect={() => void switchVault(v.id)}
                    disabled={v.id === activeVaultId}
                    className="flex items-start gap-2 py-2"
                  >
                    <Check className={`h-3 w-3 mt-0.5 shrink-0 ${v.id === activeVaultId ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{v.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {v.owner}/{v.repo}@{v.branch}
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-6">
          {viewMode === 'graph' && (
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} />
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
                <span className="w-5 border-t-2" style={{ borderColor: '#2563eb' }} />
                <span className="text-muted-foreground">Jerarquía</span>
              </div>
            </div>
          )}
          <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => void reloadTree()}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recargar vault</TooltipContent>
          </Tooltip>
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
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border/50">
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

      {/* Cargando vaults */}
      {(!fullyLoaded || loading) && vaults.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-20">
          <Loader2 className="h-8 w-8 mb-3 animate-spin opacity-30" />
          <p className="text-sm">Cargando vaults...</p>
        </div>
      )}

      {/* Sin acceso — solo después de que todo cargó */}
      {fullyLoaded && !loading && vaults.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-20">
          <BookMarked className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">Sin acceso a vaults</p>
          <p className="text-xs mt-1 max-w-xs">Tu célula no tiene vaults asignados. Contacta a un administrador para configurar el acceso.</p>
        </div>
      )}

      {/* Error banner */}
      {error && !loading && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-destructive">Error cargando el vault</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void reloadTree()}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Main layout — solo visible si hay vaults accesibles */}
      {vaults.length > 0 && viewMode === 'tree' && (
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
                  disabled={loading}
                />
              </div>
            </div>
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <FolderTree />
            )}
          </div>
          <DocumentViewer />
        </div>
      )}
      {vaults.length > 0 && viewMode === 'graph' && (
        <div className="flex-1 border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <GraphView
            showForceControls={showForceControls}
            onNavigateToNode={navigateToNode}
          />
        </div>
      )}
      {vaults.length > 0 && viewMode === 'changelog' && (
        <div className="flex-1 flex border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <ChangelogView onNavigateToNode={navigateToNode} />
        </div>
      )}
      {vaults.length > 0 && viewMode === 'access' && (
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
