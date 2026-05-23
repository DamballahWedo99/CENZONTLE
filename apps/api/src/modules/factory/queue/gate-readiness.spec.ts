import { isAwaitingHumanGate } from './gate-readiness';

/**
 * Specs de isAwaitingHumanGate — la condición que decide si el merge gate
 * se renderiza. Función pura, sin mocks.
 *
 * Cubre el bug 2026-05-19 (Fase 1): un batch con stories `blocked` debe
 * alcanzar el gate. Antes la lógica solo contaba `done` y el gate nunca
 * aparecía para batches con fallos.
 */
describe('isAwaitingHumanGate', () => {
  it('batch vacío (0 stories) → false', () => {
    expect(isAwaitingHumanGate([])).toBe(false);
  });

  it('todas done → true', () => {
    expect(isAwaitingHumanGate(['done', 'done', 'done'])).toBe(true);
  });

  it('todas in_review → true', () => {
    expect(isAwaitingHumanGate(['in_review', 'in_review'])).toBe(true);
  });

  it('REGRESSION DEL BUG: todas blocked → true (el gate debe aparecer)', () => {
    expect(isAwaitingHumanGate(['blocked', 'blocked'])).toBe(true);
  });

  it('mezcla de estados terminales (done + blocked + in_review) → true', () => {
    expect(isAwaitingHumanGate(['done', 'blocked', 'in_review', 'done'])).toBe(
      true,
    );
  });

  it('una story aún en curso bloquea el gate', () => {
    expect(isAwaitingHumanGate(['done', 'done', 'running'])).toBe(false);
    expect(isAwaitingHumanGate(['done', 'claimed'])).toBe(false);
  });

  it('una story sin arrancar bloquea el gate', () => {
    expect(isAwaitingHumanGate(['done', 'blocked', 'backlog'])).toBe(false);
    expect(isAwaitingHumanGate(['done', 'todo'])).toBe(false);
    expect(isAwaitingHumanGate(['done', 'in_progress'])).toBe(false);
    expect(isAwaitingHumanGate(['done', 'qa'])).toBe(false);
  });

  it('escenario realista: 3 done + 2 blocked (doom loop) → gate aparece', () => {
    expect(
      isAwaitingHumanGate(['done', 'done', 'done', 'blocked', 'blocked']),
    ).toBe(true);
  });

  it('escenario realista: wave 0 falló, wave 1 aún en backlog → gate NO aparece', () => {
    // Sin la cascada de blocked, este es el caso que el qa-reviewer marcó:
    // S1 blocked, S2 backlog (su dep nunca llegó a done). Con la cascada,
    // S2 también sería blocked → este input no ocurriría en producción.
    expect(isAwaitingHumanGate(['blocked', 'backlog'])).toBe(false);
  });
});
