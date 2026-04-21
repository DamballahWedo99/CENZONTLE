import { describe, expect, it } from 'vitest';
import { buildRoundedPath } from '../edges/WaypointEdge';

describe('buildRoundedPath', () => {
  it('devuelve string vacío sin puntos', () => {
    expect(buildRoundedPath([], 8)).toBe('');
  });

  it('devuelve string vacío con un solo punto', () => {
    expect(buildRoundedPath([{ x: 0, y: 0 }], 8)).toBe('');
  });

  it('dos puntos: línea recta M…L sin arcos', () => {
    const d = buildRoundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      8,
    );
    expect(d).toBe('M 0 0 L 100 0');
    expect(d).not.toContain('Q');
  });

  it('tres puntos en L ortogonal genera un arco Q en el vértice', () => {
    const d = buildRoundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      8,
    );
    // Entra al arco 8 px antes del vértice (x=92), arco Q con control en
    // el vértice (100,0), sale al arco 8 px después en dirección y=8.
    expect(d).toMatch(/^M 0 0 L 92 0 Q 100 0 100 8 L 100 100$/);
  });

  it('radio mayor que el segmento se clampa a la mitad', () => {
    // Segmento de 10px y radio pedido de 50 → r real = 5 (mitad).
    const d = buildRoundedPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      50,
    );
    expect(d).toContain('L 5 0');
    expect(d).toContain('Q 10 0');
    expect(d).toContain('10 5');
  });

  it('vértices coincidentes (distPrev=0) cae al L defensivo sin NaN', () => {
    const d = buildRoundedPath(
      [
        { x: 50, y: 50 },
        { x: 50, y: 50 }, // colineal / coincidente con el anterior
        { x: 150, y: 50 },
      ],
      8,
    );
    expect(d).not.toContain('NaN');
    expect(d).toMatch(/^M 50 50/);
  });

  it('polilínea con múltiples bends genera múltiples Q', () => {
    const d = buildRoundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      8,
    );
    const qCount = (d.match(/Q/g) ?? []).length;
    expect(qCount).toBe(2);
    expect(d).not.toContain('NaN');
  });

  it('nunca produce NaN o Infinity incluso con inputs patológicos', () => {
    const cases: Array<Array<{ x: number; y: number }>> = [
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: -100, y: -100 },
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    ];
    for (const points of cases) {
      const d = buildRoundedPath(points, 8);
      expect(d).not.toContain('NaN');
      expect(d).not.toContain('Infinity');
    }
  });
});
