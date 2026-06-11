import type { InitiativeStatus, EpicStatus, StoryStatus, Priority } from './proyectos';

// === RESUMEN EJECUTIVO DE INICIATIVA ===
//
// Separación estricta de responsabilidades:
//  - `InitiativeMetrics` la computa el BACKEND de forma determinista desde
//    Prisma (conteos, story points, progreso, fechas). La IA nunca produce
//    ni modifica números — solo los recibe como contexto de solo lectura.
//  - `ExecutiveSummaryNarrative` la produce la IA via structured output
//    (tool `submit_executive_summary`): lectura ejecutiva, riesgos y
//    recomendaciones ancladas a las métricas reales.
//
// El frontend renderiza las métricas con charts D3 y la narrativa como
// secciones de texto — ambas piezas viajan juntas en `ExecutiveSummary`,
// que se persiste en `Initiative.executiveSummary` (Json).

// --- Métricas deterministas (backend) ---

/** Rebanada de la distribución de historias por status. */
export interface StoryStatusSlice {
  status: StoryStatus;
  count: number;
  points: number;
}

/** Métricas agregadas de una épica dentro de la iniciativa. */
export interface EpicMetricsRow {
  epicId: string;
  title: string;
  status: EpicStatus;
  priority: Priority;
  storiesTotal: number;
  storiesDone: number;
  storiesBlocked: number;
  pointsTotal: number;
  pointsDone: number;
  /** 0-100, redondeado. Basado en historias done sobre total (0 si no hay historias). */
  progressPct: number;
  startDate: string | null;
  targetDate: string | null;
}

/** Carga y avance de un pod (célula) dentro de la iniciativa. */
export interface PodMetricsRow {
  podId: string;
  podName: string;
  storiesTotal: number;
  storiesDone: number;
  pointsTotal: number;
  pointsDone: number;
  /** 0-100, redondeado. */
  progressPct: number;
}

/** Snapshot determinista de métricas de la iniciativa — fuente: Prisma. */
export interface InitiativeMetrics {
  /** ISO datetime en que el backend computó el snapshot. */
  computedAt: string;
  initiative: {
    id: string;
    name: string;
    status: InitiativeStatus;
    owner: string;
    startDate: string | null;
    targetDate: string | null;
  };
  totals: {
    epics: number;
    stories: number;
    storiesDone: number;
    storiesBlocked: number;
    points: number;
    pointsDone: number;
    /** 0-100, redondeado. Historias done sobre total. */
    progressPct: number;
    epicsByStatus: Record<EpicStatus, number>;
  };
  storyDistribution: StoryStatusSlice[];
  epics: EpicMetricsRow[];
  pods: PodMetricsRow[];
  timeline: {
    startDate: string | null;
    targetDate: string | null;
    /** ISO date (YYYY-MM-DD) del día del cómputo. */
    today: string;
    /** % del periodo start→target transcurrido (0-100, puede exceder 100 si está vencida). Null sin fechas. */
    elapsedPct: number | null;
    /** Días calendario hasta targetDate (negativo si ya venció). Null sin targetDate. */
    daysRemaining: number | null;
  };
  dependencies: {
    /** StoryDependency con hardness='hard' entre historias de la iniciativa. */
    hardBlocks: number;
    /** StoryDependency con hardness='soft'. */
    softBlocks: number;
    /** StoryTechnicalDependency con status distinto de resolved/mitigated. */
    technicalOpen: number;
    /** Subconjunto de las abiertas marcadas isBlocking. */
    technicalBlocking: number;
  };
}

// --- Narrativa generada por IA ---

export type ExecutiveSummaryHealth = 'on_track' | 'at_risk' | 'off_track';
export type ExecutiveSummaryTone = 'positive' | 'neutral' | 'warning';
export type ExecutiveSummaryRiskSeverity = 'high' | 'medium' | 'low';

export interface ExecutiveSummaryHighlight {
  title: string;
  detail: string;
  tone: ExecutiveSummaryTone;
}

export interface ExecutiveSummaryRisk {
  title: string;
  detail: string;
  severity: ExecutiveSummaryRiskSeverity;
  mitigation?: string;
}

export interface ExecutiveSummaryRecommendation {
  title: string;
  detail: string;
}

/** Lectura ejecutiva producida por la IA — sin números propios, anclada a las métricas. */
export interface ExecutiveSummaryNarrative {
  /** Una frase ejecutiva que resume el estado de la iniciativa. */
  headline: string;
  health: ExecutiveSummaryHealth;
  /** Justificación breve del semáforo de salud. */
  healthRationale: string;
  /** 1-3 párrafos en markdown con la lectura general. */
  overview: string;
  highlights: ExecutiveSummaryHighlight[];
  risks: ExecutiveSummaryRisk[];
  recommendations: ExecutiveSummaryRecommendation[];
}

/** Resumen ejecutivo completo — persiste en `Initiative.executiveSummary` (Json). */
export interface ExecutiveSummary {
  id: string;
  initiativeId: string;
  metrics: InitiativeMetrics;
  narrative: ExecutiveSummaryNarrative;
  generatedAt: string;
  /** Display name del usuario que disparó la generación. */
  generatedByName?: string;
  model?: string;
}

// --- Eventos SSE ---

export type ExecutiveSummaryPhase = 'collecting' | 'analyzing' | 'writing' | 'done';

interface ExecutiveSummaryEventBase {
  timestamp?: string;
}

/** Eventos SSE emitidos durante la generación del resumen ejecutivo. */
export type ExecutiveSummaryEvent =
  | (ExecutiveSummaryEventBase & { type: 'run_started' })
  | (ExecutiveSummaryEventBase & { type: 'phase_change'; phase: ExecutiveSummaryPhase; label: string })
  | (ExecutiveSummaryEventBase & { type: 'thinking'; delta: string })
  | (ExecutiveSummaryEventBase & { type: 'metrics_ready'; metrics: InitiativeMetrics })
  | (ExecutiveSummaryEventBase & { type: 'summary_ready'; summary: ExecutiveSummary })
  | (ExecutiveSummaryEventBase & { type: 'run_finished'; totalDurationMs: number })
  | (ExecutiveSummaryEventBase & { type: 'done' })
  | (ExecutiveSummaryEventBase & { type: 'error'; message: string });
