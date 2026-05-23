// ════════════════════════════════════════════════════════════════════════
// Run stats — cost + tokens-new per-run, derivado de los usage del AgentRun
// ════════════════════════════════════════════════════════════════════════
//
// Extraído de factory-queue.service.ts (2026-05-20) a su propio archivo:
// es lógica pura de dominio reusada por dos callsites — `getBatchDetail`
// (AgentCard per-agent metrics) y `getRunDetail` (AgentDetailDrawer). Tener
// una sola implementación garantiza que ambos sumen lo mismo (generator +
// verifier + planner) en lugar de divergir.

/**
 * Extrae cost+tokens-new per-run, derivando de generatorUsage +
 * dodVerification + plannerUsage del run. El AgentCard y el AgentDetailDrawer
 * usan estos números para mostrar métricas reales (no del batch entero —
 * granularidad por agente).
 *
 * `tokensNew` = input + output + cache_creation, SIN cache_read (las
 * re-lecturas de cache se facturan a $0.10/1M — incluirlas infla el número
 * sin reflejar trabajo real).
 */
export function computeRunStats(run: {
  generatorUsage: unknown;
  dodVerification: unknown;
  plannerUsage: unknown;
  filesModified: number | null;
}): { costUsd: number; tokensNew: number; filesModified: number | null } {
  let costUsd = 0;
  let tokensNew = 0;
  // Generator
  const gen = run.generatorUsage as Record<string, unknown> | null;
  if (gen && typeof gen === 'object') {
    if (typeof gen.totalCostUsd === 'number') costUsd += gen.totalCostUsd;
    if (typeof gen.totalInputTokens === 'number') tokensNew += gen.totalInputTokens;
    if (typeof gen.totalOutputTokens === 'number') tokensNew += gen.totalOutputTokens;
    if (typeof gen.totalCacheCreationInputTokens === 'number')
      tokensNew += gen.totalCacheCreationInputTokens;
  }
  // Verifier
  const dod = run.dodVerification;
  if (Array.isArray(dod)) {
    for (const attemptEntry of dod) {
      const verdicts = (attemptEntry as { verdicts?: unknown } | null)?.verdicts;
      if (!Array.isArray(verdicts)) continue;
      for (const v of verdicts) {
        const usage = (v as { usage?: unknown } | null)?.usage;
        if (!usage || typeof usage !== 'object') continue;
        const u = usage as Record<string, unknown>;
        if (typeof u.totalCostUsd === 'number') costUsd += u.totalCostUsd;
        if (typeof u.inputTokens === 'number') tokensNew += u.inputTokens;
        if (typeof u.outputTokens === 'number') tokensNew += u.outputTokens;
        if (typeof u.cacheCreationInputTokens === 'number')
          tokensNew += u.cacheCreationInputTokens;
      }
    }
  }
  // Planner (pre-CLI advisor — 2026-05-18)
  const planner = run.plannerUsage as Record<string, unknown> | null;
  if (planner && typeof planner === 'object') {
    if (typeof planner.totalCostUsd === 'number') costUsd += planner.totalCostUsd;
    if (typeof planner.executorTokensIn === 'number') tokensNew += planner.executorTokensIn;
    if (typeof planner.executorTokensOut === 'number') tokensNew += planner.executorTokensOut;
    if (typeof planner.advisorTokensIn === 'number') tokensNew += planner.advisorTokensIn;
    if (typeof planner.advisorTokensOut === 'number') tokensNew += planner.advisorTokensOut;
  }
  return { costUsd, tokensNew, filesModified: run.filesModified };
}
