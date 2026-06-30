import type { QaFindingCategory, QaFindingSeverity } from '@cenzontle/shared';

/**
 * Shapes internos del pipeline QA (distintos de los shapes públicos del
 * dashboard en @cenzontle/shared). Un lente produce un `LensExecResult` que
 * el orquestador persiste en `qa_lens_runs.rawResults` + `reportedFindings`,
 * y el synthesizer lee de vuelta para armar el QAReport público.
 */

/** Resultado normalizado tipo suite de un lente (test_suite / e2e / perf_a11y). */
export interface LensTestSuiteResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Cobertura % si el reporter la emitió; null si no aplica. */
  coverage: number | null;
  durationMs: number;
}

/** Fallo crudo reportado por un lente, ANTES de la verificación adversarial. */
export interface RawFinding {
  /** Estable dentro del lens run (usado para enlazar los votos). */
  id: string;
  category: QaFindingCategory;
  title: string;
  /** Evidencia truncada: stack, salida del test, hunk del diff. */
  evidence: string;
  severity: QaFindingSeverity;
}

/** Uso/costo de las llamadas IA de un lente. */
export interface LensUsage {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Lo que un lente devuelve al orquestador. */
export interface LensExecResult {
  status: 'completed' | 'failed';
  /** Suite normalizada; null para security_diff (solo findings). */
  suite: LensTestSuiteResult | null;
  findings: RawFinding[];
  /** URL RFC1918 del entorno efímero servido (e2e/perf); null si no sirvió. */
  envUrl: string | null;
  errorMessage: string | null;
  usage: LensUsage | null;
}

/** Fallo tras la verificación adversarial — agrega el veredicto por voto. */
export interface VerifiedFinding extends RawFinding {
  /** Veredicto de decideClaimedReal: real salvo que la MAYORÍA lo refute
   *  (refuted <= upheld). Empate o all-uncertain → real (conservador). */
  claimedReal: boolean;
  votes: { upheld: number; refuted: number; uncertain: number };
}
