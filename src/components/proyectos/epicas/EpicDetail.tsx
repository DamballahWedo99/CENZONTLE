'use client';

import { useState, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  EpicWithRelations,
  EpicStatus,
  Priority,
  StoryStatus,
  ChangelogAction,
  ChangelogEntityType,
  ChangelogEntry,
} from '@/types/proyectos';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityIndicator } from '../shared/PriorityIndicator';
import { PodBadge } from '../shared/PodBadge';
import { ProgressBar } from '../shared/ProgressBar';
import { StoryPointsBadge } from '../shared/StoryPointsBadge';
import { useProyectos } from '@/context/ProyectosContext';
import { Calendar, User, Pencil, X, Check, History, BookOpen, FileText } from 'lucide-react';

// --- Changelog formatting helpers ---

const actionVerbs: Record<ChangelogAction, string> = {
  [ChangelogAction.Created]: 'creó',
  [ChangelogAction.Updated]: 'actualizó',
  [ChangelogAction.Deleted]: 'eliminó',
  [ChangelogAction.Moved]: 'movió',
  [ChangelogAction.Reassigned]: 'reasignó',
  [ChangelogAction.Approved]: 'aprobó',
  [ChangelogAction.Rejected]: 'rechazó',
};

const fieldLabels: Record<string, string> = {
  status: 'estado',
  priority: 'prioridad',
  title: 'título',
  description: 'descripción',
  startDate: 'fecha de inicio',
  targetDate: 'fecha objetivo',
  storyPoints: 'story points',
  sprintId: 'sprint',
  podId: 'POD',
  productOwnerId: 'product owner',
  updatedAt: 'última actualización',
  createdAt: 'fecha de creación',
  epicId: 'épica',
  jiraKey: 'clave Jira',
  labels: 'etiquetas',
  acceptanceCriteria: 'criterios de aceptación',
  qualitativeBenefits: 'beneficios cualitativos',
  quantitativeBenefits: 'beneficios cuantitativos',
  benefitsMeasurement: 'medición de beneficios',
  scopeDescription: 'descripción del alcance',
  technologicalImprovements: 'mejoras tecnológicas',
  businessPriority: 'prioridad de negocio',
  teamsInvolved: 'equipos involucrados',
  impactedChannels: 'canales impactados',
  impactedFlows: 'flujos impactados',
  impactSabreLevel: 'nivel de impacto Sabre',
  thirdPartyDependencies: 'dependencias de terceros',
};

const statusLabels: Record<string, string> = {
  backlog: 'Backlog',
  to_do: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
  done: 'Done',
  blocked: 'Blocked',
  draft: 'Draft',
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On Hold',
};

const priorityLabels: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const entityTypeLabels: Record<ChangelogEntityType, string> = {
  [ChangelogEntityType.Initiative]: 'Iniciativa',
  [ChangelogEntityType.Epic]: 'Épica',
  [ChangelogEntityType.Story]: 'Historia',
};

function humanizeFieldName(field: string | null): string {
  if (!field) return '';
  return fieldLabels[field] ?? field.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function humanizeValue(field: string | null, value: string): string {
  if (!field || !value) return value;

  if (field === 'status') {
    return statusLabels[value] ?? value;
  }

  if (field === 'priority') {
    return priorityLabels[value] ?? value;
  }

  if (field === 'startDate' || field === 'targetDate' || field === 'updatedAt' || field === 'createdAt') {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch {
      // fall through
    }
    return value;
  }

  return value;
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function getStatusColor(value: string): string {
  const colors: Record<string, string> = {
    done: 'bg-green-500/15 text-green-700 dark:text-green-400',
    completed: 'bg-green-500/15 text-green-700 dark:text-green-400',
    in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    active: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    in_review: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400',
    qa: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    to_do: 'bg-slate-500/15 text-slate-700 dark:text-slate-400',
    backlog: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
    draft: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
    planning: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
    blocked: 'bg-red-500/15 text-red-700 dark:text-red-400',
    on_hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  };
  return colors[value] ?? '';
}

function ValueChip({ field, value, variant }: { field: string | null; value: string; variant: 'old' | 'new' }) {
  const humanized = humanizeValue(field, value);
  const isStatus = field === 'status';
  const isPriority = field === 'priority';

  if (isStatus) {
    const statusColor = getStatusColor(value);
    return (
      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${statusColor} ${variant === 'old' ? 'line-through opacity-60' : ''}`}>
        {humanized}
      </span>
    );
  }

  if (isPriority) {
    return (
      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground ${variant === 'old' ? 'line-through opacity-60' : ''}`}>
        {humanized}
      </span>
    );
  }

  const baseClass = variant === 'old'
    ? 'rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-700 line-through dark:text-red-400'
    : 'rounded-md bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400';

  return <span className={`text-[11px] font-medium ${baseClass}`}>{humanized}</span>;
}

// --- Inline changelog ---

function EpicChangelog({ entries }: { entries: ChangelogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <History className="h-6 w-6 mb-2 opacity-20" />
        <p className="text-sm">Sin cambios registrados</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {entries.map((entry) => {
        const verb = actionVerbs[entry.action];
        const isStoryChange = entry.entityType === ChangelogEntityType.Story;
        const fieldName = humanizeFieldName(entry.field);

        return (
          <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm">
                <span className="font-medium">{entry.changedBy.name.split(' ')[0]}</span>
                <span className="text-muted-foreground">
                  {' '}{verb}{fieldName ? ` ${fieldName}` : ''}
                </span>
                {isStoryChange && (
                  <span className="text-muted-foreground">
                    {' '}en <span className="text-foreground/70">{entry.entityTitle}</span>
                  </span>
                )}
              </p>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 tabular-nums">
                {formatShortDate(entry.timestamp)}
              </span>
            </div>

            {entry.oldValue && entry.newValue && (
              <div className="flex items-center gap-2 mt-1.5">
                <ValueChip field={entry.field} value={entry.oldValue} variant="old" />
                <svg className="h-3 w-3 text-muted-foreground/50 shrink-0" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <ValueChip field={entry.field} value={entry.newValue} variant="new" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Editable text field helper ---

function EditableTextField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
      />
    </div>
  );
}

// --- Read-only field display ---

function DetailField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[11px] text-muted-foreground block mb-1">{label}</span>
      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{value}</p>
    </div>
  );
}

// --- Main component ---

interface EpicDetailProps {
  epic: EpicWithRelations;
  onClose: () => void;
}

// The 13 business fields grouped by sections
const businessFieldSections = [
  {
    title: 'Beneficios',
    fields: [
      { key: 'qualitativeBenefits' as const, label: 'Beneficios Cualitativos' },
      { key: 'quantitativeBenefits' as const, label: 'Beneficios Cuantitativos' },
      { key: 'benefitsMeasurement' as const, label: '¿Cómo se medirán los beneficios?' },
    ],
  },
  {
    title: 'Alcance y Criterios',
    fields: [
      { key: 'scopeDescription' as const, label: 'Descripción del Alcance' },
      { key: 'acceptanceCriteria' as const, label: 'Criterios de Aceptación' },
    ],
  },
  {
    title: 'Aspectos Técnicos',
    fields: [
      { key: 'technologicalImprovements' as const, label: 'Mejoras Tecnológicas' },
      { key: 'businessPriority' as const, label: 'Prioridad de Negocio' },
      { key: 'teamsInvolved' as const, label: 'Equipos Involucrados' },
    ],
  },
  {
    title: 'Impacto',
    fields: [
      { key: 'impactedChannels' as const, label: 'Canales Impactados' },
      { key: 'impactedFlows' as const, label: 'Flujos Impactados' },
      { key: 'impactSabreLevel' as const, label: 'Nivel de Impacto en Sabre' },
      { key: 'thirdPartyDependencies' as const, label: 'Dependencias de Terceros' },
    ],
  },
];

type BusinessFieldKey = typeof businessFieldSections[number]['fields'][number]['key'];

export function EpicDetail({ epic, onClose }: EpicDetailProps) {
  const { state, dispatch } = useProyectos();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(epic.title);
  const [editDescription, setEditDescription] = useState(epic.description);
  const [editStatus, setEditStatus] = useState<EpicStatus>(epic.status);
  const [editPriority, setEditPriority] = useState<Priority>(epic.priority);
  const [editStartDate, setEditStartDate] = useState(epic.startDate);
  const [editTargetDate, setEditTargetDate] = useState(epic.targetDate);

  // State for all 13 business fields
  const [editBusinessFields, setEditBusinessFields] = useState<Record<BusinessFieldKey, string>>({
    qualitativeBenefits: epic.qualitativeBenefits,
    quantitativeBenefits: epic.quantitativeBenefits,
    benefitsMeasurement: epic.benefitsMeasurement,
    scopeDescription: epic.scopeDescription,
    acceptanceCriteria: epic.acceptanceCriteria,
    technologicalImprovements: epic.technologicalImprovements,
    businessPriority: epic.businessPriority,
    teamsInvolved: epic.teamsInvolved,
    impactedChannels: epic.impactedChannels,
    impactedFlows: epic.impactedFlows,
    impactSabreLevel: epic.impactSabreLevel,
    thirdPartyDependencies: epic.thirdPartyDependencies,
  });

  // Derive POs from the epic's pods
  const epicProductOwners = useMemo(() => {
    const poIds = new Set(epic.pods.flatMap((pod) => pod.productOwnerIds));
    return state.productOwners.filter((po) => poIds.has(po.id));
  }, [epic.pods, state.productOwners]);

  const totalPoints = epic.stories.reduce((sum, s) => sum + s.storyPoints, 0);
  const donePoints = epic.stories
    .filter((s) => s.status === StoryStatus.Done)
    .reduce((sum, s) => sum + s.storyPoints, 0);

  const epicChangelog = useMemo(() => {
    const epicStoryIds = new Set(epic.stories.map((s) => s.id));
    return state.changelog.filter(
      (entry) =>
        (entry.entityType === ChangelogEntityType.Epic && entry.entityId === epic.id) ||
        (entry.entityType === ChangelogEntityType.Story && epicStoryIds.has(entry.entityId))
    );
  }, [state.changelog, epic.id, epic.stories]);

  const handleStartEdit = () => {
    setEditTitle(epic.title);
    setEditDescription(epic.description);
    setEditStatus(epic.status);
    setEditPriority(epic.priority);
    setEditStartDate(epic.startDate);
    setEditTargetDate(epic.targetDate);
    setEditBusinessFields({
      qualitativeBenefits: epic.qualitativeBenefits,
      quantitativeBenefits: epic.quantitativeBenefits,
      benefitsMeasurement: epic.benefitsMeasurement,
      scopeDescription: epic.scopeDescription,
      acceptanceCriteria: epic.acceptanceCriteria,
      technologicalImprovements: epic.technologicalImprovements,
      businessPriority: epic.businessPriority,
      teamsInvolved: epic.teamsInvolved,
      impactedChannels: epic.impactedChannels,
      impactedFlows: epic.impactedFlows,
      impactSabreLevel: epic.impactSabreLevel,
      thirdPartyDependencies: epic.thirdPartyDependencies,
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    const changes: Record<string, string> = {};
    if (editTitle !== epic.title) changes.title = editTitle;
    if (editDescription !== epic.description) changes.description = editDescription;
    if (editStatus !== epic.status) changes.status = editStatus;
    if (editPriority !== epic.priority) changes.priority = editPriority;
    if (editStartDate !== epic.startDate) changes.startDate = editStartDate;
    if (editTargetDate !== epic.targetDate) changes.targetDate = editTargetDate;

    // Check all business fields for changes
    for (const section of businessFieldSections) {
      for (const field of section.fields) {
        if (editBusinessFields[field.key] !== epic[field.key]) {
          changes[field.key] = editBusinessFields[field.key];
        }
      }
    }

    if (Object.keys(changes).length > 0) {
      dispatch({ type: 'UPDATE_EPIC', payload: { id: epic.id, changes } });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const updateBusinessField = (key: BusinessFieldKey, value: string) => {
    setEditBusinessFields((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {/* ── Header ── */}
        <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 py-5">
          <SheetHeader className="space-y-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  {epic.jiraKey}
                </span>
                {!isEditing && (
                  <>
                    <StatusBadge status={epic.status} type="epic" />
                    <PriorityIndicator priority={epic.priority} />
                  </>
                )}
              </div>
              {!isEditing ? (
                <Button variant="outline" size="sm" onClick={handleStartEdit} className="h-8 gap-1.5 text-xs">
                  <Pencil className="h-3 w-3" />
                  Editar
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancel} className="h-8 gap-1.5 text-xs">
                    <X className="h-3 w-3" />
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSave} className="h-8 gap-1.5 text-xs">
                    <Check className="h-3 w-3" />
                    Guardar
                  </Button>
                </div>
              )}
            </div>

            {isEditing ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-lg font-semibold h-10"
              />
            ) : (
              <SheetTitle className="text-lg leading-tight">{epic.title}</SheetTitle>
            )}
          </SheetHeader>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-6 space-y-6">

          {/* Tabs: Definición | Historias | Changelog */}
          <Tabs defaultValue="definicion">
            <TabsList className="w-full">
              <TabsTrigger value="definicion" className="flex-1 gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Definición
              </TabsTrigger>
              <TabsTrigger value="historias" className="flex-1 gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                Historias ({epic.stories.length})
              </TabsTrigger>
              <TabsTrigger value="changelog" className="flex-1 gap-1.5">
                <History className="h-3.5 w-3.5" />
                Changelog ({epicChangelog.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="definicion" className="mt-4 space-y-6">
              {/* Description */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Descripción
                </h4>
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-input bg-transparent px-4 py-3 text-sm leading-relaxed shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {epic.description}
                  </p>
                )}
              </section>

              <div className="border-t" />

              {/* Metadata */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Detalles
                </h4>
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                      <Select value={editStatus} onValueChange={(v) => setEditStatus(v as EpicStatus)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(EpicStatus).map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prioridad</label>
                      <Select value={editPriority} onValueChange={(v) => setEditPriority(v as Priority)}>
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
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fecha inicio</label>
                      <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Fecha objetivo</label>
                      <Input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">Fechas</span>
                      <span className="flex items-center gap-1.5 text-sm">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        {epic.startDate} &mdash; {epic.targetDate}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">PODs asignados</span>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {epic.pods.map((pod) => (
                          <PodBadge key={pod.id} name={pod.name} color={pod.color} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">Iniciativa</span>
                      <span className="text-sm">{epic.initiative.name}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">Product Owners</span>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {epicProductOwners.length > 0 ? (
                          epicProductOwners.map((po) => (
                            <span
                              key={po.id}
                              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
                            >
                              <User className="h-3 w-3 text-muted-foreground" />
                              {po.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin PO asignado</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <div className="border-t" />

              {/* Progress */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Progreso
                  </h4>
                  <span className="text-sm font-medium tabular-nums">
                    {donePoints}/{totalPoints} SP
                  </span>
                </div>
                <ProgressBar progress={epic.progress} />
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{epic.stories.filter((s) => s.status === StoryStatus.Done).length} completadas</span>
                  <span>{epic.stories.filter((s) => s.status === StoryStatus.InProgress).length} en progreso</span>
                  <span>{epic.stories.filter((s) => s.status === StoryStatus.Blocked).length} bloqueadas</span>
                </div>
              </section>

              <div className="border-t" />

              {/* Business fields sections */}
              {businessFieldSections.map((section) => (
                <section key={section.title}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    {section.title}
                  </h4>
                  {isEditing ? (
                    <div className="space-y-4">
                      {section.fields.map((field) => (
                        <EditableTextField
                          key={field.key}
                          label={field.label}
                          value={editBusinessFields[field.key]}
                          onChange={(v) => updateBusinessField(field.key, v)}
                          rows={2}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {section.fields.map((field) => (
                        <DetailField
                          key={field.key}
                          label={field.label}
                          value={epic[field.key]}
                        />
                      ))}
                    </div>
                  )}
                  <div className="border-t mt-6" />
                </section>
              ))}
            </TabsContent>

            <TabsContent value="historias" className="mt-4">
              <div className="space-y-2">
                {epic.stories.map((story) => {
                  const po = state.productOwners.find(
                    (p) => p.id === story.productOwnerId
                  );
                  return (
                    <div
                      key={story.id}
                      className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-muted/30"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                        {story.jiraKey}
                      </span>
                      <span className="truncate flex-1">{story.title}</span>
                      <StoryPointsBadge points={story.storyPoints} />
                      <StatusBadge status={story.status} />
                      {po && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                          <User className="h-3 w-3" />
                          {po.name.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="changelog" className="mt-4">
              <EpicChangelog entries={epicChangelog} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
