'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Epic, EpicStatus, Priority, Pod } from '@cenzontle/shared';
import { createEpic as apiCreateEpic } from '@/lib/api/epics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { SectionTiptapEditor } from '../historias/editor/SectionTiptapEditor';

// --- Labels ---

const epicStatusLabels: Record<EpicStatus, string> = {
  [EpicStatus.Draft]: 'Borrador',
  [EpicStatus.InProgress]: 'En progreso',
  [EpicStatus.Done]: 'Completada',
  [EpicStatus.Blocked]: 'Bloqueada',
};

const priorityLabels: Record<Priority, string> = {
  [Priority.Critical]: 'Crítica',
  [Priority.High]: 'Alta',
  [Priority.Medium]: 'Media',
  [Priority.Low]: 'Baja',
};

const epicSchema = z.object({
  title: z.string().min(1, 'El título es obligatorio').max(200, 'Máximo 200 caracteres'),
  selectedPodIds: z.array(z.string()).min(1, 'Selecciona al menos una célula'),
  startDate: z.string().min(1, 'La fecha de inicio es obligatoria'),
  targetDate: z.string().min(1, 'La fecha objetivo es obligatoria'),
});

type EpicFieldErrors = Partial<Record<keyof z.infer<typeof epicSchema>, string>>;

// --- Markdown placeholder ---
// Estructura mínima sugerida: 9 headings level-2 obligatorios. Coincide con
// el placeholder del editor en EpicFullPage y con el prompt del agente IA.
const EPIC_MARKDOWN_PLACEHOLDER = `## Descripción

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

// --- Form state ---

export interface EpicFormData {
  title: string;
  /** Markdown único de la épica con los 9 headings obligatorios. */
  markdown: string;
  priority: Priority;
  status: EpicStatus;
  selectedPodIds: string[];
  startDate: string;
  targetDate: string;
}

const emptyForm: EpicFormData = {
  title: '',
  markdown: '',
  priority: Priority.Medium,
  status: EpicStatus.Draft,
  selectedPodIds: [],
  startDate: '',
  targetDate: '',
};

// --- Component ---

interface InlineEpicCreatorProps {
  initiativeId: string;
  pods: Pod[];
  existingEpicCount: number;
  initialData?: Partial<EpicFormData>;
  onCreateEpic: (epic: Epic) => void;
  onCancel: () => void;
}

export function InlineEpicCreator({
  initiativeId,
  pods,
  existingEpicCount,
  initialData,
  onCreateEpic,
  onCancel,
}: InlineEpicCreatorProps) {
  const [formData, setFormData] = useState<EpicFormData>(() =>
    initialData ? { ...emptyForm, ...initialData } : emptyForm,
  );
  const [showDefinition, setShowDefinition] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<EpicFieldErrors>({});
  const formRef = useRef<HTMLDivElement>(null);

  // tracker is optional — assigned when synced with external tracker
  const _nextTrackerKeyPlaceholder = `GAM-${existingEpicCount + 101}`;

  // Auto-scroll into view
  useEffect(() => {
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleTogglePod = useCallback((podId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedPodIds: prev.selectedPodIds.includes(podId)
        ? prev.selectedPodIds.filter((id) => id !== podId)
        : [...prev.selectedPodIds, podId],
    }));
  }, []);

  const handleCreate = useCallback(async () => {
    const result = epicSchema.safeParse({
      title: formData.title.trim(),
      selectedPodIds: formData.selectedPodIds,
      startDate: formData.startDate,
      targetDate: formData.targetDate,
    });
    if (!result.success) {
      const fieldErrors: EpicFieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof EpicFieldErrors;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const created = await apiCreateEpic({
        title: formData.title.trim(),
        markdown: formData.markdown.trim(),
        status: formData.status as string,
        priority: formData.priority as string,
        initiativeId,
        podIds: formData.selectedPodIds,
        startDate: formData.startDate,
        targetDate: formData.targetDate,
      });

      const newEpic: Epic = {
        id: created.id,
        title: created.title,
        markdown: created.markdown,
        documents: [],
        diagrams: [],
        dependencies: [],
        designs: [],
        designSkipped: false,
        poApproval: null,
        tlApproval: null,
        qaMatrix: null,
        qaApproval: null,
        epicQAMatrix: null,
        status: created.status as EpicStatus,
        priority: created.priority as Priority,
        initiativeId,
        podIds: created.podIds,
        startDate: created.startDate,
        targetDate: created.targetDate,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };

      toast.success('Épica creada correctamente');
      onCreateEpic(newEpic);
    } catch (err: any) {
      toast.error(err.message || 'Error al crear la épica');
    } finally {
      setSaving(false);
    }
  }, [formData, initiativeId, onCreateEpic]);

  const canSubmit = !saving;

  return (
    <div
      ref={formRef}
      className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/[0.02] animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-5 w-5 rounded bg-primary/10">
            <Plus className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs font-semibold text-foreground">Nueva Épica</span>
          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            {_nextTrackerKeyPlaceholder}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Cancelar creación"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Form body */}
      <div className="px-4 pb-4 space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Título *</label>
          <Input
            value={formData.title}
            onChange={(e) => { setFormData((prev) => ({ ...prev, title: e.target.value })); setErrors((p) => ({ ...p, title: undefined })); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Nombre descriptivo de la épica"
            className="text-sm"
            aria-invalid={!!errors.title}
            autoFocus
          />
          {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
        </div>

        {/* Meta fields row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Prioridad</label>
            <Select
              value={formData.priority}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, priority: v as Priority }))}
            >
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(priorityLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Estado</label>
            <Select
              value={formData.status}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, status: v as EpicStatus }))}
            >
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(epicStatusLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fecha inicio *</label>
            <DatePicker
              value={formData.startDate}
              onChange={(v) => { setFormData((prev) => ({ ...prev, startDate: v })); setErrors((p) => ({ ...p, startDate: undefined })); }}
              maxDate={formData.targetDate || undefined}
              className="text-sm"
              aria-invalid={!!errors.startDate}
            />
            {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fecha objetivo *</label>
            <DatePicker
              value={formData.targetDate}
              onChange={(v) => { setFormData((prev) => ({ ...prev, targetDate: v })); setErrors((p) => ({ ...p, targetDate: undefined })); }}
              minDate={formData.startDate || undefined}
              className="text-sm"
              aria-invalid={!!errors.targetDate}
            />
            {errors.targetDate && <p className="text-xs text-destructive">{errors.targetDate}</p>}
          </div>
        </div>

        {/* PODs */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Células asignadas *</label>
          <div className="flex flex-wrap gap-2">
            {pods.map((pod) => (
              <label
                key={pod.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer transition-colors text-sm ${
                  formData.selectedPodIds.includes(pod.id)
                    ? 'border-primary/40 bg-primary/5'
                    : 'hover:bg-muted/30'
                }`}
              >
                <Checkbox
                  checked={formData.selectedPodIds.includes(pod.id)}
                  onCheckedChange={() => handleTogglePod(pod.id)}
                />
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: pod.color }}
                />
                <span className="text-xs">{pod.name}</span>
              </label>
            ))}
          </div>
          {errors.selectedPodIds && <p className="text-xs text-destructive mt-1">{errors.selectedPodIds}</p>}
        </div>

        {/* Markdown único — colapsable opcional */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowDefinition(!showDefinition)}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showDefinition ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Definición de la Épica
            <span className="text-[10px] font-normal">(opcional · markdown)</span>
          </button>

          {showDefinition && (
            <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-150">
              <SectionTiptapEditor
                initialMarkdown={formData.markdown && formData.markdown.trim().length > 0 ? formData.markdown : EPIC_MARKDOWN_PLACEHOLDER}
                onChange={(md) => setFormData((prev) => ({ ...prev, markdown: md }))}
                variant="paragraph"
                placeholder="Escribe la definición de la épica en markdown..."
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t">
          <p className="text-[10px] text-muted-foreground">
            Esc para cancelar · Enter en título para crear
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!canSubmit}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Crear épica
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
