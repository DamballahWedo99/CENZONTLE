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
import { Checkbox } from '@/components/ui/checkbox';
import { useProyectos } from '@/context/ProyectosContext';
import { EpicStatus, Priority, Epic } from '@cenzontle/shared';

interface CreateEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateEpicDialog({ open, onOpenChange }: CreateEpicDialogProps) {
  const { state, dispatch } = useProyectos();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [initiativeId, setInitiativeId] = useState('');
  const [priority, setPriority] = useState<Priority>(Priority.Medium);
  const [selectedPodIds, setSelectedPodIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');

  // Business fields
  const [qualitativeBenefits, setQualitativeBenefits] = useState('');
  const [quantitativeBenefits, setQuantitativeBenefits] = useState('');
  const [benefitsMeasurement, setBenefitsMeasurement] = useState('');
  const [scopeDescription, setScopeDescription] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [technologicalImprovements, setTechnologicalImprovements] = useState('');
  const [businessPriority, setBusinessPriority] = useState('');
  const [teamsInvolved, setTeamsInvolved] = useState('');
  const [impactedChannels, setImpactedChannels] = useState('');
  const [impactedFlows, setImpactedFlows] = useState('');
  const [impactSabreLevel, setImpactSabreLevel] = useState('');
  const [thirdPartyDependencies, setThirdPartyDependencies] = useState('');

  const canSubmit = title.trim() && initiativeId && selectedPodIds.length > 0;

  const handleTogglePod = (podId: string) => {
    setSelectedPodIds((prev) =>
      prev.includes(podId) ? prev.filter((id) => id !== podId) : [...prev, podId]
    );
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    const now = new Date().toISOString();

    const newEpic: Epic = {
      id: `epic-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      qualitativeBenefits: qualitativeBenefits.trim(),
      quantitativeBenefits: quantitativeBenefits.trim(),
      benefitsMeasurement: benefitsMeasurement.trim(),
      scopeDescription: scopeDescription.trim(),
      acceptanceCriteria: acceptanceCriteria.trim(),
      technologicalImprovements: technologicalImprovements.trim(),
      businessPriority: businessPriority.trim(),
      teamsInvolved: teamsInvolved.trim(),
      impactedChannels: impactedChannels.trim(),
      impactedFlows: impactedFlows.trim(),
      impactSabreLevel: impactSabreLevel.trim(),
      thirdPartyDependencies: thirdPartyDependencies.trim(),
      documents: [],
      diagrams: [],
      dependencies: [],
      poApproval: null,
      tlApproval: null,
      qaMatrix: null,
      qaApproval: null,
      epicQAMatrix: null,

      status: EpicStatus.Draft,
      priority,
      initiativeId,
      podIds: selectedPodIds,
      jiraKey: null,
      startDate: startDate || now.split('T')[0],
      targetDate: targetDate || '',
      createdAt: now,
      updatedAt: now,
    };

    dispatch({ type: 'CREATE_EPIC', payload: newEpic });
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setInitiativeId('');
    setPriority(Priority.Medium);
    setSelectedPodIds([]);
    setStartDate('');
    setTargetDate('');
    setQualitativeBenefits('');
    setQuantitativeBenefits('');
    setBenefitsMeasurement('');
    setScopeDescription('');
    setAcceptanceCriteria('');
    setTechnologicalImprovements('');
    setBusinessPriority('');
    setTeamsInvolved('');
    setImpactedChannels('');
    setImpactedFlows('');
    setImpactSabreLevel('');
    setThirdPartyDependencies('');
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  const textareaClass =
    'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30 placeholder:text-muted-foreground';

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

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe el alcance de esta épica..."
              className={textareaClass}
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
            <label className="text-sm font-medium mb-1.5 block">PODs asignados</label>
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
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Fecha objetivo</label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Definición de la Épica</h3>

            {/* Benefits */}
            <div className="space-y-4 mb-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Beneficios</p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Beneficios Cualitativos</label>
                <textarea
                  value={qualitativeBenefits}
                  onChange={(e) => setQualitativeBenefits(e.target.value)}
                  rows={2}
                  placeholder="Beneficios cualitativos esperados..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Beneficios Cuantitativos</label>
                <textarea
                  value={quantitativeBenefits}
                  onChange={(e) => setQuantitativeBenefits(e.target.value)}
                  rows={2}
                  placeholder="Métricas y beneficios cuantitativos..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">¿Cómo se medirán los beneficios?</label>
                <textarea
                  value={benefitsMeasurement}
                  onChange={(e) => setBenefitsMeasurement(e.target.value)}
                  rows={2}
                  placeholder="Método de medición de beneficios..."
                  className={textareaClass}
                />
              </div>
            </div>

            {/* Scope & Criteria */}
            <div className="space-y-4 mb-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Alcance y Criterios</p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Descripción del Alcance</label>
                <textarea
                  value={scopeDescription}
                  onChange={(e) => setScopeDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe el alcance de la épica..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Criterios de Aceptación</label>
                <textarea
                  value={acceptanceCriteria}
                  onChange={(e) => setAcceptanceCriteria(e.target.value)}
                  rows={2}
                  placeholder="Criterios de aceptación de la épica..."
                  className={textareaClass}
                />
              </div>
            </div>

            {/* Technical */}
            <div className="space-y-4 mb-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Aspectos Técnicos</p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Mejoras Tecnológicas</label>
                <textarea
                  value={technologicalImprovements}
                  onChange={(e) => setTechnologicalImprovements(e.target.value)}
                  rows={2}
                  placeholder="Mejoras tecnológicas incluidas..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Prioridad de Negocio</label>
                <textarea
                  value={businessPriority}
                  onChange={(e) => setBusinessPriority(e.target.value)}
                  rows={2}
                  placeholder="Prioridad y justificación de negocio..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Equipos Involucrados</label>
                <textarea
                  value={teamsInvolved}
                  onChange={(e) => setTeamsInvolved(e.target.value)}
                  rows={2}
                  placeholder="Equipos que participarán..."
                  className={textareaClass}
                />
              </div>
            </div>

            {/* Impact */}
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Impacto</p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Canales Impactados</label>
                <textarea
                  value={impactedChannels}
                  onChange={(e) => setImpactedChannels(e.target.value)}
                  rows={2}
                  placeholder="Canales que serán afectados..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Flujos Impactados</label>
                <textarea
                  value={impactedFlows}
                  onChange={(e) => setImpactedFlows(e.target.value)}
                  rows={2}
                  placeholder="Flujos de negocio que serán afectados..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Nivel de Impacto en Sabre</label>
                <textarea
                  value={impactSabreLevel}
                  onChange={(e) => setImpactSabreLevel(e.target.value)}
                  rows={2}
                  placeholder="Impacto a nivel de Sabre..."
                  className={textareaClass}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Dependencias de Terceros</label>
                <textarea
                  value={thirdPartyDependencies}
                  onChange={(e) => setThirdPartyDependencies(e.target.value)}
                  rows={2}
                  placeholder="Dependencias externas o de terceros..."
                  className={textareaClass}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              Crear Épica
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
