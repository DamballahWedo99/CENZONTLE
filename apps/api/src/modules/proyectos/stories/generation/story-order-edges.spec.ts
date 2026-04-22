import {
  parseAndValidateStoryOrderEdges,
  wouldIntroduceCycle,
  type StoryOrderEdge,
  type EdgeRejectReason,
} from './story-order-edges';

/** Helper: edge mínimo válido para tests. */
function edge(
  from: number,
  blockedBy: number,
  overrides: Partial<StoryOrderEdge> = {},
): StoryOrderEdge {
  return {
    fromIndex: from,
    blockedByIndex: blockedBy,
    hardness: 'hard',
    reason: 'api_contract',
    description: '',
    ...overrides,
  };
}

describe('wouldIntroduceCycle', () => {
  it('no reporta ciclo en grafo vacío', () => {
    expect(wouldIntroduceCycle([], 5)).toBe(false);
  });

  it('no reporta ciclo en DAG lineal (0→1→2)', () => {
    const edges: StoryOrderEdge[] = [edge(0, 1), edge(1, 2)];
    expect(wouldIntroduceCycle(edges, 3)).toBe(false);
  });

  it('no reporta ciclo en DAG con múltiples raíces (0→2, 1→2)', () => {
    const edges: StoryOrderEdge[] = [edge(0, 2), edge(1, 2)];
    expect(wouldIntroduceCycle(edges, 3)).toBe(false);
  });

  it('detecta ciclo directo A↔B (0→1 y 1→0)', () => {
    const edges: StoryOrderEdge[] = [edge(0, 1), edge(1, 0)];
    expect(wouldIntroduceCycle(edges, 2)).toBe(true);
  });

  it('detecta ciclo indirecto A→B→C→A', () => {
    const edges: StoryOrderEdge[] = [edge(0, 1), edge(1, 2), edge(2, 0)];
    expect(wouldIntroduceCycle(edges, 3)).toBe(true);
  });

  it('detecta self-loop (que no debería llegar aquí pero nos aseguramos)', () => {
    const edges: StoryOrderEdge[] = [edge(0, 0)];
    expect(wouldIntroduceCycle(edges, 1)).toBe(true);
  });

  it('ignora edges con indices fuera del nodeCount sin crashear', () => {
    const edges: StoryOrderEdge[] = [edge(0, 10)]; // adjacency[0] se llena con 10, pero DFS no entra al índice 10
    // DFS solo recorre nodos [0, nodeCount), así que el edge out-of-range no dispara cycle detection
    expect(() => wouldIntroduceCycle(edges, 3)).not.toThrow();
  });
});

describe('parseAndValidateStoryOrderEdges', () => {
  it('retorna [] si el input no es array o está vacío', () => {
    expect(parseAndValidateStoryOrderEdges([], 3)).toEqual([]);
  });

  it('acepta edges válidos y preserva descripción', () => {
    const input = [
      {
        fromOutlineIndex: 1,
        blockedByOutlineIndex: 0,
        hardness: 'soft',
        reason: 'api_contract',
        description: 'B consume /api/users',
      },
    ];
    const result = parseAndValidateStoryOrderEdges(input, 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fromIndex: 1,
      blockedByIndex: 0,
      hardness: 'soft',
      reason: 'api_contract',
      description: 'B consume /api/users',
    });
  });

  it('aplica fallback a hardness="hard" cuando el valor es inválido', () => {
    const input = [
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'blocker', reason: 'api_contract', description: '' },
    ];
    const [result] = parseAndValidateStoryOrderEdges(input, 3);
    expect(result.hardness).toBe('hard');
  });

  it('aplica fallback a reason="other" cuando el valor es inválido', () => {
    const input = [
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'xyz', description: '' },
    ];
    const [result] = parseAndValidateStoryOrderEdges(input, 3);
    expect(result.reason).toBe('other');
  });

  it('trunca description a 500 chars para evitar payload gigante', () => {
    const longDesc = 'x'.repeat(1000);
    const input = [
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: longDesc },
    ];
    const [result] = parseAndValidateStoryOrderEdges(input, 3);
    expect(result.description).toHaveLength(500);
  });

  it('rechaza edge con fromIndex fuera de rango', () => {
    const reasons: EdgeRejectReason[] = [];
    const input = [{ fromOutlineIndex: 10, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: '' }];
    const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r));
    expect(result).toEqual([]);
    expect(reasons).toEqual(['out_of_range']);
  });

  it('rechaza edge con blockedByIndex negativo', () => {
    const reasons: EdgeRejectReason[] = [];
    const input = [{ fromOutlineIndex: 1, blockedByOutlineIndex: -1, hardness: 'hard', reason: 'other', description: '' }];
    const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r));
    expect(result).toEqual([]);
    expect(reasons).toEqual(['out_of_range']);
  });

  it('rechaza self-block (from === blockedBy)', () => {
    const reasons: EdgeRejectReason[] = [];
    const input = [{ fromOutlineIndex: 1, blockedByOutlineIndex: 1, hardness: 'hard', reason: 'other', description: '' }];
    const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r));
    expect(result).toEqual([]);
    expect(reasons).toEqual(['self_block']);
  });

  it('rechaza duplicados exactos', () => {
    const reasons: EdgeRejectReason[] = [];
    const input = [
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: 'a' },
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'soft', reason: 'api_contract', description: 'b' },
    ];
    const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r));
    expect(result).toHaveLength(1);
    expect(reasons).toEqual(['duplicate']);
    // Se queda con la PRIMERA (no sobreescribe)
    expect(result[0].hardness).toBe('hard');
  });

  it('rechaza edge que introduciría ciclo', () => {
    const reasons: EdgeRejectReason[] = [];
    const input = [
      { fromOutlineIndex: 0, blockedByOutlineIndex: 1, hardness: 'hard', reason: 'other', description: 'a' },
      { fromOutlineIndex: 1, blockedByOutlineIndex: 2, hardness: 'hard', reason: 'other', description: 'b' },
      { fromOutlineIndex: 2, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: 'c' }, // ciclo
    ];
    const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r));
    expect(result).toHaveLength(2);
    expect(reasons).toEqual(['cycle']);
  });

  it('ignora items que no son objetos (null, strings, undefined)', () => {
    const input = [null, 'hello', undefined, 42, { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: '' }];
    const result = parseAndValidateStoryOrderEdges(input, 3);
    expect(result).toHaveLength(1);
  });

  it('ignora items con indices no numéricos', () => {
    const input = [{ fromOutlineIndex: 'abc', blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: '' }];
    const result = parseAndValidateStoryOrderEdges(input, 3);
    expect(result).toEqual([]);
  });

  it('escenario happy-path completo: DAG de 4 historias con rutas paralelas', () => {
    const input = [
      { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'migration_order', description: '' },
      { fromOutlineIndex: 2, blockedByOutlineIndex: 0, hardness: 'soft', reason: 'shared_model', description: '' },
      { fromOutlineIndex: 3, blockedByOutlineIndex: 1, hardness: 'hard', reason: 'api_contract', description: '' },
      { fromOutlineIndex: 3, blockedByOutlineIndex: 2, hardness: 'soft', reason: 'api_contract', description: '' },
    ];
    const result = parseAndValidateStoryOrderEdges(input, 4);
    expect(result).toHaveLength(4);
  });
});
