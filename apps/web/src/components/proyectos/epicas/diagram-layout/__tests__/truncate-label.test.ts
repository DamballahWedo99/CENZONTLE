import { describe, it, expect } from 'vitest';
import { truncateToFitPx, measureLabelPx } from '../truncate-label';

// Con CHAR_WIDTH_FACTOR = 0.6 y fontSize 11 → ancho/char ≈ 6.6px.
// Un label de 10 chars ≈ 66px, de 5 chars ≈ 33px, de 1 char ≈ 6.6px.
const FS = 11;

describe('measureLabelPx', () => {
  it('texto vacío mide 0', () => {
    expect(measureLabelPx('', FS)).toBe(0);
  });

  it('fontSize 0 mide 0 (evita divisiones raras)', () => {
    expect(measureLabelPx('hola', 0)).toBe(0);
  });

  it('10 chars a fontSize 11 ≈ 66px', () => {
    // 10 * 11 * 0.6 = 66
    expect(measureLabelPx('CONFLUENCE', FS)).toBe(66);
  });
});

describe('truncateToFitPx', () => {
  it('texto vacío → vacío', () => {
    expect(truncateToFitPx('', 100, FS)).toBe('');
  });

  it('maxWidth 0 → vacío', () => {
    expect(truncateToFitPx('hola', 0, FS)).toBe('');
  });

  it('maxWidth negativo → vacío', () => {
    expect(truncateToFitPx('hola', -50, FS)).toBe('');
  });

  it('fontSize 0 → vacío (no rompe por div/0)', () => {
    expect(truncateToFitPx('hola', 100, 0)).toBe('');
  });

  it('texto cabe completo → sin ellipsis', () => {
    // "NOTION" = 6 chars * 6.6 = 39.6px < 100px
    expect(truncateToFitPx('NOTION', 100, FS)).toBe('NOTION');
  });

  it('texto exactamente en el límite → sin ellipsis', () => {
    // "HOLA" = 4 * 6.6 = 26.4px, cabe en 27px
    expect(truncateToFitPx('HOLA', 27, FS)).toBe('HOLA');
  });

  it('CONFLUENCE apenas excede → trunca a CONFLUEN…', () => {
    // CONFLUENCE = 10 chars * 6.6 = 66px. maxWidth 60px.
    // availableWidth = 60 - 6.6 = 53.4 → keep = floor(53.4/6.6) = 8
    // Resultado: "CONFLUEN" + "…"
    expect(truncateToFitPx('CONFLUENCE', 60, FS)).toBe('CONFLUEN\u2026');
  });

  it('texto mucho más largo que el espacio → trunca agresivamente', () => {
    // 20 chars * 6.6 = 132px, maxWidth 30
    // available = 30 - 6.6 = 23.4 → keep = floor(23.4/6.6) = 3
    // Resultado: "ABC" + "…"
    expect(truncateToFitPx('ABCDEFGHIJKLMNOPQRST', 30, FS)).toBe('ABC\u2026');
  });

  it('maxWidth menor que un carácter → vacío', () => {
    // maxWidth 5px, 1 char = 6.6px. Ni el ellipsis cabe.
    expect(truncateToFitPx('hola', 5, FS)).toBe('');
  });

  it('maxWidth igual al ellipsis → vacío (no tiene sentido mostrar solo …)', () => {
    // maxWidth = charWidth (6.6), available = 0
    expect(truncateToFitPx('hola', 6.6, FS)).toBe('');
  });

  it('soporta caracteres Unicode (emojis y acentos) con misma heurística', () => {
    // "Decisión" con tilde = 8 "chars" JS (la tilde es 1 code unit).
    // 8 * 6.6 = 52.8px, cabe en 60
    expect(truncateToFitPx('Decisión', 60, FS)).toBe('Decisión');
    // "Decisión" en 40px → available = 33.4 → keep = 5 → "Decis…"
    expect(truncateToFitPx('Decisión', 40, FS)).toBe('Decis\u2026');
  });

  it('escala con fontSize: mismo texto, doble fuente, cabe en el doble', () => {
    // fontSize 22 → charWidth = 13.2. "HOLA" = 52.8px → no cabe en 40
    expect(truncateToFitPx('HOLA', 40, 22)).toBe('HO\u2026');
    // 80px → cabe completo
    expect(truncateToFitPx('HOLA', 80, 22)).toBe('HOLA');
  });
});
