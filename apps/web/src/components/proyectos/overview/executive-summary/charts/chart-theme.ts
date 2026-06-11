import { StoryStatus, Priority } from '@cenzontle/shared';
import type { ExecutiveSummaryHealth } from '@cenzontle/shared';

// Paleta coherente con los statusColors de InitiativeFullPage — misma
// semántica de color por status para no crear choque cognitivo entre el
// snapshot ejecutivo y las métricas en vivo de abajo.

/** Orden canónico de pintado/leyenda (avance → pendiente → bloqueo). */
export const STATUS_ORDER: StoryStatus[] = [
  StoryStatus.Done,
  StoryStatus.InProgress,
  StoryStatus.InReview,
  StoryStatus.QA,
  StoryStatus.ToDo,
  StoryStatus.Backlog,
  StoryStatus.Blocked,
];

export const STATUS_BG: Record<StoryStatus, string> = {
  [StoryStatus.Done]: 'bg-green-500',
  [StoryStatus.InProgress]: 'bg-blue-500',
  [StoryStatus.InReview]: 'bg-cyan-500',
  [StoryStatus.QA]: 'bg-amber-500',
  [StoryStatus.ToDo]: 'bg-slate-400',
  [StoryStatus.Blocked]: 'bg-red-500',
  [StoryStatus.Backlog]: 'bg-gray-300 dark:bg-gray-600',
};

export const STATUS_LABELS: Record<StoryStatus, string> = {
  [StoryStatus.Done]: 'Done',
  [StoryStatus.InProgress]: 'In Progress',
  [StoryStatus.InReview]: 'In Review',
  [StoryStatus.QA]: 'QA',
  [StoryStatus.ToDo]: 'To Do',
  [StoryStatus.Backlog]: 'Backlog',
  [StoryStatus.Blocked]: 'Blocked',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.Critical]: 'Crítica',
  [Priority.High]: 'Alta',
  [Priority.Medium]: 'Media',
  [Priority.Low]: 'Baja',
};

export const PRIORITY_PILL: Record<Priority, string> = {
  [Priority.Critical]: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/40',
  [Priority.High]: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/40',
  [Priority.Medium]: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/40',
  [Priority.Low]: 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800/30 dark:border-slate-700/40',
};

export interface HealthTheme {
  label: string;
  /** Clase de fill para SVG (arco del donut). */
  fill: string;
  /** Clase de texto (número central, deltas). */
  text: string;
  /** Badge semáforo. */
  badge: string;
  /** Dot del badge. */
  dot: string;
}

export const HEALTH_THEME: Record<ExecutiveSummaryHealth, HealthTheme> = {
  on_track: {
    label: 'En curso',
    fill: 'fill-emerald-500',
    text: 'text-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  at_risk: {
    label: 'En riesgo',
    fill: 'fill-amber-500',
    text: 'text-amber-500',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  off_track: {
    label: 'Fuera de curso',
    fill: 'fill-red-500',
    text: 'text-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    dot: 'bg-red-500',
  },
};

/** Color de barra por umbral de progreso — mismo criterio que ProgressBar. */
export function progressBarColor(pct: number): string {
  if (pct === 100) return 'bg-green-500';
  if (pct >= 60) return 'bg-blue-500';
  if (pct >= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

export function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
