import { describe, it, expect } from 'vitest';
import {
  MAX_RUN_DURATION_MS_DEFAULT,
  MAX_RUN_DURATION_MS_MAX,
  MAX_RUN_DURATION_MS_MIN,
  resolveMaxRunDurationMs,
} from './runner';

/**
 * Tests del resolver de max run duration del worker (runner.ts).
 *
 * El resolver es la única lógica que decide cuánto tiempo el worker
 * permite que el CLI corra antes de matarlo. Un bug acá (clamp roto,
 * default mal, type coercion) se traduce en:
 *   - Stories grandes matadas prematuramente (caso real, run cb180125)
 *   - Runaway costs si valor enorme pasa el clamp
 *   - Crash del worker si el resolver throws con input inesperado
 *
 * Cobertura objetivo: 100% branches de la función pura.
 */

describe('resolveMaxRunDurationMs', () => {
  // ─────────────────────────────────────────────────────────────────
  // Path: backend NO envió el campo (legacy claim / deploy parcial)
  // ─────────────────────────────────────────────────────────────────
  describe('fallback al DEFAULT cuando el backend no envió valor', () => {
    it('retorna DEFAULT (30 min) cuando backendValue es undefined', () => {
      const r = resolveMaxRunDurationMs(undefined);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
      expect(r.clamped).toBe(false);
    });

    it('retorna DEFAULT cuando backendValue es 0 (falsy)', () => {
      // 0 ms es claramente inválido — un worker con timeout=0 mataría el
      // CLI antes de spawn. Tratamos como "no configurado" → default.
      const r = resolveMaxRunDurationMs(0);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
      expect(r.clamped).toBe(false);
    });

    it('retorna DEFAULT cuando backendValue es negativo', () => {
      // Negativo es basura — probablemente cast erróneo de un DTO sin
      // validación, o un downgrade que dejó la BD con valor inválido.
      const r = resolveMaxRunDurationMs(-1000);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
    });

    it('retorna DEFAULT cuando backendValue es NaN', () => {
      // NaN puede pasar si el JSON del claim trae "null" coerced a Number.
      // Number.isFinite(NaN) === false, así que cae al fallback.
      const r = resolveMaxRunDurationMs(NaN);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
    });

    it('retorna DEFAULT cuando backendValue es Infinity', () => {
      // Infinity NO es válido — un timeout infinito desactiva el safety net.
      // Number.isFinite(Infinity) === false → cae al fallback.
      const r = resolveMaxRunDurationMs(Infinity);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
    });

    it('retorna DEFAULT cuando backendValue es -Infinity', () => {
      const r = resolveMaxRunDurationMs(-Infinity);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('default');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Path: valor válido dentro del rango → pasa tal cual
  // ─────────────────────────────────────────────────────────────────
  describe('valores VÁLIDOS dentro del rango [MIN, MAX] pasan sin clamp', () => {
    it('retorna el valor crudo cuando = DEFAULT (30 min)', () => {
      const r = resolveMaxRunDurationMs(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_DEFAULT);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(false);
    });

    it('retorna 60 min cuando se configura 60 min', () => {
      const r = resolveMaxRunDurationMs(3_600_000);
      expect(r.value).toBe(3_600_000);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(false);
    });

    it('retorna 90 min cuando se configura 90 min', () => {
      const r = resolveMaxRunDurationMs(5_400_000);
      expect(r.value).toBe(5_400_000);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(false);
    });

    it('retorna exactamente MIN sin clamp', () => {
      // Borde inferior: 300_000 (5 min). Debe pasar tal cual (NO clampear).
      const r = resolveMaxRunDurationMs(MAX_RUN_DURATION_MS_MIN);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MIN);
      expect(r.clamped).toBe(false);
    });

    it('retorna exactamente MAX sin clamp', () => {
      // Borde superior: 7_200_000 (2 h). Debe pasar tal cual.
      const r = resolveMaxRunDurationMs(MAX_RUN_DURATION_MS_MAX);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MAX);
      expect(r.clamped).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Path: valor fuera de rango → clamp al borde + flag true
  // ─────────────────────────────────────────────────────────────────
  describe('valores fuera del rango se CLAMPEAN al borde', () => {
    it('valores debajo del MIN se clampean al MIN', () => {
      // 60_000 (1 min) está debajo del MIN (5 min). Se sube a MIN.
      const r = resolveMaxRunDurationMs(60_000);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MIN);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(true);
    });

    it('valores arriba del MAX se clampean al MAX', () => {
      // 36_000_000 (10 h) está arriba del MAX (2 h). Se baja a MAX.
      const r = resolveMaxRunDurationMs(36_000_000);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MAX);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(true);
    });

    it('MIN - 1ms se clampea al MIN (off-by-one inferior)', () => {
      // Borde EXACTO del clamp inferior. Una violación de 1ms basta.
      const r = resolveMaxRunDurationMs(MAX_RUN_DURATION_MS_MIN - 1);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MIN);
      expect(r.clamped).toBe(true);
    });

    it('MAX + 1ms se clampea al MAX (off-by-one superior)', () => {
      const r = resolveMaxRunDurationMs(MAX_RUN_DURATION_MS_MAX + 1);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MAX);
      expect(r.clamped).toBe(true);
    });

    it('valor microscópico (1ms) se clampea al MIN', () => {
      // Aunque 1 es > 0 (no falsy), está MUY debajo del MIN. Defense in
      // depth: clampea, NO retorna a default (para que el operador en logs
      // vea "clamped from 1" y entienda que algo está mal).
      const r = resolveMaxRunDurationMs(1);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MIN);
      expect(r.source).toBe('backend');
      expect(r.clamped).toBe(true);
    });

    it('valor enorme (24 h) se clampea al MAX', () => {
      // 86_400_000 = 24 horas. Catastrófico si llegara al CLI tal cual.
      const r = resolveMaxRunDurationMs(86_400_000);
      expect(r.value).toBe(MAX_RUN_DURATION_MS_MAX);
      expect(r.clamped).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Invariantes del rango
  // ─────────────────────────────────────────────────────────────────
  describe('invariantes del rango configurado', () => {
    it('MIN < DEFAULT < MAX (sanity check)', () => {
      expect(MAX_RUN_DURATION_MS_MIN).toBeLessThan(MAX_RUN_DURATION_MS_DEFAULT);
      expect(MAX_RUN_DURATION_MS_DEFAULT).toBeLessThan(MAX_RUN_DURATION_MS_MAX);
    });

    it('MIN >= 5 min (no permitir timeouts más cortos que el setup mínimo del CLI)', () => {
      // 5 min es el piso porque solo el clone + npm install ya toma 1-3 min.
      // Cualquier valor más bajo garantiza fallar antes de que el agente arranque.
      expect(MAX_RUN_DURATION_MS_MIN).toBeGreaterThanOrEqual(300_000);
    });

    it('MAX <= 2 h (límite contra runaway cost)', () => {
      // 2 h es el techo razonable. Stories que necesitan más deben dividirse.
      expect(MAX_RUN_DURATION_MS_MAX).toBeLessThanOrEqual(7_200_000);
    });

    it('DEFAULT = 30 min (cambio backwards-compat con runner.ts:145 original)', () => {
      // Crítico: si esto cambia, runs viejos (claims sin el campo) van a
      // recibir un timeout distinto al esperado. Solo cambiar con migration.
      expect(MAX_RUN_DURATION_MS_DEFAULT).toBe(30 * 60 * 1000);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Determinismo (función pura)
  // ─────────────────────────────────────────────────────────────────
  describe('determinismo: misma entrada → misma salida', () => {
    it('llamadas múltiples con el mismo input retornan equal output', () => {
      const a = resolveMaxRunDurationMs(3_600_000);
      const b = resolveMaxRunDurationMs(3_600_000);
      expect(a).toEqual(b);
    });

    it('no muta el objeto retornado entre llamadas', () => {
      const a = resolveMaxRunDurationMs(3_600_000);
      a.value = 999;
      const b = resolveMaxRunDurationMs(3_600_000);
      expect(b.value).toBe(3_600_000);
    });
  });
});
