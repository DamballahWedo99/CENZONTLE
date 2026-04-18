'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { updateInitiative as apiUpdateInitiative, deleteInitiative as apiDeleteInitiative } from '@/lib/api/initiatives';
import { deleteEpic as apiDeleteEpic } from '@/lib/api/epics';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
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
  Priority,
} from '@cenzontle/shared';
import { StatusBadge } from '../shared/StatusBadge';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { DownloadMenu } from '../shared/DownloadMenu';
import { InitiativeEconomicAnalysis } from './InitiativeEconomicAnalysis';
import { InitiativeDocuments } from './InitiativeDocuments';
import { streamEpicProposals } from '@/lib/epic-agent';
import { InlineEpicCreator } from './InlineEpicCreator';
import { EpicAgentPromptBar } from './EpicAgentPromptBar';
import { AgentThinkingDisplay } from './agent-thinking';
import { EpicProposalList } from './EpicProposalList';
import type { ProposedEpic, EpicGenerationEvent, Epic } from '@cenzontle/shared';
import { createEpic as apiCreateEpic } from '@/lib/api/epics';
import { getCachedSession, invalidateCache, removeCachedProposal } from '@/lib/api/epic-generation';
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
  Paperclip,
  Trash2,
  Download,
  ExternalLink,
} from 'lucide-react';

const initiativeStatusConfig: Record<InitiativeStatus, { label: string; className: string }> = {
  [InitiativeStatus.Planning]: { label: 'Planning', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  [InitiativeStatus.Active]: { label: 'Active', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  [InitiativeStatus.Completed]: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' },
  [InitiativeStatus.OnHold]: { label: 'On Hold', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
};

const priorityStyles: Record<Priority, string> = {
  [Priority.Critical]: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/40',
  [Priority.High]: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/40',
  [Priority.Medium]: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/40',
  [Priority.Low]: 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700/40',
};

const priorityLabels: Record<Priority, string> = {
  [Priority.Critical]: 'Crítica',
  [Priority.High]: 'Alta',
  [Priority.Medium]: 'Media',
  [Priority.Low]: 'Baja',
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

  // Edit + delete state
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<InitiativeStatus>(InitiativeStatus.Planning);
  const [editOwner, setEditOwner] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [activeTab, setActiveTab] = useState('descripcion');
  const [isCreatingEpic, setIsCreatingEpic] = useState(false);
  const [epicContextMenu, setEpicContextMenu] = useState<{ epicId: string; x: number; y: number } | null>(null);
  const [deleteEpicConfirmId, setDeleteEpicConfirmId] = useState<string | null>(null);
  const epicContextMenuRef = useRef<HTMLDivElement>(null);

  // AI agent states
  const [agentMode, setAgentMode] = useState<'idle' | 'prompting' | 'streaming' | 'staging'>('idle');
  const [proposals, setProposals] = useState<ProposedEpic[]>([]);
  const [agentEvents, setAgentEvents] = useState<EpicGenerationEvent[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [editingProposal, setEditingProposal] = useState<ProposedEpic | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;

  // Recover cached session on mount (survives page refresh)
  useEffect(() => {
    if (!initiative) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await getCachedSession(initiative.id);
        if (cancelled || !result?.session) return;
        const { session } = result;
        if (session.proposals.length > 0) {
          setAgentEvents(session.events);
          setProposals(session.proposals);
          setAgentMode('staging');
        }
      } catch {
        // Cache unavailable — stay idle
      }
    })();

    return () => { cancelled = true; };
  }, [initiative?.id]);

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

  const handleDelete = async () => {
    try {
      await apiDeleteInitiative(initiative.id);
      dispatch({ type: 'DELETE_INITIATIVE', payload: { id: initiative.id } });
      toast.success('Iniciativa eliminada');
      router.push('/proyectos');
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar iniciativa');
      throw err; // re-throw para que el dialog se quede abierto
    }
  };

  const handleSave = async () => {
    const changes: Record<string, string> = {};
    if (editName !== initiative.name) changes.name = editName;
    if (editDescription !== initiative.description) changes.description = editDescription;
    if (editStatus !== initiative.status) changes.status = editStatus;
    if (editOwner !== initiative.owner) changes.owner = editOwner;
    if (editStartDate !== initiative.startDate) changes.startDate = editStartDate;
    if (editTargetDate !== initiative.targetDate) changes.targetDate = editTargetDate;

    if (Object.keys(changes).length > 0) {
      try {
        await apiUpdateInitiative(initiative.id, changes);
        dispatch({ type: 'UPDATE_INITIATIVE', payload: { id: initiative.id, changes } });
        toast.success('Iniciativa actualizada');
      } catch (err: any) {
        toast.error(err.message || 'Error al actualizar');
      }
    }
    setIsEditing(false);
  };

  const handleStartAgent = () => setAgentMode('prompting');

  const handleCancelAgent = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAgentMode(proposalsRef.current.length > 0 ? 'staging' : 'idle');
    setAgentEvents([]);
  };

  const handleSubmitPrompt = async (prompt: string, webSearch: boolean) => {
    if (!initiative) return;
    setAgentMode('streaming');
    setAgentEvents([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamEpicProposals(initiative.id, { prompt, webSearch, signal: controller.signal })) {
        setAgentEvents((prev) => [...prev, event]);

        if (event.type === 'proposal_ready') {
          setProposals((prev) => [...prev, event.epic]);
        }
        if (event.type === 'done') {
          setAgentMode('staging');
        }
        if (event.type === 'error') {
          toast.error(event.message);
          setAgentMode(proposalsRef.current.length > 0 ? 'staging' : 'idle');
        }
      }
      // Stream ended naturally
      setAgentMode((m) => m === 'streaming' ? 'staging' : m);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'Error generando épicas');
        setAgentMode('idle');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleAcceptProposal = async (proposal: ProposedEpic) => {
    setAcceptingId(proposal.clientId);
    try {
      const created = await apiCreateEpic({
        title: proposal.title,
        description: proposal.description,
        status: proposal.status,
        priority: proposal.priority,
        initiativeId: proposal.initiativeId,
        podIds: proposal.podIds,
        startDate: proposal.startDate,
        targetDate: proposal.targetDate,
        qualitativeBenefits: proposal.qualitativeBenefits,
        quantitativeBenefits: proposal.quantitativeBenefits,
        benefitsMeasurement: proposal.benefitsMeasurement,
        scopeDescription: proposal.scopeDescription,
        acceptanceCriteria: proposal.acceptanceCriteria,
        technologicalImprovements: proposal.technologicalImprovements,
        businessPriority: proposal.businessPriority,
        teamsInvolved: proposal.teamsInvolved,
        impactedChannels: proposal.impactedChannels,
        impactedFlows: proposal.impactedFlows,
        impactSabreLevel: proposal.impactSabreLevel,
        thirdPartyDependencies: proposal.thirdPartyDependencies,
      });

      dispatch({
        type: 'CREATE_EPIC',
        payload: {
          ...created,
          podIds: proposal.podIds,
          documents: [],
          diagrams: [],
          dependencies: [],
          poApproval: null,
          tlApproval: null,
          qaMatrix: null,
          qaApproval: null,
          epicQAMatrix: null,
        } as Epic,
      });

      setProposals((prev) => prev.filter((p) => p.clientId !== proposal.clientId));
      removeCachedProposal(initiative.id, proposal.clientId).catch(() => {});
      toast.success(`Épica "${proposal.title}" creada`);
    } catch (err: any) {
      toast.error(err.message || 'Error creando épica');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleAcceptAll = async () => {
    const snapshot = [...proposals];
    let accepted = 0;
    for (const p of snapshot) {
      try {
        await handleAcceptProposal(p);
        accepted++;
      } catch {
        // handleAcceptProposal already toasts the error
        break;
      }
    }
    if (accepted > 0 && accepted < snapshot.length) {
      toast.info(`${accepted} de ${snapshot.length} épicas creadas — el resto falló`);
    }
  };

  const handleDiscardProposal = (clientId: string) => {
    setProposals((prev) => prev.filter((p) => p.clientId !== clientId));
    if (initiative) removeCachedProposal(initiative.id, clientId).catch(() => {});
  };

  const handleDiscardAll = () => {
    setProposals([]);
    setAgentMode('idle');
    if (initiative) invalidateCache(initiative.id).catch(() => {});
  };

  const handleEditProposal = (proposal: ProposedEpic) => {
    setEditingProposal(proposal);
    setIsCreatingEpic(true);
  };

  const handleRegenerateProposal = (proposal: ProposedEpic) => {
    handleDiscardProposal(proposal.clientId);
    setAgentMode('prompting');
  };

  const handleRefinePrompt = () => {
    setAgentMode('prompting');
  };

  const handleOpenEpicInNewTab = useCallback((epicId: string) => {
    window.open(`/proyectos/epicas/${epicId}`, '_blank', 'noopener,noreferrer');
    setEpicContextMenu(null);
  }, []);

  const handleDownloadEpic = useCallback((epicId: string) => {
    const epic = state.epics.find((e) => e.id === epicId);
    if (!epic) return;

    const sections: Array<[string, string]> = [
      ['Descripción', epic.description],
      ['Beneficios cualitativos', epic.qualitativeBenefits],
      ['Beneficios cuantitativos', epic.quantitativeBenefits],
      ['Medición de beneficios', epic.benefitsMeasurement],
      ['Alcance', epic.scopeDescription],
      ['Criterios de aceptación', epic.acceptanceCriteria],
      ['Mejoras tecnológicas', epic.technologicalImprovements],
      ['Prioridad de negocio', epic.businessPriority],
      ['Equipos involucrados', epic.teamsInvolved],
      ['Canales impactados', epic.impactedChannels],
      ['Flujos impactados', epic.impactedFlows],
      ['Nivel de impacto Sabre', epic.impactSabreLevel],
      ['Dependencias con terceros', epic.thirdPartyDependencies],
    ];

    const frontMatter = [
      '---',
      `id: ${epic.id}`,
      `title: ${JSON.stringify(epic.title)}`,
      `status: ${epic.status}`,
      `priority: ${epic.priority}`,
      epic.tracker?.externalKey ? `tracker: ${epic.tracker.externalKey}` : null,
      '---',
    ].filter(Boolean).join('\n');

    const escapeBody = (value: string) => value.replace(/^(#{1,6})\s/gm, '\\$1 ');

    const body = sections
      .filter(([, value]) => value && value.trim().length > 0)
      .map(([heading, value]) => `## ${heading}\n\n${escapeBody(value)}`)
      .join('\n\n');

    const content = `${frontMatter}\n\n# ${epic.title}\n\n${body}\n`;
    const safeName = (epic.tracker?.externalKey || epic.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'epic';

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast.success('Épica descargada');
    setEpicContextMenu(null);
  }, [state.epics]);

  const handleDeleteEpic = useCallback(async (epicId: string) => {
    try {
      await apiDeleteEpic(epicId);
      dispatch({ type: 'DELETE_EPIC', payload: { id: epicId } });
      toast.success('Épica eliminada');
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar épica');
      throw err;
    }
  }, [dispatch]);

  useEffect(() => {
    if (!epicContextMenu) return;
    const close = () => setEpicContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onClick = (e: MouseEvent) => {
      if (epicContextMenuRef.current && !epicContextMenuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [epicContextMenu]);

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
        <div className="mx-auto px-6 py-8 max-w-6xl">
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
                  <>
                    <DownloadMenu entity={{ kind: 'initiative', initiative }} />
                    <Button variant="ghost" size="icon" onClick={handleStartEdit} className="text-muted-foreground hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
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
                    <DatePicker value={editStartDate} onChange={setEditStartDate} maxDate={editTargetDate || undefined} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fecha objetivo</label>
                    <DatePicker value={editTargetDate} onChange={setEditTargetDate} minDate={editStartDate || undefined} className="h-8 text-xs" />
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
                  {agentMode === 'idle' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStartAgent}
                      className="gap-1.5 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generar con IA
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingProposal(null); setIsCreatingEpic(true); }}
                    disabled={isCreatingEpic}
                    className="gap-1.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar épica
                  </Button>
                </div>
              </div>

              {/* Agent prompt bar / streaming timeline */}
              {(agentMode === 'prompting' || agentMode === 'streaming') && (
                <EpicAgentPromptBar
                  mode={agentMode}
                  events={agentEvents}
                  onSubmit={handleSubmitPrompt}
                  onCancel={handleCancelAgent}
                />
              )}

              {/* Persistent thinking chain — visible in staging mode */}
              {agentMode === 'staging' && agentEvents.length > 0 && (
                <AgentThinkingDisplay events={agentEvents} isStreaming={false} />
              )}

              {/* Staging area for proposals */}
              {proposals.length > 0 && agentMode !== 'streaming' && (
                <EpicProposalList
                  initiativeId={initiative.id}
                  proposals={proposals}
                  pods={state.pods}
                  acceptingId={acceptingId}
                  onAccept={handleAcceptProposal}
                  onAcceptAll={handleAcceptAll}
                  onEdit={handleEditProposal}
                  onRegenerate={handleRegenerateProposal}
                  onDiscard={handleDiscardProposal}
                  onDiscardAll={handleDiscardAll}
                  onRefinePrompt={handleRefinePrompt}
                />
              )}

              {/* Epic list */}
              {!isCreatingEpic && (
                <div className="space-y-2">
                  {epics.length === 0 && agentMode === 'idle' && proposals.length === 0 ? (
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
                          onContextMenu={(e) => {
                            e.preventDefault();
                            const menuWidth = 220;
                            const menuHeight = 132;
                            const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
                            const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
                            setEpicContextMenu({ epicId: epic.id, x: Math.max(8, x), y: Math.max(8, y) });
                          }}
                        >
                          <div className="flex items-center gap-3 px-4 py-3">
                            <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{epic.tracker?.externalKey ?? '—'}</span>
                            <span className="truncate flex-1 text-sm font-medium">{epic.title}</span>
                            <div className="flex gap-1 shrink-0 w-28 justify-center">
                              {epicPods.slice(0, 2).map((pod) => (
                                <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                              ))}
                              {epicPods.length > 2 && (
                                <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                                  +{epicPods.length - 2}
                                </span>
                              )}
                            </div>
                            <div className="w-14 shrink-0 flex justify-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${priorityStyles[epic.priority]}`}>
                                {priorityLabels[epic.priority]}
                              </span>
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
                  initialData={editingProposal ? {
                    title: editingProposal.title,
                    description: editingProposal.description,
                    priority: editingProposal.priority,
                    status: editingProposal.status,
                    selectedPodIds: editingProposal.podIds,
                    startDate: editingProposal.startDate,
                    targetDate: editingProposal.targetDate,
                    qualitativeBenefits: editingProposal.qualitativeBenefits,
                    quantitativeBenefits: editingProposal.quantitativeBenefits,
                    benefitsMeasurement: editingProposal.benefitsMeasurement,
                    scopeDescription: editingProposal.scopeDescription,
                    acceptanceCriteria: editingProposal.acceptanceCriteria,
                    technologicalImprovements: editingProposal.technologicalImprovements,
                    businessPriority: editingProposal.businessPriority,
                    teamsInvolved: editingProposal.teamsInvolved,
                    impactedChannels: editingProposal.impactedChannels,
                    impactedFlows: editingProposal.impactedFlows,
                    impactSabreLevel: editingProposal.impactSabreLevel,
                    thirdPartyDependencies: editingProposal.thirdPartyDependencies,
                  } : undefined}
                  onCreateEpic={(epic) => {
                    dispatch({ type: 'CREATE_EPIC', payload: epic });
                    // Remove from proposals if editing a proposal
                    if (editingProposal) {
                      setProposals((prev) => prev.filter((p) => p.clientId !== editingProposal.clientId));
                      setEditingProposal(null);
                    }
                    setIsCreatingEpic(false);
                  }}
                  onCancel={() => { setIsCreatingEpic(false); setEditingProposal(null); }}
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
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Carga por Célula</h3>
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
              />
            </TabsContent>

            {/* ── Tab: Documentos ── */}
            <TabsContent value="documentos" className="mt-8">
              <InitiativeDocuments
                initiative={initiative}
                epicTitles={epics.map((e) => e.title)}
                documents={initiative.documents ?? []}
                onDocumentGenerated={async (doc) => {
                  const newDocs = [...(initiative.documents ?? []), doc];
                  await apiUpdateInitiative(initiative.id, { documents: newDocs } as any).catch(() => {});
                  dispatch({ type: 'ADD_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } });
                }}
                onDocumentUpdated={async (doc) => {
                  const newDocs = (initiative.documents ?? []).map((d) => d.id === doc.id ? doc : d);
                  await apiUpdateInitiative(initiative.id, { documents: newDocs } as any).catch(() => {});
                  dispatch({ type: 'UPDATE_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } });
                }}
                onDocumentDeleted={async (docId) => {
                  const newDocs = (initiative.documents ?? []).filter((d) => d.id !== docId);
                  await apiUpdateInitiative(initiative.id, { documents: newDocs } as any).catch(() => {});
                  dispatch({ type: 'DELETE_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, documentId: docId } });
                }}
                onDocumentAdded={async (doc) => {
                  const newDocs = [...(initiative.documents ?? []), doc];
                  await apiUpdateInitiative(initiative.id, { documents: newDocs } as any).catch(() => {});
                  dispatch({ type: 'ADD_INITIATIVE_DOCUMENT', payload: { initiativeId: initiative.id, document: doc } });
                }}
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
                        {(entry.newValue || entry.oldValue) && (
                          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{entry.newValue || entry.oldValue}</p>
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

      <TypeToConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar iniciativa"
        resourceLabel="iniciativa"
        expectedValue={initiative.name}
        description="Esto eliminará la iniciativa junto con todas sus épicas, historias y documentos asociados. La acción es permanente y no se puede deshacer."
        confirmText="Eliminar iniciativa"
        onConfirm={handleDelete}
      />

      {epicContextMenu && (
        <div
          ref={epicContextMenuRef}
          role="menu"
          className="fixed z-50 min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-md p-1 text-sm animate-in fade-in-0 zoom-in-95"
          style={{ top: epicContextMenu.y, left: epicContextMenu.x }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleOpenEpicInNewTab(epicContextMenu.epicId)}
            className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir en nueva pestaña
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleDownloadEpic(epicContextMenu.epicId)}
            className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground text-left"
          >
            <Download className="h-4 w-4" />
            Descargar archivo
          </button>
          <div className="h-px my-1 bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDeleteEpicConfirmId(epicContextMenu.epicId);
              setEpicContextMenu(null);
            }}
            className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-destructive hover:bg-destructive/10 text-left"
          >
            <Trash2 className="h-4 w-4" />
            Eliminar épica
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deleteEpicConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteEpicConfirmId(null)}
        title="Eliminar épica"
        description={(() => {
          const epic = state.epics.find((e) => e.id === deleteEpicConfirmId);
          if (!epic) return 'Esta acción no se puede deshacer.';
          const storyCount = state.stories.filter((s) => s.epicId === epic.id).length;
          const storySuffix = storyCount > 0
            ? ` También se eliminarán ${storyCount} ${storyCount === 1 ? 'historia asociada' : 'historias asociadas'}.`
            : '';
          return `Vas a eliminar "${epic.title}". Esta acción no se puede deshacer.${storySuffix}`;
        })()}
        confirmText="Eliminar"
        destructive
        onConfirm={async () => {
          if (!deleteEpicConfirmId) return;
          await handleDeleteEpic(deleteEpicConfirmId);
        }}
      />
    </div>
  );
}

export function InitiativeFullPage({ initiativeId }: InitiativeFullPageProps) {
  return <InitiativeFullPageInner initiativeId={initiativeId} />;
}
