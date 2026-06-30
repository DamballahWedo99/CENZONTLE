import {
  TestCategory,
  TestResult,
  type LogAnalysis,
  type QAReport,
  type QaLensKindValue,
  type QaLensStatusValue,
  type QaVerdictValue,
} from '@cenzontle/shared';
import type { LensExecResult, VerifiedFinding } from './qa-types';

/**
 * Núcleo PURO de la síntesis del QAReport: confianza, recomendación y el
 * ensamblado de los TestSuite. Sin I/O ni dependencias de Nest — testeable
 * en aislamiento. La narrativa (string) la genera el synthesizer vía IA y se
 * inyecta aquí; si falla, se pasa un fallback templado.
 */

const SEVERITY_PENALTY: Record<VerifiedFinding['severity'], number> = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 3,
};
/** Un lente que falló o quedó abandoned = señal faltante → baja la confianza. */
const MISSING_LENS_PENALTY = 10;
/** Fallo real pero con refutadores en contra = menos certeza. */
const DISAGREEMENT_PENALTY = 5;

function clamp(min: number, max: number, n: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface LensOutcome {
  lens: QaLensKindValue;
  status: QaLensStatusValue;
  result: LensExecResult | null;
}

/**
 * Confianza honesta 0-100. Arranca en 100 y resta por: fallos verificados
 * como reales (ponderado por severidad), desacuerdo entre refutadores, y
 * lentes sin señal (failed/abandoned). Que falte señal BAJA la confianza —
 * no la sube fingiendo que "no hubo fallos".
 */
export function computeConfidence(
  lenses: LensOutcome[],
  verified: VerifiedFinding[],
): number {
  let score = 100;
  for (const f of verified) {
    if (!f.claimedReal) continue;
    score -= SEVERITY_PENALTY[f.severity];
    if (f.votes.refuted > 0 || f.votes.uncertain > 0) score -= DISAGREEMENT_PENALTY;
  }
  for (const l of lenses) {
    if (l.status === 'failed' || l.status === 'abandoned') score -= MISSING_LENS_PENALTY;
  }
  return clamp(0, 100, Math.round(score));
}

/** Hay ≥1 fallo crítico verificado como real → activa la red de auto-rollback. */
export function computeAutoRollbackAdvised(verified: VerifiedFinding[]): boolean {
  return verified.some((f) => f.claimedReal && f.severity === 'critical');
}

/**
 * Decide si un fallo es REAL a partir de los votos de los refutadores. El
 * fallo se sostiene salvo que la MAYORÍA lo refute (refuted > upheld). Empate
 * o all-uncertain → real: ante la duda, conservador, se surfacea. Evita que un
 * fallo que nadie pudo confirmar NI refutar desaparezca silenciosamente.
 */
export function decideClaimedReal(votes: {
  upheld: number;
  refuted: number;
  uncertain: number;
}): boolean {
  return votes.refuted <= votes.upheld;
}

/**
 * Recomendación: rollback ante cualquier fallo real crítico O alto; rollout
 * en el resto. Conservador a propósito — el humano siempre tiene la última
 * palabra en el gate, pero la recomendación por default protege producción.
 */
export function computeRecommendation(verified: VerifiedFinding[]): QaVerdictValue {
  const hasCriticalOrHighReal = verified.some(
    (f) => f.claimedReal && (f.severity === 'critical' || f.severity === 'high'),
  );
  return hasCriticalOrHighReal ? 'rollback' : 'rollout';
}

function emptyTestSuite(
  category: TestCategory,
  name: string,
  status: QaLensStatusValue,
): import('@cenzontle/shared').TestSuite {
  return {
    id: `qa-suite-${category}`,
    category,
    storyId: null,
    name,
    result: status === 'failed' || status === 'abandoned' ? TestResult.Skipped : TestResult.Pending,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    coverage: null,
    startedAt: null,
    completedAt: null,
  };
}

function suiteFromLens(
  category: TestCategory,
  name: string,
  outcome: LensOutcome | undefined,
): import('@cenzontle/shared').TestSuite {
  if (!outcome || !outcome.result?.suite) {
    return emptyTestSuite(category, name, outcome?.status ?? 'failed');
  }
  const s = outcome.result.suite;
  const result: TestResult =
    s.failed > 0 ? TestResult.Failed : s.total > 0 ? TestResult.Passed : TestResult.Skipped;
  return {
    id: `qa-suite-${category}`,
    category,
    storyId: null,
    name,
    result,
    total: s.total,
    passed: s.passed,
    failed: s.failed,
    skipped: s.skipped,
    duration: s.durationMs,
    coverage: s.coverage,
    startedAt: null,
    completedAt: null,
  };
}

/** Ensambla el LogAnalysis a partir de los fallos verificados como reales. */
export function buildLogAnalysis(
  verified: VerifiedFinding[],
  confidence: number,
  summary: string,
): LogAnalysis {
  const real = verified.filter((f) => f.claimedReal);
  return {
    httpErrors: real.filter((f) => f.category === 'e2e' || f.category === 'functional').length,
    latencySpikes: real.filter((f) => f.category === 'performance').length,
    memoryLeaks: 0,
    unexpectedErrors: real.length,
    anomalyScore: 100 - confidence,
    summary,
  };
}

/** Arma el QAReport público (shape canónico de @cenzontle/shared). */
export function buildQAReport(input: {
  qaRunId: string;
  batchId: string;
  lenses: LensOutcome[];
  verified: VerifiedFinding[];
  confidence: number;
  recommendation: QaVerdictValue;
  narrative: string;
  generatedAt: string;
}): QAReport {
  const byLens = new Map(input.lenses.map((l) => [l.lens, l]));
  return {
    id: input.qaRunId,
    batchId: input.batchId,
    recommendation: input.recommendation,
    confidence: input.confidence,
    e2eResults: suiteFromLens(TestCategory.E2E, 'E2E (entorno efímero)', byLens.get('e2e')),
    integrationResults: suiteFromLens(
      TestCategory.Integration,
      'Suite del repo',
      byLens.get('test_suite'),
    ),
    performanceResults: suiteFromLens(
      TestCategory.Performance,
      'Performance + A11y',
      byLens.get('perf_a11y'),
    ),
    logAnalysis: buildLogAnalysis(input.verified, input.confidence, input.narrative),
    generatedAt: input.generatedAt,
  };
}
