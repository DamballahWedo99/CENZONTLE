'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { useHeaderActions } from '@/context/HeaderActionsContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  InitiativeStatus,
  StoryStatus,
  ChangelogEntityType,
} from '@cenzontle/shared';
import { StatusBadge } from '../shared/StatusBadge';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { InitiativeEconomicAnalysis } from './InitiativeEconomicAnalysis';
import { InitiativeDocuments } from './InitiativeDocuments';
import { CopilotSidebar, type CopilotSidebarApi } from '../shared/CopilotSidebar';
import { getSuggestedPrompts } from '@/lib/doc-copilot-agent';
import { generateEpics } from '@/lib/epic-agent';
import {
  type VisualizationType,
  type AnalysisResponse,
  generateAnalysisFromPrompt,
} from '@/lib/economic-analysis-agent';
import { AnalysisChartSelector } from './AnalysisChartSelector';
import { InlineEpicCreator } from './InlineEpicCreator';
import {
  Calendar,
  Pencil,
  X,
  Check,
  FileText,
  Layers,
  BarChart3,
  History,
  User,
  ChevronRight,
  Sparkles,
  Loader2,
  Plus,
  BriefcaseBusiness,
  Brain,
  Paperclip,
} from 'lucide-react';

const initiativeStatusConfig: Record<InitiativeStatus, { label: string; className: string }> = {
  [InitiativeStatus.Planning]: { label: 'Planning', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  [InitiativeStatus.Active]: { label: 'Active', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  [InitiativeStatus.Completed]: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  [InitiativeStatus.OnHold]: { label: 'On Hold', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
};

interface InitiativeFullPageProps {
  initiativeId: string;
}

function InitiativeFullPageInner({ initiativeId }: InitiativeFullPageProps) {
  const router = useRouter();
  const { state, dispatch } = useProyectos();
  const { setBreadcrumb } = useBreadcrumb();

  const initiative = state.initiatives.find((i) => i.id === initiativeId);

  // Derived data
  const epics = useMemo(() => {
    if (!initiative) return [];
    return state.epics.filter((e) => initiative.epicIds.includes(e.id));
  }, [initiative, state.epics]);

  const stories = useMemo(() => {
    return state.stories.filter((s) => epics.some((e) => e.id === s.epicId));
  }, [epics, state.stories]);

  const doneStories = stories.filter((s) => s.status === StoryStatus.Done);
  const progress = stories.length > 0 ? Math.round((doneStories.length / stories.length) * 100) : 0;
  const totalPoints = stories.reduce((sum, s) => sum + s.storyPoints, 0);
  const donePoints = doneStories.reduce((sum, s) => sum + s.storyPoints, 0);

  // Stats by status
  const storyStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stories) {
      counts[s.status] = (counts[s.status] || 0) + 1;
    }
    return counts;
  }, [stories]);

  // POD distribution
  const podDistribution = useMemo(() => {
    const map = new Map<string, { pod: typeof state.pods[0]; storyCount: number; doneCount: number; points: number }>();
    for (const story of stories) {
      const pod = state.pods.find((p) => p.id === story.podId);
      if (!pod) continue;
      const entry = map.get(pod.id) ?? { pod, storyCount: 0, doneCount: 0, points: 0 };
      entry.storyCount++;
      if (story.status === StoryStatus.Done) entry.doneCount++;
      entry.points += story.storyPoints;
      map.set(pod.id, entry);
    }
    return Array.from(map.values());
  }, [stories, state.pods]);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<InitiativeStatus>(InitiativeStatus.Planning);
  const [editOwner, setEditOwner] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [activeTab, setActiveTab] = useState('descripcion');
  const [isGeneratingEpics, setIsGeneratingEpics] = useState(false);
  const [isCreatingEpic, setIsCreatingEpic] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotWidth, setCopilotWidth] = useState(420);

  // -- Analysis mode (active when sidebar opened from "Generar Analisis con IA") --
  const [analysisMode, setAnalysisMode] = useState(false);
  const [chartSelection, setChartSelection] = useState<VisualizationType[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisResponse[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const sidebarApiRef = useRef<CopilotSidebarApi | null>(null);

  const handleOpenAnalysisCopilot = useCallback(() => {
    setAnalysisMode(true);
    setCopilotOpen(true);
  }, []);

  const handleAnalysisGenerated = useCallback((response: AnalysisResponse) => {
    setAnalyses((prev) => [response, ...prev]);
    setSelectedAnalysisId(response.id);
  }, []);

  const handleDeleteAnalysis = useCallback((id: string) => {
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
    setSelectedAnalysisId((prev) => (prev === id ? null : prev));
  }, []);

  // Intercepts sidebar send when in analysis mode
  const handleBeforeSend = useCallback(
    async (message: string): Promise<boolean> => {
      if (!analysisMode || !initiative) return false;

      const api = sidebarApiRef.current;
      if (api) api.setLoading(true);

      try {
        const response = await generateAnalysisFromPrompt({
          prompt: message,
          initiative,
          epics,
          storiesCount: stories.length,
          doneStoriesCount: doneStories.length,
          totalPoints,
          donePoints,
        });

        handleAnalysisGenerated(response);
        if (api) {
          api.addAssistantMessage(response.summary);
          api.setLoading(false);
        }
      } catch {
        if (api) {
          api.addAssistantMessage('Lo siento, ocurrio un error al generar el analisis. Intenta de nuevo.');
          api.setLoading(false);
        }
      }

      return true; // Prevent default doc-copilot send
    },
    [analysisMode, initiative, epics, stories, doneStories, totalPoints, donePoints, handleAnalysisGenerated],
  );

  // Reset analysis mode when sidebar closes
  useEffect(() => {
    if (!copilotOpen) setAnalysisMode(false);
  }, [copilotOpen]);

  // Changelog filtered to this initiative and its epics
  const changelog = useMemo(() => {
    if (!initiative) return [];
    const epicIds = new Set(initiative.epicIds);
    return state.changelog.filter((entry) => {
      if (entry.entityType === ChangelogEntityType.Initiative && entry.entityId === initiative.id) return true;
      if (entry.entityType === ChangelogEntityType.Epic && epicIds.has(entry.entityId)) return true;
      if (entry.entityType === ChangelogEntityType.Story) {
        const story = state.stories.find((s) => s.id === entry.entityId);
        if (story && epicIds.has(story.epicId)) return true;
      }
      return false;
    });
  }, [initiative, state.changelog, state.stories]);

  // Breadcrumb
  useEffect(() => {
    if (!initiative) return;
    setBreadcrumb(
      <div className="flex items-center gap-2 text-sm">
        <Link href="/proyectos" className="text-muted-foreground hover:text-foreground transition-colors">
          Proyectos
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground truncate max-w-[300px]">{initiative.name}</span>
      </div>
    );
    return () => setBreadcrumb(null);
  }, [initiative, setBreadcrumb]);

  // Inject copilot toggle into app header
  const { setActions } = useHeaderActions();
  useEffect(() => {
    setActions(
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCopilotOpen(prev => !prev)}
        className={`relative h-9 w-9 rounded-lg transition-colors ${
          copilotOpen
            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        aria-label="Toggle Copilot"
      >
        <Brain className="h-5 w-5" />
        {copilotOpen && (
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />
        )}
      </Button>
    );
    return () => setActions(null);
  }, [copilotOpen, setActions]);

  // Override main styles for full-height flex
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    main.style.overflow = 'hidden';
    main.style.height = '100%';
    main.style.minHeight = '0';
    return () => {
      main.style.overflow = '';
      main.style.height = '';
      main.style.minHeight = '';
    };
  }, []);

  // Push the entire layout (header + main) left when sidebar is open
  useEffect(() => {
    const main = document.querySelector('main');
    const layoutWrapper = main?.parentElement;
    if (!layoutWrapper) return;
    const mr = copilotOpen ? `${copilotWidth}px` : '0px';
    layoutWrapper.style.transition = 'margin-right 300ms ease-in-out';
    layoutWrapper.style.marginRight = mr;
    return () => {
      layoutWrapper.style.transition = '';
      layoutWrapper.style.marginRight = '';
    };
  }, [copilotOpen, copilotWidth]);

  if (!initiative) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-sm text-muted-foreground">Iniciativa no encontrada</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/proyectos">Volver a proyectos</Link>
        </Button>
      </div>
    );
  }

  const statusCfg = initiativeStatusConfig[initiative.status];

  const handleStartEdit = () => {
    setEditName(initiative.name);
    setEditDescription(initiative.description);
    setEditStatus(initiative.status);
    setEditOwner(initiative.owner);
    setEditStartDate(initiative.startDate);
    setEditTargetDate(initiative.targetDate);
    setIsEditing(true);
  };

  const handleSave = () => {
    const changes: Record<string, string> = {};
    if (editName !== initiative.name) changes.name = editName;
    if (editDescription !== initiative.description) changes.description = editDescription;
    if (editStatus !== initiative.status) changes.status = editStatus;
    if (editOwner !== initiative.owner) changes.owner = editOwner;
    if (editStartDate !== initiative.startDate) changes.startDate = editStartDate;
    if (editTargetDate !== initiative.targetDate) changes.targetDate = editTargetDate;

    if (Object.keys(changes).length > 0) {
      dispatch({ type: 'UPDATE_INITIATIVE', payload: { id: initiative.id, changes } });
    }
    setIsEditing(false);
  };

  const handleGenerateEpics = async () => {
    if (!initiative) return;
    setIsGeneratingEpics(true);
    try {
      const newEpics = await generateEpics(initiative, state.pods, state.epics.length);
      for (const epic of newEpics) {
        dispatch({ type: 'CREATE_EPIC', payload: epic });
      }
    } finally {
      setIsGeneratingEpics(false);
    }
  };

  function formatShortDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Status colors for summary chart
  const statusColors: Record<string, string> = {
    [StoryStatus.Done]: 'bg-green-500',
    [StoryStatus.InProgress]: 'bg-blue-500',
    [StoryStatus.InReview]: 'bg-cyan-500',
    [StoryStatus.QA]: 'bg-amber-500',
    [StoryStatus.ToDo]: 'bg-slate-400',
    [StoryStatus.Backlog]: 'bg-gray-300 dark:bg-gray-600',
    [StoryStatus.Blocked]: 'bg-red-500',
  };

  const statusLabels: Record<string, string> = {
    [StoryStatus.Done]: 'Done',
    [StoryStatus.InProgress]: 'In Progress',
    [StoryStatus.InReview]: 'In Review',
    [StoryStatus.QA]: 'QA',
    [StoryStatus.ToDo]: 'To Do',
    [StoryStatus.Backlog]: 'Backlog',
    [StoryStatus.Blocked]: 'Blocked',
  };

  return (
    <div className="h-full min-h-0">
      <div className="h-full min-h-0 overflow-y-auto">
        <div className={`mx-auto px-6 py-8 transition-[max-width] duration-300 ease-in-out ${copilotOpen ? 'max-w-5xl' : 'max-w-6xl'}`}>
          {/* ── Header ── */}
          <div className="mb-8">
            <div className="flex items-start gap-2">
              {isEditing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-3xl font-bold h-auto py-1 border-none shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40 flex-1"
                  placeholder="Nombre de la iniciativa"
                />
              ) : (
                <h1 className="text-3xl font-bold tracking-tight flex-1">{initiative.name}</h1>
              )}
              <div className="flex gap-1 shrink-0 mt-1">
                {!isEditing ? (
                  <Button variant="ghost" size="icon" onClick={handleStartEdit} className="text-muted-foreground hover:text-foreground">
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleSave} className="text-foreground">
                      <Check className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Metadata */}
            {isEditing ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as InitiativeStatus)}>
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(InitiativeStatus).map(([key, val]) => (
                          <SelectItem key={val} value={val}>{key}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Owner</label>
                    <Input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fecha inicio</label>
                    <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fecha objetivo</label>
                    <Input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}>
                    {statusCfg.label}
                  </span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatShortDate(initiative.startDate)} — {formatShortDate(initiative.targetDate)}
                  </span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {initiative.owner}
                  </span>
                </div>
              </>
            )}

            {/* Progress bar */}
            {stories.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">
                    {doneStories.length}/{stories.length} historias completadas
                  </span>
                  <span className="text-sm font-medium tabular-nums">{donePoints}/{totalPoints} SP</span>
                </div>
                <ProgressBar progress={progress} />
              </div>
            )}
          </div>

          {/* ── Tabs ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent px-0 h-auto pb-0">
              <TabsTrigger value="descripcion" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <FileText className="h-3.5 w-3.5" />
                Descripción
              </TabsTrigger>
              <TabsTrigger value="epicas" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <Layers className="h-3.5 w-3.5" />
                Épicas ({epics.length})
              </TabsTrigger>
              <TabsTrigger value="resumen" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <BarChart3 className="h-3.5 w-3.5" />
                Resumen
              </TabsTrigger>
              <TabsTrigger value="economico" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                Análisis Ejecutivo
              </TabsTrigger>
              <TabsTrigger value="documentos" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <Paperclip className="h-3.5 w-3.5" />
                Documentos ({(initiative.documents ?? []).length})
              </TabsTrigger>
              <TabsTrigger value="changelog" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <History className="h-3.5 w-3.5" />
                Changelog ({changelog.length})
              </TabsTrigger>
            </TabsList>

            {/* ── Tab: Descripción ── */}
            <TabsContent value="descripcion" className="mt-8 space-y-8">
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Descripción</h3>
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={6}
                    className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                    placeholder="Describe la iniciativa, sus objetivos y alcance..."
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                    {initiative.description || <span className="italic text-muted-foreground">Sin descripción</span>}
                  </p>
                )}
              </section>

              <div className="border-t" />

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Información General</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Owner</p>
                    <p className="text-sm font-medium">{initiative.owner}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${statusCfg.className}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Fecha Inicio</p>
                    <p className="text-sm font-medium">{formatShortDate(initiative.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Fecha Objetivo</p>
                    <p className="text-sm font-medium">{formatShortDate(initiative.targetDate)}</p>
                  </div>
                </div>
              </section>

              <div className="border-t" />

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Métricas Rápidas</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-bold tabular-nums">{epics.length}</p>
                    <p className="text-xs text-muted-foreground">Épicas</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-bold tabular-nums">{stories.length}</p>
                    <p className="text-xs text-muted-foreground">Historias</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-bold tabular-nums">{totalPoints}</p>
                    <p className="text-xs text-muted-foreground">Story Points</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-bold tabular-nums">{progress}%</p>
                    <p className="text-xs text-muted-foreground">Progreso</p>
                  </div>
                </div>
              </section>
            </TabsContent>

            {/* ── Tab: Épicas ── */}
            <TabsContent value="epicas" className="mt-8 space-y-4">
              {/* Header with count + action buttons */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {epics.length} {epics.length === 1 ? 'épica' : 'épicas'}
                </p>
                <div className="flex gap-2">
                  {epics.length === 0 && !isGeneratingEpics && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateEpics}
                      disabled={isGeneratingEpics}
                      className="gap-1.5 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generar con IA
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsCreatingEpic(true)}
                    disabled={isCreatingEpic}
                    className="gap-1.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar épica
                  </Button>
                </div>
              </div>

              {isGeneratingEpics && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">
                    El agente está analizando la iniciativa para generar épicas...
                  </span>
                </div>
              )}

              {/* Epic list */}
              {!isCreatingEpic && (
                <div className="space-y-2">
                  {epics.length === 0 && !isGeneratingEpics ? (
                    <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-3 text-center">
                      <Layers className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No hay épicas asociadas a esta iniciativa</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        Usa el botón &quot;Agregar épica&quot; para crear una nueva, o &quot;Generar con IA&quot; para crearlas automáticamente
                      </p>
                    </div>
                  ) : epics.length === 0 ? null : (
                    epics.map((epic) => {
                      const epicStories = state.stories.filter((s) => s.epicId === epic.id);
                      const epicDone = epicStories.filter((s) => s.status === StoryStatus.Done).length;
                      const epicProgress = epicStories.length > 0 ? Math.round((epicDone / epicStories.length) * 100) : 0;
                      const epicPods = state.pods.filter((p) => epic.podIds.includes(p.id));
                      const epicPoints = epicStories.reduce((sum, s) => sum + s.storyPoints, 0);

                      return (
                        <div
                          key={epic.id}
                          className="rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => router.push(`/proyectos/epicas/${epic.id}`)}
                        >
                          <div className="flex items-center gap-3 px-4 py-3">
                            <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{epic.tracker?.externalKey ?? '—'}</span>
                            <span className="truncate flex-1 text-sm font-medium">{epic.title}</span>
                            <div className="flex gap-1 shrink-0">
                              {epicPods.slice(0, 2).map((pod) => (
                                <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                              ))}
                              {epicPods.length > 2 && (
                                <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                                  +{epicPods.length - 2}
                                </span>
                              )}
                            </div>
                            <StatusBadge status={epic.status} type="epic" />
                            <StoryPointsBadge points={epicPoints} />
                            <div className="w-24 shrink-0">
                              <ProgressBar progress={epicProgress} size="sm" showLabel={false} />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right shrink-0">
                              {epicDone}/{epicStories.length}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Inline epic creator — Notion-style */}
              {isCreatingEpic && (
                <InlineEpicCreator
                  initiativeId={initiative.id}
                  pods={state.pods}
                  existingEpicCount={state.epics.length}
                  onCreateEpic={(epic) => {
                    dispatch({ type: 'CREATE_EPIC', payload: epic });
                    setIsCreatingEpic(false);
                  }}
                  onCancel={() => setIsCreatingEpic(false)}
                />
              )}
            </TabsContent>

            {/* ── Tab: Resumen ── */}
            <TabsContent value="resumen" className="mt-8 space-y-8">
              {/* Story distribution */}
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Distribución de Historias</h3>
                {stories.length > 0 ? (
                  <>
                    {/* Stacked bar */}
                    <div className="h-6 rounded-full overflow-hidden flex">
                      {Object.values(StoryStatus).map((status) => {
                        const count = storyStatusCounts[status] || 0;
                        if (count === 0) return null;
                        const pct = (count / stories.length) * 100;
                        return (
                          <div
                            key={status}
                            className={`${statusColors[status]} transition-all`}
                            style={{ width: `${pct}%` }}
                            title={`${statusLabels[status]}: ${count}`}
                          />
                        );
                      })}
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mt-3">
                      {Object.values(StoryStatus).map((status) => {
                        const count = storyStatusCounts[status] || 0;
                        if (count === 0) return null;
                        return (
                          <div key={status} className="flex items-center gap-1.5 text-xs">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />
                            <span className="text-muted-foreground">{statusLabels[status]}</span>
                            <span className="font-medium">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin historias</p>
                )}
              </section>

              <div className="border-t" />

              {/* POD distribution */}
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Carga por POD</h3>
                {podDistribution.length > 0 ? (
                  <div className="space-y-3">
                    {podDistribution.map(({ pod, storyCount, doneCount, points }) => {
                      const podProgress = storyCount > 0 ? Math.round((doneCount / storyCount) * 100) : 0;
                      return (
                        <div key={pod.id} className="flex items-center gap-3">
                          <PodBadge name={pod.name} color={pod.color} />
                          <div className="flex-1 min-w-0">
                            <ProgressBar progress={podProgress} size="sm" showLabel={false} />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                            {doneCount}/{storyCount} historias
                          </span>
                          <span className="text-xs font-medium tabular-nums shrink-0 w-12 text-right">
                            {points} SP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin datos de PODs</p>
                )}
              </section>

              <div className="border-t" />

              {/* Epic progress summary */}
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Progreso por Épica</h3>
                {epics.length > 0 ? (
                  <div className="space-y-3">
                    {epics.map((epic) => {
                      const epicStories = state.stories.filter((s) => s.epicId === epic.id);
                      const epicDone = epicStories.filter((s) => s.status === StoryStatus.Done).length;
                      const epicProgress = epicStories.length > 0 ? Math.round((epicDone / epicStories.length) * 100) : 0;
                      const epicPoints = epicStories.reduce((sum, s) => sum + s.storyPoints, 0);

                      return (
                        <div key={epic.id} className="flex items-center gap-3">
                          <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{epic.tracker?.externalKey ?? '—'}</span>
                          <span className="text-sm truncate flex-1 min-w-0">{epic.title}</span>
                          <div className="w-32 shrink-0">
                            <ProgressBar progress={epicProgress} size="sm" />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-12 text-right">
                            {epicDone}/{epicStories.length}
                          </span>
                          <span className="text-xs font-medium tabular-nums shrink-0 w-12 text-right">
                            {epicPoints} SP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin épicas</p>
                )}
              </section>
            </TabsContent>

            {/* ── Tab: Análisis Económico ── */}
            <TabsContent value="economico" className="mt-8">
              <InitiativeEconomicAnalysis
                initiative={initiative}
                epics={epics}
                stories={stories}
                doneStories={doneStories}
                totalPoints={totalPoints}
                donePoints={donePoints}
                onOpenCopilot={handleOpenAnalysisCopilot}
                analyses={analyses}
                selectedAnalysisId={selectedAnalysisId}
                onSelectAnalysis={setSelectedAnalysisId}
                onDeleteAnalysis={handleDeleteAnalysis}
                globalVizPreference={chartSelection}
              />
            </TabsContent>

            {/* ── Tab: Documentos ── */}
            <TabsContent value="documentos" className="mt-8">
              <InitiativeDocuments
                initiative={initiative}
                epicTitles={epics.map((e) => e.title)}
                documents={initiative.documents ?? []}
                onDocumentGenerated={(doc) => dispatch({ type: 'ADD_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } })}
                onDocumentUpdated={(doc) => dispatch({ type: 'UPDATE_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } })}
                onDocumentDeleted={(docId) => dispatch({ type: 'DELETE_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, documentId: docId } })}
                onDocumentAdded={(doc) => dispatch({ type: 'ADD_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } })}
              />
            </TabsContent>

            {/* ── Tab: Changelog ── */}
            <TabsContent value="changelog" className="mt-8">
              {changelog.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-3 text-center">
                  <History className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Sin actividad registrada</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {changelog.slice(0, 50).map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <History className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          <span className="font-medium">{entry.changedBy.name}</span>
                          {' '}
                          <span className="text-muted-foreground">
                            {entry.action === 'created' && 'creó'}
                            {entry.action === 'updated' && 'actualizó'}
                            {entry.action === 'deleted' && 'eliminó'}
                            {entry.action === 'approved' && 'aprobó'}
                            {entry.action === 'rejected' && 'rechazó'}
                          </span>
                          {' '}
                          <span className="font-medium">{entry.entityTitle}</span>
                          {entry.field && (
                            <span className="text-muted-foreground"> · {entry.field}</span>
                          )}
                        </p>
                        {entry.newValue && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.newValue}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {new Date(entry.timestamp).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Copilot Sidebar — in-flow flex child */}
      <CopilotSidebar
        open={copilotOpen}
        onOpenChange={setCopilotOpen}
        context={{
          entityType: 'initiative',
          entityTitle: initiative.name,
          entityDescription: initiative.description,
          entityLabel: '',
          fields: {
            owner: initiative.owner,
            status: initiative.status,
            startDate: initiative.startDate,
            targetDate: initiative.targetDate,
          },
          items: epics.map((e) => e.title),
          diagramTypes: [],
          existingDocs: (initiative.documents ?? []).map((d) => d.name),
        }}
        suggestedPrompts={getSuggestedPrompts('initiative')}
        title="Copilot de Iniciativa"
        description="Pregunta sobre épicas, roadmap, inversión o genera documentación basada en el contexto completo de la iniciativa."
        contextLabel={initiative.name}
        onDocumentAccepted={(doc) => dispatch({ type: 'ADD_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } })}
        width={copilotWidth}
        onWidthChange={setCopilotWidth}
        inputAddon={analysisMode ? (
          <AnalysisChartSelector selected={chartSelection} onChange={setChartSelection} />
        ) : undefined}
        onBeforeSend={analysisMode ? handleBeforeSend : undefined}
        onReady={(api) => { sidebarApiRef.current = api; }}
        placeholder={analysisMode ? 'Describe que analisis necesitas...' : undefined}
      />
    </div>
  );
}

export function InitiativeFullPage({ initiativeId }: InitiativeFullPageProps) {
  return <InitiativeFullPageInner initiativeId={initiativeId} />;
}
