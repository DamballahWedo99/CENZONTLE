import {
  buildQAReport,
  computeAutoRollbackAdvised,
  computeConfidence,
  computeRecommendation,
  decideClaimedReal,
  type LensOutcome,
} from './qa-confidence';
import type { VerifiedFinding } from './qa-types';

/**
 * Specs del núcleo puro de la síntesis del QAReport: confianza, recomendación,
 * red de auto-rollback y ensamblado del reporte. Sin I/O ni mocks.
 */

function finding(
  over: Partial<VerifiedFinding> & Pick<VerifiedFinding, 'severity' | 'claimedReal'>,
): VerifiedFinding {
  return {
    id: 'f',
    category: 'unit',
    title: 't',
    evidence: 'e',
    votes: { upheld: 3, refuted: 0, uncertain: 0 },
    ...over,
  };
}

const okLens = (lens: LensOutcome['lens']): LensOutcome => ({
  lens,
  status: 'completed',
  result: {
    status: 'completed',
    suite: { total: 10, passed: 10, failed: 0, skipped: 0, coverage: 90, durationMs: 100 },
    findings: [],
    envUrl: null,
    errorMessage: null,
    usage: null,
  },
});

describe('computeConfidence', () => {
  it('todo verde, sin fallos → 100', () => {
    expect(computeConfidence([okLens('test_suite'), okLens('e2e')], [])).toBe(100);
  });

  it('un fallo crítico real resta 40', () => {
    const verified = [finding({ severity: 'critical', claimedReal: true })];
    expect(computeConfidence([okLens('e2e')], verified)).toBe(60);
  });

  it('fallo refutado (no real) no resta', () => {
    const verified = [
      finding({ severity: 'critical', claimedReal: false, votes: { upheld: 0, refuted: 3, uncertain: 0 } }),
    ];
    expect(computeConfidence([okLens('e2e')], verified)).toBe(100);
  });

  it('lente fallido resta señal (10)', () => {
    const failed: LensOutcome = { lens: 'perf_a11y', status: 'failed', result: null };
    expect(computeConfidence([okLens('e2e'), failed], [])).toBe(90);
  });

  it('desacuerdo entre refutadores resta extra (40 + 5)', () => {
    const verified = [
      finding({ severity: 'critical', claimedReal: true, votes: { upheld: 2, refuted: 1, uncertain: 0 } }),
    ];
    expect(computeConfidence([okLens('e2e')], verified)).toBe(55);
  });

  it('clamp inferior en 0', () => {
    const many = Array.from({ length: 5 }, () => finding({ severity: 'critical', claimedReal: true }));
    expect(computeConfidence([], many)).toBe(0);
  });
});

describe('computeRecommendation', () => {
  it('sin fallos reales → rollout', () => {
    expect(computeRecommendation([])).toBe('rollout');
  });

  it('fallo crítico real → rollback', () => {
    expect(computeRecommendation([finding({ severity: 'critical', claimedReal: true })])).toBe('rollback');
  });

  it('fallo alto real → rollback', () => {
    expect(computeRecommendation([finding({ severity: 'high', claimedReal: true })])).toBe('rollback');
  });

  it('fallo medio real → rollout (no bloquea)', () => {
    expect(computeRecommendation([finding({ severity: 'medium', claimedReal: true })])).toBe('rollout');
  });

  it('fallo crítico pero NO real → rollout', () => {
    expect(computeRecommendation([finding({ severity: 'critical', claimedReal: false })])).toBe('rollout');
  });
});

describe('decideClaimedReal', () => {
  it('mayoría upheld → real', () => {
    expect(decideClaimedReal({ upheld: 2, refuted: 1, uncertain: 0 })).toBe(true);
  });
  it('mayoría refuted → no real', () => {
    expect(decideClaimedReal({ upheld: 1, refuted: 2, uncertain: 0 })).toBe(false);
  });
  it('all-uncertain → real (conservador, no se descarta en silencio)', () => {
    expect(decideClaimedReal({ upheld: 0, refuted: 0, uncertain: 3 })).toBe(true);
  });
  it('empate → real (ante la duda, surfacear)', () => {
    expect(decideClaimedReal({ upheld: 1, refuted: 1, uncertain: 1 })).toBe(true);
  });
  it('todos refutados → no real', () => {
    expect(decideClaimedReal({ upheld: 0, refuted: 3, uncertain: 0 })).toBe(false);
  });
});

describe('computeAutoRollbackAdvised', () => {
  it('crítico real → true', () => {
    expect(computeAutoRollbackAdvised([finding({ severity: 'critical', claimedReal: true })])).toBe(true);
  });
  it('alto real → false (solo crítico activa la red)', () => {
    expect(computeAutoRollbackAdvised([finding({ severity: 'high', claimedReal: true })])).toBe(false);
  });
});

describe('buildQAReport', () => {
  it('mapea lentes a las suites del QAReport', () => {
    const report = buildQAReport({
      qaRunId: 'run-1',
      batchId: 'batch-1',
      lenses: [okLens('e2e'), okLens('test_suite'), okLens('perf_a11y')],
      verified: [],
      confidence: 100,
      recommendation: 'rollout',
      narrative: 'todo bien',
      generatedAt: '2026-06-13T00:00:00.000Z',
    });
    expect(report.id).toBe('run-1');
    expect(report.batchId).toBe('batch-1');
    expect(report.recommendation).toBe('rollout');
    expect(report.confidence).toBe(100);
    expect(report.e2eResults.total).toBe(10);
    expect(report.integrationResults.total).toBe(10);
    expect(report.performanceResults.total).toBe(10);
    expect(report.logAnalysis.summary).toBe('todo bien');
    expect(report.logAnalysis.anomalyScore).toBe(0);
  });

  it('lente faltante → suite vacía (skipped)', () => {
    const report = buildQAReport({
      qaRunId: 'run-2',
      batchId: 'batch-2',
      lenses: [okLens('test_suite')],
      verified: [],
      confidence: 90,
      recommendation: 'rollout',
      narrative: '',
      generatedAt: '2026-06-13T00:00:00.000Z',
    });
    expect(report.e2eResults.total).toBe(0);
    expect(report.integrationResults.total).toBe(10);
  });
});
