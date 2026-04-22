import { describe, it, expect } from 'vitest';
import type { ProposedStory } from '@cenzontle/shared';
import { topologicalSortProposals } from './story-dag';

/** Factory de ProposedStory mínima para tests. Solo rellena campos que el sort usa. */
function p(
  clientId: string,
  blockedByClientIds: string[] = [],
): ProposedStory {
  return {
    clientId,
    title: `Story ${clientId}`,
    description: '',
    status: 'backlog',
    storyPoints: 3,
    epicId: 'epic-test',
    podId: 'pod-test',
    sprintId: null,
    labels: [],
    po: {
      background: '', objective: '', userStory: '',
      whatHowWhen: { what: '', how: '', when: '' },
      acceptanceCriteria: [], additionalNotes: '',
    },
    technical: {
      architecture: '', integrationFlow: '',
      validations: [], errorHandling: [], implementationChecklist: [],
    },
    qa: { testingStrategy: '', linkedQAMatrixId: null },
    blockedBy: blockedByClientIds.map((id) => ({
      storyClientId: id,
      hardness: 'hard' as const,
      reason: 'api_contract' as const,
      description: '',
    })),
  } as unknown as ProposedStory;
}

/** Helper: devuelve el index de clientId dentro del array resultante. */
function indexOf(arr: ProposedStory[], clientId: string): number {
  return arr.findIndex((x) => x.clientId === clientId);
}

describe('topologicalSortProposals', () => {
  it('retorna [] para input vacío', () => {
    expect(topologicalSortProposals([])).toEqual([]);
  });

  it('preserva orden cuando no hay deps', () => {
    const input = [p('a'), p('b'), p('c')];
    const result = topologicalSortProposals(input);
    expect(result).toHaveLength(3);
    expect(result.map((x) => x.clientId)).toEqual(['a', 'b', 'c']);
  });

  it('coloca bloqueantes antes que bloqueadas (A bloquea B)', () => {
    const input = [p('B', ['A']), p('A')]; // input "inverso" — B primero
    const result = topologicalSortProposals(input);
    expect(indexOf(result, 'A')).toBeLessThan(indexOf(result, 'B'));
  });

  it('maneja cadena lineal A → B → C', () => {
    const input = [p('C', ['B']), p('B', ['A']), p('A')];
    const result = topologicalSortProposals(input);
    expect(indexOf(result, 'A')).toBeLessThan(indexOf(result, 'B'));
    expect(indexOf(result, 'B')).toBeLessThan(indexOf(result, 'C'));
  });

  it('maneja diamante A → B, A → C, B→D, C→D', () => {
    const input = [
      p('D', ['B', 'C']),
      p('B', ['A']),
      p('C', ['A']),
      p('A'),
    ];
    const result = topologicalSortProposals(input);
    expect(indexOf(result, 'A')).toBeLessThan(indexOf(result, 'B'));
    expect(indexOf(result, 'A')).toBeLessThan(indexOf(result, 'C'));
    expect(indexOf(result, 'B')).toBeLessThan(indexOf(result, 'D'));
    expect(indexOf(result, 'C')).toBeLessThan(indexOf(result, 'D'));
  });

  it('ignora deps a historias fuera del batch (no cuenta in-degree)', () => {
    // B referencia "external-story" que NO está en el batch → B es raíz igual que A
    const input = [p('A'), p('B', ['external-story'])];
    const result = topologicalSortProposals(input);
    expect(result).toHaveLength(2);
    // Sin deps internas, preserva orden de entrada (Kahn's con FIFO queue)
    expect(result.map((x) => x.clientId)).toEqual(['A', 'B']);
  });

  it('maneja ciclo residual emitiendo todas las historias (mejor que perderlas)', () => {
    // Ciclo: A → B → A. No debería pasar (el backend valida) pero defensivo.
    const input = [p('A', ['B']), p('B', ['A'])];
    const result = topologicalSortProposals(input);
    expect(result).toHaveLength(2);
    const ids = result.map((x) => x.clientId).sort();
    expect(ids).toEqual(['A', 'B']);
  });

  it('ciclo parcial: los nodos en ciclo van al final, los fuera se ordenan correctamente', () => {
    // A → B → A (ciclo). C es raíz independiente. D depende de B (parte del ciclo).
    const input = [p('A', ['B']), p('B', ['A']), p('C'), p('D', ['B'])];
    const result = topologicalSortProposals(input);
    expect(result).toHaveLength(4);
    // C no está en el ciclo → debe aparecer antes que A, B, D
    expect(indexOf(result, 'C')).toBe(0);
  });

  it('no duplica historias (el ciclo residual no debe agregar las ya procesadas)', () => {
    const input = [p('A'), p('B', ['A']), p('C', ['B'])];
    const result = topologicalSortProposals(input);
    const ids = result.map((x) => x.clientId);
    expect(new Set(ids).size).toBe(3);
  });

  it('batch de 1 sin deps', () => {
    const input = [p('solo')];
    const result = topologicalSortProposals(input);
    expect(result.map((x) => x.clientId)).toEqual(['solo']);
  });

  it('batch con multiples raíces paralelas preserva orden de entrada entre raíces', () => {
    const input = [p('r1'), p('r2'), p('r3'), p('leaf', ['r2'])];
    const result = topologicalSortProposals(input);
    // Las 3 raíces salen primero (sin orden garantizado entre ellas en Kahn's)
    const leafIdx = indexOf(result, 'leaf');
    expect(leafIdx).toBe(3);
    expect(indexOf(result, 'r2')).toBeLessThan(leafIdx);
  });
});
