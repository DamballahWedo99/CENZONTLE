import type { VelocityCalibrationRow, VelocityClassification } from '@cenzontle/shared';
import { COST_COMPONENT_KEYS, computeRunComponentStats } from '../cost/cost-stats';

// ════════════════════════════════════════════════════════════════════════
// Velocity stats — funciones puras del Velocity Tracker (sin NestJS)
// ════════════════════════════════════════════════════════════════════════
//
// Cruza estimación (Story.storyPoints) contra esfuerzo real medido de los
// AgentRuns (costo + duración + attempts del DoD). Todo se normaliza contra
// la MEDIANA de la población visible (historias done con costo > 0): la
// mediana es robusta a outliers (una historia que entró en doom loop de
// retries no corre el baseline como lo haría un promedio).
//
// Estas funciones son el único punto de verdad del cálculo: las consumen
// ForgeVelocityService (endpoint con pod gating), VelocityCalibrationService
// (tabla org-wide para el prompt del PO agent) y los tests. Cambiar una
// fórmula aquí cambia TODAS las superficies a la vez — por diseño.

/**
 * Pesos del effort score compuesto. El costo pesa más porque es la señal
 * más directa de "cuánto trabajo real hizo el agente" (tokens consumidos);
 * la duración captura fricción (builds lentos, retries de red) y los
 * attempts capturan calidad (el DoD verifier rechazando intentos).
 */
export const EFFORT_WEIGHTS = { cost: 0.5, duration: 0.3, attempts: 0.2 } as const;

/**
 * Umbral SIMÉTRICO de clasificación: una historia está calibrada si su
 * ratio esfuerzo-real/esfuerzo-presupuestado cae en [1/1.5, 1.5]. Por
 * debajo se SOBRE-estimó (costó menos de lo presupuestado), por encima se
 * SUB-estimó. 1.5 ≈ un escalón Fibonacci de error (3→5, 5→8), que es la
 * granularidad mínima accionable al re-estimar.
 */
export const CALIBRATION_FACTOR = 1.5;

/**
 * Población mínima para que las medianas signifiquen algo. Por debajo,
 * TODO se reporta como 'no-data' y la calibración NO se inyecta al PO
 * agent — peor que no tener datos es calibrar contra ruido de 1-2 muestras.
 */
export const MIN_SAMPLES = 3;

/** Buckets Fibonacci válidos de la tabla de calibración. */
export const SP_BUCKETS = [1, 2, 3, 5, 8, 13] as const;

/**
 * Ventana de batches a agregar — mismo cap defensivo (CWE-770) y mismo
 * valor que ForgeCostService.MAX_BATCHES para que velocity y cost miren
 * exactamente la misma población y los números crucen entre dashboards.
 */
export const MAX_BATCHES = 50;

/**
 * Args Prisma del include de agentRuns que necesita el cálculo de esfuerzo
 * — exactamente los campos de VelocityRunInput. Compartido entre
 * ForgeVelocityService y VelocityCalibrationService para que ambas queries
 * nunca diverjan (mismo criterio que los puros de abajo). El orderBy es
 * solo determinismo del payload: la agregación es order-independent.
 */
export const AGENT_RUN_EFFORT_SELECT = {
  select: {
    generatorUsage: true,
    dodVerification: true,
    plannerUsage: true,
    attempts: true,
    status: true,
    startedAt: true,
    completedAt: true,
  },
  orderBy: { startedAt: 'desc' },
} as const;

/** Shape mínimo de AgentRun que necesita el cálculo de esfuerzo. */
export interface VelocityRunInput {
  generatorUsage: unknown;
  dodVerification: unknown;
  plannerUsage: unknown;
  attempts: number | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Esfuerzo medido de una historia, agregado across TODOS sus runs. */
export interface StoryEffortInputs {
  costUsd: number;
  durationMs: number;
  totalAttempts: number;
  runsCount: number;
  /** Max completedAt de los runs con status 'completed'; null si ninguno. */
  latestRunCompletedAt: Date | null;
}

/** Medianas poblacionales contra las que se normaliza el effort score. */
export interface VelocityMedians {
  costUsd: number;
  durationMs: number;
  attempts: number;
  storyPoints: number;
}

/** Muestra de la población de referencia (historia done con costo > 0). */
export interface VelocityPopulationSample {
  costUsd: number;
  durationMs: number;
  totalAttempts: number;
  storyPoints: number;
}

/** Historia con score ya calculado — input de la tabla de calibración. */
export interface VelocityScoredStory extends VelocityPopulationSample {
  effortScore: number;
}

/**
 * Agrega el esfuerzo real de una historia sumando TODOS sus runs, los
 * failed/abandoned incluidos — también consumieron tokens y tiempo de
 * worker, y excluirlos haría ver "baratas" justamente a las historias más
 * problemáticas (las que el Forge tuvo que reintentar desde cero).
 *
 * - costUsd: planner + generator + verifier vía computeRunComponentStats
 *   (mismo cálculo que /factory/cost — los números cruzan entre dashboards).
 * - durationMs: solo runs con AMBOS timestamps; un run colgado sin
 *   completedAt no aporta duración (no sabemos cuánta fue real).
 * - totalAttempts: Σ run.attempts con null legacy = 1 intento.
 * - latestRunCompletedAt: SOLO runs 'completed' — un failed con
 *   completedAt marca cuándo falló, no cuándo se entregó valor.
 */
export function computeStoryEffortInputs(runs: VelocityRunInput[]): StoryEffortInputs {
  let costUsd = 0;
  let durationMs = 0;
  let totalAttempts = 0;
  let latestRunCompletedAt: Date | null = null;

  for (const run of runs) {
    const stats = computeRunComponentStats(run);
    for (const key of COST_COMPONENT_KEYS) costUsd += stats[key].costUsd;

    if (run.startedAt && run.completedAt) {
      // Clamp a 0: un row con timestamps invertidos (clock skew del worker)
      // no debe restar duración al agregado.
      durationMs += Math.max(0, run.completedAt.getTime() - run.startedAt.getTime());
    }

    totalAttempts += run.attempts ?? 1;

    if (
      run.status === 'completed' &&
      run.completedAt &&
      (!latestRunCompletedAt || run.completedAt > latestRunCompletedAt)
    ) {
      latestRunCompletedAt = run.completedAt;
    }
  }

  return { costUsd, durationMs, totalAttempts, runsCount: runs.length, latestRunCompletedAt };
}

/** Mediana estándar (promedio de centrales si n es par); 0 si vacío. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Medianas de la población de referencia, componente por componente. */
export function computeMedians(population: VelocityPopulationSample[]): VelocityMedians {
  return {
    costUsd: median(population.map((s) => s.costUsd)),
    durationMs: median(population.map((s) => s.durationMs)),
    attempts: median(population.map((s) => s.totalAttempts)),
    storyPoints: median(population.map((s) => s.storyPoints)),
  };
}

/**
 * Effort score compuesto: suma ponderada de los ratios de cada componente
 * vs su mediana poblacional. 1.0 se lee "esfuerzo de la historia mediana".
 *
 * Si una mediana es 0 (p.ej. población legacy sin timestamps → mediana de
 * duración 0), ese componente se OMITE y los pesos restantes se
 * RE-NORMALIZAN a 1 — dividir por mediana 0 daría Infinity y dejar el peso
 * sin redistribuir sesgaría el score hacia abajo para toda la población.
 *
 * Null si la historia no tiene costo medible (costUsd <= 0: sin runs o
 * usage Json vacío — no hay esfuerzo que comparar) o si TODOS los
 * componentes quedaron omitidos.
 */
export function computeEffortScore(
  inputs: Pick<StoryEffortInputs, 'costUsd' | 'durationMs' | 'totalAttempts'>,
  medians: VelocityMedians,
): number | null {
  if (inputs.costUsd <= 0) return null;

  const components = [
    { weight: EFFORT_WEIGHTS.cost, value: inputs.costUsd, median: medians.costUsd },
    { weight: EFFORT_WEIGHTS.duration, value: inputs.durationMs, median: medians.durationMs },
    { weight: EFFORT_WEIGHTS.attempts, value: inputs.totalAttempts, median: medians.attempts },
  ].filter((c) => c.median > 0);

  if (components.length === 0) return null;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  return components.reduce((sum, c) => sum + (c.weight / totalWeight) * (c.value / c.median), 0);
}

/**
 * Clasifica el ratio esfuerzo-real/esfuerzo-presupuestado con el umbral
 * simétrico CALIBRATION_FACTOR. Los bordes exactos (1/1.5 y 1.5) cuentan
 * como 'calibrated' — la desigualdad es estricta para que el umbral sea
 * inclusivo en ambos extremos.
 */
export function classifyRatio(ratio: number | null): VelocityClassification {
  if (ratio === null) return 'no-data';
  if (ratio < 1 / CALIBRATION_FACTOR) return 'over';
  if (ratio > CALIBRATION_FACTOR) return 'under';
  return 'calibrated';
}

/**
 * YYYY-MM-DD del LUNES de la semana de `date`, en UTC. Semana ISO-8601
 * (lunes a domingo): getUTCDay() devuelve 0=domingo, así que el offset al
 * lunes es (day + 6) % 7 — el domingo retrocede 6 días, el lunes 0.
 * Todo en UTC para que el bucket no dependa del TZ del server.
 */
export function weekStartIso(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

/**
 * Tabla de calibración por bucket Fibonacci: solo buckets con muestras
 * (un bucket vacío no aporta evidencia y ensuciaría el prompt del PO
 * agent con filas sin datos). Historias con storyPoints fuera de
 * SP_BUCKETS (0 o valores no-Fibonacci) se ignoran — no hay bucket donde
 * acumularlas sin distorsionar el de al lado.
 *
 * ratioVsExpected = avgEffortScore / (sp / medianSP): >1 el bucket tiende
 * a SUB-estimarse, <1 a SOBRE-estimarse. Null si medianSP es 0 (población
 * entera sin puntos — no existe "esfuerzo esperado por punto").
 */
export function buildCalibrationTable(
  storiesWithScore: VelocityScoredStory[],
  medians: VelocityMedians,
): VelocityCalibrationRow[] {
  const rows: VelocityCalibrationRow[] = [];

  for (const sp of SP_BUCKETS) {
    const bucket = storiesWithScore.filter((s) => s.storyPoints === sp);
    if (bucket.length === 0) continue;

    const avg = (select: (s: VelocityScoredStory) => number) =>
      bucket.reduce((sum, s) => sum + select(s), 0) / bucket.length;

    const avgEffortScore = avg((s) => s.effortScore);
    rows.push({
      storyPoints: sp,
      samples: bucket.length,
      avgCostUsd: avg((s) => s.costUsd),
      avgDurationMs: avg((s) => s.durationMs),
      avgAttempts: avg((s) => s.totalAttempts),
      avgEffortScore,
      ratioVsExpected:
        medians.storyPoints > 0 ? avgEffortScore / (sp / medians.storyPoints) : null,
    });
  }

  return rows;
}
