'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProyectos } from '@/context/ProyectosContext';
import { InitiativeStatus, Initiative } from '@/types/proyectos';

interface CreateInitiativeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateInitiativeDialog({ open, onOpenChange }: CreateInitiativeDialogProps) {
  const { dispatch } = useProyectos();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<InitiativeStatus>(InitiativeStatus.Planning);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const canSubmit = name.trim() && owner.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;

    const now = new Date().toISOString();

    const newInitiative: Initiative = {
      id: `init-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      status,
      startDate: startDate || now.split('T')[0],
      targetDate: targetDate || '',
      owner: owner.trim(),
      epicIds: [],
      documents: [],
    };

    dispatch({ type: 'CREATE_INITIATIVE', payload: newInitiative });
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setOwner('');
    setStatus(InitiativeStatus.Planning);
    setStartDate('');
    setTargetDate('');
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
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la iniciativa"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe el objetivo de esta iniciativa..."
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Owner</label>
              <Input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Responsable"
              />
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
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha objetivo</label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              Crear Iniciativa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
