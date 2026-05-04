'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useProyectos, mapEpic } from '@/context/ProyectosContext';
import { EpicStatus, Priority } from '@cenzontle/shared';
import { createEpic as apiCreateEpic } from '@/lib/api/epics';
import { SectionTiptapEditor } from '../historias/editor/SectionTiptapEditor';

// Estructura mínima sugerida — coincide con EpicFullPage y InlineEpicCreator.
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

interface CreateEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateEpicDialog({ open, onOpenChange }: CreateEpicDialogProps) {
  const { state, dispatch } = useProyectos();

  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [initiativeId, setInitiativeId] = useState('');
  const [priority, setPriority] = useState<Priority>(Priority.Medium);
  const [selectedPodIds, setSelectedPodIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [showDefinition, setShowDefinition] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // El backend requiere startDate y targetDate como ISO strings — no pueden estar vacíos.
  const canSubmit =
    title.trim() &&
    initiativeId &&
    selectedPodIds.length > 0 &&
    startDate &&
    targetDate &&
    !isSubmitting;

  const handleTogglePod = (podId: string) => {
    setSelectedPodIds((prev) =>
      prev.includes(podId) ? prev.filter((id) => id !== podId) : [...prev, podId]
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      // El backend genera el UUID y el vaultPath — no los mandamos.
      const created = await apiCreateEpic({
        title: title.trim(),
        markdown: markdown.trim(),
        status: EpicStatus.Draft,
        priority,
        startDate,
        targetDate,
        initiativeId,
        podIds: selectedPodIds,
      });

      // Sincronizar el state local con el objeto real que devolvió el backend
      // (tiene el UUID real, timestamps reales, vaultPath, etc.)
      dispatch({ type: 'CREATE_EPIC', payload: mapEpic(created) });
      toast.success('Épica creada');
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Error al crear la épica');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setMarkdown('');
    setInitiativeId('');
    setPriority(Priority.Medium);
    setSelectedPodIds([]);
    setStartDate('');
    setTargetDate('');
    setShowDefinition(false);
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Épica</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Title */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Título</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nombre de la épica"
              autoFocus
            />
          </div>

          {/* Initiative + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Iniciativa</label>
              <Select value={initiativeId} onValueChange={setInitiativeId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {state.initiatives.map((init) => (
                    <SelectItem key={init.id} value={init.id}>
                      {init.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Prioridad</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Priority).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* PODs */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Células asignadas</label>
            <div className="space-y-2">
              {state.pods.map((pod) => (
                <label
                  key={pod.id}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={selectedPodIds.includes(pod.id)}
                    onCheckedChange={() => handleTogglePod(pod.id)}
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: pod.color }}
                  />
                  <span className="text-sm">{pod.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha inicio</label>
              <DatePicker value={startDate} onChange={setStartDate} maxDate={targetDate || undefined} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha objetivo</label>
              <DatePicker value={targetDate} onChange={setTargetDate} minDate={startDate || undefined} />
            </div>
          </div>

          {/* Markdown definition (collapsible, optional) */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowDefinition(!showDefinition)}
              className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <span>{showDefinition ? '▾' : '▸'}</span>
              Definición de la Épica
              <span className="text-xs font-normal">(opcional · markdown)</span>
            </button>

            {showDefinition && (
              <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-150">
                <SectionTiptapEditor
                  initialMarkdown={markdown && markdown.trim().length > 0 ? markdown : EPIC_MARKDOWN_PLACEHOLDER}
                  onChange={setMarkdown}
                  variant="paragraph"
                  placeholder="Escribe la definición de la épica en markdown..."
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {isSubmitting ? 'Creando...' : 'Crear Épica'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
