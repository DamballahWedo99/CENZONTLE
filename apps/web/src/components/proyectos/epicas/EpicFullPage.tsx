'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useProyectos } from '@/context/ProyectosContext';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import { updateEpic as apiUpdateEpic, deleteEpic as apiDeleteEpic } from '@/lib/api/epics';
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
import { EpicQAMatrix } from './EpicQAMatrix';
import { EpicDocuments } from './EpicDocuments';
import { EpicDependencies } from './EpicDependencies';
import { IntegrationSettingsDialog } from '../settings/IntegrationSettingsDialog';
import { EpicStoryList } from './EpicStoryList';
import { generateStories } from '@/lib/story-agent';
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
  Sparkles,
  Loader2,
  ShieldCheck,
  XCircle,
  MessageSquare,
  ListChecks,
  ClipboardCheck,
  GitBranch,
  Upload,
} from 'lucide-react';

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
  status: 'estado', priority: 'prioridad', title: 'título', description: 'descripción',
  startDate: 'fecha de inicio', targetDate: 'fecha objetivo', storyPoints: 'story points',
  qualitativeBenefits: 'beneficios cualitativos', quantitativeBenefits: 'beneficios cuantitativos',
  benefitsMeasurement: 'medición de beneficios', scopeDescription: 'descripción del alcance',
  acceptanceCriteria: 'criterios de aceptación', technologicalImprovements: 'mejoras tecnológicas',
  businessPriority: 'prioridad de negocio', teamsInvolved: 'equipos involucrados',
  impactedChannels: 'canales impactados', impactedFlows: 'flujos impactados',
  impactSabreLevel: 'nivel de impacto Sabre', thirdPartyDependencies: 'dependencias de terceros',
  historias: 'historias de usuario', documento: 'documento', 'aprobación PO': 'aprobación PO', 'aprobación TL (diagrama)': 'aprobación TL (diagrama)', 'aprobación QA': 'aprobación QA',
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

// --- Business field sections ---

const businessFieldSections = [
  {
    title: 'Beneficios',
    fields: [
      { key: 'qualitativeBenefits' as const, label: 'Beneficios Cualitativos' },
      { key: 'quantitativeBenefits' as const, label: 'Beneficios Cuantitativos' },
      { key: 'benefitsMeasurement' as const, label: '¿Cómo se medirán los beneficios?' },
    ],
  },
  {
    title: 'Alcance y Criterios',
    fields: [
      { key: 'scopeDescription' as const, label: 'Descripción del Alcance' },
      { key: 'acceptanceCriteria' as const, label: 'Criterios de Aceptación' },
    ],
  },
  {
    title: 'Aspectos Técnicos',
    fields: [
      { key: 'technologicalImprovements' as const, label: 'Mejoras Tecnológicas' },
      { key: 'businessPriority' as const, label: 'Prioridad de Negocio' },
      { key: 'teamsInvolved' as const, label: 'Equipos Involucrados' },
    ],
  },
  {
    title: 'Impacto',
    fields: [
      { key: 'impactedChannels' as const, label: 'Canales Impactados' },
      { key: 'impactedFlows' as const, label: 'Flujos Impactados' },
      { key: 'impactSabreLevel' as const, label: 'Nivel de Impacto en Sabre' },
      { key: 'thirdPartyDependencies' as const, label: 'Dependencias de Terceros' },
    ],
  },
];

type BusinessFieldKey = typeof businessFieldSections[number]['fields'][number]['key'];

const allBusinessFieldKeys: BusinessFieldKey[] = businessFieldSections.flatMap((s) => s.fields.map((f) => f.key));

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
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<EpicStatus>(EpicStatus.Draft);
  const [editPriority, setEditPriority] = useState<Priority>(Priority.Medium);
  const [editStartDate, setEditStartDate] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editBusinessFields, setEditBusinessFields] = useState<Record<BusinessFieldKey, string>>({} as Record<BusinessFieldKey, string>);
  const [editPodIds, setEditPodIds] = useState<string[]>([]);
  const [editInitiativeId, setEditInitiativeId] = useState('');
  const [isGeneratingStories, setIsGeneratingStories] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') ?? 'definicion');
  const [showChecklist, setShowChecklist] = useState(false);

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
  const definitionComplete = useMemo(() => {
    if (!rawEpic) return false;
    return allBusinessFieldKeys.every((key) => (rawEpic[key] ?? '').trim().length > 0)
      && rawEpic.description.trim().length > 0;
  }, [rawEpic]);

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

  const tlApproval = rawEpic?.tlApproval ?? null;
  const isTlApproved = tlApproval?.status === 'approved';

  const hasQAMatrix = rawEpic?.qaMatrix != null || rawEpic?.epicQAMatrix != null;
  const qaApproval = rawEpic?.qaApproval ?? null;
  const isQaApproved = qaApproval?.status === 'approved';

  const poApproval = rawEpic?.poApproval ?? null;
  const isApproved = poApproval?.status === 'approved';

  const filledFieldsCount = useMemo(() => {
    if (!rawEpic) return 0;
    let count = rawEpic.description.trim().length > 0 ? 1 : 0;
    count += allBusinessFieldKeys.filter((key) => (rawEpic[key] ?? '').trim().length > 0).length;
    return count;
  }, [rawEpic]);
  const totalFields = allBusinessFieldKeys.length + 1; // +1 for description

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
      id: 'tl-approval',
      label: 'Visto bueno del TL',
      description: isTlApproved
        ? 'Diagrama aprobado por TL'
        : tlApproval?.status === 'rejected'
          ? 'Diagrama rechazado — edita y solicita nueva revisión'
          : 'Pendiente de aprobación del Technical Leader',
      completed: isTlApproved,
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
    {
      id: 'approval',
      label: 'Validación del PO',
      description: isApproved
        ? 'Historias aprobadas'
        : poApproval?.status === 'rejected'
          ? 'Historias rechazadas — modifica y solicita nueva revisión'
          : 'Pendiente de aprobación',
      completed: isApproved,
      active: false,
      locked: false,
    },
    {
      id: 'qa-matrix',
      label: 'Matriz de QA',
      description: hasQAMatrix
        ? `${(rawEpic!.epicQAMatrix?.tests.length ?? 0)} tests sistémicos · ${(rawEpic!.qaMatrix?.rows.reduce((s, r) => s + r.testCases.length, 0) ?? 0)} funcionales`
        : 'Genera las matrices de QA sistémico y funcional con IA',
      completed: hasQAMatrix,
      active: activeTab === 'matrices-qa',
      locked: false,
    },
    {
      id: 'qa-approval',
      label: 'Visto bueno de QA',
      description: isQaApproved
        ? 'QA aprobado'
        : qaApproval?.status === 'rejected'
          ? 'QA rechazado — edita y solicita nueva revisión'
          : 'Pendiente de aprobación de QA',
      completed: isQaApproved,
      active: activeTab === 'matrices-qa',
      locked: false,
    },
  ];

  const completedStepsCount = checklistSteps.filter((s) => s.completed).length;

  const handleChecklistClick = (stepId: string) => {
    const tabMap: Record<string, string> = {
      definition: 'definicion',
      diagram: 'diagramas',
      'tl-approval': 'diagramas',
      stories: 'historias',
      approval: 'historias',
      'qa-matrix': 'matrices-qa',
      'qa-approval': 'matrices-qa',
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
    setEditDescription(epic.description);
    setEditStatus(epic.status);
    setEditPriority(epic.priority);
    setEditStartDate(epic.startDate);
    setEditTargetDate(epic.targetDate);
    const bf = {} as Record<BusinessFieldKey, string>;
    for (const section of businessFieldSections) {
      for (const field of section.fields) {
        bf[field.key] = epic[field.key];
      }
    }
    setEditBusinessFields(bf);
    setEditPodIds([...epic.podIds]);
    setEditInitiativeId(epic.initiativeId);
    setIsEditing(true);
  };

  const handleSave = async () => {
    const changes: Record<string, unknown> = {};
    if (editTitle !== epic.title) changes.title = editTitle;
    if (editDescription !== epic.description) changes.description = editDescription;
    if (editStatus !== epic.status) changes.status = editStatus;
    if (editPriority !== epic.priority) changes.priority = editPriority;
    if (editStartDate !== epic.startDate) changes.startDate = editStartDate;
    if (editTargetDate !== epic.targetDate) changes.targetDate = editTargetDate;
    if (editInitiativeId !== epic.initiativeId) changes.initiativeId = editInitiativeId;
    const podsSorted = [...editPodIds].sort();
    const origPodsSorted = [...epic.podIds].sort();
    if (JSON.stringify(podsSorted) !== JSON.stringify(origPodsSorted)) changes.podIds = editPodIds;
    for (const section of businessFieldSections) {
      for (const field of section.fields) {
        if (editBusinessFields[field.key] !== epic[field.key]) {
          changes[field.key] = editBusinessFields[field.key];
        }
      }
    }

    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }

    // Optimistic update local primero para UX responsiva
    dispatch({ type: 'UPDATE_EPIC', payload: { id: epic.id, changes } });
    setIsEditing(false);

    // Persistir al backend (PG + vault). Si falla, revertir el optimistic update.
    try {
      await apiUpdateEpic(epic.id, changes);
      toast.success('Épica actualizada');
    } catch (err: any) {
      // Rollback: regresar los valores originales al state local
      const rollback: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        rollback[key] = (epic as any)[key];
      }
      dispatch({ type: 'UPDATE_EPIC', payload: { id: epic.id, changes: rollback } });
      toast.error(err?.message || 'Error al guardar la épica');
    }
  };

  const updateBusinessField = (key: BusinessFieldKey, value: string) => {
    setEditBusinessFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleGenerateStories = async () => {
    if (!rawEpic) return;
    setIsGeneratingStories(true);
    try {
      const stories = await generateStories(rawEpic, rawEpic.podIds);
      dispatch({ type: 'BULK_CREATE_STORIES', payload: { epicId: rawEpic.id, stories } });
    } finally {
      setIsGeneratingStories(false);
    }
  };

  const handleApprove = () => {
    dispatch({
      type: 'APPROVE_EPIC_STORIES',
      payload: { epicId: epic.id, poId: state.currentUserId, poName: state.currentUserName },
    });
  };

  const handleReject = () => {
    if (!rejectComment.trim()) return;
    dispatch({
      type: 'REJECT_EPIC_STORIES',
      payload: { epicId: epic.id, poId: state.currentUserId, poName: state.currentUserName, comment: rejectComment.trim() },
    });
    setRejectComment('');
    setShowRejectForm(false);
  };

  return (
    <div className="h-full min-h-0">
      {/* Scrollable content */}
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto px-6 py-8 max-w-6xl">
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
            <div className="flex gap-1 shrink-0 mt-1">
              {!isEditing ? (
                <>
                  <DownloadMenu entity={{ kind: 'epic', epic }} fetchFullContent />
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
                  Historias ({epic.stories.length})
                </TabsTrigger>
                <TabsTrigger
                  value="matrices-qa"
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Matrices QA
                </TabsTrigger>
                <TabsTrigger value="documentos" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <Paperclip className="h-3.5 w-3.5" />
                  Documentos ({epic.documents.length})
                </TabsTrigger>
                <TabsTrigger value="dependencias" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <GitBranch className="h-3.5 w-3.5" />
                  Dependencias ({(epic.dependencies ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="changelog" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                  <History className="h-3.5 w-3.5" />
                  Changelog ({epicChangelog.length})
                </TabsTrigger>
              </TabsList>

              {/* ── Definición ── */}
              <TabsContent value="definicion" className="mt-8 space-y-8">
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Descripción</h3>
                  {isEditing ? (
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-input bg-transparent px-4 py-3 text-sm leading-relaxed shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{epic.description}</p>
                  )}
                </section>


                {businessFieldSections.map((section) => (
                  <section key={section.title}>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">{section.title}</h3>
                    {isEditing ? (
                      <div className="space-y-4">
                        {section.fields.map((field) => (
                          <div key={field.key}>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{field.label}</label>
                            <textarea
                              value={editBusinessFields[field.key] ?? ''}
                              onChange={(e) => updateBusinessField(field.key, e.target.value)}
                              rows={2}
                              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {section.fields.map((field) => {
                          const value = epic[field.key];
                          if (!value) return (
                            <div key={field.key} className="flex items-center gap-2">
                              <Circle className="h-3 w-3 text-amber-500/60" />
                              <span className="text-xs text-amber-600 dark:text-amber-400">{field.label} — sin completar</span>
                            </div>
                          );
                          return (
                            <div key={field.key}>
                              <span className="text-xs text-muted-foreground block mb-1">{field.label}</span>
                              <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{value}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
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
                  tlApproval={rawEpic!.tlApproval}
                  onTlApprove={() =>
                    dispatch({ type: 'APPROVE_EPIC_DIAGRAM_TL', payload: { epicId: rawEpic!.id, tlName: 'Tech Lead' } })
                  }
                  onTlReject={(comment) =>
                    dispatch({ type: 'REJECT_EPIC_DIAGRAM_TL', payload: { epicId: rawEpic!.id, tlName: 'Tech Lead', comment } })
                  }
                />
              </TabsContent>

              {/* ── Historias ── */}
              <TabsContent value="historias" className="mt-8 space-y-6">
                {/* AI Generate button — only when no stories exist */}
                {epic.stories.length === 0 && (
                  <div className="flex items-center justify-between">
                    <div />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateStories}
                      disabled={isGeneratingStories}
                      className="gap-2"
                    >
                      {isGeneratingStories ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Generar con IA
                    </Button>
                  </div>
                )}

                {isGeneratingStories && (
                  <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                      El agente está analizando la épica y los repositorios para generar historias...
                    </span>
                  </div>
                )}

                {/* Story list with create/edit/delete */}
                <EpicStoryList
                  stories={epic.stories}
                  epicId={rawEpic!.id}
                  pods={state.pods}
                  qaMatrix={rawEpic!.qaMatrix}
                  onCreateStory={async (story) => {
                    try {
                      const po: any = story.po ?? {};
                      const created = await apiCreateStory({
                        title: story.title,
                        epicId: story.epicId,
                        podId: story.podId,
                        status: story.status as string,
                        storyPoints: story.storyPoints,
                        sprintId: story.sprintId ?? undefined,
                        labels: story.labels ?? [],
                        po: {
                          background: po.background ?? '',
                          objective: po.objective ?? '',
                          userStory: po.userStory ?? '',
                          whatHowWhen: typeof po.whatHowWhen === 'string' ? po.whatHowWhen : '',
                          acceptanceCriteria: Array.isArray(po.acceptanceCriteria) ? po.acceptanceCriteria.join('\n') : (po.acceptanceCriteria ?? ''),
                          additionalNotes: po.additionalNotes ?? '',
                        },
                      });
                      dispatch({ type: 'CREATE_STORY', payload: { ...story, id: created.id } });
                      toast.success('Historia creada');
                    } catch (err: any) {
                      toast.error(err.message || 'Error al crear historia');
                    }
                  }}
                  onUpdateStory={async (id, changes) => {
                    try {
                      const po: any = (changes as any).po ?? {};
                      const technical: any = (changes as any).technical ?? {};
                      const qa: any = (changes as any).qa ?? {};
                      await apiUpdateStory(id, {
                        title: changes.title,
                        status: changes.status as string | undefined,
                        storyPoints: changes.storyPoints,
                        podId: changes.podId,
                        sprintId: changes.sprintId ?? undefined,
                        labels: changes.labels,
                        po: Object.keys(po).length ? {
                          background: po.background,
                          objective: po.objective,
                          userStory: po.userStory,
                          whatHowWhen: typeof po.whatHowWhen === 'string' ? po.whatHowWhen : '',
                          acceptanceCriteria: Array.isArray(po.acceptanceCriteria) ? po.acceptanceCriteria.join('\n') : po.acceptanceCriteria,
                          additionalNotes: po.additionalNotes,
                        } : undefined,
                        technical: Object.keys(technical).length ? technical : undefined,
                        qa: Object.keys(qa).length ? qa : undefined,
                      });
                      dispatch({ type: 'UPDATE_STORY', payload: { id, changes } });
                      toast.success('Historia actualizada');
                    } catch (err: any) {
                      toast.error(err.message || 'Error al actualizar historia');
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
                />

                {/* PO Approval Section */}
                {epic.stories.length > 0 && (
                  <div className="rounded-xl border p-5">
                    {!poApproval && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Validación del Product Owner</p>
                            <p className="text-xs text-muted-foreground">
                              Revisa las historias y aprueba o solicita cambios
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowRejectForm(true)}
                            className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Rechazar
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleApprove}
                            className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aprobar
                          </Button>
                        </div>
                      </div>
                    )}

                    {poApproval?.status === 'approved' && (
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-green-700 dark:text-green-400">Historias aprobadas</p>
                          <p className="text-xs text-muted-foreground">
                            Aprobado por {poApproval.approvedBy ?? 'PO'} · {poApproval.approvedAt ? formatShortDate(poApproval.approvedAt) : ''}
                          </p>
                        </div>
                      </div>
                    )}

                    {poApproval?.status === 'rejected' && (
                      <div>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">Historias rechazadas</p>
                            <p className="text-xs text-muted-foreground">
                              Rechazado por {poApproval.approvedBy ?? 'PO'} · {poApproval.approvedAt ? formatShortDate(poApproval.approvedAt) : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleApprove}
                            className="gap-1.5 text-green-600 hover:text-green-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aprobar
                          </Button>
                        </div>
                        {poApproval.comment && (
                          <div className="flex items-start gap-2 mt-3 ml-[52px] rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                            <MessageSquare className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-red-700 dark:text-red-400">{poApproval.comment}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Reject form */}
                    {showRejectForm && !poApproval && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <textarea
                          value={rejectComment}
                          onChange={(e) => setRejectComment(e.target.value)}
                          placeholder="Describe los cambios necesarios..."
                          rows={3}
                          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => { setShowRejectForm(false); setRejectComment(''); }}>
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleReject}
                            disabled={!rejectComment.trim()}
                            className="gap-1.5 bg-red-600 hover:bg-red-700 text-white"
                          >
                            Confirmar rechazo
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Matrices QA ── */}
              <TabsContent value="matrices-qa" className="mt-8">
                <EpicQAMatrix
                  epic={rawEpic!}
                  stories={epic.stories}
                  qaMatrix={rawEpic!.qaMatrix}
                  onMatrixGenerated={(matrix) =>
                    dispatch({ type: 'SAVE_QA_MATRIX', payload: { epicId: rawEpic!.id, matrix } })
                  }
                  onMatrixEdited={(matrix) =>
                    dispatch({ type: 'UPDATE_QA_MATRIX', payload: { epicId: rawEpic!.id, matrix } })
                  }
                  qaApproval={rawEpic!.qaApproval}
                  onQaApprove={() =>
                    dispatch({ type: 'APPROVE_EPIC_QA', payload: { epicId: rawEpic!.id, qaName: 'QA Lead' } })
                  }
                  onQaReject={(comment) =>
                    dispatch({ type: 'REJECT_EPIC_QA', payload: { epicId: rawEpic!.id, qaName: 'QA Lead', comment } })
                  }
                  epicQAMatrix={rawEpic!.epicQAMatrix}
                  onEpicMatrixGenerated={(matrix) =>
                    dispatch({ type: 'SAVE_EPIC_QA_MATRIX', payload: { epicId: rawEpic!.id, matrix } })
                  }
                  onEpicMatrixEdited={(matrix) =>
                    dispatch({ type: 'UPDATE_EPIC_QA_MATRIX', payload: { epicId: rawEpic!.id, matrix } })
                  }
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
                  epic={epic}
                  onAddDependency={(dep) => dispatch({ type: 'ADD_EPIC_DEPENDENCY', payload: { epicId: rawEpic!.id, dependency: dep } })}
                  onUpdateDependency={(dep) => dispatch({ type: 'UPDATE_EPIC_DEPENDENCY', payload: { epicId: rawEpic!.id, dependency: dep } })}
                  onDeleteDependency={(depId) => dispatch({ type: 'DELETE_EPIC_DEPENDENCY', payload: { epicId: rawEpic!.id, dependencyId: depId } })}
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
