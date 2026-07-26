'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, Network, List, BookMarked, SlidersHorizontal, History, Shield, RefreshCw, Loader2, AlertCircle, ChevronDown, Check, Eye, Link2, Sparkles, X } from 'lucide-react';
import { useDefiniciones } from '@/context/DefinicionesContext';
import { runVaultConnections, getVaultConnectionsStatus, getVaultConnectionsLastRun, type VaultConnectionsStatus } from '@/lib/api/vault';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

type ViewMode = 'tree' | 'graph' | 'changelog' | 'access';

const CONNECTIONS_POLL_MS = 2500;

const CONNECTIONS_PHASE_LABELS: Record<string, string> = {
  reading: 'Leyendo documentos',
  analyzing: 'Analizando conexiones',
  writing: 'Escribiendo tags',
};

/**
 * Formato relativo en español ("hace 5m/3h/2d", o fecha corta si es viejo).
 * Mismo patrón que ChangelogView.formatRelativeTime — el codebase mantiene
 * estos helpers locales por componente (ver ReleaseBoard, PRPipeline).
 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'hace un momento';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DefinicionesExplorer() {
  const { state, setSearch, selectNode, expandFolder, loading, error, reloadTree, vaults, vaultsLoaded, activeVaultId, viewingVaultId, effectiveVaultId, switchVault } = useDefiniciones();
  const { hasPermission, isLoading: authLoading } = useAuthContext();
  // Solo mostrar "Sin acceso" cuando AMBOS (vaults + auth) terminaron de cargar.
  // Sin esto, hay un flash donde el rol es 'viewer' (default) antes de que el
  // Management API fallback resuelva el rol real → el filtro descarta los vaults.
  const fullyLoaded = vaultsLoaded && !authLoading;
  const activeVault = vaults.find((v) => v.id === activeVaultId);
  // Vault que se está VIENDO (puede diferir del vinculado si el user navegó
  // desde el dropdown). Se muestra en el header y guía qué tree se carga.
  const effectiveVault = vaults.find((v) => v.id === effectiveVaultId);
  const isBrowseMode = !!viewingVaultId && viewingVaultId !== activeVaultId;

  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [showForceControls, setShowForceControls] = useState(false);

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
  }, [state.tree, selectNode, expandFolder]);

  // Volver al explorador es responsabilidad del caller que NO está ya en él:
  // el grafo y el changelog navegan desde otra vista, así que la cambian.
  // El deep-link usa `navigateToNode` pelado y NO fuerza la vista: monta en
  // 'tree', y si para cuando carga el vault el usuario ya se cambió de pestaña,
  // se respeta esa elección en vez de arrancarlo de vuelta. Así el efecto que lo
  // consume tampoco dispara un setState sincrónico (cascading render).
  const navigateToNodeAndShowTree = useCallback((nodeId: string) => {
    navigateToNode(nodeId);
    setViewMode('tree');
  }, [navigateToNode]);

  // === Agente de conexiones IA ===
  // El backend corre un solo job a la vez (fire-and-forget); aquí solo se
  // dispara y se pollea el status. Al terminar, reloadTree refresca árbol +
  // tags y el grafo dibuja las conexiones nuevas.
  const [connections, setConnections] = useState<VaultConnectionsStatus | null>(null);
  const [connectionsNotice, setConnectionsNotice] = useState<{ kind: 'done' | 'error'; message: string } | null>(null);
  // Última generación de conexiones (ISO), derivada del git history del vault.
  // Persiste entre sesiones y reinicios — el vault es la fuente de verdad.
  const [connectionsLastRun, setConnectionsLastRun] = useState<string | null>(null);
  const connectionsRunning = connections?.status === 'running';
  const canRunConnections = hasPermission(Permission.MANAGE_DOCUMENTS);
  // En browse-mode el agente opera sobre el vault que se está viendo; sin
  // override opera sobre el activo (mismo contrato que el resto de la API).
  const connectionsVaultParam = isBrowseMode ? (effectiveVaultId ?? undefined) : undefined;

  // Al montar (y al cambiar de vault): detectar un job en curso y datar la
  // última generación desde el git history. Ambas lecturas en paralelo.
  useEffect(() => {
    if (!fullyLoaded || vaults.length === 0) return;
    let cancelled = false;
    getVaultConnectionsStatus(connectionsVaultParam)
      .then((s) => {
        if (!cancelled && s.status === 'running') setConnections(s);
      })
      .catch(() => { /* status no disponible: el botón queda en reposo */ });
    getVaultConnectionsLastRun(connectionsVaultParam)
      .then((r) => {
        if (!cancelled) setConnectionsLastRun(r.lastRunAt);
      })
      .catch(() => { /* sin git history disponible: no mostramos fecha */ });
    return () => { cancelled = true; };
  }, [fullyLoaded, vaults.length, connectionsVaultParam]);

  // Polling mientras el job corre. Al pasar a done/error el cleanup corta el interval.
  useEffect(() => {
    if (!connectionsRunning) return;
    const timer = setInterval(() => {
      getVaultConnectionsStatus(connectionsVaultParam)
        .then((s) => {
          setConnections(s);
          if (s.status === 'done') {
            setConnectionsNotice({
              kind: 'done',
              message: `Conexiones generadas: ${s.updatedDocuments} de ${s.totalDocuments} documentos actualizados · ${s.sharedTags} tags compartidos${s.skippedDocuments > 0 ? ` · ${s.skippedDocuments} documentos omitidos por límite` : ''}.`,
            });
            // El job acaba de terminar: su finishedAt es la última generación
            // más fresca, sin necesidad de re-consultar el git history.
            if (s.finishedAt) setConnectionsLastRun(s.finishedAt);
            void reloadTree();
          } else if (s.status === 'error') {
            setConnectionsNotice({ kind: 'error', message: s.error ?? 'Error generando conexiones' });
          }
        })
        .catch(() => { /* error transitorio de red: el próximo tick reintenta */ });
    }, CONNECTIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [connectionsRunning, connectionsVaultParam, reloadTree]);

  const handleRunConnections = useCallback(async () => {
    setConnectionsNotice(null);
    try {
      const s = await runVaultConnections(connectionsVaultParam);
      setConnections(s);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo iniciar el agente de conexiones';
      setConnectionsNotice({ kind: 'error', message });
    }
  }, [connectionsVaultParam]);

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
              {effectiveVault && (
                <span className="ml-1.5">· <span className="font-mono text-xs">{effectiveVault.name}</span></span>
              )}
            </p>
          </div>
          {/* Dropdown selector — SOLO navega entre vaults para visualizar contenido.
              NO cambia el "vínculo" (qué vault es destino de escrituras de épicas/historias).
              Para vincular otro vault, ir a Settings → Vault → botón "Vincular".
              Mientras se navega un vault distinto al vinculado, badge "Solo navegación"
              avisa al user que las escrituras siguen yendo al activo. */}
          {vaults.length >= 2 && effectiveVault && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-2 flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors">
                  <Eye className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">{effectiveVault.name}</span>
                  {isBrowseMode && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-normal">
                      No vinculado
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[260px]">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-normal">
                  Navegar entre vaults
                </DropdownMenuLabel>
                {vaults.map((v) => {
                  const isActive = v.id === activeVaultId;
                  const isViewing = v.id === effectiveVaultId;
                  return (
                    <DropdownMenuItem
                      key={v.id}
                      onSelect={() => void switchVault(v.id)}
                      disabled={isViewing}
                      className="flex items-start gap-2 py-2"
                    >
                      <Check className={`h-3 w-3 mt-0.5 shrink-0 ${isViewing ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium">{v.name}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                              <Link2 className="h-2 w-2" />
                              Vinculado
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {v.owner}/{v.repo}@{v.branch}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground/80 leading-snug space-y-1">
                  <p>Las carpetas y documentos manuales se guardan en el vault que estés viendo aquí.</p>
                  <p>Las épicas/historias creadas desde Proyectos siempre van al vault <strong>vinculado</strong> (cambialo en Settings → Vincular).</p>
                </div>
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
          {canRunConnections && (
            <div className="flex items-center gap-2">
              {connectionsRunning && connections ? (
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {CONNECTIONS_PHASE_LABELS[connections.phase ?? ''] ?? 'Procesando'}
                  {connections.totalDocuments > 0 && connections.phase === 'reading'
                    ? ` ${connections.processedDocuments}/${connections.totalDocuments}`
                    : ''}
                  …
                </span>
              ) : connectionsLastRun ? (
                <span className="hidden md:inline text-xs text-muted-foreground whitespace-nowrap">
                  Conexiones · {formatRelativeTime(connectionsLastRun)}
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void handleRunConnections()}
                    disabled={connectionsRunning || loading || vaults.length === 0}
                  >
                    <Sparkles className={`h-4 w-4 ${connectionsRunning ? 'animate-pulse text-amber-500' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {connectionsRunning ? (
                    'El agente está generando conexiones…'
                  ) : (
                    <div className="text-center">
                      <p>Generar conexiones del grafo (agente IA)</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {connectionsLastRun
                          ? `Última generación: ${formatRelativeTime(connectionsLastRun)}`
                          : 'Aún no se han generado'}
                      </p>
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
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

      {/* Resultado del agente de conexiones (descartable) */}
      {connectionsNotice && (
        <div
          className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-sm ${
            connectionsNotice.kind === 'done'
              ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-destructive/40 bg-destructive/10'
          }`}
        >
          <Sparkles
            className={`h-4 w-4 shrink-0 mt-0.5 ${
              connectionsNotice.kind === 'done' ? 'text-amber-500' : 'text-destructive'
            }`}
          />
          <p className="flex-1 text-xs text-muted-foreground mt-0.5">{connectionsNotice.message}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setConnectionsNotice(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
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
            onNavigateToNode={navigateToNodeAndShowTree}
          />
        </div>
      )}
      {vaults.length > 0 && viewMode === 'changelog' && (
        <div className="flex-1 flex border border-border/50 rounded-lg overflow-hidden bg-background min-h-0 shadow-sm">
          <ChangelogView onNavigateToNode={navigateToNodeAndShowTree} />
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
