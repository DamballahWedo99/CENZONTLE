import { describe, it, expect } from 'vitest';
import {
  resolveMaxDodAttempts,
  evaluateDoomLoop,
  INITIAL_DOOM_LOOP_STATE,
  DEFAULT_DOD_ATTEMPTS,
  MIN_DOD_ATTEMPTS,
  MAX_DOD_ATTEMPTS_CAP,
  DOOM_LOOP_THRESHOLD,
  type DoomLoopState,
} from './dod-retry.js';

/**
 * Tests UNITARIOS de la policy pura del DoD retry loop.
 *
 * Estas funciones gobiernan la feature "configuración para activar retries"
 * (AgentTokenSettings → tab Factory → dodMaxAttempts). Son determinísticas y
 * sin side-effects → cada caso corre en microsegundos, sin stubs ni mocks.
 * El comportamiento integrado del loop (spawn real de claude, retry) se
 * cubre aparte en `runner.retry.e2e.test.ts`.
 */

// ═════════════════════════════════════════════════════════════════════════
// resolveMaxDodAttempts — resolución y clamp del tope de attempts
// ═════════════════════════════════════════════════════════════════════════

describe('resolveMaxDodAttempts', () => {
  describe('claim ausente o malformado → DEFAULT_DOD_ATTEMPTS (retries opt-in)', () => {
    it('undefined (claim de un backend viejo) cae al default', () => {
      expect(resolveMaxDodAttempts(undefined)).toBe(DEFAULT_DOD_ATTEMPTS);
    });

    it('NaN cae al default (payload corrupto)', () => {
      expect(resolveMaxDodAttempts(Number.NaN)).toBe(DEFAULT_DOD_ATTEMPTS);
    });

    it('Infinity cae al default — un loop infinito quemaría tokens', () => {
      expect(resolveMaxDodAttempts(Number.POSITIVE_INFINITY)).toBe(
        DEFAULT_DOD_ATTEMPTS,
      );
    });

    it('-Infinity cae al default', () => {
      expect(resolveMaxDodAttempts(Number.NEGATIVE_INFINITY)).toBe(
        DEFAULT_DOD_ATTEMPTS,
      );
    });
  });

  describe('clamp al rango [MIN_DOD_ATTEMPTS, MAX_DOD_ATTEMPTS_CAP]', () => {
    it('0 se clampea a MIN (1) — el loop siempre corre al menos una vez', () => {
      expect(resolveMaxDodAttempts(0)).toBe(MIN_DOD_ATTEMPTS);
    });

    it('un valor negativo se clampea a MIN', () => {
      expect(resolveMaxDodAttempts(-7)).toBe(MIN_DOD_ATTEMPTS);
    });

    it('un valor por encima del CAP se clampea a MAX (3)', () => {
      expect(resolveMaxDodAttempts(4)).toBe(MAX_DOD_ATTEMPTS_CAP);
    });

    it('un valor salvaje (100) se clampea a MAX — defensa contra claim corrupto', () => {
      expect(resolveMaxDodAttempts(100)).toBe(MAX_DOD_ATTEMPTS_CAP);
    });
  });

  describe('valores válidos dentro del rango pasan tal cual', () => {
    it.each([1, 2, 3])('%i → %i', (n) => {
      expect(resolveMaxDodAttempts(n)).toBe(n);
    });
  });

  describe('los floats se truncan (Math.trunc, NO se redondean)', () => {
    it('2.9 → 2 (trunc, no round a 3)', () => {
      expect(resolveMaxDodAttempts(2.9)).toBe(2);
    });

    it('1.001 → 1', () => {
      expect(resolveMaxDodAttempts(1.001)).toBe(1);
    });

    it('0.9 → trunc 0 → clamp a MIN (1)', () => {
      expect(resolveMaxDodAttempts(0.9)).toBe(MIN_DOD_ATTEMPTS);
    });

    it('3.9 → trunc 3 → 3 (dentro del rango tras truncar)', () => {
      expect(resolveMaxDodAttempts(3.9)).toBe(MAX_DOD_ATTEMPTS_CAP);
    });
  });

  describe('contrato de las constantes (no deben cambiar sin intención)', () => {
    it('el default es 1 — los retries son opt-in', () => {
      expect(DEFAULT_DOD_ATTEMPTS).toBe(1);
    });

    it('el piso es 1', () => {
      expect(MIN_DOD_ATTEMPTS).toBe(1);
    });

    it('el techo es 3 (el cambio de cap 5→3 se mantiene)', () => {
      expect(MAX_DOD_ATTEMPTS_CAP).toBe(3);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// evaluateDoomLoop — máquina de estados del doom loop
// ═════════════════════════════════════════════════════════════════════════

describe('evaluateDoomLoop', () => {
  it('el umbral de turnos malos es 2', () => {
    expect(DOOM_LOOP_THRESHOLD).toBe(2);
  });

  it('el primer turno (sin baseline) nunca dispara — solo fija el baseline', () => {
    const ev = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 3);
    expect(ev.doomLooped).toBe(false);
    expect(ev.delta).toBeNull();
    expect(ev.kind).toBeNull();
    expect(ev.state).toEqual({ previousPassedCount: 3, consecutiveBadTurns: 0 });
  });

  it('un solo turno malo no dispara (umbral = 2)', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    const t2 = evaluateDoomLoop(t1.state, 5); // estancamiento
    expect(t2.delta).toBe(0);
    expect(t2.doomLooped).toBe(false);
    expect(t2.state.consecutiveBadTurns).toBe(1);
  });

  it('2 turnos de estancamiento seguidos → doom loop con kind "stagnation"', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    const t2 = evaluateDoomLoop(t1.state, 5); // malo #1
    const t3 = evaluateDoomLoop(t2.state, 5); // malo #2 → dispara
    expect(t3.delta).toBe(0);
    expect(t3.doomLooped).toBe(true);
    expect(t3.kind).toBe('stagnation');
    expect(t3.state.consecutiveBadTurns).toBe(2);
  });

  it('2 turnos de regresión seguidos → doom loop con kind "regression"', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 8);
    const t2 = evaluateDoomLoop(t1.state, 6); // delta -2 (malo #1)
    const t3 = evaluateDoomLoop(t2.state, 4); // delta -2 (malo #2 → dispara)
    expect(t3.doomLooped).toBe(true);
    expect(t3.kind).toBe('regression');
  });

  it('estancamiento luego regresión: el kind lo decide el ÚLTIMO delta', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    const t2 = evaluateDoomLoop(t1.state, 5); // delta 0 (malo #1)
    const t3 = evaluateDoomLoop(t2.state, 3); // delta -2 (malo #2 → dispara)
    expect(t3.doomLooped).toBe(true);
    expect(t3.kind).toBe('regression'); // el último delta fue < 0
  });

  it('regresión luego estancamiento: kind = "stagnation" (último delta = 0)', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 7);
    const t2 = evaluateDoomLoop(t1.state, 4); // delta -3 (malo #1)
    const t3 = evaluateDoomLoop(t2.state, 4); // delta 0 (malo #2 → dispara)
    expect(t3.doomLooped).toBe(true);
    expect(t3.kind).toBe('stagnation');
  });

  it('un turno con progreso resetea el contador de turnos malos', () => {
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    const t2 = evaluateDoomLoop(t1.state, 5); // malo #1
    expect(t2.state.consecutiveBadTurns).toBe(1);
    const t3 = evaluateDoomLoop(t2.state, 7); // progreso → reset
    expect(t3.delta).toBe(2);
    expect(t3.doomLooped).toBe(false);
    expect(t3.kind).toBeNull();
    expect(t3.state.consecutiveBadTurns).toBe(0);
  });

  it('la secuencia malo-bueno-malo NO dispara (los turnos malos no son consecutivos)', () => {
    let s: DoomLoopState = INITIAL_DOOM_LOOP_STATE;
    s = evaluateDoomLoop(s, 5).state; // baseline
    s = evaluateDoomLoop(s, 5).state; // malo #1
    s = evaluateDoomLoop(s, 8).state; // bueno → reset
    const last = evaluateDoomLoop(s, 8); // malo #1 de nuevo (no #2)
    expect(last.doomLooped).toBe(false);
    expect(last.state.consecutiveBadTurns).toBe(1);
  });

  it('es un reducer puro — no muta el estado previo', () => {
    const prev: DoomLoopState = {
      previousPassedCount: 5,
      consecutiveBadTurns: 1,
    };
    const snapshot = { ...prev };
    evaluateDoomLoop(prev, 5);
    expect(prev).toEqual(snapshot);
  });

  it('replica el escenario real del worker: 3 attempts estancados con cap=3', () => {
    // attempt 1 verifica passed=4, attempt 2 passed=4, attempt 3 passed=4.
    // El doom loop debe cortar tras el attempt 3 (2 deltas malos: a2 y a3).
    const a1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 4);
    expect(a1.doomLooped).toBe(false); // baseline
    const a2 = evaluateDoomLoop(a1.state, 4);
    expect(a2.doomLooped).toBe(false); // 1 turno malo
    const a3 = evaluateDoomLoop(a2.state, 4);
    expect(a3.doomLooped).toBe(true); // 2 turnos malos → corta
    expect(a3.kind).toBe('stagnation');
  });

  it('progreso sostenido nunca dispara, sin importar cuántos turnos', () => {
    let s: DoomLoopState = INITIAL_DOOM_LOOP_STATE;
    for (const passed of [1, 2, 3, 5, 8]) {
      const ev = evaluateDoomLoop(s, passed);
      expect(ev.doomLooped).toBe(false);
      s = ev.state;
    }
  });

  it('passedCount idéntico a 0 entre turnos también es estancamiento', () => {
    // Caso edge: el agente nunca pasó ningún criterio (passed=0 siempre).
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 0);
    const t2 = evaluateDoomLoop(t1.state, 0); // malo #1
    const t3 = evaluateDoomLoop(t2.state, 0); // malo #2 → dispara
    expect(t3.doomLooped).toBe(true);
    expect(t3.kind).toBe('stagnation');
  });

  it('un reset externo a INITIAL_DOOM_LOOP_STATE corta la cadena de turnos malos', () => {
    // Simula el reset por hard-error de runner.ts: tras un crash de claude,
    // el caller descarta el estado acumulado (doomLoopState = INITIAL_...) y
    // el próximo attempt verificado arranca una cadena nueva.
    const t1 = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    const t2 = evaluateDoomLoop(t1.state, 5); // malo #1 — la cadena empezó
    expect(t2.state.consecutiveBadTurns).toBe(1);
    // El caller vuelve a pasar INITIAL_DOOM_LOOP_STATE (reset por crash).
    const fresh = evaluateDoomLoop(INITIAL_DOOM_LOOP_STATE, 5);
    expect(fresh.doomLooped).toBe(false);
    expect(fresh.delta).toBeNull(); // sin baseline → es un primer turno de nuevo
    expect(fresh.state.consecutiveBadTurns).toBe(0);
  });
});
