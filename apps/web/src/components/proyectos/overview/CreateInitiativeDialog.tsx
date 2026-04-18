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
import { DatePicker } from '@/components/ui/date-picker';
import { Loader2 } from 'lucide-react';
import { useProyectos } from '@/context/ProyectosContext';
import { useAuthContext } from '@/context/AuthContext';
import { InitiativeStatus } from '@cenzontle/shared';
import { createInitiative } from '@/lib/api/initiatives';
import type { Initiative } from '@cenzontle/shared';

const initiativeSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(200, 'Máximo 200 caracteres'),
  description: z.string().min(1, 'La descripción es obligatoria'),
  owner: z.string().min(1, 'Selecciona un responsable'),
  startDate: z.string().min(1, 'La fecha de inicio es obligatoria'),
  targetDate: z.string().min(1, 'La fecha objetivo es obligatoria'),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof initiativeSchema>, string>>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

interface CreateInitiativeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateInitiativeDialog({ open, onOpenChange }: CreateInitiativeDialogProps) {
  const { state, dispatch } = useProyectos();
  const { members } = useAuthContext();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<InitiativeStatus>(InitiativeStatus.Planning);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const ownerOptions = members.map((m) => ({ id: m.id, name: m.name }));

  const handleSubmit = async () => {
    const result = initiativeSchema.safeParse({
      name: name.trim(),
      description: description.trim(),
      owner,
      startDate,
      targetDate,
    });

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
    try {
      const created = await createInitiative({
        name: name.trim(),
        description: description.trim(),
        status,
        startDate,
        targetDate,
        owner,
      });

      const newInitiative: Initiative = {
        id: created.id,
        name: created.name,
        description: created.description,
        status: created.status as InitiativeStatus,
        startDate: created.startDate,
        targetDate: created.targetDate,
        owner: created.owner,
        epicIds: [],
        documents: [],
      };
      dispatch({ type: 'CREATE_INITIATIVE', payload: newInitiative });

      toast.success('Iniciativa creada correctamente');
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Error al crear la iniciativa');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setOwner('');
    setStatus(InitiativeStatus.Planning);
    setStartDate('');
    setTargetDate('');
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
          <DialogTitle>Nueva Iniciativa</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nombre</label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
              placeholder="Nombre de la iniciativa"
              aria-invalid={!!errors.name}
              autoFocus
            />
            <FieldError message={errors.name} />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: undefined })); }}
              rows={3}
              placeholder="Describe el objetivo de esta iniciativa..."
              aria-invalid={!!errors.description}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground aria-invalid:border-destructive"
            />
            <FieldError message={errors.description} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Responsable</label>
              <Select value={owner} onValueChange={(v) => { setOwner(v); setErrors((p) => ({ ...p, owner: undefined })); }}>
                <SelectTrigger className="w-full" aria-invalid={!!errors.owner}>
                  <SelectValue placeholder="Seleccionar responsable" />
                </SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((o) => (
                    <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.owner} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as InitiativeStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(InitiativeStatus).map(([key, val]) => (
                    <SelectItem key={val} value={val}>{key}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha inicio</label>
              <DatePicker
                value={startDate}
                onChange={(v) => { setStartDate(v); setErrors((p) => ({ ...p, startDate: undefined })); }}
                aria-invalid={!!errors.startDate}
                maxDate={targetDate || undefined}
              />
              <FieldError message={errors.startDate} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha objetivo</label>
              <DatePicker
                value={targetDate}
                onChange={(v) => { setTargetDate(v); setErrors((p) => ({ ...p, targetDate: undefined })); }}
                aria-invalid={!!errors.targetDate}
                minDate={startDate || undefined}
              />
              <FieldError message={errors.targetDate} />
            </div>
          </div>
        </div>

        <div className="border-t border-border" />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Crear Iniciativa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
