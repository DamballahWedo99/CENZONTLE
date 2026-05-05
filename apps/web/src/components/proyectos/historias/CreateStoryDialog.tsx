'use client';

import { useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useProyectos } from '@/context/ProyectosContext';
import { StoryStatus, UserStory } from '@cenzontle/shared';
import { createStory as apiCreateStory } from '@/lib/api/stories';

const storySchema = z.object({
  title: z.string().min(1, 'El título es obligatorio').max(200, 'Máximo 200 caracteres'),
  epicId: z.string().min(1, 'Selecciona una épica'),
  podId: z.string().min(1, 'Selecciona una célula'),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof storySchema>, string>>;

interface CreateStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEpicId?: string;
}

const FIBONACCI = [1, 2, 3, 5, 8, 13];

export function CreateStoryDialog({ open, onOpenChange, defaultEpicId }: CreateStoryDialogProps) {
  const { state, dispatch } = useProyectos();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [epicId, setEpicId] = useState(defaultEpicId ?? '');
  const [podId, setPodId] = useState('');
  const [storyPoints, setStoryPoints] = useState('3');
  const [sprintId, setSprintId] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Filter sprints by selected pod
  const availableSprints = podId
    ? state.sprints.filter((s) => s.podId === podId)
    : state.sprints;

  // Pods available for the selected epic
  const selectedEpic = state.epics.find((e) => e.id === epicId);
  const availablePods = selectedEpic
    ? state.pods.filter((p) => selectedEpic.podIds.includes(p.id))
    : state.pods;

  const handleSubmit = async () => {
    const result = storySchema.safeParse({ title: title.trim(), epicId, podId });
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSaving(true);
    // Loader pendiente — se reemplaza por success/error con el mismo
    // `toastId` cuando termina la operación, evitando que queden 2 toasts
    // simultáneos en pantalla.
    const toastId = toast.loading(`Guardando historia "${title.trim()}"…`);
    try {
      // El backend persiste 3 markdowns (po/technical/qa). El user llenará
      // los detalles en la story page; aquí solo armamos el PO mínimo con la
      // historia de usuario, los headings canónicos van vacíos para que el
      // user los complete o el agente IA los regenere.
      const initialPOMarkdown = [
        '## Antecedentes',
        '',
        '## Objetivo',
        '',
        '## Historia de usuario',
        '',
        description.trim(),
        '',
        '## What/How/When',
        '',
        '## Criterios de aceptación',
        '',
        '## Notas adicionales',
        '',
      ].join('\n');
      const created = await apiCreateStory({
        title: title.trim(),
        epicId,
        podId,
        status: StoryStatus.Backlog,
        storyPoints: Number(storyPoints),
        sprintId: sprintId || undefined,
        labels: [],
        po: { markdown: initialPOMarkdown },
        technical: { markdown: '' },
        qa: { markdown: '' },
      });

      // Add to local state for instant UI feedback
      const newStory: UserStory = {
        id: created.id,
        title: created.title,
        description: description.trim(),
        status: created.status as StoryStatus,
        storyPoints: created.storyPoints as 1 | 2 | 3 | 5 | 8 | 13,
        epicId: created.epicId,
        podId: created.podId,
        sprintId: created.sprintId,
        labels: [],
        po: { markdown: initialPOMarkdown },
        technical: { markdown: '' },
        qa: { markdown: '' },
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      } as UserStory;

      dispatch({ type: 'CREATE_STORY', payload: newStory });

      toast.success('Historia creada correctamente', { id: toastId });
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Error al crear la historia', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setEpicId(defaultEpicId ?? '');
    setPodId('');
    setStoryPoints('3');
    setSprintId('');
    setErrors({});
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva Historia de Usuario</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Título</label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors((p) => ({ ...p, title: undefined })); }}
              placeholder="Como usuario quiero..."
              aria-invalid={!!errors.title}
              autoFocus
            />
            {errors.title && <p className="text-xs text-destructive mt-1">{errors.title}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe la historia de usuario..."
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Épica</label>
              <Select value={epicId} onValueChange={(v) => { setEpicId(v); setPodId(''); setErrors((p) => ({ ...p, epicId: undefined })); }}>
                <SelectTrigger className="w-full" aria-invalid={!!errors.epicId}>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {state.epics.map((epic) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.epicId && <p className="text-xs text-destructive mt-1">{errors.epicId}</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Célula</label>
              <Select value={podId} onValueChange={(v) => { setPodId(v); setSprintId(''); setErrors((p) => ({ ...p, podId: undefined })); }}>
                <SelectTrigger className="w-full" aria-invalid={!!errors.podId}>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {availablePods.map((pod) => (
                    <SelectItem key={pod.id} value={pod.id}>
                      {pod.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.podId && <p className="text-xs text-destructive mt-1">{errors.podId}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Story Points</label>
              <Select value={storyPoints} onValueChange={setStoryPoints}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIBONACCI.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Sprint</label>
              <Select value={sprintId} onValueChange={setSprintId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {availableSprints.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Crear Historia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
