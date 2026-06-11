import type { CriterionVerdict, DodVerificationEntry } from '@cenzontle/shared';

/**
 * Deriva el veredicto agregado del DoD desde `agent_runs.dodVerification`
 * (Json crudo de Prisma — `unknown` hasta validar shape).
 *
 * Semántica de lectura canónica (ver DodVerificationEntry en shared):
 * merge across attempts con last-wins por criterionId — NO leer solo el
 * último entry, que durante POST `/progress` parciales arranca con
 * verdicts incompletos y descartaría los del attempt anterior.
 *
 *  - algún criterio merged en 'failed' → 'failed'
 *  - ≥1 criterio y todos passed/skipped → 'passed' (skipped = "no aplica
 *    al environment", no es failure)
 *  - sin verdicts válidos (el run nunca llegó al verifier) → 'pending'
 *
 * Función pura extraída del ForgePrsService para testear sin DI (mismo
 * patrón que gate-readiness/failure-info en queue/).
 */
export function deriveDodStatus(raw: unknown): 'pending' | 'passed' | 'failed' {
  if (!Array.isArray(raw)) return 'pending';

  const entries = [...(raw as unknown[])]
    .filter((e): e is DodVerificationEntry => {
      if (e === null || typeof e !== 'object') return false;
      const r = e as Record<string, unknown>;
      return typeof r.attempt === 'number' && Array.isArray(r.verdicts);
    })
    .sort((a, b) => a.attempt - b.attempt);

  const merged = new Map<string, CriterionVerdict['status']>();
  for (const entry of entries) {
    for (const v of entry.verdicts) {
      if (v === null || typeof v !== 'object') continue;
      const verdict = v as Partial<CriterionVerdict>;
      if (typeof verdict.criterionId !== 'string') continue;
      if (
        verdict.status === 'passed' ||
        verdict.status === 'failed' ||
        verdict.status === 'skipped'
      ) {
        merged.set(verdict.criterionId, verdict.status);
      }
    }
  }

  if (merged.size === 0) return 'pending';
  for (const status of merged.values()) {
    if (status === 'failed') return 'failed';
  }
  return 'passed';
}
