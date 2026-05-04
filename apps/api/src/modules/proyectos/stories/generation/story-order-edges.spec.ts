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

  it('ignora edges con indices fuera del nodeCount y NO reporta ciclo', () => {
    // Aserción semántica: el guard explícito en `wouldIntroduceCycle` descarta
    // edges out-of-range antes del DFS, así que el resultado es `false`. Antes
    // del fix HIGH del qa-reviewer, `color[v]` con `v` fuera de rango era
    // `undefined` y `=== GRAY` siempre era false → un ciclo real con índices
    // fuera de rango se reportaba como NO ciclo (silently). Ahora el path es
    // explícito: out-of-range = skip, no contribuye al grafo.
    const edges: StoryOrderEdge[] = [edge(0, 10)];
    expect(wouldIntroduceCycle(edges, 3)).toBe(false);
  });

  it('descarta edges out-of-range pero detecta ciclos válidos en el mismo array', () => {
    // Edges mezclados: uno fuera de rango (ignorado) + ciclo real (detectado).
    const edges: StoryOrderEdge[] = [edge(0, 99), edge(0, 1), edge(1, 0)];
    expect(wouldIntroduceCycle(edges, 2)).toBe(true);
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

  describe('pre-seed con existingEdges', () => {
    // Caso clave: el StoryOrderAnalyzer (5to agente) llama esta función con
    // los edges del TL como pre-seed. Sin esto, el merge cross-call podía
    // duplicar o introducir ciclos contra los del TL (HIGH del qa-reviewer
    // 2026-05-03). Estos tests garantizan paridad con el contrato.

    it('NO duplica un edge que ya está en existingEdges', () => {
      const existing: StoryOrderEdge[] = [edge(1, 0)];
      const reasons: EdgeRejectReason[] = [];
      const input = [
        // Mismo par (1, 0) que ya existe — debe ser rechazado como duplicate.
        { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'soft', reason: 'other', description: 'dup' },
        // Edge nuevo válido — debe ser aceptado.
        { fromOutlineIndex: 2, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'api_contract', description: 'new' },
      ];
      const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r), existing);
      expect(result).toHaveLength(1);
      expect(result[0].fromIndex).toBe(2);
      expect(reasons).toEqual(['duplicate']);
    });

    it('NO acepta edge que formaría ciclo CONTRA los del existingEdges', () => {
      // existing tiene 0→1; si emitimos 1→0 sería ciclo.
      const existing: StoryOrderEdge[] = [edge(0, 1)];
      const reasons: EdgeRejectReason[] = [];
      const input = [
        { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: 'cycle' },
      ];
      const result = parseAndValidateStoryOrderEdges(input, 2, (r) => reasons.push(r), existing);
      expect(result).toEqual([]);
      expect(reasons).toEqual(['cycle']);
    });

    it('detecta ciclo INDIRECTO formado entre existing + raw (existing 0→1, raw 1→2 + 2→0)', () => {
      const existing: StoryOrderEdge[] = [edge(0, 1)];
      const reasons: EdgeRejectReason[] = [];
      const input = [
        { fromOutlineIndex: 1, blockedByOutlineIndex: 2, hardness: 'hard', reason: 'other', description: 'ok' },
        // Este edge crea ciclo 0→1→2→0.
        { fromOutlineIndex: 2, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: 'cycle' },
      ];
      const result = parseAndValidateStoryOrderEdges(input, 3, (r) => reasons.push(r), existing);
      // Solo el primero pasa; el segundo se rechaza por ciclo.
      expect(result).toHaveLength(1);
      expect(result[0].fromIndex).toBe(1);
      expect(reasons).toEqual(['cycle']);
    });

    it('retorna SOLO los edges nuevos del raw (no duplica el pre-seed)', () => {
      // Contrato del API: el pre-seed NO se mezcla en el resultado, así el
      // caller puede hacer `existing.concat(parse(raw, N, cb, existing))`
      // sin riesgo de duplicar.
      const existing: StoryOrderEdge[] = [edge(0, 1)];
      const input = [
        { fromOutlineIndex: 1, blockedByOutlineIndex: 2, hardness: 'hard', reason: 'other', description: 'new' },
      ];
      const result = parseAndValidateStoryOrderEdges(input, 3, undefined, existing);
      expect(result).toHaveLength(1);
      expect(result[0].fromIndex).toBe(1);
      expect(result[0].blockedByIndex).toBe(2);
      // No incluye el edge del existing.
      expect(result.find((e) => e.fromIndex === 0 && e.blockedByIndex === 1)).toBeUndefined();
    });

    it('comportamiento legacy: existingEdges omitido se trata como []', () => {
      const input = [
        { fromOutlineIndex: 1, blockedByOutlineIndex: 0, hardness: 'hard', reason: 'other', description: '' },
      ];
      // Sin pasar existingEdges (4to argumento) — el default es [].
      const result = parseAndValidateStoryOrderEdges(input, 3);
      expect(result).toHaveLength(1);
    });
  });
});
