'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { useIntegrations } from '@/context/IntegrationsContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { updateStory as apiUpdateStory, deleteStory as apiDeleteStory, getStory as apiGetStory } from '@/lib/api/stories';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
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
  StoryStatus,
  ChangelogAction,
  ChangelogEntityType,
  type UserStory,
  type AssistantProposal,
} from '@cenzontle/shared';
import { AssistantChatSidebar } from '../assistant/AssistantChatSidebar';
import { StatusBadge } from '../shared/StatusBadge';
import { PodBadge } from '../shared/PodBadge';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { EstimateDeviationBadge } from '../shared/EstimateDeviationBadge';
import { DownloadMenu } from '../shared/DownloadMenu';
import { StoryDependencies } from './StoryDependencies';
import { StoryPOTab } from './editor/StoryPOTab';
import { StoryTechnicalTab } from './editor/StoryTechnicalTab';
import { StoryQATab } from './editor/StoryQATab';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';
import {
  Calendar,

  Pencil,
  Trash2,
  X,
  Check,
  History,
  ClipboardList,
  Code2,
  TestTube2,
  Link2,
  Plus,
  Tag,
  Layers,
  ArrowLeft,
  ExternalLink,
  Loader2,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { LinearIcon } from '@/components/icons/LinearIcon';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoryVelocity } from '@/hooks/use-story-velocity';
import { publishStoryToTracker } from '@/lib/api/integrations';
import { ApiError } from '@/lib/api/client';
import type { TrackerReference } from '@cenzontle/shared';

// --- Labels ---

const storyStatusLabels: Record<StoryStatus, string> = {
  [StoryStatus.Backlog]: 'Backlog',
  [StoryStatus.ToDo]: 'Por hacer',
  [StoryStatus.InProgress]: 'En progreso',
  [StoryStatus.InReview]: 'En revisión',
  [StoryStatus.QA]: 'QA',
  [StoryStatus.Done]: 'Completado',
  [StoryStatus.Blocked]: 'Bloqueado',
};

const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13] as const;

const actionVerbs: Record<ChangelogAction, string> = {
  [ChangelogAction.Created]: 'creó',
  [ChangelogAction.Updated]: 'actualizó',
  [ChangelogAction.Deleted]: 'eliminó',
  [ChangelogAction.Moved]: 'movió',
  [ChangelogAction.Reassigned]: 'reasignó',
  [ChangelogAction.Approved]: 'aprobó',
  [ChangelogAction.Rejected]: 'rechazó',
};

// --- Helpers ---

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// --- Markdown skeleton ---

/**
 * Placeholder visual mientras `vaultContent` lazy-loadea desde la API
 * (`apiGetStory(id, true)`). Sin esto, el user ve "Sin contenido" durante
 * ~150-300ms incluso en historias que SÍ tienen markdown — falso positivo
 * porque el state global solo trae metadata, no el body del markdown.
 *
 * Imita la estructura típica de los markdowns de PO/Technical/QA: heading
 * + párrafos + sub-heading + lista. Tamaño compacto para no empujar la
 * matriz QA u otros elementos abajo durante el shimmer.
 */
function StoryMarkdownSkeleton() {
  return (
    <div className="space-y-6" aria-label="Cargando contenido del markdown">
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/4" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <div className="space-y-2 pl-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

// --- Breadcrumb dropdown ---

/**
 * Span del breadcrumb que al hover despliega un Popover con las otras
 * historias de la misma épica para navegación rápida sin volver al EpicFullPage.
 *
 * Patrón hover-bridge: usa state controlado de Popover + timeout de 120ms al
 * salir, así el cursor puede moverse del trigger al content sin que cierre.
 *
 * IMPORTANTE: el dropdown NO consume `useProyectos()` directamente. Las
 * sibling stories se computan en `StoryFullPageInner` y se inyectan vía prop.
 * Esto es porque el breadcrumb se monta vía `setBreadcrumb` en `BreadcrumbContext`,
 * y el render real ocurre en el layout — fuera del `ProyectosProvider`. Llamar
 * useProyectos aquí causa "useProyectos must be used within a ProyectosProvider".
 *
 * Si no hay sibling stories, renderiza un span plano sin chevron ni popover —
 * el dropdown sería un menú vacío que solo confunde.
 */
function BreadcrumbStoryDropdown({
  storyTitle,
  siblings,
}: {
  storyTitle: string;
  siblings: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (siblings.length === 0) {
    return (
      <span className="text-foreground truncate max-w-[250px]">{storyTitle}</span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="text-foreground inline-flex items-center gap-1 cursor-default max-w-[280px]"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <span className="truncate">{storyTitle}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-1 max-h-80 overflow-y-auto"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground px-2 py-1.5">
          Otras historias en esta épica ({siblings.length})
        </div>
        <div className="flex flex-col">
          {siblings.map((s) => (
            <Link
              key={s.id}
              href={`/proyectos/historias/${s.id}`}
              className="text-xs px-2 py-1.5 rounded-sm hover:bg-muted truncate text-foreground/90 transition-colors"
            >
              {s.title}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Main Component ---

interface StoryFullPageProps {
  storyId: string;
}

function StoryFullPageInner({ storyId }: StoryFullPageProps) {
  const router = useRouter();
  const { state, dispatch } = useProyectos();
  const { setBreadcrumb } = useBreadcrumb();
  const { isLinearConfigured } = useIntegrations();

  const baseStory = useMemo(() => state.stories.find((s) => s.id === storyId) ?? null, [storyId, state.stories]);

  // Vault content loaded from API (contains the narrative markdown fields)
  const [vaultContent, setVaultContent] = useState<{
    po?: { markdown?: string };
    technical?: { markdown?: string };
    qa?: { markdown?: string };
  } | null>(null);

  // Si el usuario aplica una propuesta del asistente antes de que el fetch
  // inicial resuelva (vault lento), el .then no debe pisar el contenido ya
  // aplicado con la data stale del API.
  const vaultMutatedRef = useRef(false);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    apiGetStory(storyId, true)
      .then((data) => {
        if (cancelled || vaultMutatedRef.current) return;
        if (data.content) setVaultContent(data.content);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storyId]);

  // Merge base story (from state) with vault content (from API).
  // Vault content trae 3 markdowns por sección (post-refactor v2). El backend
  // se encarga de migrar contenido legacy a markdown estructurado en el read.
  const story = useMemo(() => {
    if (!baseStory) return null;
    if (!vaultContent) return baseStory;
    return {
      ...baseStory,
      po: { markdown: vaultContent.po?.markdown ?? baseStory.po.markdown ?? '' },
      technical: { markdown: vaultContent.technical?.markdown ?? baseStory.technical.markdown ?? '' },
      qa: { markdown: vaultContent.qa?.markdown ?? baseStory.qa.markdown ?? '' },
    } as UserStory;
  }, [baseStory, vaultContent]);
  const epic = useMemo(() => (story ? state.epics.find((e) => e.id === story.epicId) ?? null : null), [story, state.epics]);
  const initiative = useMemo(() => (epic ? state.initiatives.find((i) => i.id === epic.initiativeId) ?? null : null), [epic, state.initiatives]);
  const pod = useMemo(() => (story ? state.pods.find((p) => p.id === story.podId) ?? null : null), [story, state.pods]);
  const sprint = useMemo(() => (story?.sprintId ? state.sprints.find((s) => s.id === story.sprintId) ?? null : null), [story, state.sprints]);

  // Velocity (desviación estimado-vs-real) — solo aplica a historias done:
  // antes de eso no hay esfuerzo final que comparar contra los SP. Los hooks
  // no pueden ser condicionales, así que el gating va en el parámetro: sin
  // storyId el hook NO fetchea (ver use-story-velocity).
  const { story: velocityStory } = useStoryVelocity({
    storyId: story?.status === StoryStatus.Done ? story.id : undefined,
  });

  // Loading flag para los 3 markdowns de la historia (PO/Technical/QA).
  // `vaultContent === null` significa que el API call `apiGetStory(id, true)`
  // todavía no resolvió. Tras resolver, `vaultContent` pasa a un objeto
  // (potencialmente con strings vacíos) — entonces los empty states son
  // legítimos y mostramos "Sin contenido".
  const isVaultLoading = vaultContent === null;

  // Hermanas de la historia actual (misma épica, excluyendo self), ordenadas
  // por createdAt asc — refleja el orden de propuesta del agente IA.
  // Se computa aquí dentro del ProyectosProvider para pasarlo serializable
  // al BreadcrumbStoryDropdown que vive fuera del provider tree.
  const siblingStories = useMemo(() => {
    if (!story || !epic) return [];
    return state.stories
      .filter((s) => s.epicId === epic.id && s.id !== story.id)
      .map((s) => ({ id: s.id, title: s.title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [state.stories, story, epic]);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishingTracker, setPublishingTracker] = useState(false);

  const handlePublishToLinear = async () => {
    if (!story) return;
    setPublishingTracker(true);
    try {
      const result = await publishStoryToTracker(story.id, 'linear');
      dispatch({
        type: 'UPDATE_STORY',
        payload: { id: story.id, changes: { tracker: result.tracker } },
      });
      if (result.alreadyPublished) {
        toast.info('La historia ya estaba publicada en Linear', {
          description: `${result.tracker.externalKey} → abrir`,
          action: {
            label: 'Abrir',
            onClick: () => window.open(result.tracker.externalUrl, '_blank'),
          },
        });
      } else {
        toast.success(`Historia publicada como ${result.tracker.externalKey}`, {
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
        toast.error('No se pudo publicar la historia en Linear', { description: message });
      }
    } finally {
      setPublishingTracker(false);
    }
  };

  const handleDelete = async () => {
    if (!story) return;
    try {
      await apiDeleteStory(story.id);
      dispatch({ type: 'DELETE_STORY', payload: { id: story.id } });
      toast.success('Historia eliminada');
      router.push(`/proyectos/epicas/${story.epicId}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Error al eliminar historia');
      throw err;
    }
  };
  // Tab state URL-synced: la tab activa vive en el query string `?tab=` para
  // que refresh/back/forward y deep-links funcionen. `replace` (no `push`)
  // evita llenar el history; `{ scroll: false }` evita el salto al top al
  // cambiar tab. Si la URL no trae `tab`, default a 'po' (Definición de
  // Negocio).
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'po';
  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState<StoryStatus>(StoryStatus.Backlog);
  const [editStoryPoints, setEditStoryPoints] = useState(3);
  const [editPodId, setEditPodId] = useState('');
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  // En v2 cada sección es un string markdown único. El editor (1 Tiptap por
  // tab) lo modifica via `onChange` y al guardar enviamos los 3 markdowns
  // crudos al backend.
  const [editPO, setEditPO] = useState<string>('');
  const [editTechnical, setEditTechnical] = useState<string>('');
  const [editQA, setEditQA] = useState<string>('');
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Changelog for this story
  const storyChangelog = useMemo(() => {
    if (!story) return [];
    return state.changelog.filter(
      (entry) => entry.entityType === ChangelogEntityType.Story && entry.entityId === story.id
    );
  }, [state.changelog, story]);

  // Breadcrumb
  useEffect(() => {
    if (!story || !epic) return;
    setBreadcrumb(
      <div className="flex items-center gap-2 text-sm">
        <Link href="/proyectos" className="text-muted-foreground hover:text-foreground transition-colors">
          Proyectos
        </Link>
        <span className="text-muted-foreground/40">/</span>
        {initiative && (
          <>
            <Link href={`/proyectos/iniciativas/${initiative.id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]">
              {initiative.name}
            </Link>
            <span className="text-muted-foreground/40">/</span>
          </>
        )}
        <Link href={`/proyectos/epicas/${epic.id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]">
          {epic.title}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <BreadcrumbStoryDropdown
          storyTitle={story.title}
          siblings={siblingStories}
        />
      </div>
    );
    return () => setBreadcrumb(null);
  }, [story, epic, initiative, setBreadcrumb, siblingStories]);

  // --- Edit handlers ---

  // Apply de propuestas del asistente: mismo write-path que handleSave
  // (PATCH sección + dispatch + sync de vaultContent local).
  const handleApplyAssistantProposal = useCallback(
    async (proposal: AssistantProposal) => {
      if (!story) throw new Error('Historia no disponible');
      vaultMutatedRef.current = true;
      if (proposal.target === 'story_po') {
        await apiUpdateStory(story.id, { po: { markdown: proposal.newContent } });
        dispatch({
          type: 'UPDATE_STORY',
          payload: { id: story.id, changes: { po: { markdown: proposal.newContent } } },
        });
        setVaultContent((prev) => ({ ...(prev ?? {}), po: { markdown: proposal.newContent } }));
      } else if (proposal.target === 'story_technical') {
        await apiUpdateStory(story.id, { technical: { markdown: proposal.newContent } });
        dispatch({
          type: 'UPDATE_STORY',
          payload: { id: story.id, changes: { technical: { markdown: proposal.newContent } } },
        });
        setVaultContent((prev) => ({ ...(prev ?? {}), technical: { markdown: proposal.newContent } }));
      } else if (proposal.target === 'story_qa') {
        await apiUpdateStory(story.id, { qa: { markdown: proposal.newContent } });
        dispatch({
          type: 'UPDATE_STORY',
          payload: { id: story.id, changes: { qa: { markdown: proposal.newContent } } },
        });
        setVaultContent((prev) => ({ ...(prev ?? {}), qa: { markdown: proposal.newContent } }));
      } else {
        throw new Error('Propuesta no aplicable a esta historia');
      }
    },
    [story, dispatch],
  );

  const handleStartEdit = useCallback(() => {
    if (!story) return;
    setEditTitle(story.title);
    setEditStatus(story.status);
    setEditStoryPoints(story.storyPoints);
    setEditPodId(story.podId);
    setEditLabels([...story.labels]);
    setIsEditing(true);
  }, [story]);

  // Sincroniza buffers (header + 3 markdowns) con la story actual cada vez
  // que cambia. Los tabs leen `editPO/editTechnical/editQA` para renderizar
  // (ReadOnlyMarkdown en read-mode, SectionTiptapEditor en edit-mode).
  useEffect(() => {
    if (!story) return;
    setEditTitle(story.title);
    setEditStatus(story.status);
    setEditStoryPoints(story.storyPoints);
    setEditPodId(story.podId);
    setEditLabels([...story.labels]);
    setEditPO(story.po.markdown ?? '');
    setEditTechnical(story.technical.markdown ?? '');
    setEditQA(story.qa.markdown ?? '');
  }, [story]);

  const handleSave = useCallback(async () => {
    if (!story || !editTitle.trim() || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await apiUpdateStory(story.id, {
        title: editTitle.trim(),
        status: editStatus as string,
        storyPoints: editStoryPoints,
        podId: editPodId,
        labels: editLabels,
        po: { markdown: editPO },
        technical: { markdown: editTechnical },
        qa: { markdown: editQA },
      });
      dispatch({
        type: 'UPDATE_STORY',
        payload: {
          id: story.id,
          changes: {
            title: editTitle.trim(),
            // El description corto se deriva de la primera línea de contenido
            // (no-heading) del PO markdown — match con el comportamiento del
            // backend (`normalizeOutline`).
            description:
              editPO
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l.length > 0 && !l.startsWith('#')) ?? '',
            storyPoints: editStoryPoints,
            status: editStatus,
            podId: editPodId,
            labels: editLabels,
            po: { markdown: editPO },
            technical: { markdown: editTechnical },
            qa: { markdown: editQA },
          },
        },
      });

      // Sincroniza vaultContent local con lo que acabamos de mandar al backend.
      // Sin esto, el memo `story` sigue mostrando los markdowns viejos porque
      // `vaultContent.po?.markdown ?? baseStory.po.markdown` shadowea al
      // baseStory ya actualizado por el dispatch. El refresh "arregla" el bug
      // porque al remount, el useEffect re-llama apiGetStory y rehidrata
      // vaultContent con el contenido fresh.
      setVaultContent({
        po: { markdown: editPO },
        technical: { markdown: editTechnical },
        qa: { markdown: editQA },
      });

      toast.success('Historia actualizada');
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Error al actualizar historia');
    } finally {
      setIsSaving(false);
    }
  }, [story, editTitle, editStoryPoints, editStatus, editPodId, editLabels, editPO, editTechnical, editQA, dispatch, isSaving]);

  const addLabel = useCallback(() => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setEditLabels((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewLabel('');
  }, [newLabel]);

  // --- Not found ---

  if (!story) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Historia no encontrada</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/proyectos')}>
          Volver a Proyectos
        </Button>
      </div>
    );
  }

  // --- Render ---

  const qaRow = epic?.qaMatrix?.rows.find((r) => r.storyId === story.id);

  return (
    <div className="h-full min-h-0 flex">
      <div className="h-full min-h-0 overflow-y-auto flex-1 min-w-0">
        <div className="mx-auto max-w-7xl px-6 py-8">

          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-1.5 text-muted-foreground hover:text-foreground mb-4 -ml-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver
          </Button>

          {/* Title + metadata header */}
          <div className="mb-8">
            <div className="flex items-start gap-2">
              {isEditing ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-3xl font-bold h-auto py-1 border-none shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40 flex-1"
                  placeholder="Título de la historia"
                />
              ) : (
                <h1 className="text-3xl font-bold tracking-tight flex-1">{story.title}</h1>
              )}
              <TooltipProvider delayDuration={200}>
                <div className="flex gap-1 shrink-0 mt-1">
                  {!isEditing ? (
                    <>
                      <DownloadMenu entity={{ kind: 'story', story }} fetchFullContent />
                      {(story.tracker as TrackerReference | undefined)?.externalKey ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={(story.tracker as TrackerReference).externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent dark:hover:bg-accent/50 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {(story.tracker as TrackerReference).externalKey}
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>
                            Abrir {(story.tracker as TrackerReference).externalKey} en Linear
                          </TooltipContent>
                        </Tooltip>
                      ) : isLinearConfigured ? (
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
                          <TooltipContent>
                            {(epic?.tracker as TrackerReference | undefined)?.externalId
                              ? 'Publicar como sub-issue de la épica en Linear'
                              : 'Publicar historia en Linear'}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setAssistantOpen((v) => !v)}
                            className={`text-muted-foreground hover:text-foreground ${assistantOpen ? 'bg-muted text-foreground' : ''}`}
                          >
                            <Sparkles className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Asistente de edición IA</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={handleStartEdit} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar historia</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Eliminar historia</TooltipContent>
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

            {isEditing ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Estado</label>
                    <Select value={editStatus} onValueChange={(v) => setEditStatus(v as StoryStatus)}>
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(storyStatusLabels).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Story Points</label>
                    <Select value={String(editStoryPoints)} onValueChange={(v) => setEditStoryPoints(Number(v))}>
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIBONACCI_POINTS.map((p) => (
                          <SelectItem key={p} value={String(p)}>{p} SP</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Pod</label>
                    <Select value={editPodId} onValueChange={setEditPodId}>
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        {state.pods.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Labels editing */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Etiquetas</label>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {editLabels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        {label}
                        <button
                          type="button"
                          onClick={() => setEditLabels((prev) => prev.filter((l) => l !== label))}
                          className="hover:text-red-500 transition-colors"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }}
                      placeholder="Nueva etiqueta..."
                      className="text-sm flex-1 max-w-[200px]"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addLabel} disabled={!newLabel.trim()} className="h-9">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <StatusBadge status={story.status} />
                  <StoryPointsBadge points={story.storyPoints} />
                  {/* Badge de calibración estimado-vs-real — solo en done y si
                      la historia cae en la ventana de /factory/velocity. */}
                  {story.status === StoryStatus.Done && velocityStory && (
                    <EstimateDeviationBadge
                      ratio={velocityStory.ratio}
                      classification={velocityStory.classification}
                    />
                  )}
                  {story.tracker?.externalKey && (
                    <span className="font-mono text-xs rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{story.tracker.externalKey}</span>
                  )}
                  {sprint && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {sprint.name}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {pod && <PodBadge name={pod.name} color={pod.color} />}
                  {epic && (
                    <Link
                      href={`/proyectos/epicas/${epic.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium hover:bg-muted/80 transition-colors"
                    >
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      {epic.tracker?.externalKey ? `${epic.tracker.externalKey} · ` : ''}{epic.title}
                    </Link>
                  )}
                </div>

                {story.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {story.labels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-3">
                  <span>
                    Creado: <span className="text-foreground">{new Date(story.createdAt).toLocaleDateString('es-MX')}</span>
                  </span>
                  <span>
                    Actualizado: <span className="text-foreground">{new Date(story.updatedAt).toLocaleDateString('es-MX')}</span>
                  </span>
                </div>
              </>
            )}
          </div>

          {/* ── Tabs ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent px-0 h-auto pb-0">
              <TabsTrigger value="po" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <ClipboardList className="h-3.5 w-3.5" />
                Definición de Negocio
              </TabsTrigger>
              <TabsTrigger value="technical" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <Code2 className="h-3.5 w-3.5" />
                Technical
              </TabsTrigger>
              <TabsTrigger value="qa" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <TestTube2 className="h-3.5 w-3.5" />
                QA
              </TabsTrigger>
              <TabsTrigger value="dependencies" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <Link2 className="h-3.5 w-3.5" />
                Dependencias
              </TabsTrigger>
              <TabsTrigger value="changelog" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <History className="h-3.5 w-3.5" />
                Changelog ({storyChangelog.length})
              </TabsTrigger>
            </TabsList>

            {/* ── PO Tab ── Editor solo en modo edición; en lectura, ReadOnlyMarkdown.
                El toggle viene del botón con ícono de lápiz en el header.
                Skeleton mientras vaultContent lazy-loadea — evita falso
                positivo de "Sin contenido" durante el fetch inicial. */}
            <TabsContent value="po" className="mt-8 space-y-6">
              {isEditing ? (
                <StoryPOTab value={editPO} onChange={setEditPO} />
              ) : isVaultLoading ? (
                <StoryMarkdownSkeleton />
              ) : editPO.trim() ? (
                <ReadOnlyMarkdown content={editPO} />
              ) : (
                <p className="text-sm text-muted-foreground italic">Sin contenido. Click en el lápiz para empezar a editar.</p>
              )}
            </TabsContent>

            {/* ── Technical Tab ── */}
            <TabsContent value="technical" className="mt-8 space-y-6">
              {isEditing ? (
                <StoryTechnicalTab value={editTechnical} onChange={setEditTechnical} />
              ) : isVaultLoading ? (
                <StoryMarkdownSkeleton />
              ) : editTechnical.trim() ? (
                <ReadOnlyMarkdown content={editTechnical} />
              ) : (
                <p className="text-sm text-muted-foreground italic">Sin contenido. Click en el lápiz para empezar a editar.</p>
              )}
            </TabsContent>

            {/* ── QA Tab ── */}
            <TabsContent value="qa" className="mt-8 space-y-6">
              {isEditing ? (
                <StoryQATab value={editQA} onChange={setEditQA} />
              ) : isVaultLoading ? (
                <StoryMarkdownSkeleton />
              ) : editQA.trim() ? (
                <ReadOnlyMarkdown content={editQA} />
              ) : (
                <p className="text-sm text-muted-foreground italic">Sin contenido. Click en el lápiz para empezar a editar.</p>
              )}

              {/* Sección de matriz de pruebas — read-only, vinculada al epic */}
              <section className="pt-4 border-t mt-8">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Matriz de Pruebas</h3>
                {qaRow ? (
                  <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-foreground">{qaRow.storyJiraKey}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {qaRow.testCases.length} casos · {qaRow.coverage}% cobertura
                      </span>
                    </div>
                    {qaRow.testCases.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {qaRow.testCases.map((tc) => (
                          <div key={tc.id} className="flex items-center gap-2 text-xs">
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              tc.status === 'passed' ? 'bg-green-500' :
                              tc.status === 'failed' ? 'bg-red-500' :
                              tc.status === 'blocked' ? 'bg-amber-500' :
                              'bg-gray-400'
                            }`} />
                            <span className="text-foreground/80">{tc.title}</span>
                            <span className="text-muted-foreground ml-auto">{tc.priority}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Sin matriz vinculada</p>
                )}
              </section>
            </TabsContent>

            {/* ── Changelog Tab ── */}
            <TabsContent value="dependencies" className="mt-8">
              <StoryDependencies storyId={story.id} />
            </TabsContent>

            <TabsContent value="changelog" className="mt-8">
              {storyChangelog.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <History className="h-6 w-6 mb-2 opacity-20" />
                  <p className="text-sm">Sin cambios registrados</p>
                </div>
              ) : (
                <div className="divide-y">
                  {storyChangelog.map((entry) => {
                    const verb = actionVerbs[entry.action];
                    return (
                      <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm">
                            <span className="font-medium">{entry.changedBy.name.split(' ')[0]}</span>
                            <span className="text-muted-foreground"> {verb}{entry.field ? ` ${entry.field}` : ''}</span>
                          </p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 tabular-nums">
                            {formatShortDate(entry.timestamp)}
                          </span>
                        </div>
                        {entry.oldValue && entry.newValue && (
                          <div className="flex items-center gap-2 mt-1.5 text-xs">
                            <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-700 line-through dark:text-red-400">{entry.oldValue}</span>
                            <svg className="h-3 w-3 text-muted-foreground/50 shrink-0" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400">{entry.newValue}</span>
                          </div>
                        )}
                        {!entry.oldValue && entry.newValue && entry.action !== ChangelogAction.Created && (
                          <p className="text-xs text-muted-foreground mt-1">{entry.newValue}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Save bar — visible solo en modo edición (toggle del lápiz en el
              header). El user entra explícitamente en edit mode; tabs muestran
              ReadOnlyMarkdown por default y SectionTiptapEditor cuando edita. */}
          {isEditing && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-3 mt-8 -mx-6 px-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  // Revert: restaurar buffers a la story original (3 markdowns).
                  if (story) {
                    setEditPO(story.po.markdown ?? '');
                    setEditTechnical(story.technical.markdown ?? '');
                    setEditQA(story.qa.markdown ?? '');
                  }
                  setIsEditing(false);
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!editTitle.trim() || isSaving} className="gap-1.5">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {isSaving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <AssistantChatSidebar
        entityType="story"
        entityId={storyId}
        entityTitle={story.title}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onApplyProposal={handleApplyAssistantProposal}
      />

      {story && (
        <TypeToConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Eliminar historia"
          resourceLabel="historia"
          expectedValue={story.title}
          description="Esto eliminará la historia y toda su información asociada (criterios de aceptación, notas técnicas, QA). La acción es permanente y no se puede deshacer."
          confirmText="Eliminar historia"
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

export function StoryFullPage({ storyId }: StoryFullPageProps) {
  return <StoryFullPageInner storyId={storyId} />;
}
