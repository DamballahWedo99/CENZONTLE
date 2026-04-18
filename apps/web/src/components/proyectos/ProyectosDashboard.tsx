'use client';

import { useState } from 'react';
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
import { LayoutDashboard, Layers, BookOpen, Plus, Loader2, AlertCircle } from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { Permission } from '@cenzontle/shared';

const createButtonConfig = {
  overview: { label: 'Nueva Iniciativa', dialog: 'initiative' as const },
  epicas: { label: 'Nueva Épica', dialog: 'epic' as const },
  historias: { label: 'Nueva Historia', dialog: 'story' as const },
};

function DashboardContent() {
  const { state, dispatch } = useProyectos();
  const { hasPermission } = useAuthContext();
  const [showCreateInitiative, setShowCreateInitiative] = useState(false);
  const [showCreateEpic, setShowCreateEpic] = useState(false);
  const [showCreateStory, setShowCreateStory] = useState(false);

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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Seguimiento de Proyectos</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de iniciativas, épicas e historias de usuario
          </p>
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
