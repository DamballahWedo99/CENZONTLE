'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { updateInitiative as apiUpdateInitiative, deleteInitiative as apiDeleteInitiative } from '@/lib/api/initiatives';
import { deleteEpic as apiDeleteEpic, getEpic } from '@/lib/api/epics';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { RoundCheckbox } from '@/components/ui/round-checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ALL_FORMATS,
  FORMAT_LABELS,
  buildFilename,
  dispatchEpic,
  type ExportFormat,
} from '@/lib/proyectos-exporter';
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
import { InitiativeDocuments } from './InitiativeDocuments';
import { streamEpicProposals } from '@/lib/epic-agent';
import { InlineEpicCreator } from './InlineEpicCreator';
import { EpicAgentPromptBar } from './EpicAgentPromptBar';
import { AgentThinkingDisplay } from './agent-thinking';
import { EpicProposalList } from './EpicProposalList';
import type { ProposedEpic, EpicGenerationEvent, Epic } from '@cenzontle/shared';
import { createEpic as apiCreateEpic } from '@/lib/api/epics';
import { getCachedSession, invalidateCache, removeCachedProposal, cancelEpicGeneration } from '@/lib/api/epic-generation';
import { publishInitiativeToTracker } from '@/lib/api/integrations';
import { ApiError } from '@/lib/api/client';
import type { TrackerReference } from '@cenzontle/shared';
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
  FileType,
  FileSpreadsheet,
  FileCode,
  FileJson,
} from 'lucide-react';
import { LinearIcon } from '@/components/icons/LinearIcon';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';

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
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishingTracker, setPublishingTracker] = useState(false);

  const handlePublishToLinear = async () => {
    if (!initiative) return;
    setPublishingTracker(true);
    try {
      const result = await publishInitiativeToTracker(initiative.id, 'linear');
      dispatch({
        type: 'UPDATE_INITIATIVE',
        payload: { id: initiative.id, changes: { tracker: result.tracker } },
      });
      if (result.alreadyPublished) {
        toast.info('La iniciativa ya estaba publicada en Linear', {
          description: 'Initiative existente — abrir',
          action: {
            label: 'Abrir',
            onClick: () => window.open(result.tracker.externalUrl, '_blank'),
          },
        });
      } else {
        toast.success('Iniciativa publicada como Linear Initiative', {
          action: {
            label: 'Abrir Linear',
            onClick: () => window.open(result.tracker.externalUrl, '_blank'),
          },
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      if (err instanceof ApiError && err.status === 409) {
        toast.info('Otra publicación en curso', {
          description: 'Espera unos segundos y reintenta.',
        });
      } else {
        toast.error('No se pudo publicar la iniciativa en Linear', {
          description: message,
        });
      }
    } finally {
      setPublishingTracker(false);
    }
  };
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<InitiativeStatus>(InitiativeStatus.Planning);
  const [editOwner, setEditOwner] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  // Tab state URL-synced (ver mismo patrón en Story/EpicFullPage). Default
  // 'descripcion' cuando la URL no trae `?tab=`.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'descripcion';
  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [isCreatingEpic, setIsCreatingEpic] = useState(false);
  const [epicContextMenu, setEpicContextMenu] = useState<{ epicId: string; x: number; y: number } | null>(null);
  const [deleteEpicId, setDeleteEpicId] = useState<string | null>(null);
  const [deleteEpicOpen, setDeleteEpicOpen] = useState(false);
  // Selección múltiple de épicas para bulk delete (paritario al patrón en
  // EpicStoryList). Set vacío oculta la action bar.
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(new Set());
  const [bulkDeleteEpicsOpen, setBulkDeleteEpicsOpen] = useState(false);
  const [exportingEpicFormat, setExportingEpicFormat] = useState<ExportFormat | null>(null);

  // AI agent states
  const [agentMode, setAgentMode] = useState<'idle' | 'prompting' | 'streaming' | 'staging'>('idle');
  const [proposals, setProposals] = useState<ProposedEpic[]>([]);
  const [agentEvents, setAgentEvents] = useState<EpicGenerationEvent[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [editingProposal, setEditingProposal] = useState<ProposedEpic | null>(null);

  // Mantiene la pantalla activa durante runs largos del agente (epic
  // generation puede tardar 5-15 min). Sin esto, macOS/Chrome pueden
  // suspender el sistema y matar el SSE con `terminated`.
  useScreenWakeLock(agentMode === 'streaming');
  const abortRef = useRef<AbortController | null>(null);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;

  // Recover cached session on mount (survives tab close / page refresh).
  // Hidrata 4 escenarios:
  //   1. session.status='staging' + proposals → mostrar staging UI.
  //   2. last event = 'run_finished' → run terminó (defensa contra zombies
  //      donde el proceso murió antes de saveFullSession y el status quedó
  //      stuck en 'streaming'). Tratar como staging.
  //   3. session.status='streaming' + events sin run_finished → corre en
  //      background, mostrar thinking display + polling.
  //   4. session vacía o no existe → idle.
  useEffect(() => {
    if (!initiative) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await getCachedSession(initiative.id);
        if (cancelled || !result?.session) return;
        const { session } = result;

        if (session.proposals.length > 0 && session.status === 'staging') {
          setAgentEvents(session.events);
          setProposals(session.proposals);
          setAgentMode('staging');
          return;
        }

        // Defensa contra cache zombie: si el último event es 'run_finished'
        // o 'done', el agente terminó aunque status diga 'streaming'.
        // Esto pasa cuando saveFullSession no corrió (ej. proceso del backend
        // murió mid-callback). El polling NO debe activarse en este caso.
        const lastEvent = session.events[session.events.length - 1];
        const runFinished =
          lastEvent?.type === 'run_finished' || lastEvent?.type === 'done';
        if (runFinished) {
          setAgentEvents(session.events);
          setProposals(session.proposals);
          setAgentMode(session.proposals.length > 0 ? 'staging' : 'idle');
          return;
        }

        // El run fue iniciado en otra tab/sesión y aún corre en background.
        // Hidrata los eventos acumulados — el segundo useEffect (polling)
        // se encarga de seguir trayendo updates hasta que termine.
        if (session.events.length > 0 && session.status === 'streaming') {
          setAgentEvents(session.events);
          setProposals(session.proposals);
          setAgentMode('streaming');
        }
      } catch {
        // Cache unavailable — stay idle
      }
    })();

    return () => { cancelled = true; };
  }, [initiative?.id]);

  // Polling del cache cuando el run sigue corriendo en background (otra tab,
  // o esta misma tab tras cerrarla). Solo se activa si NO hay un run iniciado
  // por este cliente (abortRef vacío) — en ese caso el SSE stream local ya
  // está alimentando agentEvents en vivo y el polling sería redundante.
  //
  // Stale detection: si el cache no recibe events nuevos en N ticks,
  // asumimos que el run murió (server reinició, timeout disparado sin
  // limpiar bien, etc.) y paramos el polling para no quemar requests.
  useEffect(() => {
    if (!initiative) return;
    if (agentMode !== 'streaming') return;
    if (abortRef.current) return; // SSE local activo; no necesitamos polling

    let cancelled = false;
    const POLL_INTERVAL_MS = 3000;
    const STALE_THRESHOLD_TICKS = 20; // 20 × 3s = 60s sin nuevos events
    let lastEventCount = -1;
    let staleTickCount = 0;

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await getCachedSession(initiative.id);
        if (cancelled || !result?.session) {
          // Cache borrado (TTL expiró o consumido) — terminamos polling.
          if (!cancelled) setAgentMode('idle');
          return;
        }
        const { session } = result;
        // Hidratar los eventos completos cada tick — son inmutables y el
        // useAgentThinkingState memoiza, así que reasignar el array
        // completo no causa render churn más allá de la diff de los blocks.
        setAgentEvents(session.events);
        setProposals(session.proposals);

        if (session.status === 'staging') {
          // Run terminó. Detenemos polling y mostramos staging UI.
          setAgentMode('staging');
          cancelled = true;
          return;
        }

        // Defensa contra cache zombie: si el último event ya es run_finished
        // o done, el agente terminó pero saveFullSession no actualizó el
        // status. Paramos polling igual.
        const lastEvent = session.events[session.events.length - 1];
        if (lastEvent?.type === 'run_finished' || lastEvent?.type === 'done') {
          setAgentMode(session.proposals.length > 0 ? 'staging' : 'idle');
          cancelled = true;
          return;
        }

        // Stale detection: si events no crecen, run probablemente murió.
        // Marcamos como staging local (mostrando lo que hay) para parar polling.
        // El cache seguirá con status='streaming' hasta TTL expire — no es
        // ideal, pero evita el bucle infinito visible al user.
        if (session.events.length === lastEventCount) {
          staleTickCount++;
          if (staleTickCount >= STALE_THRESHOLD_TICKS) {
            setAgentMode(session.proposals.length > 0 ? 'staging' : 'idle');
            cancelled = true;
            return;
          }
        } else {
          lastEventCount = session.events.length;
          staleTickCount = 0;
        }
      } catch {
        // Error transitorio — siguiente tick reintenta.
      }
    };

    // Primer tick inmediato + interval. setInterval garantiza que aunque un
    // tick demore (red lenta), no se solapan llamadas — el siguiente espera.
    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initiative?.id, agentMode]);

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

  const handleOpenEpicInNewTab = useCallback((epicId: string) => {
    window.open(`/proyectos/epicas/${epicId}`, '_blank', 'noopener,noreferrer');
    setEpicContextMenu(null);
  }, []);

  const handleExportEpicFormat = useCallback(async (epicId: string, format: ExportFormat) => {
    const baseEpic = state.epics.find((e) => e.id === epicId);
    if (!baseEpic) return;
    setExportingEpicFormat(format);
    try {
      const api = await getEpic(epicId, true);
      // Post-refactor v2: el contenido entero vive en `markdown`. El backend
      // hace el merge vault-vs-PG en `findOne(includeContent=true)`.
      const epic: Epic = {
        ...baseEpic,
        markdown: api.markdown ?? baseEpic.markdown,
      };
      const initiativeForEpic = state.initiatives.find((i) => i.id === epic.initiativeId) ?? null;
      const filename = buildFilename({ kind: 'epic', epic }, format);
      await dispatchEpic(format, epic, initiativeForEpic, state.pods, state.stories, filename);
      toast.success('Archivo descargado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar');
    } finally {
      setExportingEpicFormat(null);
      setEpicContextMenu(null);
    }
  }, [state.epics, state.initiatives, state.pods, state.stories]);

  const handleDeleteEpic = useCallback(async () => {
    if (!deleteEpicId) return;
    try {
      await apiDeleteEpic(deleteEpicId);
      dispatch({ type: 'DELETE_EPIC', payload: { id: deleteEpicId } });
      toast.success('Épica eliminada');
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar épica');
      throw err;
    }
  }, [dispatch, deleteEpicId]);

  const toggleSelectEpic = useCallback((epicId: string, checked: boolean) => {
    setSelectedEpicIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(epicId);
      else next.delete(epicId);
      return next;
    });
  }, []);

  const clearEpicSelection = useCallback(() => {
    setSelectedEpicIds(new Set());
  }, []);

  const handleBulkDeleteEpics = useCallback(async () => {
    // Snapshot del set antes de borrar — el array de épicas en state se
    // muta por el dispatch de cada DELETE_EPIC mientras iteramos.
    const idsToDelete = Array.from(selectedEpicIds);
    setSelectedEpicIds(new Set());
    setBulkDeleteEpicsOpen(false);

    // Toast unificado con loader: arranca en estado loading, luego se
    // reemplaza in-place por success/warning/error según el resultado
    // agregado. Sonner muestra el spinner integrado en el loading state.
    const toastId = toast.loading(
      `Eliminando ${idsToDelete.length} ${idsToDelete.length === 1 ? 'épica' : 'épicas'}…`,
    );
    let successCount = 0;
    let failCount = 0;
    for (const id of idsToDelete) {
      try {
        await apiDeleteEpic(id);
        dispatch({ type: 'DELETE_EPIC', payload: { id } });
        successCount++;
      } catch {
        failCount++;
        // Silencioso: agregamos al toast final el conteo de fallas. NO
        // interrumpimos el bucle para que las épicas que SÍ se pueden borrar
        // se procesen — el user vuelve a abrir el dialog si quiere reintentar.
      }
    }
    if (successCount > 0 && failCount === 0) {
      toast.success(`${successCount} ${successCount === 1 ? 'épica eliminada' : 'épicas eliminadas'}`, { id: toastId });
    } else if (successCount > 0 && failCount > 0) {
      toast.warning(`${successCount} eliminadas, ${failCount} fallaron`, { id: toastId });
    } else if (failCount > 0) {
      toast.error(`No se pudo eliminar ${failCount === 1 ? 'la épica' : 'las épicas'}`, { id: toastId });
    }
  }, [dispatch, selectedEpicIds]);

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
    // Fechas opcionales — fallback a string vacío si la iniciativa está en
    // planning sin compromiso temporal todavía.
    setEditStartDate(initiative.startDate ?? '');
    setEditTargetDate(initiative.targetDate ?? '');
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

    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }

    if (isSaving) return;
    setIsSaving(true);

    try {
      await apiUpdateInitiative(initiative.id, changes);
      dispatch({ type: 'UPDATE_INITIATIVE', payload: { id: initiative.id, changes } });
      toast.success('Iniciativa actualizada');
      setIsEditing(false);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartAgent = () => setAgentMode('prompting');

  const handleCancelAgent = () => {
    // Doble cancelación:
    //   1. AbortController local — cierra el SSE de este cliente.
    //   2. DELETE /active al backend — aborta el agente Anthropic + limpia
    //      el cache. Sin (2), tras `req.close` el backend dejaba el agente
    //      corriendo en background hasta el timeout de 10min y al refrescar
    //      el cliente veía el run "todavía corriendo".
    //
    // (2) es fire-and-forget — el user no espera la respuesta del DELETE
    // para que la UI vuelva a idle al instante. Si la red falla, el cache
    // queda con el run zombi y el timeout backend lo cierra eventualmente.
    abortRef.current?.abort();
    abortRef.current = null;
    if (initiative) {
      cancelEpicGeneration(initiative.id).catch(() => {});
    }
    setAgentMode(proposalsRef.current.length > 0 ? 'staging' : 'idle');
    setAgentEvents([]);
    setProposals(proposalsRef.current);
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
        markdown: proposal.markdown,
        status: proposal.status,
        priority: proposal.priority,
        initiativeId: proposal.initiativeId,
        podIds: proposal.podIds,
        startDate: proposal.startDate,
        targetDate: proposal.targetDate,
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
        <div className="mx-auto px-6 py-8 max-w-7xl">
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
              <TooltipProvider delayDuration={200}>
                <div className="flex gap-1 shrink-0 mt-1">
                  {!isEditing ? (
                    <>
                      <DownloadMenu entity={{ kind: 'initiative', initiative }} />
                      {(initiative.tracker as TrackerReference | undefined)?.externalUrl ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={(initiative.tracker as TrackerReference).externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent dark:hover:bg-accent/50 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Linear
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>Abrir iniciativa en Linear</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={handlePublishToLinear}
                              disabled={publishingTracker}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {publishingTracker ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <LinearIcon className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Publicar como Linear Initiative</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={handleStartEdit} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar iniciativa</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Eliminar iniciativa</TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Cancelar edición</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={handleSave} disabled={isSaving} className="text-foreground">
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Guardar cambios</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>
              </TooltipProvider>
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
                    {initiative.startDate && initiative.targetDate
                      ? `${formatShortDate(initiative.startDate)} — ${formatShortDate(initiative.targetDate)}`
                      : 'Sin fechas (borrador)'}
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
                    <p className="text-sm font-medium">
                      {initiative.startDate ? formatShortDate(initiative.startDate) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Fecha Objetivo</p>
                    <p className="text-sm font-medium">
                      {initiative.targetDate ? formatShortDate(initiative.targetDate) : '—'}
                    </p>
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
              {/* Header with count + action buttons (o bulk action bar si hay selección) */}
              <div className="flex items-center justify-between gap-3">
                {selectedEpicIds.size > 0 ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">
                      {selectedEpicIds.size}{' '}
                      {selectedEpicIds.size === 1 ? 'épica seleccionada' : 'épicas seleccionadas'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearEpicSelection}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBulkDeleteEpicsOpen(true)}
                      className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar {selectedEpicIds.size}
                    </Button>
                  </div>
                ) : (
                  (() => {
                    const allEpicsSelected = epics.length > 0 && selectedEpicIds.size === epics.length;
                    const someEpicsSelected =
                      selectedEpicIds.size > 0 && selectedEpicIds.size < epics.length;
                    return (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>
                          {epics.length} {epics.length === 1 ? 'épica' : 'épicas'}
                        </span>
                        {epics.length > 0 && !isCreatingEpic && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <label className="flex items-center gap-2 cursor-pointer select-none hover:text-foreground transition-colors">
                              <RoundCheckbox
                                checked={allEpicsSelected ? true : someEpicsSelected ? 'indeterminate' : false}
                                onCheckedChange={() => {
                                  if (allEpicsSelected) {
                                    setSelectedEpicIds(new Set());
                                  } else {
                                    setSelectedEpicIds(new Set(epics.map((e) => e.id)));
                                  }
                                }}
                                aria-label="Seleccionar todas las épicas"
                              />
                              <span className="text-xs">
                                {allEpicsSelected
                                  ? 'Todas seleccionadas'
                                  : someEpicsSelected
                                    ? 'Selección parcial'
                                    : 'Seleccionar todo'}
                              </span>
                            </label>
                          </>
                        )}
                      </div>
                    );
                  })()
                )}
                <div className="flex gap-2">
                  {agentMode === 'idle' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStartAgent}
                      disabled={selectedEpicIds.size > 0}
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
                    disabled={isCreatingEpic || selectedEpicIds.size > 0}
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
                      const isEpicSelected = selectedEpicIds.has(epic.id);

                      return (
                        <div
                          key={epic.id}
                          className={`rounded-lg border transition-colors cursor-pointer ${
                            isEpicSelected ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/30'
                          }`}
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
                            {/* Checkbox de selección — stopPropagation para no navegar */}
                            <div
                              className="shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <RoundCheckbox
                                checked={isEpicSelected}
                                onCheckedChange={(checked) => toggleSelectEpic(epic.id, checked === true)}
                                aria-label={`Seleccionar épica ${epic.title}`}
                              />
                            </div>
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
                    markdown: editingProposal.markdown,
                    priority: editingProposal.priority,
                    status: editingProposal.status,
                    selectedPodIds: editingProposal.podIds,
                    startDate: editingProposal.startDate,
                    targetDate: editingProposal.targetDate,
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

      <DropdownMenu
        open={epicContextMenu !== null}
        onOpenChange={(open) => { if (!open) setEpicContextMenu(null); }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none"
            style={{
              position: 'fixed',
              top: epicContextMenu?.y ?? -9999,
              left: epicContextMenu?.x ?? -9999,
              width: 1,
              height: 1,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={2}
          className="min-w-[220px]"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem
            onSelect={() => epicContextMenu && handleOpenEpicInNewTab(epicContextMenu.epicId)}
          >
            <ExternalLink className="h-4 w-4" />
            Abrir en nueva pestaña
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={exportingEpicFormat !== null}>
              {exportingEpicFormat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Descargar archivo
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[160px]">
              {ALL_FORMATS.map((format) => {
                const Icon = {
                  pdf: FileType,
                  excel: FileSpreadsheet,
                  word: FileText,
                  csv: FileCode,
                  json: FileJson,
                }[format];
                return (
                  <DropdownMenuItem
                    key={format}
                    disabled={exportingEpicFormat !== null}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (epicContextMenu) handleExportEpicFormat(epicContextMenu.epicId, format);
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {FORMAT_LABELS[format]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (!epicContextMenu) return;
              setDeleteEpicId(epicContextMenu.epicId);
              setDeleteEpicOpen(true);
              setEpicContextMenu(null);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Eliminar épica
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {deleteEpicId && (() => {
        const epicToDelete = state.epics.find((e) => e.id === deleteEpicId);
        if (!epicToDelete) return null;
        return (
          <TypeToConfirmDialog
            open={deleteEpicOpen}
            onOpenChange={(open) => {
              setDeleteEpicOpen(open);
              if (!open) setDeleteEpicId(null);
            }}
            title="Eliminar épica"
            resourceLabel="épica"
            expectedValue={epicToDelete.title}
            description="Esto eliminará la épica junto con todas sus historias, diagramas, documentos y dependencias. La acción es permanente y no se puede deshacer."
            confirmText="Eliminar épica"
            onConfirm={handleDeleteEpic}
          />
        );
      })()}

      {/* Modal type-to-confirm bulk delete de épicas. Reusa
          TypeToConfirmDialog con expectedValue="ELIMINAR" (palabra
          constante) — paritario al patrón usado para historias. La
          lista de épicas afectadas vive en `extraContent` para que el
          user verifique scope antes de escribir la palabra. */}
      <TypeToConfirmDialog
        open={bulkDeleteEpicsOpen}
        onOpenChange={setBulkDeleteEpicsOpen}
        title={`Eliminar ${selectedEpicIds.size} ${selectedEpicIds.size === 1 ? 'épica' : 'épicas'}`}
        resourceLabel="épicas"
        expectedValue="ELIMINAR"
        confirmLabel={
          <>Para confirmar, escribe <span className="font-mono font-semibold text-foreground">ELIMINAR</span></>
        }
        hideExpectedValueBlock
        description="Cada épica se eliminará junto con todas sus historias, diagramas, documentos y dependencias. La acción es permanente y no se puede deshacer."
        confirmText="Eliminar"
        extraContent={
          <div className="max-h-32 overflow-y-auto rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs space-y-0.5">
            {state.epics
              .filter((e) => selectedEpicIds.has(e.id))
              .map((e) => (
                <div key={e.id} className="truncate text-foreground/80">
                  <span className="text-muted-foreground/60">·</span> {e.title}
                </div>
              ))}
          </div>
        }
        onConfirm={handleBulkDeleteEpics}
      />
    </div>
  );
}

export function InitiativeFullPage({ initiativeId }: InitiativeFullPageProps) {
  return <InitiativeFullPageInner initiativeId={initiativeId} />;
}
