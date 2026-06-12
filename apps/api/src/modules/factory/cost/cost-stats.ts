// ════════════════════════════════════════════════════════════════════════
// Cost stats — cost + tokens POR COMPONENTE (planner/generator/verifier)
// ════════════════════════════════════════════════════════════════════════
//
// Hermano de run-stats.ts (computeRunStats): mismos campos de origen para
// costUsd/tokensNew, con DOS diferencias de contrato — granularidad
// per-componente (el dashboard desglosa dónde se va el dinero) y
// `tokensCached` (cache_read), que run-stats.ts no computa en absoluto.
// Mantener costUsd/tokensNew alineados: si un usage gana campos nuevos,
// actualizar los dos para que sigan sumando exactamente lo mismo.

export type CostComponentKey = 'planner' | 'generator' | 'verifier';

export interface CostComponentTotals {
  costUsd: number;
  tokensNew: number;
  tokensCached: number;
}

export type RunComponentStats = Record<CostComponentKey, CostComponentTotals>;

export const COST_COMPONENT_KEYS: readonly CostComponentKey[] = [
  'planner',
  'generator',
  'verifier',
];

export const emptyComponentTotals = (): CostComponentTotals => ({
  costUsd: 0,
  tokensNew: 0,
  tokensCached: 0,
});

export const emptyByComponent = (): RunComponentStats => ({
  planner: emptyComponentTotals(),
  generator: emptyComponentTotals(),
  verifier: emptyComponentTotals(),
});

/**
 * Extrae cost+tokens por componente de un run, derivando de generatorUsage +
 * dodVerification + plannerUsage.
 *
 * `tokensNew` = input + output + cache_creation, SIN cache_read (las
 * re-lecturas de cache se facturan a $0.10/1M — incluirlas infla el número
 * sin reflejar trabajo real). `tokensCached` = cache_read, separado.
 *
 * Las tres columnas son Json sin schema enforcement en BD — el narrowing
 * defensivo campo por campo evita que un row legacy o malformado tumbe el
 * endpoint entero (mismo estilo que run-stats.ts).
 */
export function computeRunComponentStats(run: {
  generatorUsage: unknown;
  dodVerification: unknown;
  plannerUsage: unknown;
}): RunComponentStats {
  const totals = emptyByComponent();

  // Generator (coder CLI — summary across DoD attempts del run)
  const gen = run.generatorUsage as Record<string, unknown> | null;
  if (gen && typeof gen === 'object') {
    const t = totals.generator;
    if (typeof gen.totalCostUsd === 'number') t.costUsd += gen.totalCostUsd;
    if (typeof gen.totalInputTokens === 'number') t.tokensNew += gen.totalInputTokens;
    if (typeof gen.totalOutputTokens === 'number') t.tokensNew += gen.totalOutputTokens;
    if (typeof gen.totalCacheCreationInputTokens === 'number')
      t.tokensNew += gen.totalCacheCreationInputTokens;
    if (typeof gen.totalCacheReadInputTokens === 'number')
      t.tokensCached += gen.totalCacheReadInputTokens;
  }

  // Verifier (dodVerification[].verdicts[].usage — un usage por verdict)
  const dod = run.dodVerification;
  if (Array.isArray(dod)) {
    const t = totals.verifier;
    for (const attemptEntry of dod) {
      const verdicts = (attemptEntry as { verdicts?: unknown } | null)?.verdicts;
      if (!Array.isArray(verdicts)) continue;
      for (const v of verdicts) {
        const usage = (v as { usage?: unknown } | null)?.usage;
        if (!usage || typeof usage !== 'object') continue;
        const u = usage as Record<string, unknown>;
        if (typeof u.totalCostUsd === 'number') t.costUsd += u.totalCostUsd;
        if (typeof u.inputTokens === 'number') t.tokensNew += u.inputTokens;
        if (typeof u.outputTokens === 'number') t.tokensNew += u.outputTokens;
        if (typeof u.cacheCreationInputTokens === 'number')
          t.tokensNew += u.cacheCreationInputTokens;
        if (typeof u.cacheReadInputTokens === 'number')
          t.tokensCached += u.cacheReadInputTokens;
      }
    }
  }

  // Planner (pre-CLI advisor — executor Sonnet + advisor Opus). No emite
  // cache_read hoy (single-shot, sin reuso de conversación), así que
  // tokensCached del planner queda en 0 por diseño.
  const planner = run.plannerUsage as Record<string, unknown> | null;
  if (planner && typeof planner === 'object') {
    const t = totals.planner;
    if (typeof planner.totalCostUsd === 'number') t.costUsd += planner.totalCostUsd;
    if (typeof planner.executorTokensIn === 'number') t.tokensNew += planner.executorTokensIn;
    if (typeof planner.executorTokensOut === 'number') t.tokensNew += planner.executorTokensOut;
    if (typeof planner.advisorTokensIn === 'number') t.tokensNew += planner.advisorTokensIn;
    if (typeof planner.advisorTokensOut === 'number') t.tokensNew += planner.advisorTokensOut;
  }

  return totals;
}
