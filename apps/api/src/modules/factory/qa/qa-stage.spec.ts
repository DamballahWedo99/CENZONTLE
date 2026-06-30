import { deriveQaStage } from './qa-stage';

/**
 * Specs de deriveQaStage — función pura que decide la etapa post-Forge del
 * batch a partir de timestamps del Epic. Verifica la precedencia
 * released > qa-gate-ready > qa-testing > staged.
 */
describe('deriveQaStage', () => {
  const base = {
    consolidatedPrMergedAt: null,
    qaStartedAt: null,
    qaCompletedAt: null,
    releaseApprovedAt: null,
  };

  it('sin merge a DEV → null', () => {
    expect(deriveQaStage(base)).toBeNull();
  });

  it('mergeado pero sin QA → staged', () => {
    expect(deriveQaStage({ ...base, consolidatedPrMergedAt: new Date() })).toBe('staged');
  });

  it('QA arrancado (sin completar) → qa-testing', () => {
    expect(
      deriveQaStage({ ...base, consolidatedPrMergedAt: new Date(), qaStartedAt: new Date() }),
    ).toBe('qa-testing');
  });

  it('QA completado (sin release) → qa-gate-ready', () => {
    expect(
      deriveQaStage({
        ...base,
        consolidatedPrMergedAt: new Date(),
        qaStartedAt: new Date(),
        qaCompletedAt: new Date(),
      }),
    ).toBe('qa-gate-ready');
  });

  it('release aprobado → released (precedencia máxima)', () => {
    expect(
      deriveQaStage({
        consolidatedPrMergedAt: new Date(),
        qaStartedAt: new Date(),
        qaCompletedAt: new Date(),
        releaseApprovedAt: new Date(),
      }),
    ).toBe('released');
  });

  it('released gana aunque falten timestamps intermedios', () => {
    expect(deriveQaStage({ ...base, releaseApprovedAt: new Date() })).toBe('released');
  });

  it('acepta strings ISO además de Date', () => {
    expect(
      deriveQaStage({ ...base, consolidatedPrMergedAt: '2026-06-13T00:00:00.000Z' }),
    ).toBe('staged');
  });
});
