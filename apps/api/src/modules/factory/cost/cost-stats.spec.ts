import { computeRunComponentStats } from './cost-stats';

describe('computeRunComponentStats', () => {
  const emptyRun = {
    generatorUsage: null,
    dodVerification: null,
    plannerUsage: null,
  };

  it('los tres Json null → todo en cero', () => {
    const stats = computeRunComponentStats(emptyRun);

    expect(stats).toEqual({
      planner: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
      generator: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
      verifier: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
    });
  });

  it('shapes válidos completos → desglose exacto por componente', () => {
    const stats = computeRunComponentStats({
      generatorUsage: {
        totalCostUsd: 0.5,
        totalInputTokens: 1000,
        totalOutputTokens: 2000,
        totalCacheCreationInputTokens: 300,
        totalCacheReadInputTokens: 4000,
      },
      dodVerification: [
        {
          attempt: 1,
          verdicts: [
            {
              criterionId: 'build',
              usage: {
                totalCostUsd: 0.125,
                inputTokens: 100,
                outputTokens: 50,
                cacheCreationInputTokens: 25,
                cacheReadInputTokens: 500,
              },
            },
            {
              criterionId: 'tests',
              usage: {
                totalCostUsd: 0.125,
                inputTokens: 10,
                outputTokens: 5,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 200,
              },
            },
          ],
        },
      ],
      plannerUsage: {
        totalCostUsd: 0.25,
        executorTokensIn: 10,
        executorTokensOut: 20,
        advisorTokensIn: 30,
        advisorTokensOut: 40,
      },
    });

    expect(stats.generator).toEqual({ costUsd: 0.5, tokensNew: 3300, tokensCached: 4000 });
    expect(stats.verifier).toEqual({ costUsd: 0.25, tokensNew: 190, tokensCached: 700 });
    expect(stats.planner).toEqual({ costUsd: 0.25, tokensNew: 100, tokensCached: 0 });
  });

  it('verifier suma across múltiples attempts del DoD loop', () => {
    const attempt = (cost: number) => ({
      verdicts: [{ usage: { totalCostUsd: cost, inputTokens: 10, outputTokens: 5 } }],
    });

    const stats = computeRunComponentStats({
      ...emptyRun,
      dodVerification: [attempt(0.25), attempt(0.5)],
    });

    expect(stats.verifier).toEqual({ costUsd: 0.75, tokensNew: 30, tokensCached: 0 });
  });

  it('shapes parciales → suma solo los campos numéricos presentes', () => {
    const stats = computeRunComponentStats({
      // Generator sin tokens de cache (rows legacy pre-split).
      generatorUsage: { totalCostUsd: 0.1, totalInputTokens: 500 },
      // Verdict sin usage + verdict con usage parcial.
      dodVerification: [
        {
          verdicts: [
            { criterionId: 'build', status: 'passed' },
            { criterionId: 'tests', usage: { outputTokens: 42 } },
          ],
        },
      ],
      // Planner solo con costo (sin breakdown de tokens).
      plannerUsage: { totalCostUsd: 0.05 },
    });

    expect(stats.generator).toEqual({ costUsd: 0.1, tokensNew: 500, tokensCached: 0 });
    expect(stats.verifier).toEqual({ costUsd: 0, tokensNew: 42, tokensCached: 0 });
    expect(stats.planner).toEqual({ costUsd: 0.05, tokensNew: 0, tokensCached: 0 });
  });

  it('Json malformados (tipos incorrectos) → todo en cero sin tirar', () => {
    const stats = computeRunComponentStats({
      // Strings donde van numbers — un row corrupto no debe sumar basura.
      generatorUsage: { totalCostUsd: '0.5', totalInputTokens: '1000' },
      // dodVerification no-array y entradas no-objeto en cascada.
      dodVerification: { verdicts: 'nope' },
      plannerUsage: 'garbage',
    });

    expect(stats).toEqual({
      planner: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
      generator: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
      verifier: { costUsd: 0, tokensNew: 0, tokensCached: 0 },
    });
  });

  it('dodVerification con entradas null/no-objeto intercaladas → ignora sin tirar', () => {
    const stats = computeRunComponentStats({
      ...emptyRun,
      dodVerification: [
        null,
        'string suelto',
        { verdicts: [null, { usage: null }, { usage: { totalCostUsd: 0.5 } }] },
      ],
    });

    expect(stats.verifier).toEqual({ costUsd: 0.5, tokensNew: 0, tokensCached: 0 });
  });
});
