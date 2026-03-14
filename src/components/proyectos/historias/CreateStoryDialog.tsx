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
import { StoryStatus, UserStory } from '@/types/proyectos';

interface CreateStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIBONACCI = [1, 2, 3, 5, 8, 13];

export function CreateStoryDialog({ open, onOpenChange }: CreateStoryDialogProps) {
  const { state, dispatch } = useProyectos();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [epicId, setEpicId] = useState('');
  const [podId, setPodId] = useState('');
  const [productOwnerId, setProductOwnerId] = useState('');
  const [storyPoints, setStoryPoints] = useState('3');
  const [sprintId, setSprintId] = useState('');

  const canSubmit = title.trim() && epicId && podId;

  // Current user
  const currentUser = state.productOwners.find((p) => p.id === state.currentUserId);

  // Only show epics where current user is PO (via shared pods)
  const availableEpics = currentUser
    ? state.epics.filter((epic) =>
        epic.podIds.some((pid) => currentUser.podIds.includes(pid))
      )
    : [];

  // Filter POs by selected pod
  const availablePOs = podId
    ? state.productOwners.filter((po) => po.podIds.includes(podId))
    : state.productOwners;

  // Filter sprints by selected pod
  const availableSprints = podId
    ? state.sprints.filter((s) => s.podId === podId)
    : state.sprints;

  const handleSubmit = () => {
    if (!canSubmit) return;

    const nextKey = state.stories.length + 201;
    const now = new Date().toISOString();

    const newStory: UserStory = {
      id: `story-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      status: StoryStatus.Backlog,
      storyPoints: Number(storyPoints),
      epicId,
      podId,
      productOwnerId: productOwnerId || state.currentUserId,
      sprintId: sprintId || null,
      jiraKey: `GAM-${nextKey}`,
      labels: [],
      po: {
        background: '',
        objective: '',
        userStory: description.trim(),
        whatHowWhen: { what: '', how: '', when: '' },
        acceptanceCriteria: [],
        additionalNotes: '',
      },
      technical: {
        architecture: '',
        integrationFlow: '',
        validations: [],
        errorHandling: [],
        implementationChecklist: [],
      },
      qa: {
        testingStrategy: '',
        linkedQAMatrixId: null,
      },
      createdAt: now,
      updatedAt: now,
    };

    dispatch({ type: 'CREATE_STORY', payload: newStory });
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setEpicId('');
    setPodId('');
    setProductOwnerId('');
    setStoryPoints('3');
    setSprintId('');
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Como usuario quiero..."
              autoFocus
            />
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
              <Select value={epicId} onValueChange={setEpicId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEpics.map((epic) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.jiraKey} — {epic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">POD</label>
              <Select value={podId} onValueChange={(v) => { setPodId(v); setProductOwnerId(''); setSprintId(''); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
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

          <div className="grid grid-cols-3 gap-3">
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
              <label className="text-sm font-medium mb-1.5 block">Product Owner</label>
              <Select value={productOwnerId} onValueChange={setProductOwnerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {availablePOs.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.name}
                    </SelectItem>
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              Crear Historia
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
