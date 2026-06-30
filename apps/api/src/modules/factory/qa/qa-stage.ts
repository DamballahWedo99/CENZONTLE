import type { QaStage } from '@cenzontle/shared';

/**
 * Derivación pura de la etapa post-Forge de un batch a partir de los
 * timestamps escalares del Epic. Fuente única de verdad para listQueue,
 * getBatchDetail y el read model de /factory/tests — espeja la convención
 * existente donde el stage se DERIVA de timestamps (no hay enum de stage).
 *
 * Precedencia (de más avanzado a menos): released > qa-gate-ready >
 * qa-testing > staged. Devuelve null si el batch aún no mergeó a DEV.
 */
export interface StageTimestamps {
  consolidatedPrMergedAt: Date | string | null;
  qaStartedAt: Date | string | null;
  qaCompletedAt: Date | string | null;
  releaseApprovedAt: Date | string | null;
}

export function deriveQaStage(e: StageTimestamps): QaStage | null {
  if (e.releaseApprovedAt) return 'released';
  if (e.qaCompletedAt) return 'qa-gate-ready';
  if (e.qaStartedAt) return 'qa-testing';
  if (e.consolidatedPrMergedAt) return 'staged';
  return null;
}
