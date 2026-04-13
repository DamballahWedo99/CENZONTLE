'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Epic, EpicStatus, Priority, Pod } from '@cenzontle/shared';
import { createEpic as apiCreateEpic } from '@/lib/api/epics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Target,
  Ruler,
  Cpu,
  Zap,
  Loader2,
} from 'lucide-react';

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
  description: z.string().min(1, 'La descripción es obligatoria'),
  selectedPodIds: z.array(z.string()).min(1, 'Selecciona al menos una célula'),
  startDate: z.string().min(1, 'La fecha de inicio es obligatoria'),
  targetDate: z.string().min(1, 'La fecha objetivo es obligatoria'),
});

type EpicFieldErrors = Partial<Record<keyof z.infer<typeof epicSchema>, string>>;

// --- Textarea class ---

const inputCls =
  'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground';

// --- Form state ---

interface EpicFormData {
  title: string;
  description: string;
  priority: Priority;
  status: EpicStatus;
  selectedPodIds: string[];
  startDate: string;
  targetDate: string;
  // Definition fields
  qualitativeBenefits: string;
  quantitativeBenefits: string;
  benefitsMeasurement: string;
  scopeDescription: string;
  acceptanceCriteria: string;
  technologicalImprovements: string;
  businessPriority: string;
  teamsInvolved: string;
  impactedChannels: string;
  impactedFlows: string;
  impactSabreLevel: string;
  thirdPartyDependencies: string;
}

const emptyForm: EpicFormData = {
  title: '',
  description: '',
  priority: Priority.Medium,
  status: EpicStatus.Draft,
  selectedPodIds: [],
  startDate: '',
  targetDate: '',
  qualitativeBenefits: '',
  quantitativeBenefits: '',
  benefitsMeasurement: '',
  scopeDescription: '',
  acceptanceCriteria: '',
  technologicalImprovements: '',
  businessPriority: '',
  teamsInvolved: '',
  impactedChannels: '',
  impactedFlows: '',
  impactSabreLevel: '',
  thirdPartyDependencies: '',
};

// --- Component ---

interface InlineEpicCreatorProps {
  initiativeId: string;
  pods: Pod[];
  existingEpicCount: number;
  onCreateEpic: (epic: Epic) => void;
  onCancel: () => void;
}

export function InlineEpicCreator({
  initiativeId,
  pods,
  existingEpicCount,
  onCreateEpic,
  onCancel,
}: InlineEpicCreatorProps) {
  const [formData, setFormData] = useState<EpicFormData>(emptyForm);
  const [formTab, setFormTab] = useState<string>('benefits');
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
      description: formData.description.trim(),
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
        description: formData.description.trim(),
        status: formData.status as string,
        priority: formData.priority as string,
        initiativeId,
        podIds: formData.selectedPodIds,
        startDate: formData.startDate,
        targetDate: formData.targetDate,
      });

      const now = new Date().toISOString();
      const newEpic: Epic = {
        id: created.id,
        title: created.title,
        description: created.description,
        qualitativeBenefits: formData.qualitativeBenefits.trim(),
        quantitativeBenefits: formData.quantitativeBenefits.trim(),
        benefitsMeasurement: formData.benefitsMeasurement.trim(),
        scopeDescription: formData.scopeDescription.trim(),
        acceptanceCriteria: formData.acceptanceCriteria.trim(),
        technologicalImprovements: formData.technologicalImprovements.trim(),
        businessPriority: formData.businessPriority.trim(),
        teamsInvolved: formData.teamsInvolved.trim(),
        impactedChannels: formData.impactedChannels.trim(),
        impactedFlows: formData.impactedFlows.trim(),
        impactSabreLevel: formData.impactSabreLevel.trim(),
        thirdPartyDependencies: formData.thirdPartyDependencies.trim(),
        documents: [],
        diagrams: [],
        dependencies: [],
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

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Descripción</label>
          <textarea
            value={formData.description}
            onChange={(e) => { setFormData((prev) => ({ ...prev, description: e.target.value })); setErrors((p) => ({ ...p, description: undefined })); }}
            placeholder="Describe el alcance y objetivo de esta épica..."
            rows={2}
            className={`${inputCls}${errors.description ? ' border-destructive' : ''}`}
          />
          {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
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
            <Input
              type="date"
              value={formData.startDate}
              onChange={(e) => { setFormData((prev) => ({ ...prev, startDate: e.target.value })); setErrors((p) => ({ ...p, startDate: undefined })); }}
              className="text-sm"
              aria-invalid={!!errors.startDate}
            />
            {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fecha objetivo *</label>
            <Input
              type="date"
              value={formData.targetDate}
              onChange={(e) => { setFormData((prev) => ({ ...prev, targetDate: e.target.value })); setErrors((p) => ({ ...p, targetDate: undefined })); }}
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

        {/* Collapsible definition section */}
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
            <span className="text-[10px] font-normal">(opcional)</span>
          </button>

          {showDefinition && (
            <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-150">
              <Tabs value={formTab} onValueChange={setFormTab}>
                <TabsList className="w-full grid grid-cols-4">
                  <TabsTrigger value="benefits" className="gap-1 text-xs">
                    <Target className="h-3 w-3" />
                    Beneficios
                  </TabsTrigger>
                  <TabsTrigger value="scope" className="gap-1 text-xs">
                    <Ruler className="h-3 w-3" />
                    Alcance
                  </TabsTrigger>
                  <TabsTrigger value="technical" className="gap-1 text-xs">
                    <Cpu className="h-3 w-3" />
                    Técnico
                  </TabsTrigger>
                  <TabsTrigger value="impact" className="gap-1 text-xs">
                    <Zap className="h-3 w-3" />
                    Impacto
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="benefits" className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Beneficios Cualitativos</label>
                    <textarea
                      value={formData.qualitativeBenefits}
                      onChange={(e) => setFormData((prev) => ({ ...prev, qualitativeBenefits: e.target.value }))}
                      rows={2}
                      placeholder="Beneficios cualitativos esperados..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Beneficios Cuantitativos</label>
                    <textarea
                      value={formData.quantitativeBenefits}
                      onChange={(e) => setFormData((prev) => ({ ...prev, quantitativeBenefits: e.target.value }))}
                      rows={2}
                      placeholder="Métricas y beneficios cuantitativos..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Medición de Beneficios</label>
                    <textarea
                      value={formData.benefitsMeasurement}
                      onChange={(e) => setFormData((prev) => ({ ...prev, benefitsMeasurement: e.target.value }))}
                      rows={2}
                      placeholder="¿Cómo se medirán los beneficios?"
                      className={inputCls}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="scope" className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Descripción del Alcance</label>
                    <textarea
                      value={formData.scopeDescription}
                      onChange={(e) => setFormData((prev) => ({ ...prev, scopeDescription: e.target.value }))}
                      rows={3}
                      placeholder="Describe el alcance detallado de la épica..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Criterios de Aceptación</label>
                    <textarea
                      value={formData.acceptanceCriteria}
                      onChange={(e) => setFormData((prev) => ({ ...prev, acceptanceCriteria: e.target.value }))}
                      rows={3}
                      placeholder="Criterios que deben cumplirse para considerar la épica completada..."
                      className={inputCls}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="technical" className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Mejoras Tecnológicas</label>
                    <textarea
                      value={formData.technologicalImprovements}
                      onChange={(e) => setFormData((prev) => ({ ...prev, technologicalImprovements: e.target.value }))}
                      rows={2}
                      placeholder="Mejoras tecnológicas incluidas..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Prioridad de Negocio</label>
                    <textarea
                      value={formData.businessPriority}
                      onChange={(e) => setFormData((prev) => ({ ...prev, businessPriority: e.target.value }))}
                      rows={2}
                      placeholder="Prioridad y justificación de negocio..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Equipos Involucrados</label>
                    <textarea
                      value={formData.teamsInvolved}
                      onChange={(e) => setFormData((prev) => ({ ...prev, teamsInvolved: e.target.value }))}
                      rows={2}
                      placeholder="Equipos que participarán..."
                      className={inputCls}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="impact" className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Canales Impactados</label>
                    <textarea
                      value={formData.impactedChannels}
                      onChange={(e) => setFormData((prev) => ({ ...prev, impactedChannels: e.target.value }))}
                      rows={2}
                      placeholder="Canales que serán afectados..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Flujos Impactados</label>
                    <textarea
                      value={formData.impactedFlows}
                      onChange={(e) => setFormData((prev) => ({ ...prev, impactedFlows: e.target.value }))}
                      rows={2}
                      placeholder="Flujos de negocio que serán afectados..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Nivel de Impacto en Sabre</label>
                    <textarea
                      value={formData.impactSabreLevel}
                      onChange={(e) => setFormData((prev) => ({ ...prev, impactSabreLevel: e.target.value }))}
                      rows={2}
                      placeholder="Impacto a nivel de Sabre..."
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Dependencias de Terceros</label>
                    <textarea
                      value={formData.thirdPartyDependencies}
                      onChange={(e) => setFormData((prev) => ({ ...prev, thirdPartyDependencies: e.target.value }))}
                      rows={2}
                      placeholder="Dependencias externas o de terceros..."
                      className={inputCls}
                    />
                  </div>
                </TabsContent>
              </Tabs>
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
