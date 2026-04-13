'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ProyectosOverview } from './overview/ProyectosOverview';
import { CreateInitiativeDialog } from './overview/CreateInitiativeDialog';
import { EpicasList } from './epicas/EpicasList';
import { CreateEpicDialog } from './epicas/CreateEpicDialog';
import { HistoriasList } from './historias/HistoriasList';
import { CreateStoryDialog } from './historias/CreateStoryDialog';
import { ProyectosFilters } from './filters/ProyectosFilters';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutDashboard, Layers, BookOpen, Plus, Loader2, AlertCircle, ChevronDown, Check, GitBranch } from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { Permission } from '@cenzontle/shared';
import {
  getAccessibleVaultConfigs,
  activateVaultConfig,
  type VaultConfig,
} from '@/lib/api/vault-configs';

const createButtonConfig = {
  overview: { label: 'Nueva Iniciativa', dialog: 'initiative' as const },
  epicas: { label: 'Nueva Épica', dialog: 'epic' as const },
  historias: { label: 'Nueva Historia', dialog: 'story' as const },
};

function DashboardContent() {
  const { state, dispatch, reload } = useProyectos();
  const { hasPermission } = useAuthContext();
  const [showCreateInitiative, setShowCreateInitiative] = useState(false);
  const [showCreateEpic, setShowCreateEpic] = useState(false);
  const [showCreateStory, setShowCreateStory] = useState(false);

  // Vault selector state
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [vaultsLoaded, setVaultsLoaded] = useState(false);
  const [switching, setSwitching] = useState(false);

  const activeVault = vaults.find((v) => v.isActive);

  const loadVaults = useCallback(async () => {
    try {
      const list = await getAccessibleVaultConfigs();
      setVaults(list);
    } catch {
      // Silent — vaults are optional enhancement
    } finally {
      setVaultsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const handleSwitchVault = useCallback(async (vaultId: string) => {
    const target = vaults.find((v) => v.id === vaultId);
    if (!target || target.isActive || switching) return;
    setSwitching(true);
    try {
      await activateVaultConfig(vaultId);
      toast.success(`Vault cambiado a "${target.name}"`);
      await loadVaults();
      await reload();
    } catch (err: any) {
      toast.error(`Error cambiando vault: ${err?.message ?? 'error desconocido'}`);
    } finally {
      setSwitching(false);
    }
  }, [vaults, switching, loadVaults, reload]);

  const btnConfig = createButtonConfig[state.activeTab];

  const canCreate =
    btnConfig.dialog === 'initiative'
      ? hasPermission(Permission.CREATE_INITIATIVE)
      : btnConfig.dialog === 'epic'
        ? hasPermission(Permission.CREATE_EPIC)
        : hasPermission(Permission.CREATE_STORY);

  const handleCreate = () => {
    if (btnConfig.dialog === 'initiative') setShowCreateInitiative(true);
    else if (btnConfig.dialog === 'epic') setShowCreateEpic(true);
    else setShowCreateStory(true);
  };

  if (state.loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Cargando proyectos...</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{state.error}</p>
        <p className="text-xs text-muted-foreground">Verifica que la API esté corriendo en {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}</p>
      </div>
    );
  }

  return (
    <Tabs
      value={state.activeTab}
      onValueChange={(v) => dispatch({ type: 'SET_ACTIVE_TAB', payload: v as typeof state.activeTab })}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Seguimiento de Proyectos</h1>
            <p className="text-sm text-muted-foreground">
              Gestión de iniciativas, épicas e historias de usuario
              {activeVault && vaults.length === 1 && (
                <span className="ml-1.5">
                  · <span className="font-mono text-xs">{activeVault.name}</span>
                </span>
              )}
            </p>
          </div>

          {/* Vault selector — visible cuando hay 2+ vaults accesibles */}
          {vaultsLoaded && vaults.length >= 2 && activeVault && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="ml-1 flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50"
                  disabled={switching}
                >
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono">{activeVault.name}</span>
                  {switching
                    ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  }
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px]">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Vault destino
                </div>
                {vaults.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    onSelect={() => void handleSwitchVault(v.id)}
                    disabled={v.isActive}
                    className="flex items-start gap-2 py-2"
                  >
                    <Check className={`h-3 w-3 mt-0.5 shrink-0 ${v.isActive ? 'opacity-100 text-primary' : 'opacity-0'}`} />
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
        <div className="flex items-center gap-3">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Iniciativas
            </TabsTrigger>
            <TabsTrigger value="epicas" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Épicas
            </TabsTrigger>
            <TabsTrigger value="historias" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Historias
            </TabsTrigger>
          </TabsList>
          {canCreate && (
            <Button size="sm" onClick={handleCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {btnConfig.label}
            </Button>
          )}
        </div>
      </div>

      {state.activeTab !== 'overview' && (
        <ProyectosFilters />
      )}

      <TabsContent value="overview" className="mt-0">
        <ProyectosOverview />
      </TabsContent>
      <TabsContent value="epicas" className="mt-0">
        <EpicasList />
      </TabsContent>
      <TabsContent value="historias" className="mt-0">
        <HistoriasList />
      </TabsContent>

      <CreateInitiativeDialog open={showCreateInitiative} onOpenChange={setShowCreateInitiative} />
      <CreateEpicDialog open={showCreateEpic} onOpenChange={setShowCreateEpic} />
      <CreateStoryDialog open={showCreateStory} onOpenChange={setShowCreateStory} />
    </Tabs>
  );
}

export function ProyectosDashboard() {
  return <DashboardContent />;
}
