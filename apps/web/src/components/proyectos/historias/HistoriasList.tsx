'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useProyectos } from '@/context/ProyectosContext';
import { updateStory as apiUpdateStory, deleteStory as apiDeleteStory } from '@/lib/api/stories';
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
import { DownloadMenu } from '../shared/DownloadMenu';
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

const emptyPO: StoryPOFields = {
  background: '',
  objective: '',
  userStory: '',
  whatHowWhen: { what: '', how: '', when: '' },
  acceptanceCriteria: [''],
  additionalNotes: '',
};

const emptyTechnical: StoryTechnicalFields = {
  architecture: '',
  integrationFlow: '',
  validations: [''],
  errorHandling: [''],
  implementationChecklist: [''],
};

const emptyQA: StoryQAFields = {
  testingStrategy: '',
  linkedQAMatrixId: null,
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

  // --- Edit ---

  const startEditing = useCallback((story: UserStory) => {
    setEditingStoryId(story.id);
    setExpandedStoryId(story.id);
    setFormTab('po');
    setFormData({
      title: story.title,
      storyPoints: story.storyPoints,
      status: story.status,
      podId: story.podId,
      labels: [...story.labels],
      po: {
        ...story.po,
        acceptanceCriteria:
          story.po.acceptanceCriteria.length > 0 ? [...story.po.acceptanceCriteria] : [''],
      },
      technical: {
        ...story.technical,
        validations: story.technical.validations.length > 0 ? [...story.technical.validations] : [''],
        errorHandling:
          story.technical.errorHandling.length > 0 ? [...story.technical.errorHandling] : [''],
        implementationChecklist:
          story.technical.implementationChecklist.length > 0
            ? [...story.technical.implementationChecklist]
            : [''],
      },
      qa: { ...story.qa },
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingStoryId(null);
  }, []);

  const saveEditing = useCallback(async () => {
    if (!editingStoryId || !formData.title.trim()) return;

    const cleanedPO = {
      ...formData.po,
      acceptanceCriteria: formData.po.acceptanceCriteria.filter((c: string) => c.trim()),
    };
    const cleanedTechnical = {
      ...formData.technical,
      validations: formData.technical.validations.filter((v: string) => v.trim()),
      errorHandling: formData.technical.errorHandling.filter((e: string) => e.trim()),
      implementationChecklist: formData.technical.implementationChecklist.filter((c: string) => c.trim()),
    };

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
      await apiUpdateStory(editingStoryId, {
        title: formData.title.trim(),
        status: formData.status as string,
        storyPoints: formData.storyPoints,
        podId: formData.podId,
        labels: formData.labels,
        po: poForApi,
        technical: cleanedTechnical,
        qa: {
          testingStrategy: formData.qa.testingStrategy,
          linkedQAMatrixId: formData.qa.linkedQAMatrixId ?? undefined,
        },
      });

      dispatch({
        type: 'UPDATE_STORY',
        payload: {
          id: editingStoryId,
          changes: {
            title: formData.title.trim(),
            description: formData.po.userStory.trim(),
            storyPoints: formData.storyPoints,
            status: formData.status,
            podId: formData.podId,
            labels: formData.labels,
            po: cleanedPO,
            technical: cleanedTechnical,
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

  const renderPOTab = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Antecedentes</label>
        <textarea
          value={formData.po.background}
          onChange={(e) => updatePO({ background: e.target.value })}
          placeholder="Contexto e información previa relevante para esta historia..."
          rows={2}
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Objetivo</label>
        <textarea
          value={formData.po.objective}
          onChange={(e) => updatePO({ objective: e.target.value })}
          placeholder="¿Qué se busca lograr con esta historia?"
          rows={2}
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Historia de Usuario</label>
        <textarea
          value={formData.po.userStory}
          onChange={(e) => updatePO({ userStory: e.target.value })}
          placeholder="Como [tipo de usuario], quiero [acción] para [beneficio]..."
          rows={2}
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">What / How / When</label>
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={formData.po.whatHowWhen.what}
            onChange={(e) =>
              updatePO({ whatHowWhen: { ...formData.po.whatHowWhen, what: e.target.value } })
            }
            placeholder="What — ¿Qué?"
            className="text-sm"
          />
          <Input
            value={formData.po.whatHowWhen.how}
            onChange={(e) =>
              updatePO({ whatHowWhen: { ...formData.po.whatHowWhen, how: e.target.value } })
            }
            placeholder="How — ¿Cómo?"
            className="text-sm"
          />
          <Input
            value={formData.po.whatHowWhen.when}
            onChange={(e) =>
              updatePO({ whatHowWhen: { ...formData.po.whatHowWhen, when: e.target.value } })
            }
            placeholder="When — ¿Cuándo?"
            className="text-sm"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Criterios de Aceptación</label>
        <ListEditor
          items={formData.po.acceptanceCriteria}
          onChange={(items) => updatePO({ acceptanceCriteria: items })}
          placeholder="Dado que... Cuando... Entonces..."
          label="Agregar criterio"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Notas Adicionales <span className="font-normal">(opcional)</span>
        </label>
        <textarea
          value={formData.po.additionalNotes}
          onChange={(e) => updatePO({ additionalNotes: e.target.value })}
          placeholder="Dependencias, restricciones, consideraciones extra..."
          rows={2}
          className={inputCls}
        />
      </div>
    </div>
  );

  const renderTechnicalTab = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Arquitectura y Componentes</label>
        <textarea
          value={formData.technical.architecture}
          onChange={(e) => updateTechnical({ architecture: e.target.value })}
          placeholder="Componentes involucrados, servicios, bases de datos..."
          rows={3}
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Flujo de Integración Propuesto
        </label>
        <textarea
          value={formData.technical.integrationFlow}
          onChange={(e) => updateTechnical({ integrationFlow: e.target.value })}
          placeholder="Secuencia de llamadas, APIs involucradas, flujo de datos..."
          rows={3}
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Validaciones Requeridas</label>
        <ListEditor
          items={formData.technical.validations}
          onChange={(items) => updateTechnical({ validations: items })}
          placeholder="Validación de entrada, reglas de negocio..."
          label="Agregar validación"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Manejo de Errores</label>
        <ListEditor
          items={formData.technical.errorHandling}
          onChange={(items) => updateTechnical({ errorHandling: items })}
          placeholder="Escenario de error y estrategia de manejo..."
          label="Agregar escenario"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Checklist de Implementación
        </label>
        <ListEditor
          items={formData.technical.implementationChecklist}
          onChange={(items) => updateTechnical({ implementationChecklist: items })}
          placeholder="Paso de implementación..."
          label="Agregar paso"
        />
      </div>
    </div>
  );

  const renderQATab = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Testing Strategy</label>
        <textarea
          value={formData.qa.testingStrategy}
          onChange={(e) => updateQA({ testingStrategy: e.target.value })}
          placeholder="Estrategia de pruebas: unitarias, integración, E2E, performance..."
          rows={4}
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

  // --- Read-only views ---

  const renderPOView = (story: UserStory) => (
    <div className="space-y-3">
      {story.po.background && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Antecedentes</p>
          <p className="text-sm text-foreground/80">{story.po.background}</p>
        </div>
      )}
      {story.po.objective && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Objetivo</p>
          <p className="text-sm text-foreground/80">{story.po.objective}</p>
        </div>
      )}
      {story.po.userStory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Historia de Usuario</p>
          <p className="text-sm text-foreground/80">{story.po.userStory}</p>
        </div>
      )}
      {(story.po.whatHowWhen.what || story.po.whatHowWhen.how || story.po.whatHowWhen.when) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">What / How / When</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-muted/30 p-2">
              <span className="text-muted-foreground">What: </span>
              <span className="text-foreground/80">{story.po.whatHowWhen.what || '—'}</span>
            </div>
            <div className="rounded-lg bg-muted/30 p-2">
              <span className="text-muted-foreground">How: </span>
              <span className="text-foreground/80">{story.po.whatHowWhen.how || '—'}</span>
            </div>
            <div className="rounded-lg bg-muted/30 p-2">
              <span className="text-muted-foreground">When: </span>
              <span className="text-foreground/80">{story.po.whatHowWhen.when || '—'}</span>
            </div>
          </div>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Criterios de Aceptación</p>
        <ReadOnlyList items={story.po.acceptanceCriteria} emptyText="Sin criterios definidos" />
      </div>
      {story.po.additionalNotes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Notas Adicionales</p>
          <p className="text-sm text-foreground/80">{story.po.additionalNotes}</p>
        </div>
      )}
    </div>
  );

  const renderTechnicalView = (story: UserStory) => (
    <div className="space-y-3">
      {story.technical.architecture && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Arquitectura y Componentes</p>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{story.technical.architecture}</p>
        </div>
      )}
      {story.technical.integrationFlow && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Flujo de Integración</p>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{story.technical.integrationFlow}</p>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Validaciones Requeridas</p>
        <ReadOnlyList items={story.technical.validations} emptyText="Sin validaciones definidas" />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Manejo de Errores</p>
        <ReadOnlyList items={story.technical.errorHandling} emptyText="Sin escenarios definidos" />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Checklist de Implementación</p>
        <ReadOnlyList items={story.technical.implementationChecklist} emptyText="Sin checklist definido" />
      </div>
    </div>
  );

  const renderQAView = (story: UserStory) => {
    const epic = state.epics.find((e) => e.id === story.epicId);
    const qaRow = epic?.qaMatrix?.rows.find((r) => r.storyId === story.id);
    return (
      <div className="space-y-3">
        {story.qa.testingStrategy ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Testing Strategy</p>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">{story.qa.testingStrategy}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Sin estrategia de testing definida</p>
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
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? 'historia' : 'historias'}
        </span>
        <DownloadMenu
          entity={{ kind: 'stories-list', stories: sorted }}
          variant="button"
        />
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
                    {story.tracker?.externalKey ? (
                      <span className="font-mono text-xs text-muted-foreground">{story.tracker.externalKey}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">{'\u2014'}</span>
                    )}
                  </div>
                  <span className="truncate font-medium">{story.title}</span>
                  <span className="text-xs text-muted-foreground truncate">{epic?.title}</span>
                  <div>{pod && <PodBadge name={pod.name} color={pod.color} />}</div>
                  <div><StatusBadge status={story.status} /></div>
                  <div><StoryPointsBadge points={story.storyPoints} /></div>
                  <span className="text-xs text-muted-foreground">{sprint?.name ?? '\u2014'}</span>
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
