import { describe, it, expect } from 'vitest';
import { computeNodeDepths, inferLayoutDirection } from '../infer-direction';
import type { DiagramNode, DiagramEdge } from '@cenzontle/shared';

function n(id: string, type: DiagramNode['type'] = 'service'): DiagramNode {
  return { id, type, label: id };
}
function e(source: string, target: string): DiagramEdge {
  return { id: `e-${source}-${target}`, source, target };
}

describe('inferLayoutDirection', () => {
  it('pirámide ancha y baja (maxDepth<=3, maxWidth>=5) → TB', () => {
    // root con 5 hijos directos → maxWidth=5, maxDepth=1 → TB (caso "wide+shallow")
    const nodes = [n('root'), n('a'), n('b'), n('c'), n('d'), n('e2')];
    const edges = [e('root', 'a'), e('root', 'b'), e('root', 'c'), e('root', 'd'), e('root', 'e2')];
    expect(inferLayoutDirection(nodes, edges)).toBe('TB');
  });

  it('grafo lineal largo → LR (default)', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => n(`n${i}`));
    const edges = Array.from({ length: 7 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    expect(inferLayoutDirection(nodes, edges)).toBe('LR');
  });

  it('grafo corto lineal → LR (default)', () => {
    const nodes = [n('a'), n('b'), n('c')];
    const edges = [e('a', 'b'), e('b', 'c')];
    expect(inferLayoutDirection(nodes, edges)).toBe('LR');
  });

  it('grafo branching típico (4 capas, varias ramas) → LR', () => {
    // Shape similar al diagrama "Roles personalizados" del user: profundidad
    // moderada con branching. Default LR coincide con la convención del
    // diagrama de referencia DCC.
    const nodes = [
      n('root'), n('a1'), n('a2'), n('b1'), n('b2'), n('c'), n('d'),
    ];
    const edges = [
      e('root', 'a1'), e('root', 'a2'),
      e('a1', 'b1'), e('a2', 'b2'),
      e('b1', 'c'), e('b2', 'c'),
      e('c', 'd'),
    ];
    expect(inferLayoutDirection(nodes, edges)).toBe('LR');
  });

  it('pirámide ancha poco profunda → TB', () => {
    // 2 capas, 7 nodos en la capa inferior → wide+shallow → TB
    const nodes = [
      n('root'), n('n1'), n('n2'), n('n3'), n('n4'), n('n5'), n('n6'), n('n7'),
    ];
    const edges = [
      e('root', 'n1'), e('root', 'n2'), e('root', 'n3'), e('root', 'n4'),
      e('root', 'n5'), e('root', 'n6'), e('root', 'n7'),
    ];
    expect(inferLayoutDirection(nodes, edges)).toBe('TB');
  });

  it('grafo vacío → LR por default', () => {
    expect(inferLayoutDirection([], [])).toBe('LR');
  });
});

describe('computeNodeDepths — self-loop regression', () => {
  it('ignora self-loops al computar inDegree (nodo con A→A sigue siendo root)', () => {
    // Regression test: un retry-loop A→A no debe inflar el inDegree de A.
    // Sin el guard, A se excluiría de roots y su depth quedaría undefined.
    // Con el guard, A es root → depth=0 → el downstream (insertJumpConnectors
    // en useGroupedLayout) puede detectar correctamente edges largos.
    const nodes = [n('a'), n('b'), n('c')];
    const edges = [
      e('a', 'a'), // self-loop retry
      e('a', 'b'),
      e('b', 'c'),
    ];
    const depths = computeNodeDepths(nodes, edges);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(2);
  });

  it('grafo solo con self-loops → BFS alcanza a todos (no loops infinitos)', () => {
    // Edge case: si TODOS los edges son self-loops, BFS debe terminar sin
    // añadir depth extra a ningún nodo más allá de los roots.
    const nodes = [n('a'), n('b')];
    const edges = [e('a', 'a'), e('b', 'b')];
    const depths = computeNodeDepths(nodes, edges);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(0);
  });

  it('grafo con múltiples self-loops y aristas reales → depths consistentes', () => {
    // Mezcla de self-loops (retry) y flow normal. El retry no debe afectar
    // la topología del resto del grafo.
    const nodes = [n('start'), n('validate'), n('process'), n('end')];
    const edges = [
      e('start', 'validate'),
      e('validate', 'validate'), // retry loop
      e('validate', 'process'),
      e('process', 'process'), // otro retry loop
      e('process', 'end'),
    ];
    const depths = computeNodeDepths(nodes, edges);
    expect(depths.get('start')).toBe(0);
    expect(depths.get('validate')).toBe(1);
    expect(depths.get('process')).toBe(2);
    expect(depths.get('end')).toBe(3);
  });
});
