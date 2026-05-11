'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  UserStory,
  StoryStatus,
  StoryPOFields,
  StoryTechnicalFields,
  StoryQAFields,
  Pod,
} from '@cenzontle/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoundCheckbox } from '@/components/ui/round-checkbox';
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog';
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
import { StoryPOTab } from '../historias/editor/StoryPOTab';
import { StoryTechnicalTab } from '../historias/editor/StoryTechnicalTab';
import { StoryQATab } from '../historias/editor/StoryQATab';
import { ReadOnlyMarkdown } from '@/components/shared/tiptap/ReadOnlyMarkdown';
import { getShortId } from '@/lib/short-id';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  ChevronRight,
  ClipboardList,
  Code2,
  TestTube2,
  Link2,
  Sparkles,
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

// --- Defaults ---

// En v2, cada sección es un único string markdown — se inicializa vacío.
const emptyPO: StoryPOFields = { markdown: '' };
const emptyTechnical: StoryTechnicalFields = { markdown: '' };
const emptyQA: StoryQAFields = { markdown: '' };

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

const emptyForm: StoryFormData = {
  title: '',
  storyPoints: 3,
  status: StoryStatus.Backlog,
  podId: '',
  labels: [],
  po: emptyPO,
  technical: emptyTechnical,
  qa: emptyQA,
};

// --- Helpers ---

const inputCls =
  'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30';

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

// --- Component ---

interface EpicStoryListProps {
  stories: UserStory[];
  epicId: string;
  pods: Pod[];
  onCreateStory: (story: UserStory) => void;
  onUpdateStory: (id: string, changes: Partial<UserStory>) => void;
  onDeleteStory: (id: string) => void;
  /**
   * Callback opcional para bulk delete. Cuando está definido, el bulk delete
   * lo usa (en lugar de iterar `onDeleteStory`) para que el padre orqueste
   * UN solo toast loading + success/error en lugar de N toasts individuales.
   */
  onBulkDeleteStories?: (ids: string[]) => Promise<void>;
  /**
   * Si se provee, renderiza un boton "Crear con IA" inmediatamente a la izquierda
   * del boton "Agregar historia" en el header. Se oculta cuando esta undefined
   * (p.ej. cuando el agente ya esta en modo streaming/staging desde el padre).
   */
  onGenerateWithAI?: () => void;
}

export function EpicStoryList({
  stories,
  epicId,
  pods,
  onCreateStory,
  onUpdateStory,
  onDeleteStory,
  onBulkDeleteStories,
  onGenerateWithAI,
}: EpicStoryListProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const createFormRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState<StoryFormData>(emptyForm);
  const [formTab, setFormTab] = useState<string>('po');
  const [viewTab, setViewTab] = useState<string>('po');
  const [newLabel, setNewLabel] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Selección múltiple para bulk delete. Usa Set por O(1) lookup y semántica
  // clara de unicidad. Cuando el set está vacío, la action bar se oculta.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const toggleSelect = useCallback((storyId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(storyId);
      else next.delete(storyId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const allSelected = stories.length > 0 && selectedIds.size === stories.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < stories.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(stories.map((s) => s.id)));
    }
  }, [allSelected, stories]);

  const handleBulkDelete = useCallback(async () => {
    // Snapshot inmutable del set: el callback puede tardar y el set podría
    // mutar mientras iteramos. Convertimos a array antes de iterar.
    const idsToDelete = Array.from(selectedIds);
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);

    if (onBulkDeleteStories) {
      // El padre orquesta el toast loading/success/error con un solo toast
      // unificado (paritario UX al delete individual).
      await onBulkDeleteStories(idsToDelete);
      return;
    }

    // Fallback: iteramos onDeleteStory individualmente y mostramos UN toast
    // que va de loading → success/error según el resultado agregado. El
    // padre puede mostrar toasts individuales por cada onDeleteStory; no
    // podemos suprimirlos desde aquí, pero el toast loading visual sigue
    // siendo correcto.
    const toastId = toast.loading(
      `Eliminando ${idsToDelete.length} ${idsToDelete.length === 1 ? 'historia de usuario' : 'historias de usuario'}…`,
    );
    let ok = 0;
    let fail = 0;
    for (const id of idsToDelete) {
      try {
        await onDeleteStory(id);
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
  }, [selectedIds, onBulkDeleteStories, onDeleteStory]);
  // Deriva la story completa para usarla en el modal type-to-confirm (necesita
  // expectedValue=title). Si la story se elimina del array, deleteConfirmId
  // tambien se limpia desde el handler.
  const storyToDelete = useMemo(
    () => (deleteConfirmId ? stories.find((s) => s.id === deleteConfirmId) ?? null : null),
    [deleteConfirmId, stories],
  );

  // tracker is assigned externally (e.g. via Linear/Jira integration), not at creation time

  // Auto-scroll to inline creation form & Escape key
  useEffect(() => {
    if (isCreating && createFormRef.current) {
      createFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isCreating]);

  useEffect(() => {
    if (!isCreating) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsCreating(false); setFormData(emptyForm); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isCreating]);

  // --- Form updaters ---

  const updatePO = useCallback((changes: Partial<StoryPOFields>) => {
    setFormData((prev) => ({ ...prev, po: { ...prev.po, ...changes } }));
  }, []);

  const updateTechnical = useCallback((changes: Partial<StoryTechnicalFields>) => {
    setFormData((prev) => ({ ...prev, technical: { ...prev.technical, ...changes } }));
  }, []);

  const updateQA = useCallback((changes: Partial<StoryQAFields>) => {
    setFormData((prev) => ({ ...prev, qa: { ...prev.qa, ...changes } }));
  }, []);

  // --- Create ---

  const startCreating = useCallback(() => {
    setEditingStoryId(null);
    setExpandedStoryId(null);
    setFormData({
      ...emptyForm,
      podId: pods[0]?.id ?? '',
    });
    setFormTab('po');
    setIsCreating(true);
  }, [pods]);

  const cancelCreating = useCallback(() => {
    setIsCreating(false);
    setFormData(emptyForm);
  }, []);

  const handleCreate = useCallback(() => {
    if (!formData.title.trim()) return;
    const now = new Date().toISOString();
    // Description corto se deriva de la primera línea no-heading del markdown PO.
    const firstContentLine = formData.po.markdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'));
    const story: UserStory = {
      id: crypto.randomUUID(),
      title: formData.title.trim(),
      description: firstContentLine ?? '',
      storyPoints: formData.storyPoints,
      status: formData.status,
      epicId,
      podId: formData.podId,
      sprintId: null,
      labels: formData.labels,
      po: { markdown: formData.po.markdown },
      technical: { markdown: formData.technical.markdown },
      qa: { markdown: formData.qa.markdown },
      createdAt: now,
      updatedAt: now,
    };
    onCreateStory(story);
    setIsCreating(false);
    setFormData(emptyForm);
  }, [formData, epicId, onCreateStory]);

  // --- Edit ---

  const startEditing = useCallback((story: UserStory) => {
    setIsCreating(false);
    setEditingStoryId(story.id);
    setExpandedStoryId(story.id);
    setFormTab('po');
    setFormData({
      title: story.title,
      storyPoints: story.storyPoints,
      status: story.status,
      podId: story.podId,
      labels: [...story.labels],
      po: { markdown: story.po.markdown ?? '' },
      technical: { markdown: story.technical.markdown ?? '' },
      qa: { markdown: story.qa.markdown ?? '' },
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingStoryId(null);
  }, []);

  const saveEditing = useCallback(() => {
    if (!editingStoryId || !formData.title.trim()) return;
    const firstContentLine = formData.po.markdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'));
    onUpdateStory(editingStoryId, {
      title: formData.title.trim(),
      description: firstContentLine ?? '',
      storyPoints: formData.storyPoints,
      status: formData.status,
      podId: formData.podId,
      labels: formData.labels,
      po: { markdown: formData.po.markdown },
      technical: { markdown: formData.technical.markdown },
      qa: { markdown: formData.qa.markdown },
    });
    setEditingStoryId(null);
  }, [editingStoryId, formData, onUpdateStory]);

  // --- Labels helpers ---

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

  // --- Shared form sections ---

  const renderMetaFields = () => (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 mb-4">
      <div className="min-w-0 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Story Points</label>
        <Select
          value={String(formData.storyPoints)}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, storyPoints: Number(v) }))}
        >
          <SelectTrigger className="w-full text-sm">
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
      <div className="min-w-0 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Estado</label>
        <Select
          value={formData.status}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, status: v as StoryStatus }))}
        >
          <SelectTrigger className="w-full text-sm">
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
      <div className="min-w-0 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Pod</label>
        <Select
          value={formData.podId}
          onValueChange={(v) => setFormData((prev) => ({ ...prev, podId: v }))}
        >
          <SelectTrigger className="w-full text-sm">
            <SelectValue placeholder="Seleccionar" />
          </SelectTrigger>
          <SelectContent>
            {pods.map((pod) => (
              <SelectItem key={pod.id} value={pod.id}>
                {pod.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  // En v2 cada tab es un único editor Tiptap full-feature (StoryPOTab/
  // StoryTechnicalTab/StoryQATab) con un placeholder de los headings
  // obligatorios. Reemplaza los N textareas + ListEditor del shape v1.
  const renderPOTab = () => (
    <StoryPOTab
      value={formData.po.markdown}
      onChange={(md) => setFormData((prev) => ({ ...prev, po: { markdown: md } }))}
    />
  );

  const renderTechnicalTab = () => (
    <StoryTechnicalTab
      value={formData.technical.markdown}
      onChange={(md) => setFormData((prev) => ({ ...prev, technical: { markdown: md } }))}
    />
  );

  const renderQATab = () => (
    <StoryQATab
      value={formData.qa.markdown}
      onChange={(md) => setFormData((prev) => ({ ...prev, qa: { markdown: md } }))}
    />
  );

  const renderStoryForm = (autoFocusTitle: boolean) => (
    <div className="space-y-0">
      {/* Title */}
      <div className="space-y-1.5 mb-4">
        <label className="text-xs font-medium text-muted-foreground">Título *</label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isCreating && formData.title.trim()) {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Título descriptivo de la historia"
          className="text-sm"
          autoFocus={autoFocusTitle}
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

      {/* Section tabs */}
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
          {renderPOTab()}
        </TabsContent>
        <TabsContent value="technical" className="mt-4">
          {renderTechnicalTab()}
        </TabsContent>
        <TabsContent value="qa" className="mt-4">
          {renderQATab()}
        </TabsContent>
      </Tabs>
    </div>
  );

  // --- Read-only view sections ---
  // En v2 cada sección es un único string markdown — renderizamos directo
  // como markdown via ReadOnlyMarkdown (que parsea y muestra con la misma
  // tipografía que el editor). Sin reconstruir sub-secciones desde campos
  // discretos.

  const renderPOView = (story: UserStory) => (
    <div className="space-y-2 prose prose-sm dark:prose-invert max-w-none">
      {story.po.markdown ? (
        <ReadOnlyMarkdown content={story.po.markdown} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin definición de negocio</p>
      )}
    </div>
  );

  const renderTechnicalView = (story: UserStory) => (
    <div className="space-y-2 prose prose-sm dark:prose-invert max-w-none">
      {story.technical.markdown ? (
        <ReadOnlyMarkdown content={story.technical.markdown} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin definición técnica</p>
      )}
    </div>
  );

  const renderQAView = (story: UserStory) => (
    <div className="space-y-2 prose prose-sm dark:prose-invert max-w-none">
      {story.qa.markdown ? (
        <ReadOnlyMarkdown content={story.qa.markdown} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin estrategia de testing definida</p>
      )}
    </div>
  );

  // --- Main render ---

  return (
    <div className="space-y-3">
      {/* Header con counter, action bar de bulk select y CTAs */}
      <div className="flex items-center justify-between gap-3">
        {selectedIds.size > 0 ? (
          // Action bar de bulk select reemplaza el counter cuando hay
          // selección. Mantenemos los CTAs deshabilitados (no quieres crear
          // mientras estás eligiendo qué borrar).
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">
              {selectedIds.size} {selectedIds.size === 1 ? 'historia seleccionada' : 'historias seleccionadas'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBulkDeleteOpen(true)}
              className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar {selectedIds.size}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {stories.length} {stories.length === 1 ? 'historia' : 'historias'} ·{' '}
              {stories.reduce((sum, s) => sum + s.storyPoints, 0)} SP
            </span>
            {stories.length > 0 && !isCreating && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <label className="flex items-center gap-2 cursor-pointer select-none hover:text-foreground transition-colors">
                  <RoundCheckbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Seleccionar todas las historias"
                  />
                  <span className="text-xs">
                    {allSelected
                      ? 'Todas seleccionadas'
                      : someSelected
                        ? 'Selección parcial'
                        : 'Seleccionar todo'}
                  </span>
                </label>
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {onGenerateWithAI && (
            <Button
              size="sm"
              variant="outline"
              onClick={onGenerateWithAI}
              disabled={isCreating || selectedIds.size > 0}
              className="gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Crear con IA
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={startCreating}
            disabled={isCreating || selectedIds.size > 0}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar historia
          </Button>
        </div>
      </div>

      {/* Story list — hidden during creation to focus on the form */}
      {!isCreating && <div className="space-y-2">
        {stories.map((story) => {
          const isEditing = editingStoryId === story.id;
          const isExpanded = expandedStoryId === story.id;
          const isSelected = selectedIds.has(story.id);
          return (
            <div
              key={story.id}
              className={`rounded-lg border transition-colors ${
                isEditing
                  ? 'border-primary/50 bg-muted/20'
                  : isSelected
                    ? 'border-primary/40 bg-primary/5'
                    : 'hover:bg-muted/30'
              }`}
            >
              {/* Row summary */}
              <div
                className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer"
                onClick={() => {
                  if (!isEditing) {
                    router.push(`/proyectos/historias/${story.id}`);
                  }
                }}
              >
                {/* Checkbox de selección — stopPropagation para que el click
                    NO navegue al detalle de la story. */}
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RoundCheckbox
                    checked={isSelected}
                    onCheckedChange={(checked) => toggleSelect(story.id, checked === true)}
                    aria-label={`Seleccionar historia ${story.title}`}
                  />
                </div>
                <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                  {story.tracker?.externalKey ?? getShortId(story.id)}
                </span>
                <span className="truncate flex-1">{story.title}</span>
                <StoryPointsBadge points={story.storyPoints} />
                <StatusBadge status={story.status} />
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
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
                    {isEditing ? (
                      <X className="h-3.5 w-3.5" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(story.id);
                    }}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                    title="Eliminar historia"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>

              {/* Expanded read-only view */}
              {isExpanded && !isEditing && (
                <div className="px-4 pb-4 border-t mx-4 pt-3">
                  {/* Meta */}
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                    {pods.find((p) => p.id === story.podId) && (
                      <span>
                        Pod:{' '}
                        <span className="text-foreground">
                          {pods.find((p) => p.id === story.podId)!.name}
                        </span>
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
                  {renderStoryForm(false)}
                  <div className="flex justify-end gap-2 mt-4">
                    <Button size="sm" variant="ghost" onClick={cancelEditing}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveEditing}
                      disabled={!formData.title.trim()}
                      className="gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Guardar cambios
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>}

      {/* Empty state */}
      {stories.length === 0 && !isCreating && (
        <div className="rounded-xl border-2 border-dashed py-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">No hay historias de usuario</p>
          <Button size="sm" variant="outline" onClick={startCreating} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Crear primera historia
          </Button>
        </div>
      )}

      {/* Inline creation row — Notion-style */}
      {isCreating && (
        <div
          ref={createFormRef}
          className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/[0.02] animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Inline header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-5 w-5 rounded bg-primary/10">
                <Plus className="h-3 w-3 text-primary" />
              </div>
              <span className="text-xs font-semibold text-foreground">Nueva Historia</span>
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                Sin clave
              </span>
            </div>
            <button
              type="button"
              onClick={cancelCreating}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Cancelar creación"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Form body */}
          <div className="px-4 pb-4">
            {renderStoryForm(true)}
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <p className="text-[10px] text-muted-foreground">
                Esc para cancelar · Enter en título para crear
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelCreating}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!formData.title.trim()}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Crear historia
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal type-to-confirm para borrar historia ── */}
      {storyToDelete && (
        <TypeToConfirmDialog
          open={!!deleteConfirmId}
          onOpenChange={(open) => {
            if (!open) setDeleteConfirmId(null);
          }}
          title="Eliminar historia"
          resourceLabel="historia"
          expectedValue={storyToDelete.title}
          description="Esto eliminará la historia junto con su carpeta del vault (definicion-negocio.md, definicion-tecnica.md, testing-strategy.md, documentos-epica/, dependencias/). La acción es permanente y no se puede deshacer."
          confirmText="Eliminar historia"
          onConfirm={async () => {
            const id = storyToDelete.id;
            onDeleteStory(id);
            setDeleteConfirmId(null);
            if (editingStoryId === id) setEditingStoryId(null);
            if (expandedStoryId === id) setExpandedStoryId(null);
          }}
        />
      )}

      {/* ── Modal type-to-confirm para borrar múltiples historias ──
          Reusa el mismo componente que el delete individual con
          `expectedValue="ELIMINAR"` (palabra constante, no nombres
          individuales — escribir N nombres es UX absurda). La fricción
          consciente sigue siendo real: el botón destructive solo se
          habilita cuando el user escribe "ELIMINAR" exactamente. */}
      <TypeToConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Eliminar ${selectedIds.size} ${selectedIds.size === 1 ? 'historia' : 'historias'}`}
        resourceLabel="historias"
        expectedValue="ELIMINAR"
        confirmLabel={
          <>Para confirmar, escribe <span className="font-mono font-semibold text-foreground">ELIMINAR</span></>
        }
        hideExpectedValueBlock
        description="Cada historia se eliminará junto con su carpeta del vault. La acción es permanente y no se puede deshacer."
        confirmText="Eliminar"
        extraContent={
          <div className="max-h-32 overflow-y-auto rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs space-y-0.5">
            {stories
              .filter((s) => selectedIds.has(s.id))
              .map((s) => (
                <div key={s.id} className="truncate text-foreground/80">
                  <span className="text-muted-foreground/60">·</span> {s.title}
                </div>
              ))}
          </div>
        }
        onConfirm={async () => {
          handleBulkDelete();
        }}
      />
    </div>
  );
}
