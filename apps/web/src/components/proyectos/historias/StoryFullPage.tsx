'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
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
  type StoryPOFields,
  type StoryTechnicalFields,
  type StoryQAFields,
} from '@cenzontle/shared';
import { StatusBadge } from '../shared/StatusBadge';
import { PodBadge } from '../shared/PodBadge';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { DownloadMenu } from '../shared/DownloadMenu';
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
} from 'lucide-react';

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

const inputCls =
  'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30';

// --- Helpers ---

function ListEditor({
  items,
  onChange,
  placeholder,
  label,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5 group">
          <span className="text-[10px] text-muted-foreground font-mono w-5 text-right shrink-0">
            {idx + 1}.
          </span>
          <Input
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[idx] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="text-sm flex-1"
          />
          {items.length > 1 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onChange([...items, ''])}
        className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {label}
      </Button>
    </div>
  );
}

function ReadOnlyList({ items, emptyText }: { items: string[]; emptyText?: string }) {
  const filtered = items.filter((i) => i.trim());
  if (filtered.length === 0) {
    return <p className="text-xs text-muted-foreground italic">{emptyText ?? 'Sin definir'}</p>;
  }
  return (
    <div className="space-y-0.5">
      {filtered.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5 text-xs">
          <span className="text-muted-foreground font-mono w-4 text-right shrink-0 mt-0.5">
            {i + 1}.
          </span>
          <span className="text-foreground/80">{item}</span>
        </div>
      ))}
    </div>
  );
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// --- Main Component ---

interface StoryFullPageProps {
  storyId: string;
}

function StoryFullPageInner({ storyId }: StoryFullPageProps) {
  const router = useRouter();
  const { state, dispatch } = useProyectos();
  const { setBreadcrumb } = useBreadcrumb();

  const baseStory = useMemo(() => state.stories.find((s) => s.id === storyId) ?? null, [storyId, state.stories]);

  // Vault content loaded from API (contains the narrative markdown fields)
  const [vaultContent, setVaultContent] = useState<{ po: any; technical: any; qa: any } | null>(null);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    apiGetStory(storyId, true)
      .then((data) => {
        if (cancelled) return;
        if (data.content) setVaultContent(data.content);
      })
      .catch((err) => {
        console.error('[StoryFullPage] failed to load vault content', err);
      });
    return () => { cancelled = true; };
  }, [storyId]);

  // Merge base story (from state) with vault content (from API)
  const story = useMemo(() => {
    if (!baseStory) return null;
    if (!vaultContent) return baseStory;
    return {
      ...baseStory,
      po: {
        ...baseStory.po,
        background: vaultContent.po?.background ?? '',
        objective: vaultContent.po?.objective ?? '',
        userStory: vaultContent.po?.userStory ?? '',
        whatHowWhen: baseStory.po.whatHowWhen,
        acceptanceCriteria: vaultContent.po?.acceptanceCriteria
          ? String(vaultContent.po.acceptanceCriteria).split('\n').filter((s: string) => s.trim())
          : [],
        additionalNotes: vaultContent.po?.additionalNotes ?? '',
      },
      technical: {
        architecture: vaultContent.technical?.architecture ?? '',
        integrationFlow: vaultContent.technical?.integrationFlow ?? '',
        validations: vaultContent.technical?.validations ?? [],
        errorHandling: vaultContent.technical?.errorHandling ?? [],
        implementationChecklist: vaultContent.technical?.implementationChecklist ?? [],
      },
      qa: {
        testingStrategy: vaultContent.qa?.testingStrategy ?? '',
        linkedQAMatrixId: baseStory.qa.linkedQAMatrixId,
      },
    } as UserStory;
  }, [baseStory, vaultContent]);
  const epic = useMemo(() => (story ? state.epics.find((e) => e.id === story.epicId) ?? null : null), [story, state.epics]);
  const initiative = useMemo(() => (epic ? state.initiatives.find((i) => i.id === epic.initiativeId) ?? null : null), [epic, state.initiatives]);
  const pod = useMemo(() => (story ? state.pods.find((p) => p.id === story.podId) ?? null : null), [story, state.pods]);
  const sprint = useMemo(() => (story?.sprintId ? state.sprints.find((s) => s.id === story.sprintId) ?? null : null), [story, state.sprints]);

  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleDelete = async () => {
    if (!story) return;
    try {
      await apiDeleteStory(story.id);
      dispatch({ type: 'DELETE_STORY', payload: { id: story.id } });
      toast.success('Historia eliminada');
      router.push(`/proyectos/epicas/${story.epicId}`);
    } catch (err: any) {
      toast.error(err.message || 'Error al eliminar historia');
      throw err;
    }
  };
  const [activeTab, setActiveTab] = useState('po');
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState<StoryStatus>(StoryStatus.Backlog);
  const [editStoryPoints, setEditStoryPoints] = useState(3);
  const [editPodId, setEditPodId] = useState('');
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [editPO, setEditPO] = useState<StoryPOFields>({
    background: '',
    objective: '',
    userStory: '',
    whatHowWhen: { what: '', how: '', when: '' },
    acceptanceCriteria: [''],
    additionalNotes: '',
  });
  const [editTechnical, setEditTechnical] = useState<StoryTechnicalFields>({
    architecture: '',
    integrationFlow: '',
    validations: [''],
    errorHandling: [''],
    implementationChecklist: [''],
  });
  const [editQA, setEditQA] = useState<StoryQAFields>({
    testingStrategy: '',
    linkedQAMatrixId: null,
  });

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
        <span className="text-foreground truncate max-w-[250px]">{story.title}</span>
      </div>
    );
    return () => setBreadcrumb(null);
  }, [story, epic, initiative, setBreadcrumb]);

  // --- Edit handlers ---

  const handleStartEdit = useCallback(() => {
    if (!story) return;
    setEditTitle(story.title);
    setEditStatus(story.status);
    setEditStoryPoints(story.storyPoints);
    setEditPodId(story.podId);
    setEditLabels([...story.labels]);
    setEditPO({
      ...story.po,
      acceptanceCriteria: story.po.acceptanceCriteria.length > 0 ? [...story.po.acceptanceCriteria] : [''],
    });
    setEditTechnical({
      ...story.technical,
      validations: story.technical.validations.length > 0 ? [...story.technical.validations] : [''],
      errorHandling: story.technical.errorHandling.length > 0 ? [...story.technical.errorHandling] : [''],
      implementationChecklist: story.technical.implementationChecklist.length > 0 ? [...story.technical.implementationChecklist] : [''],
    });
    setEditQA({ ...story.qa });
    setIsEditing(true);
  }, [story]);

  const handleSave = useCallback(async () => {
    if (!story || !editTitle.trim()) {
      return;
    }

    const cleanedPO = {
      ...editPO,
      acceptanceCriteria: editPO.acceptanceCriteria.filter((c: string) => c.trim()),
    };
    const cleanedTechnical = {
      ...editTechnical,
      validations: editTechnical.validations.filter((v: string) => v.trim()),
      errorHandling: editTechnical.errorHandling.filter((e: string) => e.trim()),
      implementationChecklist: editTechnical.implementationChecklist.filter((c: string) => c.trim()),
    };

    // Convert PO fields to API shape (acceptanceCriteria joined, whatHowWhen flattened)
    const poForApi = {
      background: cleanedPO.background,
      objective: cleanedPO.objective,
      userStory: cleanedPO.userStory,
      whatHowWhen: typeof (cleanedPO as any).whatHowWhen === 'string'
        ? (cleanedPO as any).whatHowWhen
        : [
            (cleanedPO as any).whatHowWhen?.what,
            (cleanedPO as any).whatHowWhen?.how,
            (cleanedPO as any).whatHowWhen?.when,
          ].filter(Boolean).join(' / '),
      acceptanceCriteria: cleanedPO.acceptanceCriteria.join('\n'),
      additionalNotes: cleanedPO.additionalNotes,
    };

    try {
      const result = await apiUpdateStory(story.id, {
        title: editTitle.trim(),
        status: editStatus as string,
        storyPoints: editStoryPoints,
        podId: editPodId,
        labels: editLabels,
        po: poForApi,
        technical: cleanedTechnical,
        qa: {
          testingStrategy: editQA.testingStrategy,
          linkedQAMatrixId: editQA.linkedQAMatrixId ?? undefined,
        },
      });
      dispatch({
        type: 'UPDATE_STORY',
        payload: {
          id: story.id,
          changes: {
            title: editTitle.trim(),
            description: editPO.userStory.trim(),
            storyPoints: editStoryPoints,
            status: editStatus,
            podId: editPodId,
            labels: editLabels,
            po: cleanedPO,
            technical: cleanedTechnical,
            qa: editQA,
          },
        },
      });

      toast.success('Historia actualizada');
      setIsEditing(false);
    } catch (err: any) {
      console.error('[StoryFullPage] apiUpdateStory FAILED', err);
      toast.error(err.message || 'Error al actualizar historia');
    }
  }, [story, editTitle, editStoryPoints, editStatus, editPodId, editLabels, editPO, editTechnical, editQA, dispatch]);

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
    <div className="h-full min-h-0">
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">

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
              <div className="flex gap-1 shrink-0 mt-1">
                {!isEditing ? (
                  <>
                    <DownloadMenu entity={{ kind: 'story', story }} fetchFullContent />
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
                Product Owner
              </TabsTrigger>
              <TabsTrigger value="technical" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <Code2 className="h-3.5 w-3.5" />
                Technical
              </TabsTrigger>
              <TabsTrigger value="qa" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <TestTube2 className="h-3.5 w-3.5" />
                QA
              </TabsTrigger>
              <TabsTrigger value="changelog" className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:shadow-none">
                <History className="h-3.5 w-3.5" />
                Changelog ({storyChangelog.length})
              </TabsTrigger>
            </TabsList>

            {/* ── PO Tab ── */}
            <TabsContent value="po" className="mt-8 space-y-6">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Antecedentes</label>
                    <textarea
                      value={editPO.background}
                      onChange={(e) => setEditPO((prev) => ({ ...prev, background: e.target.value }))}
                      placeholder="Contexto e información previa relevante para esta historia..."
                      rows={3}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Objetivo</label>
                    <textarea
                      value={editPO.objective}
                      onChange={(e) => setEditPO((prev) => ({ ...prev, objective: e.target.value }))}
                      placeholder="¿Qué se busca lograr con esta historia?"
                      rows={3}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Historia de Usuario</label>
                    <textarea
                      value={editPO.userStory}
                      onChange={(e) => setEditPO((prev) => ({ ...prev, userStory: e.target.value }))}
                      placeholder="Como [tipo de usuario], quiero [acción] para [beneficio]..."
                      rows={3}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">What / How / When</label>
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        value={editPO.whatHowWhen.what}
                        onChange={(e) => setEditPO((prev) => ({ ...prev, whatHowWhen: { ...prev.whatHowWhen, what: e.target.value } }))}
                        placeholder="What — ¿Qué?"
                        className="text-sm"
                      />
                      <Input
                        value={editPO.whatHowWhen.how}
                        onChange={(e) => setEditPO((prev) => ({ ...prev, whatHowWhen: { ...prev.whatHowWhen, how: e.target.value } }))}
                        placeholder="How — ¿Cómo?"
                        className="text-sm"
                      />
                      <Input
                        value={editPO.whatHowWhen.when}
                        onChange={(e) => setEditPO((prev) => ({ ...prev, whatHowWhen: { ...prev.whatHowWhen, when: e.target.value } }))}
                        placeholder="When — ¿Cuándo?"
                        className="text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Criterios de Aceptación</label>
                    <ListEditor
                      items={editPO.acceptanceCriteria}
                      onChange={(items) => setEditPO((prev) => ({ ...prev, acceptanceCriteria: items }))}
                      placeholder="Dado que... Cuando... Entonces..."
                      label="Agregar criterio"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Notas Adicionales <span className="font-normal">(opcional)</span>
                    </label>
                    <textarea
                      value={editPO.additionalNotes}
                      onChange={(e) => setEditPO((prev) => ({ ...prev, additionalNotes: e.target.value }))}
                      placeholder="Dependencias, restricciones, consideraciones extra..."
                      rows={2}
                      className={inputCls}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {story.po.background && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Antecedentes</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{story.po.background}</p>
                    </section>
                  )}
                  {story.po.objective && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Objetivo</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{story.po.objective}</p>
                    </section>
                  )}
                  {story.po.userStory && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Historia de Usuario</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{story.po.userStory}</p>
                    </section>
                  )}
                  {(story.po.whatHowWhen.what || story.po.whatHowWhen.how || story.po.whatHowWhen.when) && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">What / How / When</h3>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-muted/30 p-3">
                          <span className="text-xs text-muted-foreground block mb-1">What</span>
                          <span className="text-sm text-foreground/80">{story.po.whatHowWhen.what || '—'}</span>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-3">
                          <span className="text-xs text-muted-foreground block mb-1">How</span>
                          <span className="text-sm text-foreground/80">{story.po.whatHowWhen.how || '—'}</span>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-3">
                          <span className="text-xs text-muted-foreground block mb-1">When</span>
                          <span className="text-sm text-foreground/80">{story.po.whatHowWhen.when || '—'}</span>
                        </div>
                      </div>
                    </section>
                  )}
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Criterios de Aceptación</h3>
                    <ReadOnlyList items={story.po.acceptanceCriteria} emptyText="Sin criterios definidos" />
                  </section>
                  {story.po.additionalNotes && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notas Adicionales</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">{story.po.additionalNotes}</p>
                    </section>
                  )}
                  {!story.po.background && !story.po.objective && !story.po.userStory && story.po.acceptanceCriteria.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <ClipboardList className="h-6 w-6 mb-2 opacity-20" />
                      <p className="text-sm">Sin definición de PO</p>
                      <p className="text-xs mt-1">Haz clic en el lápiz para agregar información</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Technical Tab ── */}
            <TabsContent value="technical" className="mt-8 space-y-6">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Arquitectura y Componentes</label>
                    <textarea
                      value={editTechnical.architecture}
                      onChange={(e) => setEditTechnical((prev) => ({ ...prev, architecture: e.target.value }))}
                      placeholder="Componentes involucrados, servicios, bases de datos..."
                      rows={4}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Flujo de Integración Propuesto</label>
                    <textarea
                      value={editTechnical.integrationFlow}
                      onChange={(e) => setEditTechnical((prev) => ({ ...prev, integrationFlow: e.target.value }))}
                      placeholder="Secuencia de llamadas, APIs involucradas, flujo de datos..."
                      rows={4}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Validaciones Requeridas</label>
                    <ListEditor
                      items={editTechnical.validations}
                      onChange={(items) => setEditTechnical((prev) => ({ ...prev, validations: items }))}
                      placeholder="Validación de entrada, reglas de negocio..."
                      label="Agregar validación"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Manejo de Errores</label>
                    <ListEditor
                      items={editTechnical.errorHandling}
                      onChange={(items) => setEditTechnical((prev) => ({ ...prev, errorHandling: items }))}
                      placeholder="Escenario de error y estrategia de manejo..."
                      label="Agregar escenario"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Checklist de Implementación</label>
                    <ListEditor
                      items={editTechnical.implementationChecklist}
                      onChange={(items) => setEditTechnical((prev) => ({ ...prev, implementationChecklist: items }))}
                      placeholder="Paso de implementación..."
                      label="Agregar paso"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {story.technical.architecture && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Arquitectura y Componentes</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{story.technical.architecture}</p>
                    </section>
                  )}
                  {story.technical.integrationFlow && (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Flujo de Integración</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{story.technical.integrationFlow}</p>
                    </section>
                  )}
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Validaciones Requeridas</h3>
                    <ReadOnlyList items={story.technical.validations} emptyText="Sin validaciones definidas" />
                  </section>
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Manejo de Errores</h3>
                    <ReadOnlyList items={story.technical.errorHandling} emptyText="Sin escenarios definidos" />
                  </section>
                  <section>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Checklist de Implementación</h3>
                    <ReadOnlyList items={story.technical.implementationChecklist} emptyText="Sin checklist definido" />
                  </section>
                  {!story.technical.architecture && !story.technical.integrationFlow && story.technical.validations.length === 0 && story.technical.errorHandling.length === 0 && story.technical.implementationChecklist.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Code2 className="h-6 w-6 mb-2 opacity-20" />
                      <p className="text-sm">Sin definición técnica</p>
                      <p className="text-xs mt-1">Haz clic en el lápiz para agregar información</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── QA Tab ── */}
            <TabsContent value="qa" className="mt-8 space-y-6">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Testing Strategy</label>
                    <textarea
                      value={editQA.testingStrategy}
                      onChange={(e) => setEditQA((prev) => ({ ...prev, testingStrategy: e.target.value }))}
                      placeholder="Estrategia de pruebas: unitarias, integración, E2E, performance..."
                      rows={5}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Matriz de Pruebas (QA)</label>
                    <div className="rounded-lg border border-dashed p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        Las matrices de pruebas se gestionan desde la vista de la épica.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {story.qa.testingStrategy ? (
                    <section>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Testing Strategy</h3>
                      <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{story.qa.testingStrategy}</p>
                    </section>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <TestTube2 className="h-6 w-6 mb-2 opacity-20" />
                      <p className="text-sm">Sin estrategia de testing definida</p>
                    </div>
                  )}
                  <section>
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
                </div>
              )}
            </TabsContent>

            {/* ── Changelog Tab ── */}
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

          {/* Save bar when editing */}
          {isEditing && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-3 mt-8 -mx-6 px-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsEditing(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!editTitle.trim()} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Guardar cambios
              </Button>
            </div>
          )}
        </div>
      </div>
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
