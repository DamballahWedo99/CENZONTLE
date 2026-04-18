'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Epic,
  EpicDependency,
  DependencyType,
  DependencyDirection,
  DependencyStatus,
  DependencyScheduling,
  Priority,
} from '@cenzontle/shared';
import { useProyectos } from '@/context/ProyectosContext';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Pencil,
  Trash2,
  GitBranch,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  CircleDot,
  Ban,
  ExternalLink,
  Link2,
  Server,
  Users,
  BookOpen,
  Zap,
  Filter,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Labels & config
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<DependencyType, { label: string; icon: typeof Server; color: string }> = {
  technical: { label: 'Técnica', icon: Server, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  resource: { label: 'Recurso', icon: Users, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  knowledge: { label: 'Conocimiento', icon: BookOpen, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  external: { label: 'Externa', icon: ExternalLink, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  'cross-team': { label: 'Cross-team', icon: Link2, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
};

const STATUS_CONFIG: Record<DependencyStatus, { label: string; icon: typeof Clock; color: string; dot: string }> = {
  identified: { label: 'Identificada', icon: CircleDot, color: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  in_progress: { label: 'En progreso', icon: Clock, color: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  resolved: { label: 'Resuelta', icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
  blocked: { label: 'Bloqueada', icon: Ban, color: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  mitigated: { label: 'Mitigada', icon: ShieldAlert, color: 'text-teal-600 dark:text-teal-400', dot: 'bg-teal-500' },
};

const SEVERITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  [Priority.Critical]: { label: 'Crítica', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  [Priority.High]: { label: 'Alta', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  [Priority.Medium]: { label: 'Media', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  [Priority.Low]: { label: 'Baja', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

const DIRECTION_LABELS: Record<DependencyDirection, { label: string; icon: typeof ArrowRight; description: string }> = {
  depends_on: { label: 'Depende de', icon: ArrowLeft, description: 'Esta épica necesita algo de otro lado' },
  depended_on_by: { label: 'Requerida por', icon: ArrowRight, description: 'Otra épica necesita algo de esta' },
};

const SCHEDULING_LABELS: Record<DependencyScheduling, string> = {
  'finish-to-start': 'Fin → Inicio',
  'start-to-start': 'Inicio → Inicio',
  'finish-to-finish': 'Fin → Fin',
  'start-to-finish': 'Inicio → Fin',
};

// ---------------------------------------------------------------------------
// Empty form
// ---------------------------------------------------------------------------

function emptyForm(): Omit<EpicDependency, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: '',
    description: '',
    type: 'technical',
    direction: 'depends_on',
    scheduling: 'finish-to-start',
    status: 'identified',
    severity: Priority.Medium,
    isBlocking: false,
    targetEpicId: null,
    targetExternalName: null,
    owner: '',
    dueDate: null,
    resolutionNotes: '',
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EpicDependenciesProps {
  epic: Epic;
  onAddDependency: (dep: EpicDependency) => void;
  onUpdateDependency: (dep: EpicDependency) => void;
  onDeleteDependency: (depId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EpicDependencies({
  epic,
  onAddDependency,
  onUpdateDependency,
  onDeleteDependency,
}: EpicDependenciesProps) {
  const { state } = useProyectos();
  const allEpics = state.epics.filter((e) => e.id !== epic.id);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDep, setEditingDep] = useState<EpicDependency | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [statusFilter, setStatusFilter] = useState<DependencyStatus | 'all'>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // --- Derived data ---
  const filteredDeps = useMemo(() => {
    const deps = epic.dependencies ?? [];
    if (statusFilter === 'all') return deps;
    return deps.filter((d) => d.status === statusFilter);
  }, [epic.dependencies, statusFilter]);

  const stats = useMemo(() => {
    const deps = epic.dependencies ?? [];
    const blocking = deps.filter((d) => d.isBlocking && d.status !== 'resolved' && d.status !== 'mitigated');
    const active = deps.filter((d) => d.status !== 'resolved' && d.status !== 'mitigated');
    const resolved = deps.filter((d) => d.status === 'resolved' || d.status === 'mitigated');
    return { total: deps.length, blocking: blocking.length, active: active.length, resolved: resolved.length };
  }, [epic.dependencies]);

  // --- Handlers ---
  const openCreate = useCallback(() => {
    setEditingDep(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((dep: EpicDependency) => {
    setEditingDep(dep);
    setForm({
      title: dep.title,
      description: dep.description,
      type: dep.type,
      direction: dep.direction,
      scheduling: dep.scheduling,
      status: dep.status,
      severity: dep.severity,
      isBlocking: dep.isBlocking,
      targetEpicId: dep.targetEpicId,
      targetExternalName: dep.targetExternalName,
      owner: dep.owner,
      dueDate: dep.dueDate,
      resolutionNotes: dep.resolutionNotes,
    });
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.title.trim()) return;

    const now = new Date().toISOString();
    if (editingDep) {
      onUpdateDependency({
        ...editingDep,
        ...form,
        updatedAt: now,
      });
    } else {
      onAddDependency({
        ...form,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
    }
    setDialogOpen(false);
    setEditingDep(null);
    setForm(emptyForm());
  }, [form, editingDep, onAddDependency, onUpdateDependency]);

  const handleDelete = useCallback((id: string) => {
    onDeleteDependency(id);
    setDeleteConfirmId(null);
  }, [onDeleteDependency]);

  const updateField = useCallback(<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // --- Resolve epic name ---
  const getEpicLabel = useCallback((epicId: string | null) => {
    if (!epicId) return null;
    const e = state.epics.find((ep) => ep.id === epicId);
    return e ? (e.tracker?.externalKey ? `${e.tracker.externalKey} · ${e.title}` : e.title) : epicId;
  }, [state.epics]);

  // --- Empty state ---
  if ((epic.dependencies ?? []).length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed py-12 flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <GitBranch className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Sin dependencias registradas</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Registra las dependencias técnicas, de recursos, externas o cross-team que tiene esta épica
            para mantener visibilidad sobre bloqueos y riesgos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openCreate} className="gap-2 mt-2">
          <Plus className="h-3.5 w-3.5" />
          Agregar dependencia
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* --- Stats bar --- */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold">{stats.total}</span>
            <span className="text-muted-foreground">total</span>
          </div>
          {stats.blocking > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="font-semibold">{stats.blocking}</span>
              <span>bloqueantes</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-semibold">{stats.active}</span>
            <span>activas</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-semibold">{stats.resolved}</span>
            <span>resueltas</span>
          </div>
        </div>

        {/* Filter + Add */}
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DependencyStatus | 'all')}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(Object.entries(STATUS_CONFIG) as [DependencyStatus, typeof STATUS_CONFIG[DependencyStatus]][]).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openCreate} className="gap-1.5 h-8 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
        </div>
      </div>

      {/* --- Dependency cards --- */}
      <div className="space-y-2">
        {filteredDeps.map((dep) => {
          const typeCfg = TYPE_CONFIG[dep.type];
          const statusCfg = STATUS_CONFIG[dep.status];
          const sevCfg = SEVERITY_CONFIG[dep.severity];
          const dirCfg = DIRECTION_LABELS[dep.direction];
          const TypeIcon = typeCfg.icon;
          const StatusIcon = statusCfg.icon;
          const DirIcon = dirCfg.icon;
          const targetLabel = dep.targetEpicId ? getEpicLabel(dep.targetEpicId) : dep.targetExternalName;
          const isConfirmingDelete = deleteConfirmId === dep.id;

          return (
            <div
              key={dep.id}
              className={`rounded-lg border p-4 transition-colors ${
                dep.isBlocking && dep.status !== 'resolved' && dep.status !== 'mitigated'
                  ? 'border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10'
                  : ''
              }`}
            >
              {/* Row 1: Title + actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Status dot */}
                  <span className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${statusCfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{dep.title}</p>
                    {dep.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{dep.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(dep)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setDeleteConfirmId(null)}>
                        Cancelar
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => handleDelete(dep.id)}>
                        Eliminar
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600" onClick={() => setDeleteConfirmId(dep.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Row 2: Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {/* Type */}
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${typeCfg.color}`}>
                  <TypeIcon className="h-2.5 w-2.5" />
                  {typeCfg.label}
                </span>

                {/* Status */}
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted ${statusCfg.color}`}>
                  <StatusIcon className="h-2.5 w-2.5" />
                  {statusCfg.label}
                </span>

                {/* Severity */}
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${sevCfg.color}`}>
                  {sevCfg.label}
                </span>

                {/* Blocking badge */}
                {dep.isBlocking && dep.status !== 'resolved' && dep.status !== 'mitigated' && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    <Zap className="h-2.5 w-2.5" />
                    Bloqueante
                  </span>
                )}

                {/* Scheduling */}
                <span className="text-[10px] text-muted-foreground">
                  {SCHEDULING_LABELS[dep.scheduling]}
                </span>
              </div>

              {/* Row 3: Direction + target */}
              {targetLabel && (
                <div className="flex items-center gap-2 mt-2.5 text-xs text-muted-foreground">
                  <DirIcon className="h-3 w-3 shrink-0" />
                  <span>{dirCfg.label}:</span>
                  <span className="font-medium text-foreground truncate">{targetLabel}</span>
                </div>
              )}

              {/* Row 4: Meta */}
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                {dep.owner && <span>Responsable: <span className="text-foreground/70">{dep.owner}</span></span>}
                {dep.dueDate && <span>Fecha límite: <span className="text-foreground/70">{new Date(dep.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span></span>}
              </div>

              {/* Resolution notes */}
              {dep.resolutionNotes && (dep.status === 'resolved' || dep.status === 'mitigated') && (
                <div className="mt-2 rounded-md bg-green-50 dark:bg-green-950/20 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                  {dep.resolutionNotes}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredDeps.length === 0 && statusFilter !== 'all' && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No hay dependencias con estado &quot;{STATUS_CONFIG[statusFilter].label}&quot;
        </div>
      )}

      {/* --- Create/Edit Dialog --- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDep ? 'Editar dependencia' : 'Nueva dependencia'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Título *</label>
              <Input
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Ej: Integración con API de pagos"
                className="mt-1"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe el impacto y contexto de esta dependencia..."
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
              />
            </div>

            {/* Type + Direction row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                <Select value={form.type} onValueChange={(v) => updateField('type', v as DependencyType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(TYPE_CONFIG) as [DependencyType, typeof TYPE_CONFIG[DependencyType]][]).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Dirección</label>
                <Select value={form.direction} onValueChange={(v) => updateField('direction', v as DependencyDirection)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(DIRECTION_LABELS) as [DependencyDirection, typeof DIRECTION_LABELS[DependencyDirection]][]).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Target epic or external */}
            {form.type === 'external' ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Nombre externo</label>
                <Input
                  value={form.targetExternalName ?? ''}
                  onChange={(e) => updateField('targetExternalName', e.target.value || null)}
                  placeholder="Ej: DEUNA Payments API, Equipo de Infraestructura"
                  className="mt-1"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Épica relacionada</label>
                <Select value={form.targetEpicId ?? '__none__'} onValueChange={(v) => updateField('targetEpicId', v === '__none__' ? null : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar épica..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Ninguna</SelectItem>
                    {allEpics.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.tracker?.externalKey ? `${e.tracker.externalKey} · ` : ''}{e.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Status + Severity + Scheduling */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Estado</label>
                <Select value={form.status} onValueChange={(v) => updateField('status', v as DependencyStatus)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(STATUS_CONFIG) as [DependencyStatus, typeof STATUS_CONFIG[DependencyStatus]][]).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Severidad</label>
                <Select value={form.severity} onValueChange={(v) => updateField('severity', v as Priority)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SEVERITY_CONFIG) as [Priority, typeof SEVERITY_CONFIG[Priority]][]).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Secuencia</label>
                <Select value={form.scheduling} onValueChange={(v) => updateField('scheduling', v as DependencyScheduling)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SCHEDULING_LABELS) as [DependencyScheduling, string][]).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Blocking toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={form.isBlocking}
                onClick={() => updateField('isBlocking', !form.isBlocking)}
                className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-200 ${
                  form.isBlocking
                    ? 'bg-red-500 border-red-600'
                    : 'bg-muted border-border'
                }`}
              >
                <span
                  className={`pointer-events-none absolute top-[2px] inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    form.isBlocking ? 'translate-x-[20px]' : 'translate-x-[2px]'
                  }`}
                />
              </button>
              <div>
                <span className="text-sm font-medium">Bloqueante</span>
                <p className="text-[10px] text-muted-foreground">Esta dependencia impide el avance de la épica</p>
              </div>
            </label>

            {/* Owner + Due date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Responsable</label>
                <Input
                  value={form.owner}
                  onChange={(e) => updateField('owner', e.target.value)}
                  placeholder="Nombre del responsable"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fecha límite</label>
                <DatePicker
                  value={form.dueDate ?? ''}
                  onChange={(v) => updateField('dueDate', v || null)}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Resolution notes (only when resolved/mitigated) */}
            {(form.status === 'resolved' || form.status === 'mitigated') && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Notas de resolución</label>
                <textarea
                  value={form.resolutionNotes}
                  onChange={(e) => updateField('resolutionNotes', e.target.value)}
                  placeholder="Cómo se resolvió o mitigó esta dependencia..."
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none dark:bg-input/30"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!form.title.trim()}>
              {editingDep ? 'Guardar cambios' : 'Crear dependencia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
