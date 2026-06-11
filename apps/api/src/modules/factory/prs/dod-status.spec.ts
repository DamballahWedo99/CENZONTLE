import { deriveDodStatus } from './dod-status';

/**
 * Specs de deriveDodStatus — el "CI" del dashboard de PRs del Forge.
 *
 * La semántica crítica es el merge across attempts con last-wins por
 * criterionId (misma lectura canónica que extractMergedVerdicts en la UI
 * del run detail): un criterio que falló en attempt 1 y pasó en attempt 2
 * cuenta como passed. Función pura, sin mocks.
 */
describe('deriveDodStatus', () => {
  const verdict = (
    criterionId: string,
    status: 'passed' | 'failed' | 'skipped',
  ) => ({
    criterionId,
    label: criterionId,
    kind: null,
    command: null,
    exitCode: null,
    output: null,
    status,
  });

  // ─── Inputs inválidos / vacíos (Json crudo de Prisma) ─────────────────

  it('null → pending (run legacy sin dodVerification)', () => {
    expect(deriveDodStatus(null)).toBe('pending');
  });

  it('undefined → pending', () => {
    expect(deriveDodStatus(undefined)).toBe('pending');
  });

  it('no-array (objeto corrupto) → pending', () => {
    expect(deriveDodStatus({ attempt: 1 })).toBe('pending');
  });

  it('array vacío → pending (nunca llegó al verifier)', () => {
    expect(deriveDodStatus([])).toBe('pending');
  });

  it('entries malformados (sin attempt o sin verdicts) se ignoran → pending', () => {
    expect(
      deriveDodStatus([null, 'basura', { attempt: 'uno', verdicts: [] }, { verdicts: [] }]),
    ).toBe('pending');
  });

  it('verdicts malformados dentro de un entry válido se ignoran', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [null, 42, { status: 'passed' }, { criterionId: 'a', status: 'inventado' }] },
      ]),
    ).toBe('pending');
  });

  // ─── Veredictos simples (un attempt) ──────────────────────────────────

  it('todos passed → passed', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('build', 'passed'), verdict('tests', 'passed')] },
      ]),
    ).toBe('passed');
  });

  it('alguno failed → failed', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('build', 'passed'), verdict('tests', 'failed')] },
      ]),
    ).toBe('failed');
  });

  it('skipped NO es failure: passed + skipped → passed', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('build', 'passed'), verdict('e2e', 'skipped')] },
      ]),
    ).toBe('passed');
  });

  it('solo skipped → passed (nada aplicaba al environment)', () => {
    expect(
      deriveDodStatus([{ attempt: 1, verdicts: [verdict('e2e', 'skipped')] }]),
    ).toBe('passed');
  });

  // ─── Merge across attempts (last-wins por criterionId) ────────────────

  it('failed en attempt 1 + passed en attempt 2 → passed (el retry recuperó)', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('tests', 'failed'), verdict('build', 'passed')] },
        { attempt: 2, verdicts: [verdict('tests', 'passed')] },
      ]),
    ).toBe('passed');
  });

  it('passed en attempt 1 + failed en attempt 2 → failed (regresión en el retry)', () => {
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('tests', 'passed')] },
        { attempt: 2, verdicts: [verdict('tests', 'failed')] },
      ]),
    ).toBe('failed');
  });

  it('attempt 2 parcial NO borra criterios del attempt 1 (progress parcial)', () => {
    // El último entry arranca con verdicts incompletos durante POST /progress.
    // Leer "solo el último" diría pending para build — el merge lo preserva.
    expect(
      deriveDodStatus([
        { attempt: 1, verdicts: [verdict('build', 'passed'), verdict('tests', 'failed')] },
        { attempt: 2, verdicts: [verdict('tests', 'passed')] },
      ]),
    ).toBe('passed');
  });

  it('entries desordenados se ordenan por attempt antes del merge', () => {
    expect(
      deriveDodStatus([
        { attempt: 2, verdicts: [verdict('tests', 'passed')] },
        { attempt: 1, verdicts: [verdict('tests', 'failed')] },
      ]),
    ).toBe('passed');
  });
});
