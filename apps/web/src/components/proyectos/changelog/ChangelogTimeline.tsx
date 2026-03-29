'use client';

import { useMemo } from 'react';
import { useProyectos } from '@/context/ProyectosContext';
import { ChangelogAction, ChangelogEntityType, ChangelogEntry } from '@cenzontle/shared';
import { Plus, Pencil, Trash2, ArrowRightLeft, UserCheck, BookOpen, Layers, Lightbulb, CheckCircle2, XCircle } from 'lucide-react';

// --- Formatting helpers ---

const actionConfig: Record<ChangelogAction, { icon: React.ElementType; color: string; bgColor: string; verb: string }> = {
  [ChangelogAction.Created]: { icon: Plus, color: 'text-green-500', bgColor: 'bg-green-500/10 border-green-500/20', verb: 'creó' },
  [ChangelogAction.Updated]: { icon: Pencil, color: 'text-blue-500', bgColor: 'bg-blue-500/10 border-blue-500/20', verb: 'actualizó' },
  [ChangelogAction.Deleted]: { icon: Trash2, color: 'text-red-500', bgColor: 'bg-red-500/10 border-red-500/20', verb: 'eliminó' },
  [ChangelogAction.Moved]: { icon: ArrowRightLeft, color: 'text-amber-500', bgColor: 'bg-amber-500/10 border-amber-500/20', verb: 'movió' },
  [ChangelogAction.Reassigned]: { icon: UserCheck, color: 'text-fuchsia-500', bgColor: 'bg-fuchsia-500/10 border-fuchsia-500/20', verb: 'reasignó' },
  [ChangelogAction.Approved]: { icon: CheckCircle2, color: 'text-green-600', bgColor: 'bg-green-500/10 border-green-500/20', verb: 'aprobó' },
  [ChangelogAction.Rejected]: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-500/10 border-red-500/20', verb: 'rechazó' },
};

const entityConfig: Record<ChangelogEntityType, { icon: React.ElementType; label: string }> = {
  [ChangelogEntityType.Initiative]: { icon: Lightbulb, label: 'Iniciativa' },
  [ChangelogEntityType.Epic]: { icon: Layers, label: 'Épica' },
  [ChangelogEntityType.Story]: { icon: BookOpen, label: 'Historia' },
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
  trackerKey: 'clave externa',
  labels: 'etiquetas',
  acceptanceCriteria: 'criterios de aceptación',
};

const statusLabels: Record<string, string> = {
  backlog: 'Backlog', to_do: 'To Do', in_progress: 'In Progress',
  in_review: 'In Review', qa: 'QA', done: 'Done', blocked: 'Blocked',
  draft: 'Draft', planning: 'Planning', active: 'Active',
  completed: 'Completed', on_hold: 'On Hold',
};

const priorityLabels: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

function humanizeFieldName(field: string | null): string {
  if (!field) return '';
  return fieldLabels[field] ?? field.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function humanizeValue(field: string | null, value: string): string {
  if (!field || !value) return value;
  if (field === 'status') return statusLabels[value] ?? value;
  if (field === 'priority') return priorityLabels[value] ?? value;
  if (field === 'startDate' || field === 'targetDate' || field === 'updatedAt' || field === 'createdAt') {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch { /* fall through */ }
  }
  return value;
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

  if (isStatus) {
    const statusColor = getStatusColor(value);
    return (
      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${statusColor} ${variant === 'old' ? 'line-through opacity-60' : ''}`}>
        {humanized}
      </span>
    );
  }

  if (field === 'priority') {
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

// --- Formatting ---

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// --- Component ---

export function ChangelogTimeline() {
  const { state } = useProyectos();

  const grouped = useMemo(() => {
    const groups: Record<string, ChangelogEntry[]> = {};
    state.changelog.forEach((entry) => {
      const day = entry.timestamp.split('T')[0];
      if (!groups[day]) groups[day] = [];
      groups[day].push(entry);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entries]) => ({ date, entries }));
  }, [state.changelog]);

  return (
    <div className="space-y-6" role="feed" aria-label="Changelog del proyecto">
      {grouped.map(({ date, entries }) => (
        <section key={date} aria-label={formatDate(date)}>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 sticky top-0 bg-background py-1 z-10">
            {formatDate(date)}
          </h3>

          <div className="relative ml-4 border-l border-border pl-6 space-y-3">
            {entries.map((entry) => {
              const config = actionConfig[entry.action];
              const Icon = config.icon;
              const entityCfg = entityConfig[entry.entityType];
              const EntityIcon = entityCfg.icon;
              const fieldName = humanizeFieldName(entry.field);

              return (
                <article
                  key={entry.id}
                  className="relative"
                  aria-label={`${entry.changedBy.name} ${config.verb} ${entry.entityTitle}`}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border ${config.bgColor}`}
                    aria-hidden="true"
                  >
                    <Icon className={`h-3 w-3 ${config.color}`} />
                  </div>

                  <div className="rounded-lg border bg-card p-3 transition-colors hover:bg-muted/30">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0"
                          aria-hidden="true"
                        >
                          {entry.changedBy.name.charAt(0)}
                        </div>
                        <div className="flex items-center gap-1.5 text-sm min-w-0">
                          <span className="font-semibold truncate">{entry.changedBy.name}</span>
                          <span className="text-muted-foreground">
                            {config.verb}{fieldName ? ` ${fieldName} de` : ''}
                          </span>
                        </div>
                      </div>
                      <time
                        dateTime={entry.timestamp}
                        className="text-xs text-muted-foreground shrink-0 tabular-nums"
                      >
                        {formatTime(entry.timestamp)}
                      </time>
                    </div>

                    <div className="mt-1.5 ml-8">
                      {/* Entity reference */}
                      <div className="flex items-center gap-1.5">
                        <EntityIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">{entityCfg.label}:</span>
                        <span className="text-sm font-medium truncate">{entry.entityTitle}</span>
                      </div>

                      {/* Value diff */}
                      {entry.oldValue && entry.newValue && (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <ValueChip field={entry.field} value={entry.oldValue} variant="old" />
                          <svg className="h-3 w-3 text-muted-foreground shrink-0" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <ValueChip field={entry.field} value={entry.newValue} variant="new" />
                        </div>
                      )}

                      {entry.changeReason && (
                        <p className="mt-1.5 text-xs text-muted-foreground italic">
                          &ldquo;{entry.changeReason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {grouped.length === 0 && (
        <div className="text-center text-muted-foreground py-12" role="status">
          No hay entradas en el changelog
        </div>
      )}
    </div>
  );
}
