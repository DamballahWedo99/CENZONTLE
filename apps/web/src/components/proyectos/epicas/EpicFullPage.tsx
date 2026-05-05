'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { updateEpic as apiUpdateEpic, deleteEpic as apiDeleteEpic, getEpic as apiGetEpic, getDiscoveredDependencies as apiGetDiscoveredDependencies, getStoryDependencies as apiGetStoryDependencies, uploadDesignBundle as apiUploadDesignBundle, deleteDesign as apiDeleteDesign, type StoryDependencyItem } from '@/lib/api/epics';
import { getEpicDependenciesRollup } from '@/lib/api/story-dependencies';
import { MOCK_DISCOVERED_DEPENDENCIES } from '@/data/mock/discovered-dependencies';
import { MOCK_PROPOSED_STORIES, MOCK_STORY_DEPENDENCIES } from '@/data/mock/proposed-stories';
import { topologicalSortProposals } from '@/lib/story-dag';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
import { createStory as apiCreateStory, updateStory as apiUpdateStory, deleteStory as apiDeleteStory } from '@/lib/api/stories';
import { toast } from 'sonner';
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
  EpicStatus,
  Priority,
  StoryStatus,
  ChangelogAction,
  ChangelogEntityType,
  ChangelogEntry,
  UserStory,
} from '@cenzontle/shared';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityIndicator } from '../shared/PriorityIndicator';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { DownloadMenu } from '../shared/DownloadMenu';
import { EpicDiagrams } from './EpicDiagrams';
import { EpicDocuments } from './EpicDocuments';
import { EpicDependencies } from './EpicDependencies';
import { EpicDesigns } from './EpicDesigns';
import { SectionTiptapEditor } from '../historias/editor/SectionTiptapEditor';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';
import { IntegrationSettingsDialog } from '../settings/IntegrationSettingsDialog';
import { EpicStoryList } from './EpicStoryList';
import { StoryAgentPromptBar } from './StoryAgentPromptBar';
import { StoryProposalList } from './StoryProposalList';
import { streamStoryProposals } from '@/lib/story-agent';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';
import {
  getCachedStorySession,
  removeCachedStoryProposal,
  invalidateStoryCache,
  getStorySession,
  cancelStoryGeneration,
} from '@/lib/api/story-generation';
import type {
  ProposedStory,
  StoryGenerationEvent,
  DiscoveredDependency,
} from '@cenzontle/shared';
import { useDiagramCacheHydration } from '@/hooks/useDiagramCacheHydration';
import {
  Calendar,
  Pencil,
  Trash2,
  X,
  Check,
  History,
  BookOpen,
  FileText,
  Paperclip,
  Network,
  CheckCircle2,
  Circle,
  Lock,
  ShieldCheck,
  ListChecks,
  GitBranch,
  Upload,
  Palette,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { LinearIcon } from '@/components/icons/LinearIcon';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { publishEpicToTracker } from '@/lib/api/integrations';
import { ApiError } from '@/lib/api/client';
import type { TrackerReference } from '@cenzontle/shared';

// --- Changelog helpers ---

const actionVerbs: Record<ChangelogAction, string> = {
  [ChangelogAction.Created]: 'creó',
  [ChangelogAction.Updated]: 'actualizó',
  [ChangelogAction.Deleted]: 'eliminó',
  [ChangelogAction.Moved]: 'movió',
  [ChangelogAction.Reassigned]: 'reasignó',
  [ChangelogAction.Approved]: 'aprobó',
  [ChangelogAction.Rejected]: 'rechazó',
};

const fieldLabels: Record<string, string> = {
  status: 'estado', priority: 'prioridad', title: 'título', markdown: 'definición',
  startDate: 'fecha de inicio', targetDate: 'fecha objetivo', storyPoints: 'story points',
  historias: 'historias de usuario', documento: 'documento', 'aprobación PO': 'aprobación PO', 'aprobación TL (diagrama)': 'aprobación TL (diagrama)', 'aprobación QA': 'aprobación QA',
  diseño: 'diseño', 'requiere diseño': 'requiere diseño',
};

const statusLabels: Record<string, string> = {
  backlog: 'Backlog', to_do: 'To Do', in_progress: 'In Progress', in_review: 'In Review',
  qa: 'QA', done: 'Done', blocked: 'Blocked', draft: 'Draft', planning: 'Planning',
  active: 'Active', completed: 'Completed', on_hold: 'On Hold',
};

const priorityLabels: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

function humanizeFieldName(field: string | null): string {
  if (!field) return '';
  return fieldLabels[field] ?? field.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function humanizeValue(field: string | null, value: string): string {
  if (!field || !value) return value;
  if (field === 'status') return statusLabels[value] ?? value;
  if (field === 'priority') return priorityLabels[value] ?? value;
  if (['startDate', 'targetDate', 'updatedAt', 'createdAt'].includes(field)) {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { /* fall through */ }
  }
  return value;
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function getStatusColor(value: string): string {
  const colors: Record<string, string> = {
    done: 'bg-green-500/15 text-green-700 dark:text-green-400',
    completed: 'bg-green-500/15 text-green-700 dark:text-green-400',
    in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    active: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    blocked: 'bg-red-500/15 text-red-700 dark:text-red-400',
    draft: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
  };
  return colors[value] ?? 'bg-muted text-muted-foreground';
}

function ValueChip({ field, value, variant }: { field: string | null; value: string; variant: 'old' | 'new' }) {
  const humanized = humanizeValue(field, value);
  if (field === 'status') {
    const statusColor = getStatusColor(value);
    return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${statusColor} ${variant === 'old' ? 'line-through opacity-60' : ''}`}>{humanized}</span>;
  }
  const baseClass = variant === 'old'
    ? 'rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-700 line-through dark:text-red-400'
    : 'rounded-md bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400';
  return <span className={`text-[11px] font-medium ${baseClass}`}>{humanized}</span>;
}

// --- Markdown placeholder ---
// Estructura mínima sugerida para épicas — placeholder del editor cuando el
// markdown está vacío. El user lo ve y empieza a escribir; el agente IA emite
// el mismo set vía `validateTerminal` (ver epic-generation.service).
// "Prioridad de negocio" y "Equipos involucrados" se omiten porque ya viven
// como metadata estructurada (`priority` enum + `podIds` cells).
const EPIC_MARKDOWN_PLACEHOLDER = `## Objetivo

(Qué se construye y por qué surge.)

## Beneficios cualitativos

-

## Beneficios cuantitativos

-

## Medición de beneficios

(Cómo se mide cada beneficio: dashboard, métrica, KPI.)

## Alcance

EN alcance:
-

NO en alcance:
-

## Criterios de aceptación

1.

## Mejoras tecnológicas

(Refactor, deuda técnica, capacidades de plataforma.)

## Canales y flujos impactados

-

## Dependencias de terceros

-`;

// --- Protocol Checklist Component ---

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  active: boolean;
  locked: boolean;
}

function ProtocolChecklist({
  steps,
  onStepClick,
}: {
  steps: ChecklistStep[];
  onStepClick: (stepId: string) => void;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Protocolo de Definición
      </h3>
      <div className="space-y-1">
        {steps.map((step, index) => (
          <button
            key={step.id}
            onClick={() => !step.locked && onStepClick(step.id)}
            disabled={step.locked}
            className={`w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
              step.locked
                ? 'opacity-40 cursor-not-allowed'
                : step.active
                  ? 'bg-foreground/5 ring-1 ring-foreground/10'
                  : 'hover:bg-muted/50 cursor-pointer'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.completed ? (
                <CheckCircle2 className="h-4.5 w-4.5 text-green-600 dark:text-green-400" />
              ) : step.locked ? (
                <Lock className="h-4.5 w-4.5 text-muted-foreground/50" />
              ) : (
                <Circle className={`h-4.5 w-4.5 ${step.active ? 'text-foreground' : 'text-muted-foreground/60'}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-tight ${step.completed ? 'text-green-700 dark:text-green-400' : step.locked ? 'text-muted-foreground/50' : ''}`}>
                {step.label}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                {step.description}
              </p>
            </div>
            {index < steps.length - 1 && (
              <div className="absolute left-[29px] top-[calc(100%-2px)] w-px h-1 bg-border" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Main inner component ---

function EpicFullPageInner({ epicId }: { epicId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, dispatch } = useProyectos();
  const { setBreadcrumb } = useBreadcrumb();

  const rawEpic = useMemo(() => state.epics.find((e) => e.id === epicId) ?? null, [epicId, state.epics]);

  const epic = useMemo(() => {
    if (!rawEpic) return null;
    const initiative = state.initiatives.find((i) => i.id === rawEpic.initiativeId)!;
    const pods = state.pods.filter((p) => rawEpic.podIds.includes(p.id));
    const stories = state.stories.filter((s) => s.epicId === rawEpic.id);
    const doneStories = stories.filter((s) => s.status === StoryStatus.Done).length;
    const progress = stories.length > 0 ? Math.round((doneStories / stories.length) * 100) : 0;
    return { ...rawEpic, initiative, pods, stories, progress };
  }, [rawEpic, state.initiatives, state.pods, state.stories]);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishingTracker, setPublishingTracker] = useState(false);

  const handlePublishToLinear = async () => {
    if (!rawEpic) return;
    setPublishingTracker(true);
    try {
      const result = await publishEpicToTracker(rawEpic.id, 'linear');
      // Cascade hacia arriba: si la iniciativa también se publicó/reusó,
      // sincronizamos su tracker en el Context.
      if (result.initiativeTracker) {
        dispatch({
          type: 'UPDATE_INITIATIVE',
          payload: {
            id: rawEpic.initiativeId,
            changes: { tracker: result.initiativeTracker },
          },
        });
      }
      dispatch({
        type: 'UPDATE_EPIC',
        payload: { id: rawEpic.id, changes: { tracker: result.epicTracker } },
      });
      for (const { storyId, tracker } of result.storyTrackers) {
        dispatch({ type: 'UPDATE_STORY', payload: { id: storyId, changes: { tracker } } });
      }
      if (result.alreadyPublished) {
        toast.info('La épica ya estaba publicada en Linear', {
          description: `Project ${result.epicTracker.externalKey} → abrir`,
          action: {
            label: 'Abrir',
            onClick: () => window.open(result.epicTracker.externalUrl, '_blank'),
          },
        });
      } else {
        const failCount = result.partialFailures.length;
        const okCount = result.storyTrackers.length;
        const initiativeNote = result.initiativeTracker
          ? result.initiativeAlreadyPublished
            ? 'Initiative reusada · '
            : 'Initiative creada · '
          : '';
        const storiesNote =
          failCount > 0
            ? `${okCount} historias OK, ${failCount} fallaron`
            : `${okCount} historias publicadas`;
        toast.success(`Project creado en Linear`, {
          description: `${initiativeNote}${storiesNote}`,
          action: {
            label: 'Abrir Linear',
            onClick: () => window.open(result.epicTracker.externalUrl, '_blank'),
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
        toast.error('No se pudo publicar la épica en Linear', { description: message });
      }
    } finally {
      setPublishingTracker(false);
    }
  };

  const handleDelete = async () => {
    if (!rawEpic) return;
    try {
      await apiDeleteEpic(rawEpic.id);
      dispatch({ type: 'DELETE_EPIC', payload: { id: rawEpic.id } });
      toast.success('Épica eliminada');
      router.push(`/proyectos/iniciativas/${rawEpic.initiativeId}`);
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar épica');
      throw err;
    }
  };
  const [showIntegrationDialog, setShowIntegrationDialog] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  /** Markdown único de la épica — reemplaza description + 11 sub-campos del shape v1. */
  const [editMarkdown, setEditMarkdown] = useState('');
  const [editStatus, setEditStatus] = useState<EpicStatus>(EpicStatus.Draft);
  const [editPriority, setEditPriority] = useState<Priority>(Priority.Medium);
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editPodIds, setEditPodIds] = useState<string[]>([]);
  const [editInitiativeId, setEditInitiativeId] = useState('');
  const [storyAgentMode, setStoryAgentMode] = useState<'idle' | 'prompting' | 'streaming' | 'staging'>('idle');
  const [storyProposals, setStoryProposals] = useState<ProposedStory[]>([]);
  const [storyAgentEvents, setStoryAgentEvents] = useState<StoryGenerationEvent[]>([]);
  const [acceptingStoryId, setAcceptingStoryId] = useState<string | null>(null);
  const storyAbortRef = useRef<AbortController | null>(null);

  // Mantiene la pantalla activa mientras el run del agente está vivo. Sin
  // esto, macOS/Chrome pueden suspender el sistema cuando la pantalla se
  // apaga por inactividad y el SSE muere con `terminated` aunque el backend
  // siga corriendo. Solo `streaming` aplica — `staging` ya tiene el run
  // terminado del lado del backend (solo esperamos confirmación del usuario).
  useScreenWakeLock(storyAgentMode === 'streaming');
  // Counter del tab "Dependencias" — se sincroniza con el rollup que carga
  // <EpicDependencies/> via callback. Inicializado con el cálculo legacy
  // (epic.dependencies + discovered + storyDeps) para evitar flicker antes
  // del primer fetch del rollup.
  const [rollupCount, setRollupCount] = useState<number | null>(null);
  // Tab state URL-synced bidireccional (ver mismo patrón en StoryFullPage).
  // El init via searchParams ya existía; ahora también escribimos al cambiar.
  const pathname = usePathname();
  const activeTab = searchParams.get('tab') ?? 'definicion';
  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [showChecklist, setShowChecklist] = useState(false);
  const [discoveredDeps, setDiscoveredDeps] = useState<DiscoveredDependency[]>([]);
  const [storyDeps, setStoryDeps] = useState<StoryDependencyItem[]>([]);
  // Dev-only toggle: `?mockDeps=true` muestra dependencias de ejemplo con
  // todos los estados (requiere credencial, resuelta, sin credencial) para
  // poder validar la UI sin ejecutar el agente. Los datos viven en
  // `data/mock/discovered-dependencies.ts` y no tocan el backend.
  const useMockDeps = searchParams.get('mockDeps') === 'true';
  const effectiveDiscoveredDeps = useMockDeps ? MOCK_DISCOVERED_DEPENDENCIES : discoveredDeps;

  /**
   * Dev-only toggle: `?mockStoryDeps=true` inyecta un batch mock de
   * propuestas con DAG rico (cadenas, diamantes, soft/hard) para validar
   * los badges de "Bloqueada por" en StoryProposalCard sin correr el
   * agente completo. Los mocks viven en `data/mock/proposed-stories.ts`.
   */
  const useMockStoryDeps = searchParams.get('mockStoryDeps') === 'true';
  const effectiveStoryDeps = useMockStoryDeps ? MOCK_STORY_DEPENDENCIES : storyDeps;

  /**
   * Refetch de discoveredDeps. Se dispara al montar/cambiar epic y también
   * desde `EpicDependencies` tras resolver una dep con un secret externo
   * (evita el hack de `window.location.reload()`).
   */
  const refreshDiscoveredDeps = useCallback(async () => {
    if (!rawEpic?.id) {
      setDiscoveredDeps([]);
      return;
    }
    try {
      const deps = await apiGetDiscoveredDependencies(rawEpic.id);
      setDiscoveredDeps(deps);
    } catch {
      setDiscoveredDeps([]);
    }
  }, [rawEpic?.id]);

  /**
   * Refetch del DAG story-to-story. Se dispara al montar/cambiar epic y
   * también después de aceptar propuestas (individual o batch), porque el
   * backend persiste los edges `blockedBy` al crear historias y sin refetch
   * el panel "Orden entre historias" queda stale hasta un reload manual.
   */
  const refreshStoryDeps = useCallback(async () => {
    if (!rawEpic?.id) {
      setStoryDeps([]);
      return;
    }
    try {
      const deps = await apiGetStoryDependencies(rawEpic.id);
      setStoryDeps(deps);
    } catch {
      setStoryDeps([]);
    }
  }, [rawEpic?.id]);

  useEffect(() => {
    if (!rawEpic?.id) {
      setDiscoveredDeps([]);
      setStoryDeps([]);
      setRollupCount(null);
      return;
    }
    const controller = new AbortController();
    apiGetDiscoveredDependencies(rawEpic.id)
      .then((deps) => {
        if (!controller.signal.aborted) setDiscoveredDeps(deps);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDiscoveredDeps([]);
      });
    apiGetStoryDependencies(rawEpic.id)
      .then((deps) => {
        if (!controller.signal.aborted) setStoryDeps(deps);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStoryDeps([]);
      });
    // Rollup count: el componente <EpicDependencies/> hace su propio fetch
    // cuando se monta — pero como vive dentro de <TabsContent value="dependencias"/>,
    // Radix Tabs solo lo monta al cambiar a esa tab. Resultado: el badge
    // mostraba un count parcial (epic.dependencies + discovered + storyDeps
    // del state local) hasta que el user clickeaba la tab.
    // Hacemos el fetch también desde el padre para que el badge sea correcto
    // desde el primer render. Cuando el user entra a la tab, EpicDependencies
    // refetch para refrescar — costo aceptable a cambio de no ver count parcial.
    getEpicDependenciesRollup(rawEpic.id)
      .then((deps) => {
        if (!controller.signal.aborted) setRollupCount(deps.length);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRollupCount(null);
      });
    return () => controller.abort();
  }, [rawEpic?.id]);

  const epicChangelog = useMemo(() => {
    if (!epic) return [];
    const epicStoryIds = new Set(epic.stories.map((s) => s.id));
    return state.changelog.filter(
      (entry) =>
        (entry.entityType === ChangelogEntityType.Epic && entry.entityId === epic.id) ||
        (entry.entityType === ChangelogEntityType.Story && epicStoryIds.has(entry.entityId))
    );
  }, [state.changelog, epic]);

  // --- Protocol checklist state ---
  // Definición considerada completa si el markdown contiene los 9 headings
  // obligatorios. Si no, la épica está parcialmente definida y el checklist
  // del protocolo lo refleja.
  const REQUIRED_EPIC_HEADINGS = useMemo(() => [
    '## descripción',
    '## beneficios cualitativos',
    '## beneficios cuantitativos',
    '## medición de beneficios',
    '## alcance',
    '## criterios de aceptación',
    '## mejoras tecnológicas',
    '## canales y flujos impactados',
    '## dependencias de terceros',
  ], []);
  const definitionComplete = useMemo(() => {
    if (!rawEpic) return false;
    const md = (rawEpic.markdown ?? '').toLowerCase();
    if (md.trim().length === 0) return false;
    return REQUIRED_EPIC_HEADINGS.every((h) => md.includes(h));
  }, [rawEpic, REQUIRED_EPIC_HEADINGS]);

  const hasBusinessDiagram = useMemo(() => {
    if (!rawEpic) return false;
    return rawEpic.diagrams.some((d) => d.type === 'business');
  }, [rawEpic]);

  // Hidrata el estado desde Redis (cache con TTL 5 días) si el diagrama no
  // está ya en memoria. La lógica vive en un hook reutilizable porque la
  // vista dedicada (`DiagramFullPage`) también la necesita — sin él, abrir
  // el diagrama en una tab nueva mostraría "No hay diagrama" aunque esté
  // cacheado. Ver `useDiagramCacheHydration` para detalles.
  useDiagramCacheHydration(rawEpic?.id, 'business');

  const hasStories = useMemo(() => {
    if (!epic) return false;
    return epic.stories.length > 0;
  }, [epic]);


  const filledFieldsCount = useMemo(() => {
    if (!rawEpic) return 0;
    const md = (rawEpic.markdown ?? '').toLowerCase();
    return REQUIRED_EPIC_HEADINGS.filter((h) => md.includes(h)).length;
  }, [rawEpic, REQUIRED_EPIC_HEADINGS]);
  const totalFields = REQUIRED_EPIC_HEADINGS.length;

  const checklistSteps: ChecklistStep[] = [
    {
      id: 'definition',
      label: `Definición completa (${filledFieldsCount}/${totalFields})`,
      description: definitionComplete ? 'Todos los campos completados' : 'Completa todos los campos de la épica',
      completed: definitionComplete,
      active: activeTab === 'definicion',
      locked: false,
    },
    {
      id: 'diagram',
      label: 'Diagrama de negocio',
      description: hasBusinessDiagram ? 'Diagrama generado' : 'Genera el diagrama con IA',
      completed: hasBusinessDiagram,
      active: activeTab === 'diagramas',
      locked: false,
    },
    {
      id: 'stories',
      label: 'Historias de usuario',
      description: hasStories
        ? `${epic?.stories.length} historias generadas`
        : 'Genera historias con el agente IA',
      completed: hasStories,
      active: activeTab === 'historias',
      locked: false,
    },
  ];

  const completedStepsCount = checklistSteps.filter((s) => s.completed).length;

  const handleChecklistClick = (stepId: string) => {
    const tabMap: Record<string, string> = {
      definition: 'definicion',
      diagram: 'diagramas',
      stories: 'historias',
    };
    setActiveTab(tabMap[stepId] ?? 'definicion');
  };

  // Inject breadcrumb into app header
  useEffect(() => {
    if (!epic) return;
    setBreadcrumb(
      <div className="flex items-center gap-2 text-sm">
        <Link href="/proyectos" className="text-muted-foreground hover:text-foreground transition-colors">
          Proyectos
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <Link href={`/proyectos/iniciativas/${epic.initiative.id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]">
          {epic.initiative.name}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground truncate max-w-[300px]">{epic.title}</span>
      </div>
    );
    return () => setBreadcrumb(null);
  }, [epic, setBreadcrumb]);

  // ── AI Story Generation (agente 3-roles: PO + Tech Lead + QA) ──
  // IMPORTANTE: estos hooks deben ejecutarse SIEMPRE (antes del early return
  // `if (!epic)` para no romper el orden de hooks entre renders). Los handlers
  // tienen sus propios guards `if (!rawEpic) return;` para comportamiento seguro.

  const [acceptingAllStories, setAcceptingAllStories] = useState(false);

  const handleOpenStoryPrompt = useCallback(() => {
    setStoryAgentMode('prompting');
    setStoryProposals([]);
    setStoryAgentEvents([]);
  }, []);

  const handleCancelStoryAgent = useCallback(() => {
    // Cancelación doble:
    //   1. AbortController local — cierra el SSE de este cliente al instante.
    //   2. DELETE /:epicId/session/active al backend — aborta el agente que
    //      ahora corre en background (el backend ya no lo mata al cerrar SSE)
    //      e invalida la session cache.
    // Sin (2), tras el abort local el agente seguía corriendo en background
    // hasta su timeout natural (~10min) — exactamente el comportamiento que
    // teníamos en diagrams antes del fix análogo.
    storyAbortRef.current?.abort();
    storyAbortRef.current = null;
    if (rawEpic?.id) {
      cancelStoryGeneration(rawEpic.id).catch(() => {});
    }
    setStoryAgentMode('idle');
    setStoryProposals([]);
    setStoryAgentEvents([]);
  }, [rawEpic?.id]);

  const handleStartStoryStreaming = useCallback(async (prompt: string, webSearch: boolean) => {
    if (!rawEpic) return;
    setStoryAgentMode('streaming');
    setStoryProposals([]);
    setStoryAgentEvents([]);

    const abort = new AbortController();
    storyAbortRef.current = abort;

    try {
      const generator = streamStoryProposals(rawEpic.id, {
        prompt: prompt.trim() || undefined,
        webSearch,
        signal: abort.signal,
      });

      for await (const event of generator) {
        if (abort.signal.aborted) break;
        setStoryAgentEvents((prev) => [...prev, event]);

        if (event.type === 'proposal_ready') {
          setStoryProposals((prev) => [...prev, event.story]);
        }

        if (event.type === 'error') {
          toast.error(event.message || 'Error del agente de historias');
          setStoryAgentMode('idle');
          return;
        }

        if (event.type === 'run_finished' || event.type === 'done') {
          setStoryAgentMode((prev) => (prev === 'streaming' ? 'staging' : prev));
        }
      }
      setStoryAgentMode((prev) => (prev === 'streaming' ? 'staging' : prev));
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        toast.error(err?.message || 'Error generando historias');
      }
      setStoryAgentMode('idle');
    } finally {
      storyAbortRef.current = null;
    }
  }, [rawEpic]);

  const handleAcceptStoryProposal = useCallback(async (proposal: ProposedStory, options?: { silent?: boolean }) => {
    if (!rawEpic) return;
    const silent = options?.silent === true;
    setAcceptingStoryId(proposal.clientId);
    // Loader solo en accept individual. En modo `silent` (durante bulk),
    // `handleAcceptAllStories` ya muestra UN loader único para todo el batch
    // — los loaders por historia inundarían la pantalla.
    const toastId = silent
      ? undefined
      : toast.loading(`Guardando historia "${proposal.title}"…`);
    try {
      const created = await apiCreateStory({
        title: proposal.title,
        epicId: proposal.epicId,
        podId: proposal.podId,
        status: proposal.status as string,
        storyPoints: proposal.storyPoints,
        sprintId: proposal.sprintId ?? undefined,
        labels: proposal.labels,
        po: { markdown: proposal.po.markdown ?? '' },
        technical: { markdown: proposal.technical.markdown ?? '' },
        qa: { markdown: proposal.qa.markdown ?? '' },
        relatedDocuments: proposal.relatedDocuments,
        discoveredDependencies: proposal.discoveredDependencies,
        // `sourceClientId` sirve como ancla para que edges del DAG (blockedBy)
        // emitidos por otras historias del mismo batch puedan resolver el
        // storyId real cuando se acepten. Ver `persistBlockedByEdges` en el
        // backend.
        sourceClientId: proposal.clientId,
        blockedBy: proposal.blockedBy,
      });

      const nowIso = new Date().toISOString();
      dispatch({
        type: 'CREATE_STORY',
        payload: {
          ...proposal,
          id: created.id,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      });

      await removeCachedStoryProposal(rawEpic.id, proposal.clientId).catch(() => {});
      setStoryProposals((prev) => {
        const next = prev.filter((p) => p.clientId !== proposal.clientId);
        if (next.length === 0) setStoryAgentMode('idle');
        return next;
      });
      // En modo `silent` (durante bulk accept), suprimimos el toast individual.
      // El loader del botón "Aceptar todas" + el toast resumen al final son
      // suficiente feedback — los toasts por historia inundaban la pantalla.
      if (!silent) {
        toast.success(`Historia "${proposal.title}" creada`, { id: toastId });
      }
    } catch (err: any) {
      // Errors también se suprimen en silent — el toast resumen al final
      // dice "X fallaron". Si todas fallan, el resumen sigue siendo
      // informativo (`successCount=0, failureCount=N`) sin spam de toasts
      // individuales.
      if (!silent) {
        toast.error(err?.message || 'Error al crear la historia', { id: toastId });
      }
      // Re-throw para que `Promise.allSettled` / `runSequentiallySettled`
      // detecten el rejection en el batch caller. Sin esto, fallidas se
      // contaban como `fulfilled` y el toast resumen mentía.
      throw err;
    } finally {
      setAcceptingStoryId(null);
    }
  }, [rawEpic, dispatch]);

  const handleAcceptAllStories = useCallback(async () => {
    if (acceptingAllStories || acceptingStoryId) return;
    setAcceptingAllStories(true);
    const snapshot = [...storyProposals];
    const startMs = Date.now();
    // Loader único para todo el batch — sonner muestra el spinner durante el
    // accept secuencial/paralelo y se reemplaza por success/warning/error
    // cuando termina. El `toastId` se reusa en cada toast final.
    const toastId = toast.loading(
      snapshot.length === 1
        ? 'Guardando 1 historia…'
        : `Guardando ${snapshot.length} historias…`,
    );

    // Orden topológico de las historias por su DAG de `blockedBy`:
    // garantiza que las bloqueantes se acepten antes que las bloqueadas,
    // para que `persistBlockedByEdges` del backend pueda resolver los
    // clientIds a storyIds reales. Kahn's algorithm (BFS con in-degree).
    const ordered = topologicalSortProposals(snapshot);
    const hasDag = snapshot.some((p) => (p.blockedBy?.length ?? 0) > 0);
    // Wrapper que llama al handler en modo silent — suprime los toasts
    // individuales durante el batch para no inundar la pantalla. El loader
    // del botón "Aceptar todas" + el toast resumen al final son el único
    // feedback visual durante este flow.
    const acceptSilent = (p: ProposedStory) => handleAcceptStoryProposal(p, { silent: true });
    try {
      // Si hay DAG: aceptar secuencialmente en orden topológico para que
      // las bloqueantes existan en DB antes que sus bloqueadas.
      // Si NO hay DAG: paralelizar como antes (máxima velocidad).
      const results: PromiseSettledResult<void>[] = hasDag
        ? await runSequentiallySettled(ordered, acceptSilent)
        : await Promise.allSettled(ordered.map((p) => acceptSilent(p)));
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.filter((r) => r.status === 'rejected').length;
      const durMs = Date.now() - startMs;
      // Toast resumen — UNO solo al final, cubre los 3 casos:
      //  - Todas fallaron: error explicit.
      //  - Algunas fallaron: warning con conteos.
      //  - Todas OK: success con conteo (incluso si fue solo 1 — el toast
      //    individual ahora se suprimió porque pasamos silent=true, así
      //    que necesitamos confirmar al user que se creó).
      if (failureCount > 0 && successCount === 0) {
        toast.error(`Las ${failureCount} historias fallaron al crear. Intenta de nuevo.`, { id: toastId });
      } else if (failureCount > 0) {
        toast.warning(`${successCount} historias creadas, ${failureCount} fallaron. Las fallidas siguen en staging.`, { id: toastId });
      } else if (successCount > 0) {
        const label = successCount === 1 ? 'Historia creada' : `${successCount} historias creadas`;
        toast.success(`${label} en ${(durMs / 1000).toFixed(1)}s`, { id: toastId });
      } else {
        // Fallback: ningún success ni failure (snapshot vacío). Cierra el
        // loader explícitamente para no dejarlo colgado en pantalla.
        toast.dismiss(toastId);
      }
    } finally {
      setAcceptingAllStories(false);
      // Refetch del DAG story-to-story y las discovered deps. El backend
      // persiste `blockedBy` y `discoveredDependencies` al crear cada story,
      // pero el panel "Dependencias" lee del estado local — sin este refresh
      // el user tiene que recargar para ver los nuevos nodos del DAG.
      void refreshStoryDeps();
      void refreshDiscoveredDeps();
    }
  }, [storyProposals, handleAcceptStoryProposal, acceptingAllStories, acceptingStoryId, refreshStoryDeps, refreshDiscoveredDeps]);

  const handleDiscardStoryProposal = useCallback(async (clientId: string) => {
    if (!rawEpic) return;
    await removeCachedStoryProposal(rawEpic.id, clientId).catch(() => {});
    setStoryProposals((prev) => {
      const next = prev.filter((p) => p.clientId !== clientId);
      if (next.length === 0) setStoryAgentMode('idle');
      return next;
    });
  }, [rawEpic]);

  const handleDiscardAllStories = useCallback(async () => {
    if (!rawEpic) return;
    await invalidateStoryCache(rawEpic.id).catch(() => {});
    setStoryProposals([]);
    setStoryAgentEvents([]);
    setStoryAgentMode('idle');
  }, [rawEpic]);

  // Recuperar sesion cacheada al montar / cambiar de epica.
  // - status='staging' → run terminado con propuestas: mostrar para revisar.
  // - status='streaming' → run sigue activo en background: cargar events y
  //   props parciales, modo='streaming' (ningún SSE local activo todavía;
  //   el polling effect de abajo se encarga de seguir actualizando).
  useEffect(() => {
    if (!rawEpic) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await getCachedStorySession(rawEpic.id);
        if (cancelled || !cached?.session) return;
        const session = cached.session;
        if (session.status === 'staging' && session.proposals.length > 0) {
          setStoryProposals(session.proposals);
          setStoryAgentEvents(session.events);
          setStoryAgentMode('staging');
          return;
        }
        if (session.status === 'streaming') {
          // Hay un agente activo en el backend — restaurar todo el state
          // parcial y dejar que el polling effect lo siga actualizando.
          setStoryProposals(session.proposals);
          setStoryAgentEvents(session.events);
          setStoryAgentMode('streaming');
        }
      } catch { /* ignore recovery errors */ }
    })();
    return () => { cancelled = true; };
  }, [rawEpic?.id]);

  // Polling cuando el agente sigue corriendo en otra tab/sesión y este
  // cliente no tiene SSE local activo. Cada 3s relee el cache; si hay events
  // nuevos, hidrata. Cuando status='staging' (run terminó) los aplica como
  // propuestas finales y para el polling.
  // Stale detection: 5min sin events nuevos → asume run muerto.
  useEffect(() => {
    if (!rawEpic?.id) return;
    if (storyAgentMode !== 'streaming') return;
    // Si ya hay un SSE local feeding events, no hacemos polling — el handler
    // de streamStoryProposals ya está actualizando state directamente.
    if (storyAbortRef.current) return;

    let cancelled = false;
    const POLL_INTERVAL_MS = 3000;
    const STALE_THRESHOLD_TICKS = 100; // 100 × 3s = 5min
    let lastEventCount = -1;
    let staleTickCount = 0;

    const tick = async () => {
      if (cancelled) return;
      // Mid-tick guard: si entre el setInterval y este tick el user disparó
      // handleStartStoryStreaming (poblando sseAbortRef), saltamos para no
      // duplicar dispatches con el SSE local que ya está activo.
      if (storyAbortRef.current) return;
      try {
        const sessionData = await getStorySession(rawEpic.id);
        if (cancelled) return;
        if (!sessionData) {
          // Cache desapareció — el run probablemente terminó y se invalidó.
          setStoryAgentMode('idle');
          cancelled = true;
          return;
        }
        const { session, isActive } = sessionData;
        setStoryAgentEvents(session.events);
        setStoryProposals(session.proposals);

        if (session.status === 'staging' || !isActive) {
          // Agente terminó. Aplicar como propuestas finales si hay.
          if (session.proposals.length > 0) {
            setStoryAgentMode('staging');
          } else {
            setStoryAgentMode('idle');
          }
          cancelled = true;
          return;
        }

        if (session.events.length === lastEventCount) {
          staleTickCount++;
          if (staleTickCount >= STALE_THRESHOLD_TICKS) {
            if (session.proposals.length > 0) {
              setStoryAgentMode('staging');
            } else {
              setStoryAgentMode('idle');
            }
            cancelled = true;
            return;
          }
        } else {
          lastEventCount = session.events.length;
          staleTickCount = 0;
        }
      } catch {
        // Tick transitorio falló — siguiente reintenta.
      }
    };

    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rawEpic?.id, storyAgentMode]);

  if (!epic) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Épica no encontrada</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/proyectos')}>
          Volver a Proyectos
        </Button>
      </div>
    );
  }

  const totalPoints = epic.stories.reduce((sum, s) => sum + s.storyPoints, 0);
  const donePoints = epic.stories.filter((s) => s.status === StoryStatus.Done).reduce((sum, s) => sum + s.storyPoints, 0);

  const handleStartEdit = () => {
    setEditTitle(epic.title);
    setEditMarkdown(epic.markdown ?? '');
    setEditStatus(epic.status);
    setEditPriority(epic.priority);
    setEditStartDate(epic.startDate);
    setEditTargetDate(epic.targetDate);
    setEditPodIds([...epic.podIds]);
    setEditInitiativeId(epic.initiativeId);
    setIsEditing(true);
  };

  const handleSave = async () => {
    const changes: Record<string, unknown> = {};
    if (editTitle !== epic.title) changes.title = editTitle;
    if (editMarkdown !== (epic.markdown ?? '')) changes.markdown = editMarkdown;
    if (editStatus !== epic.status) changes.status = editStatus;
    if (editPriority !== epic.priority) changes.priority = editPriority;
    if (editStartDate !== epic.startDate) changes.startDate = editStartDate;
    if (editTargetDate !== epic.targetDate) changes.targetDate = editTargetDate;
    if (editInitiativeId !== epic.initiativeId) changes.initiativeId = editInitiativeId;
    const podsSorted = [...editPodIds].sort();
    const origPodsSorted = [...epic.podIds].sort();
    if (JSON.stringify(podsSorted) !== JSON.stringify(origPodsSorted)) changes.podIds = editPodIds;

    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }

    if (isSaving) return;
    setIsSaving(true);

    // Pessimistic: esperar al backend antes de cerrar edición y aplicar al state.
    // Trade-off: pierde el feel inmediato del optimistic, pero permite mostrar el
    // Loader2 dentro del botón "Guardar cambios" durante el await.
    try {
      await apiUpdateEpic(epic.id, changes);
      dispatch({ type: 'UPDATE_EPIC', payload: { id: epic.id, changes } });
      toast.success('Épica actualizada');
      setIsEditing(false);
    } catch (err: any) {
      toast.error(err?.message || 'Error al guardar la épica');
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="h-full min-h-0">
      {/* Scrollable content */}
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Title + metadata header */}
        <div className="mb-8">
          <div className="flex items-start gap-2">
            {isEditing ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-3xl font-bold h-auto py-1 border-none shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40 flex-1"
                placeholder="Título de la épica"
              />
            ) : (
              <h1 className="text-3xl font-bold tracking-tight flex-1">{epic.title}</h1>
            )}
            <TooltipProvider delayDuration={200}>
              <div className="flex gap-1 shrink-0 mt-1">
                {!isEditing ? (
                  <>
                    <DownloadMenu entity={{ kind: 'epic', epic }} fetchFullContent />
                    {(epic.tracker as TrackerReference | undefined)?.externalKey ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={(epic.tracker as TrackerReference).externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent dark:hover:bg-accent/50 transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {(epic.tracker as TrackerReference).externalKey}
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>
                          Abrir {(epic.tracker as TrackerReference).externalKey} en Linear
                        </TooltipContent>
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
                        <TooltipContent>Publicar épica + historias en Linear</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowChecklist((v) => !v)}
                          className={`relative text-muted-foreground hover:text-foreground ${showChecklist ? 'bg-muted text-foreground' : ''}`}
                        >
                          <ListChecks className="h-4 w-4" />
                          {completedStepsCount > 0 && completedStepsCount < checklistSteps.length && (
                            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center">
                              {completedStepsCount}
                            </span>
                          )}
                          {completedStepsCount === checklistSteps.length && (
                            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-green-600 text-white text-[10px] flex items-center justify-center">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {showChecklist ? 'Ocultar checklist del protocolo' : 'Ver checklist del protocolo'}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={handleStartEdit} className="text-muted-foreground hover:text-foreground">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar épica</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Eliminar épica</TooltipContent>
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

          {/* ── Collapsible Protocol Checklist ── */}
          {showChecklist && (
            <div className="mt-4 animate-in slide-in-from-top-2 fade-in duration-200">
              <ProtocolChecklist steps={checklistSteps} onStepClick={handleChecklistClick} />
              {completedStepsCount === checklistSteps.length && (
                <>
                  <div className="mt-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-3 flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-green-700 dark:text-green-400">Épica Lista</p>
                      <p className="text-[11px] text-green-600/80 dark:text-green-400/60">Protocolo completo y aprobado</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setShowIntegrationDialog(true)}
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white shrink-0"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Subir tarjetas
                    </Button>
                  </div>
                  <IntegrationSettingsDialog
                    open={showIntegrationDialog}
                    onOpenChange={setShowIntegrationDialog}
                  />
                </>
              )}
            </div>
          )}

              {isEditing ? (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                      <Select value={editStatus} onValueChange={(v) => setEditStatus(v as EpicStatus)}>
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(EpicStatus).map((s) => (
                            <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prioridad</label>
                      <Select value={editPriority} onValueChange={(v) => setEditPriority(v as Priority)}>
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(Priority).map((p) => (
                            <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Iniciativa</label>
                      <Select value={editInitiativeId} onValueChange={setEditInitiativeId}>
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {state.initiatives.map((init) => (
                            <SelectItem key={init.id} value={init.id}>{init.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">PODs</label>
                      <div className="flex flex-wrap gap-1.5">
                        {state.pods.map((pod) => {
                          const selected = editPodIds.includes(pod.id);
                          return (
                            <button
                              key={pod.id}
                              type="button"
                              onClick={() =>
                                setEditPodIds((prev) =>
                                  selected ? prev.filter((id) => id !== pod.id) : [...prev, pod.id]
                                )
                              }
                              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                                selected
                                  ? 'bg-foreground text-background border-foreground'
                                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30'
                              }`}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: pod.color }}
                              />
                              {pod.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    <StatusBadge status={epic.status} type="epic" />
                    <PriorityIndicator priority={epic.priority} />
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {epic.startDate} — {epic.targetDate}
                    </span>
                    <span className="text-sm text-muted-foreground">{epic.initiative.name}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {epic.pods.map((pod) => (
                      <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                    ))}
                  </div>
                </>
              )}

              {/* Progress bar */}
              {epic.stories.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">
                      {epic.stories.filter((s) => s.status === StoryStatus.Done).length}/{epic.stories.length} historias completadas
                    </span>
                    <span className="text-sm font-medium tabular-nums">{donePoints}/{totalPoints} SP</span>
                  </div>
                  <ProgressBar progress={epic.progress} />
                </div>
              )}
            </div>

            {/* ── Tabs ── */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start border-b rounded-none bg-transparent px-0 h-auto pb-0">
                <TabsTrigger value="definicion" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <FileText className="h-3.5 w-3.5" />
                  Definición
                </TabsTrigger>
                <TabsTrigger
                  value="disenos"
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  <Palette className="h-3.5 w-3.5" />
                  Diseño {rawEpic?.designSkipped ? '(N/A)' : (rawEpic?.designs?.length ? `(${rawEpic.designs.length})` : '')}
                </TabsTrigger>
                <TabsTrigger
                  value="diagramas"
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  <Network className="h-3.5 w-3.5" />
                  Diagrama
                </TabsTrigger>
                <TabsTrigger
                  value="historias"
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Historias de Usuario ({epic.stories.length})
                </TabsTrigger>
                <TabsTrigger value="dependencias" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <GitBranch className="h-3.5 w-3.5" />
                  {/* Counter — usa el rollup como fuente única (que ya une nuevas
                      + legacy + discovered del vault). Mientras el rollup carga,
                      mostramos el cálculo legacy local para evitar flicker.
                      Suma el DAG de orden entre historias (storyDeps) que no es
                      parte del rollup técnico. */}
                  Dependencias ({(rollupCount ?? ((epic.dependencies ?? []).filter((d) => !d.id?.startsWith('ai-dep-')).length + effectiveDiscoveredDeps.length)) + effectiveStoryDeps.length})
                </TabsTrigger>
                <TabsTrigger value="documentos" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <Paperclip className="h-3.5 w-3.5" />
                  Documentos ({epic.documents.length})
                </TabsTrigger>
                <TabsTrigger value="changelog" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <History className="h-3.5 w-3.5" />
                  Changelog ({epicChangelog.length})
                </TabsTrigger>
              </TabsList>

              {/* ── Definición ── */}
              <TabsContent value="definicion" className="mt-8 space-y-6">
                {/* Markdown único de la épica con los 9 headings obligatorios.
                    En modo edit, SectionTiptapEditor full-feature; en read,
                    ReadOnlyMarkdown. Mismo patrón que StoryFullPage. */}
                {isEditing ? (
                  <SectionTiptapEditor
                    initialMarkdown={editMarkdown && editMarkdown.trim().length > 0 ? editMarkdown : EPIC_MARKDOWN_PLACEHOLDER}
                    onChange={setEditMarkdown}
                    variant="paragraph"
                    placeholder="Escribe la definición de la épica en markdown..."
                  />
                ) : epic.markdown && epic.markdown.trim().length > 0 ? (
                  <ReadOnlyMarkdown content={epic.markdown} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Sin contenido. Click en el lápiz para empezar a editar.
                  </p>
                )}
              </TabsContent>

              {/* ── Diagramas ── */}
              <TabsContent value="diagramas" className="mt-8">
                <EpicDiagrams
                  epic={rawEpic!}
                  diagrams={rawEpic!.diagrams}
                  onDiagramGenerated={(diagram) =>
                    dispatch({ type: 'SAVE_EPIC_DIAGRAM', payload: { epicId: rawEpic!.id, diagram } })
                  }
                  onDiagramEdited={(diagram) =>
                    dispatch({ type: 'UPDATE_EPIC_DIAGRAM', payload: { epicId: rawEpic!.id, diagram } })
                  }
                  onDocumentReady={() => {
                    // El backend ya registró el .md del vault en epic.documents[]
                    // antes de emitir `document_ready`. Refrescamos la épica para
                    // sincronizar la tab Documentos sin esperar a que el usuario
                    // navegue fuera y vuelva.
                    void apiGetEpic(rawEpic!.id).then((fresh) => {
                      if (fresh.documents?.length) {
                        fresh.documents.forEach((doc) => {
                          // Solo añadimos documentos que no existan ya en el state
                          // local para evitar duplicados.
                          const alreadyExists = rawEpic!.documents.some((d) => d.id === doc.id);
                          if (!alreadyExists) {
                            dispatch({
                              type: 'ADD_EPIC_DOCUMENT',
                              payload: { epicId: rawEpic!.id, document: doc },
                            });
                          }
                        });
                      }
                    }).catch(() => {
                      // Fallo silencioso: el usuario puede ir a Documentos y verá
                      // los cambios al refrescar la página.
                    });
                  }}
                />
              </TabsContent>

              {/* ── Diseños ── */}
              <TabsContent value="disenos" className="mt-8">
                <EpicDesigns
                  designs={rawEpic!.designs ?? []}
                  designSkipped={rawEpic!.designSkipped ?? false}
                  onAddDesignBundle={async (input) => {
                    // Upload multipart al backend → recibe el EpicDesign ya
                    // construido (con bundleKey, handoff sintético, etc.)
                    // y lo dispatchamos al state local. El backend escribe
                    // los archivos al vault y persiste a BD; no hace falta
                    // un PATCH adicional como en el flujo legacy.
                    try {
                      const created = await apiUploadDesignBundle(rawEpic!.id, input);
                      dispatch({ type: 'ADD_EPIC_DESIGN', payload: { epicId: rawEpic!.id, design: created } });
                      toast.success(`Diseño "${created.name}" agregado.`);
                      return created;
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Error desconocido';
                      toast.error(`No se pudo subir el bundle: ${msg}`);
                      throw err;
                    }
                  }}
                  onUpdateDesign={(design) => {
                    dispatch({ type: 'UPDATE_EPIC_DESIGN', payload: { epicId: rawEpic!.id, design } });
                    const nextDesigns = (rawEpic!.designs ?? []).map((d) => d.id === design.id ? design : d);
                    void apiUpdateEpic(rawEpic!.id, { designs: nextDesigns }).catch((err) => {
                      toast.error(`Diseño editado localmente, pero falló al guardar: ${err?.message ?? 'error desconocido'}`);
                    });
                  }}
                  onDeleteDesign={(designId) => {
                    // Optimistic update: borra del estado local inmediato.
                    // Si el backend falla, revertimos. El backend hace
                    // cleanup completo (vault + ZIP de disco + array).
                    const removed = (rawEpic!.designs ?? []).find((d) => d.id === designId);
                    dispatch({ type: 'DELETE_EPIC_DESIGN', payload: { epicId: rawEpic!.id, designId } });
                    void apiDeleteDesign(rawEpic!.id, designId).catch((err) => {
                      toast.error(`No se pudo borrar el diseño: ${err?.message ?? 'error desconocido'}`);
                      // Revertir al estado previo si tenemos el design original.
                      if (removed) {
                        dispatch({ type: 'ADD_EPIC_DESIGN', payload: { epicId: rawEpic!.id, design: removed } });
                      }
                    });
                  }}
                  onToggleSkip={(skipped) => {
                    dispatch({ type: 'TOGGLE_EPIC_DESIGN_SKIP', payload: { epicId: rawEpic!.id, skipped } });
                    void apiUpdateEpic(rawEpic!.id, { designSkipped: skipped }).catch((err) => {
                      toast.error(`Toggle actualizado localmente, pero falló al guardar: ${err?.message ?? 'error desconocido'}`);
                    });
                  }}
                />
              </TabsContent>

              {/* ── Historias ── */}
              <TabsContent value="historias" className="mt-8 space-y-6">
                {/* Prompt bar / thinking display.
                    Persiste mientras el agente este en cualquier modo distinto
                    de idle. En staging queda collapsable para revisar reasoning. */}
                {storyAgentMode !== 'idle' && (
                  <StoryAgentPromptBar
                    mode={storyAgentMode}
                    events={storyAgentEvents}
                    onSubmit={handleStartStoryStreaming}
                    onCancel={handleCancelStoryAgent}
                  />
                )}

                {/* Lista de propuestas en staging */}
                {storyAgentMode === 'staging' && storyProposals.length > 0 && (
                  <StoryProposalList
                    epicId={rawEpic!.id}
                    proposals={storyProposals}
                    pods={state.pods}
                    acceptingId={acceptingStoryId}
                    onAccept={async (proposal) => {
                      await handleAcceptStoryProposal(proposal);
                      // Refetch tras aceptación individual para que el panel
                      // "Dependencias" muestre los nuevos edges del DAG y las
                      // discovered deps sin necesidad de un reload manual.
                      // (En batch, el refresh se hace una sola vez al final
                      // desde `handleAcceptAllStories`, no por cada item.)
                      void refreshStoryDeps();
                      void refreshDiscoveredDeps();
                    }}
                    onAcceptAll={handleAcceptAllStories}
                    onDiscard={handleDiscardStoryProposal}
                    onDiscardAll={handleDiscardAllStories}
                  />
                )}

                {/* Dev-only: mocks de propuestas con DAG rico para validar
                    los badges de "Bloqueada por" sin correr el agente.
                    Activar con ?mockStoryDeps=true */}
                {useMockStoryDeps && storyAgentMode === 'idle' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border border-dashed border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/20 px-3 py-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        Mock dev
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Batch simulado con 6 propuestas y DAG (cadena + diamante + paralelo). Quita{' '}
                        <code className="font-mono">?mockStoryDeps=true</code> de la URL para salir.
                      </span>
                    </div>
                    <StoryProposalList
                      epicId={rawEpic!.id}
                      proposals={MOCK_PROPOSED_STORIES}
                      pods={state.pods}
                      acceptingId={null}
                      onAccept={() => toast.info('Mock: acepta usa mocks — genera un batch real para persistir')}
                      onAcceptAll={() => toast.info('Mock: usa un batch real para persistir')}
                      onDiscard={() => toast.info('Mock: descarta solo funciona en staging real')}
                      onDiscardAll={() => toast.info('Mock: usa un batch real para descartar')}
                    />
                  </div>
                )}

                {/* Story list with create/edit/delete */}
                <EpicStoryList
                  stories={epic.stories}
                  epicId={rawEpic!.id}
                  pods={state.pods}
                  onGenerateWithAI={storyAgentMode === 'idle' ? handleOpenStoryPrompt : undefined}
                  onCreateStory={async (story) => {
                    const toastId = toast.loading(`Guardando historia "${story.title}"…`);
                    try {
                      const po = story.po ?? { markdown: '' };
                      const technical = story.technical ?? { markdown: '' };
                      const qa = story.qa ?? { markdown: '' };
                      const created = await apiCreateStory({
                        title: story.title,
                        epicId: story.epicId,
                        podId: story.podId,
                        status: story.status as string,
                        storyPoints: story.storyPoints,
                        sprintId: story.sprintId ?? undefined,
                        labels: story.labels ?? [],
                        po: { markdown: po.markdown ?? '' },
                        technical: { markdown: technical.markdown ?? '' },
                        qa: { markdown: qa.markdown ?? '' },
                      });
                      dispatch({ type: 'CREATE_STORY', payload: { ...story, id: created.id } });
                      toast.success('Historia creada', { id: toastId });
                    } catch (err: any) {
                      toast.error(err.message || 'Error al crear historia', { id: toastId });
                    }
                  }}
                  onUpdateStory={async (id, changes) => {
                    const toastId = toast.loading('Guardando cambios…');
                    try {
                      const po = changes.po;
                      const technical = changes.technical;
                      const qa = changes.qa;
                      await apiUpdateStory(id, {
                        title: changes.title,
                        status: changes.status as string | undefined,
                        storyPoints: changes.storyPoints,
                        podId: changes.podId,
                        sprintId: changes.sprintId ?? undefined,
                        labels: changes.labels,
                        po: po ? { markdown: po.markdown ?? '' } : undefined,
                        technical: technical ? { markdown: technical.markdown ?? '' } : undefined,
                        qa: qa ? { markdown: qa.markdown ?? '' } : undefined,
                      });
                      dispatch({ type: 'UPDATE_STORY', payload: { id, changes } });
                      toast.success('Historia actualizada', { id: toastId });
                    } catch (err: any) {
                      toast.error(err.message || 'Error al actualizar historia', { id: toastId });
                    }
                  }}
                  onDeleteStory={async (id) => {
                    try {
                      await apiDeleteStory(id);
                      dispatch({ type: 'DELETE_STORY', payload: { id } });
                      toast.success('Historia eliminada');
                    } catch (err: any) {
                      toast.error(err.message || 'Error al eliminar historia');
                    }
                  }}
                  onBulkDeleteStories={async (ids) => {
                    // Toast unificado loading → success/warning/error.
                    // El loader del toast.loading de sonner viene built-in,
                    // y reemplazar el toast por id evita el flicker de
                    // dismiss + nuevo toast.
                    const toastId = toast.loading(
                      `Eliminando ${ids.length} ${ids.length === 1 ? 'historia de usuario' : 'historias de usuario'}…`,
                    );
                    let ok = 0;
                    let fail = 0;
                    for (const id of ids) {
                      try {
                        await apiDeleteStory(id);
                        dispatch({ type: 'DELETE_STORY', payload: { id } });
                        ok++;
                      } catch {
                        fail++;
                      }
                    }
                    if (ok > 0 && fail === 0) {
                      toast.success(`${ok} ${ok === 1 ? 'historia eliminada' : 'historias eliminadas'}`, { id: toastId });
                    } else if (ok > 0 && fail > 0) {
                      toast.warning(`${ok} eliminadas, ${fail} fallaron`, { id: toastId });
                    } else {
                      toast.error(`No se pudieron eliminar ${fail === 1 ? 'la historia' : 'las historias'}`, { id: toastId });
                    }
                  }}
                />

              </TabsContent>

              {/* ── Documentos ── */}
              <TabsContent value="documentos" className="mt-8">
                <EpicDocuments
                  epic={rawEpic!}
                  documents={rawEpic!.documents}
                  onDocumentGenerated={async (doc) => {
                    const newDocs = [...rawEpic!.documents, doc];
                    await apiUpdateEpic(rawEpic!.id, { documents: newDocs }).catch(() => {});
                    dispatch({ type: 'ADD_EPIC_DOCUMENT', payload: { epicId: rawEpic!.id, document: doc } });
                  }}
                  onDocumentUpdated={async (doc) => {
                    const newDocs = rawEpic!.documents.map((d) => d.id === doc.id ? doc : d);
                    await apiUpdateEpic(rawEpic!.id, { documents: newDocs }).catch(() => {});
                    dispatch({ type: 'UPDATE_EPIC_DOCUMENT', payload: { epicId: rawEpic!.id, document: doc } });
                  }}
                  onDocumentDeleted={async (docId) => {
                    const newDocs = rawEpic!.documents.filter((d) => d.id !== docId);
                    await apiUpdateEpic(rawEpic!.id, { documents: newDocs }).catch(() => {});
                    dispatch({ type: 'DELETE_EPIC_DOCUMENT', payload: { epicId: rawEpic!.id, documentId: docId } });
                  }}
                  onDocumentAdded={async (doc) => {
                    const newDocs = [...rawEpic!.documents, doc];
                    await apiUpdateEpic(rawEpic!.id, { documents: newDocs }).catch(() => {});
                    dispatch({ type: 'ADD_EPIC_DOCUMENT', payload: { epicId: rawEpic!.id, document: doc } });
                  }}
                />
              </TabsContent>

              {/* ── Dependencias ── */}
              <TabsContent value="dependencias" className="mt-8">
                <EpicDependencies
                  epicId={rawEpic!.id}
                  storyOrderDependencies={effectiveStoryDeps}
                  onRollupCountChange={setRollupCount}
                />
              </TabsContent>

              {/* ── Changelog ── */}
              <TabsContent value="changelog" className="mt-8">
                {epicChangelog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <History className="h-6 w-6 mb-2 opacity-20" />
                    <p className="text-sm">Sin cambios registrados</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {epicChangelog.map((entry) => {
                      const verb = actionVerbs[entry.action];
                      const isStoryChange = entry.entityType === ChangelogEntityType.Story;
                      const fn = humanizeFieldName(entry.field);

                      // Para acciones Created sobre la propia épica (field=null), el newValue
                      // es el título de la épica — redundante dentro de su propia vista.
                      // Para Created sobre sub-entidades (documento, diagrama, etc.) el newValue
                      // es el nombre del artefacto — sí vale la pena mostrarlo.
                      const isEpicSelfCreation =
                        entry.action === ChangelogAction.Created &&
                        entry.entityType === ChangelogEntityType.Epic &&
                        !entry.field;
                      const showNewValueLine =
                        !entry.oldValue && entry.newValue && !isEpicSelfCreation;

                      return (
                        <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm">
                              <span className="font-medium">{entry.changedBy.name}</span>
                              <span className="text-muted-foreground"> {verb}{fn ? ` ${fn}` : ''}</span>
                              {isStoryChange && (
                                <span className="text-muted-foreground"> en <span className="text-foreground/70">{entry.entityTitle}</span></span>
                              )}
                            </p>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 tabular-nums">
                              {formatShortDate(entry.timestamp)}
                            </span>
                          </div>
                          {entry.oldValue && entry.newValue && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <ValueChip field={entry.field} value={entry.oldValue} variant="old" />
                              <svg className="h-3 w-3 text-muted-foreground/50 shrink-0" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <ValueChip field={entry.field} value={entry.newValue} variant="new" />
                            </div>
                          )}
                          {showNewValueLine && (
                            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                              {entry.newValue}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>

        </div>
      </div>

      {rawEpic && (
        <TypeToConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Eliminar épica"
          resourceLabel="épica"
          expectedValue={rawEpic.title}
          description="Esto eliminará la épica junto con todas sus historias, diagramas, documentos y dependencias. La acción es permanente y no se puede deshacer."
          confirmText="Eliminar épica"
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

export function EpicFullPage({ epicId }: { epicId: string }) {
  return <EpicFullPageInner epicId={epicId} />;
}

/**
 * `Promise.allSettled` equivalente pero secuencial. Útil cuando el orden
 * importa (p.ej. DAG de deps). Captura throws por item individual sin
 * abortar el batch.
 */
async function runSequentiallySettled<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  for (const item of items) {
    try {
      await fn(item);
      results.push({ status: 'fulfilled', value: undefined });
    } catch (err) {
      results.push({ status: 'rejected', reason: err });
    }
  }
  return results;
}
