import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { resolveCollisions } from '../collision-resolver';

function n(id: string, x: number, y: number): Node {
  return { id, type: 'serviceNode', position: { x, y }, data: { label: id } };
}

describe('resolveCollisions', () => {
  it('nodos separados no se modifican', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 0)];
    const result = resolveCollisions(nodes);
    expect(result[0].position.x).toBe(0);
    expect(result[1].position.x).toBe(300);
  });

  it('dos nodos solapando en la misma rank se separan', () => {
    // serviceNode default dims: 160x56. Margin: 24. minSeparation = 160/2 + 160/2 + 24 = 184
    const nodes = [n('a', 0, 0), n('b', 50, 0)];
    const result = resolveCollisions(nodes);
    const dx = result[1].position.x - result[0].position.x;
    // serviceNode width=160, margin=24, expected separation mínima de centro a centro = 160 + 24 = 184
    expect(dx).toBeGreaterThanOrEqual(180);
  });

  it('nodos en ranks distintos no interactúan', () => {
    const nodes = [n('a', 0, 0), n('b', 50, 100)];
    const result = resolveCollisions(nodes);
    // b está en rank distinta (y=100), no debe moverse
    expect(result[1].position.x).toBe(50);
  });

  it('array vacío retorna array vacío', () => {
    expect(resolveCollisions([])).toEqual([]);
  });

  it('empujar el segundo propaga al tercero', () => {
    const nodes = [n('a', 0, 0), n('b', 30, 0), n('c', 60, 0)];
    const result = resolveCollisions(nodes);
    const dxAB = result[1].position.x - result[0].position.x;
    const dxBC = result[2].position.x - result[1].position.x;
    // Los 3 deben quedar mínimamente separados
    expect(dxAB).toBeGreaterThanOrEqual(180);
    expect(dxBC).toBeGreaterThanOrEqual(180);
  });
});
