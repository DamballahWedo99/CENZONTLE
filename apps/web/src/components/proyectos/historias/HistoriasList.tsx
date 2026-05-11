'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { updateStory as apiUpdateStory, deleteStory as apiDeleteStory, getStory as apiGetStory } from '@/lib/api/stories';
import { getShortId } from '@/lib/short-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '../shared/StatusBadge';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { PodBadge } from '../shared/PodBadge';
import {
  ArrowUpDown,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  Check,
  Plus,
  ClipboardList,
  Code2,
  TestTube2,
  Link2,
} from 'lucide-react';
import type {
  UserStory,
  StoryStatus,
  StoryPOFields,
  StoryTechnicalFields,
  StoryQAFields,
} from '@cenzontle/shared';
import { StoryStatus as StoryStatusEnum } from '@cenzontle/shared';
import { StoryPOTab } from './editor/StoryPOTab';
import { StoryTechnicalTab } from './editor/StoryTechnicalTab';
import { StoryQATab } from './editor/StoryQATab';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';

// --- Labels ---

const storyStatusLabels: Record<StoryStatus, string> = {
  [StoryStatusEnum.Backlog]: 'Backlog',
  [StoryStatusEnum.ToDo]: 'Por hacer',
  [StoryStatusEnum.InProgress]: 'En progreso',
  [StoryStatusEnum.InReview]: 'En revisión',
  [StoryStatusEnum.QA]: 'QA',
  [StoryStatusEnum.Done]: 'Completado',
  [StoryStatusEnum.Blocked]: 'Bloqueado',
};

const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13] as const;

type SortField = 'trackerKey' | 'title' | 'status' | 'storyPoints';
type SortDir = 'asc' | 'desc';

// --- Form state ---

interface StoryFormData {
  title: string;
  storyPoints: number;
  status: StoryStatus;
  podId: string;
  labels: string[];
  po: StoryPOFields;
  technical: StoryTechnicalFields;
  qa: StoryQAFields;
}

const emptyPO: StoryPOFields = { markdown: '' };
const emptyTechnical: StoryTechnicalFields = { markdown: '' };
const emptyQA: StoryQAFields = { markdown: '' };

// --- Component ---

export function HistoriasList() {
  const router = useRouter();
  const { filteredStories, state, dispatch } = useProyectos();

  const [sortField, setSortField] = useState<SortField>('trackerKey');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<StoryFormData>({
    title: '',
    storyPoints: 3,
    status: StoryStatusEnum.Backlog,
    podId: '',
    labels: [],
    po: emptyPO,
    technical: emptyTechnical,
    qa: emptyQA,
  });
  const [formTab, setFormTab] = useState<string>('po');
  const [viewTab, setViewTab] = useState<string>('po');
  const [newLabel, setNewLabel] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // ID de la story cuyo vault content está cargando — bloquea Save mientras
  // tanto y muestra estado loading. Null = nada cargando.
  const [loadingVault, setLoadingVault] = useState<string | null>(null);
  // Ref espejo de editingStoryId para usar en async callbacks sin stale closure.
  const editingStoryIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingStoryIdRef.current = editingStoryId;
  }, [editingStoryId]);

  // All users can edit/delete stories (permissions enforced server-side via Auth0 roles)
  const canEditStory = useCallback(
    (_story: UserStory): boolean => true,
    [],
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    return [...filteredStories].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'trackerKey':
          cmp = (a.tracker?.externalKey ?? '').localeCompare(b.tracker?.externalKey ?? '');
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'storyPoints':
          cmp = a.storyPoints - b.storyPoints;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredStories, sortField, sortDir]);

  // --- Edit ---

  // Guard para race conditions: si el user abre story A, espera fetch, abre
  // story B antes de que termine A, el callback tardío de A NO debe pisar
  // el formData de B. Comparamos contra `editingStoryId` actual al resolver.
  const startEditing = useCallback(async (story: UserStory) => {
    setEditingStoryId(story.id);
    setExpandedStoryId(story.id);
    setFormTab('po');
    // Setea metadata inmediatamente con markdown vacío (placeholder hasta el
    // fetch). El editor inline está deshabilitado hasta que cargue.
    setFormData({
      title: story.title,
      storyPoints: story.storyPoints,
      status: story.status,
      podId: story.podId,
      labels: [...story.labels],
      po: { markdown: '' },
      technical: { markdown: '' },
      qa: { markdown: '' },
    });
    setLoadingVault(story.id);
    try {
      // CRÍTICO: el list endpoint NO retorna contenido vault. Sin este fetch
      // saveEditing sobreescribiría el vault con strings vacíos.
      const data = await apiGetStory(story.id, true);
      // Race-condition guard: si el user cambió de story mientras cargaba.
      if (editingStoryIdRef.current !== story.id) return;
      if (data.content) {
        setFormData((prev) => ({
          ...prev,
          po: { markdown: data.content?.po?.markdown ?? '' },
          technical: { markdown: data.content?.technical?.markdown ?? '' },
          qa: { markdown: data.content?.qa?.markdown ?? '' },
        }));
      }
    } catch {
      toast.error('No se pudo cargar el contenido completo de la historia');
    } finally {
      if (editingStoryIdRef.current === story.id) setLoadingVault(null);
    }
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingStoryId(null);
  }, []);

  const saveEditing = useCallback(async () => {
    if (!editingStoryId || !formData.title.trim()) return;

    try {
      await apiUpdateStory(editingStoryId, {
        title: formData.title.trim(),
        status: formData.status as string,
        storyPoints: formData.storyPoints,
        podId: formData.podId,
        labels: formData.labels,
        po: { markdown: formData.po.markdown ?? '' },
        technical: { markdown: formData.technical.markdown ?? '' },
        qa: { markdown: formData.qa.markdown ?? '' },
      });

      dispatch({
        type: 'UPDATE_STORY',
        payload: {
          id: editingStoryId,
          changes: {
            title: formData.title.trim(),
            storyPoints: formData.storyPoints,
            status: formData.status,
            podId: formData.podId,
            labels: formData.labels,
            po: formData.po,
            technical: formData.technical,
            qa: formData.qa,
          },
        },
      });

      toast.success('Historia actualizada');
      setEditingStoryId(null);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar historia');
    }
  }, [editingStoryId, formData, dispatch]);

  // --- Labels ---

  const addLabel = useCallback(() => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setFormData((prev) => ({
      ...prev,
      labels: prev.labels.includes(trimmed) ? prev.labels : [...prev.labels, trimmed],
    }));
    setNewLabel('');
  }, [newLabel]);

  const removeLabel = useCallback((label: string) => {
    setFormData((prev) => ({
      ...prev,
      labels: prev.labels.filter((l) => l !== label),
    }));
  }, []);

  // --- Sort header ---

  const SortHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <div
      className="cursor-pointer select-none flex items-center gap-1"
      onClick={() => toggleSort(field)}
    >
      {children}
      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
    </div>
  );

  // --- Form sections ---

  const renderMetaFields = () => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Story Points</label>
        <Select
          value={String(formData.storyPoints)}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, storyPoints: Number(v) }))}
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIBONACCI_POINTS.map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p} SP
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Estado</label>
        <Select
          value={formData.status}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, status: v as StoryStatus }))}
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(storyStatusLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Pod</label>
        <Select
          value={formData.podId}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, podId: v }))}
        >
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Seleccionar" />
          </SelectTrigger>
          <SelectContent>
            {state.pods.map((pod) => (
              <SelectItem key={pod.id} value={pod.id}>
                {pod.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderStoryForm = () => (
    <div className="px-4 py-4 bg-muted/20 rounded-lg border">
      <div className="space-y-1.5 mb-4">
        <label className="text-xs font-medium text-muted-foreground">Título *</label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="Título descriptivo de la historia"
          className="text-sm"
        />
      </div>

      {renderMetaFields()}

      {/* Labels */}
      <div className="mb-4 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Etiquetas</label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {formData.labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {label}
              <button
                type="button"
                onClick={() => removeLabel(label)}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel();
              }
            }}
            placeholder="Nueva etiqueta..."
            className="text-sm flex-1 max-w-[200px]"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addLabel}
            disabled={!newLabel.trim()}
            className="h-9"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Section tabs — markdown único por sección */}
      <Tabs value={formTab} onValueChange={setFormTab}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="po" className="gap-1.5 text-xs">
            <ClipboardList className="h-3.5 w-3.5" />
            PO
          </TabsTrigger>
          <TabsTrigger value="technical" className="gap-1.5 text-xs">
            <Code2 className="h-3.5 w-3.5" />
            Technical
          </TabsTrigger>
          <TabsTrigger value="qa" className="gap-1.5 text-xs">
            <TestTube2 className="h-3.5 w-3.5" />
            QA
          </TabsTrigger>
        </TabsList>
        <TabsContent value="po" className="mt-4">
          <StoryPOTab
            value={formData.po.markdown ?? ''}
            onChange={(md) => setFormData((prev) => ({ ...prev, po: { markdown: md } }))}
          />
        </TabsContent>
        <TabsContent value="technical" className="mt-4">
          <StoryTechnicalTab
            value={formData.technical.markdown ?? ''}
            onChange={(md) => setFormData((prev) => ({ ...prev, technical: { markdown: md } }))}
          />
        </TabsContent>
        <TabsContent value="qa" className="mt-4">
          <StoryQATab
            value={formData.qa.markdown ?? ''}
            onChange={(md) => setFormData((prev) => ({ ...prev, qa: { markdown: md } }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );

  // --- Read-only views — render markdown unificado ---

  const renderPOView = (story: UserStory) => {
    const md = (story.po.markdown ?? '').trim();
    if (!md) return <p className="text-xs text-muted-foreground italic">Sin contenido de PO</p>;
    return <ReadOnlyMarkdown content={md} />;
  };

  const renderTechnicalView = (story: UserStory) => {
    const md = (story.technical.markdown ?? '').trim();
    if (!md) return <p className="text-xs text-muted-foreground italic">Sin contenido técnico</p>;
    return <ReadOnlyMarkdown content={md} />;
  };

  const renderQAView = (story: UserStory) => {
    const epic = state.epics.find((e) => e.id === story.epicId);
    const qaRow = epic?.qaMatrix?.rows.find((r) => r.storyId === story.id);
    const md = (story.qa.markdown ?? '').trim();
    return (
      <div className="space-y-3">
        {md ? (
          <ReadOnlyMarkdown content={md} />
        ) : (
          <p className="text-xs text-muted-foreground italic">Sin contenido de QA</p>
        )}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Matriz de Pruebas</p>
          {qaRow ? (
            <div className="rounded-lg border p-3 bg-muted/20 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-foreground">{qaRow.storyJiraKey}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {qaRow.testCases.length} casos · {qaRow.coverage}% cobertura
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sin matriz vinculada</p>
          )}
        </div>
      </div>
    );
  };

  // --- Main render ---

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? 'historia' : 'historias'}
        </span>
      </div>
      {/* Header row */}
      <div className="grid grid-cols-[60px_1fr_180px_160px_90px_32px_100px_60px_28px] gap-2 items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b">
        <SortHeader field="trackerKey">Key</SortHeader>
        <SortHeader field="title">Título</SortHeader>
        <div>Épica</div>
        <div>Célula</div>
        <SortHeader field="status">Status</SortHeader>
        <SortHeader field="storyPoints">SP</SortHeader>
        <div>Sprint</div>
        <div></div>
        <div></div>
      </div>

      {/* Story list */}
      <div className="space-y-1">
        {sorted.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            No se encontraron historias con los filtros actuales
          </div>
        ) : (
          sorted.map((story) => {
            const isEditing = editingStoryId === story.id;
            const isExpanded = expandedStoryId === story.id;
            const epic = state.epics.find((e) => e.id === story.epicId);
            const pod = state.pods.find((p) => p.id === story.podId);
            const sprint = story.sprintId
              ? state.sprints.find((s) => s.id === story.sprintId)
              : null;
            const userCanEdit = canEditStory(story);
            const userCanDelete = canEditStory(story);

            return (
              <div
                key={story.id}
                className={`rounded-lg border transition-colors ${
                  isEditing ? 'border-primary/50 bg-muted/20' : 'hover:bg-muted/30'
                }`}
              >
                {/* Row summary */}
                <div
                  className="grid grid-cols-[60px_1fr_180px_160px_90px_32px_100px_60px_28px] gap-2 items-center px-4 py-3 text-sm cursor-pointer"
                  onClick={() => {
                    if (!isEditing) {
                      router.push(`/proyectos/historias/${story.id}`);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {story.tracker?.externalKey ?? getShortId(story.id)}
                    </span>
                  </div>
                  <span className="truncate font-medium">{story.title}</span>
                  <span className="text-xs text-muted-foreground truncate">{epic?.title}</span>
                  <div>{pod && <PodBadge name={pod.name} color={pod.color} />}</div>
                  <div><StatusBadge status={story.status} /></div>
                  <div><StoryPointsBadge points={story.storyPoints} /></div>
                  <span className="text-xs text-muted-foreground">{sprint?.name ?? '—'}</span>
                  <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
                    {userCanEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (isEditing) cancelEditing();
                          else startEditing(story);
                        }}
                        className={`h-7 w-7 p-0 ${
                          isEditing
                            ? 'text-primary hover:text-primary/80'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title={isEditing ? 'Cancelar edición' : 'Editar historia'}
                      >
                        {isEditing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {userCanDelete && (
                      <>
                        {deleteConfirmId === story.id ? (
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  await apiDeleteStory(story.id);
                                  dispatch({ type: 'DELETE_STORY', payload: { id: story.id } });
                                  toast.success('Historia eliminada');
                                  setDeleteConfirmId(null);
                                  if (editingStoryId === story.id) setEditingStoryId(null);
                                  if (expandedStoryId === story.id) setExpandedStoryId(null);
                                } catch (err: any) {
                                  toast.error(err.message || 'Error al eliminar historia');
                                }
                              }}
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              title="Confirmar eliminación"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteConfirmId(null)}
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              title="Cancelar"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteConfirmId(story.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                            title="Eliminar historia"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Expanded read-only view */}
                {isExpanded && !isEditing && (
                  <div className="px-4 pb-4 border-t mx-4 pt-3">
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                      {pod && (
                        <span>
                          Pod: <span className="text-foreground">{pod.name}</span>
                        </span>
                      )}
                      {epic && (
                        <span>
                          Épica: <span className="text-foreground">{epic?.tracker?.externalKey ?? epic?.title}</span>
                        </span>
                      )}
                      <span>
                        Creado:{' '}
                        <span className="text-foreground">
                          {new Date(story.createdAt).toLocaleDateString('es-MX')}
                        </span>
                      </span>
                    </div>
                    {story.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {story.labels.map((label) => (
                          <span
                            key={label}
                            className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Section tabs read-only */}
                    <Tabs value={viewTab} onValueChange={setViewTab}>
                      <TabsList className="w-full grid grid-cols-3">
                        <TabsTrigger value="po" className="gap-1.5 text-xs">
                          <ClipboardList className="h-3.5 w-3.5" />
                          PO
                        </TabsTrigger>
                        <TabsTrigger value="technical" className="gap-1.5 text-xs">
                          <Code2 className="h-3.5 w-3.5" />
                          Technical
                        </TabsTrigger>
                        <TabsTrigger value="qa" className="gap-1.5 text-xs">
                          <TestTube2 className="h-3.5 w-3.5" />
                          QA
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="po" className="mt-3">
                        {renderPOView(story)}
                      </TabsContent>
                      <TabsContent value="technical" className="mt-3">
                        {renderTechnicalView(story)}
                      </TabsContent>
                      <TabsContent value="qa" className="mt-3">
                        {renderQAView(story)}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {/* Inline edit form */}
                {isEditing && (
                  <div className="px-4 pb-4 border-t mx-4 pt-3">
                    {renderStoryForm()}
                    <div className="flex justify-end gap-2 mt-4">
                      <Button size="sm" variant="ghost" onClick={cancelEditing}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={saveEditing}
                        disabled={!formData.title.trim() || loadingVault === story.id}
                        className="gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {loadingVault === story.id ? 'Cargando contenido...' : 'Guardar cambios'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Summary */}
      {sorted.length > 0 && (
        <div className="text-xs text-muted-foreground px-1">
          {sorted.length} {sorted.length === 1 ? 'historia' : 'historias'} ·{' '}
          {sorted.reduce((sum, s) => sum + s.storyPoints, 0)} SP
        </div>
      )}
    </div>
  );
}
