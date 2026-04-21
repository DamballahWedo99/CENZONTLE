import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  createEmptyHistory,
  pushSnapshot,
  undoSnapshot,
  redoSnapshot,
  clearHistory,
  DEFAULT_HISTORY_LIMIT,
  __internal,
  type DiagramSnapshot,
  type HistoryState,
} from '../editor/useDiagramHistory';

// ────────────────────────────────────────────────────────────────────────────
// Helpers de test: snapshots mínimos pero realistas
// ────────────────────────────────────────────────────────────────────────────
//
// Usamos factory functions para evitar sharing accidental de referencias
// entre tests (cada snapshot es un objeto fresh). El ID del snapshot va
// en el label del primer node para poder identificarlo en asserts.

function snap(id: string): DiagramSnapshot {
  const nodes: Node[] = [
    {
      id: `n-${id}`,
      type: 'serviceNode',
      position: { x: 0, y: 0 },
      data: { label: id, nodeType: 'service' },
    },
  ];
  const edges: Edge[] = [
    { id: `e-${id}`, source: `a`, target: `b`, label: id },
  ];
  return { nodes, edges };
}

function labelOf(s: DiagramSnapshot | null): string | null {
  if (!s) return null;
  const data = s.nodes[0]?.data as { label?: string } | undefined;
  return data?.label ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Casos del spec
// ────────────────────────────────────────────────────────────────────────────

describe('createEmptyHistory', () => {
  it('stack vacío: past y future vacíos', () => {
    const s = createEmptyHistory();
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.limit).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it('respeta el limit provisto', () => {
    const s = createEmptyHistory(10);
    expect(s.limit).toBe(10);
  });

  it('limit no positivo se clampa a 1 (degenerate pero no rompe)', () => {
    expect(createEmptyHistory(0).limit).toBe(1);
    expect(createEmptyHistory(-5).limit).toBe(1);
  });
});

describe('canUndo / canRedo (derivados del state)', () => {
  it('stack vacío: no se puede undo ni redo', () => {
    const s = createEmptyHistory();
    expect(s.past.length > 0).toBe(false); // canUndo
    expect(s.future.length > 0).toBe(false); // canRedo
  });
});

describe('pushSnapshot', () => {
  it('push 1 snapshot: past tiene 1 entry, future vacío', () => {
    const s0 = createEmptyHistory();
    const s1 = pushSnapshot(s0, snap('A'));
    expect(s1.past).toHaveLength(1);
    expect(s1.future).toHaveLength(0);
    expect(labelOf(s1.past[0])).toBe('A');
  });

  it('push múltiple conserva orden LIFO en past', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = pushSnapshot(s, snap('C'));
    expect(s.past.map(labelOf)).toEqual(['A', 'B', 'C']);
  });

  it('push no muta el state original (inmutabilidad)', () => {
    const s0 = createEmptyHistory();
    const s1 = pushSnapshot(s0, snap('A'));
    expect(s0.past).toHaveLength(0);
    expect(s1).not.toBe(s0);
  });
});

describe('undoSnapshot', () => {
  it('con past vacío: no-op, applied=null', () => {
    const s0 = createEmptyHistory();
    const { state, applied } = undoSnapshot(s0);
    expect(applied).toBeNull();
    expect(state).toEqual(s0);
  });

  it('push 1 snapshot, undo aplica ese snapshot y lo mueve a future', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    const { state, applied } = undoSnapshot(s);
    expect(labelOf(applied)).toBe('A');
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(1);
    expect(labelOf(state.future[0])).toBe('A');
  });

  it('push 3, undo 2 veces: past=[A], future=[C,B], canRedo=true', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = pushSnapshot(s, snap('C'));

    const r1 = undoSnapshot(s);
    expect(labelOf(r1.applied)).toBe('C');
    s = r1.state;

    const r2 = undoSnapshot(s);
    expect(labelOf(r2.applied)).toBe('B');
    s = r2.state;

    expect(s.past.map(labelOf)).toEqual(['A']);
    expect(s.future.map(labelOf)).toEqual(['C', 'B']);
    expect(s.future.length > 0).toBe(true); // canRedo
  });
});

describe('redoSnapshot', () => {
  it('con future vacío: no-op, applied=null', () => {
    const s0 = createEmptyHistory();
    const { state, applied } = redoSnapshot(s0);
    expect(applied).toBeNull();
    expect(state).toEqual(s0);
  });

  it('push 3, undo 2, redo 1: devuelve B, past=[A,B], future=[C]', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = pushSnapshot(s, snap('C'));
    s = undoSnapshot(s).state; // tras C -> past=[A,B], future=[C]
    s = undoSnapshot(s).state; // tras B -> past=[A], future=[C,B]

    const r = redoSnapshot(s);
    expect(labelOf(r.applied)).toBe('B');
    s = r.state;

    expect(s.past.map(labelOf)).toEqual(['A', 'B']);
    expect(s.future.map(labelOf)).toEqual(['C']);
  });

  it('undo + redo es idempotente (volvemos al mismo state)', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    const before = s;
    s = undoSnapshot(s).state;
    s = redoSnapshot(s).state;
    expect(s.past.map(labelOf)).toEqual(before.past.map(labelOf));
    expect(s.future.map(labelOf)).toEqual(before.future.map(labelOf));
  });
});

describe('push invalida el future', () => {
  it('tras undo y luego push, el future se limpia', () => {
    let s = createEmptyHistory();
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = pushSnapshot(s, snap('C'));
    s = undoSnapshot(s).state; // future=[C]
    s = undoSnapshot(s).state; // future=[C,B]
    expect(s.future.length).toBe(2);

    s = pushSnapshot(s, snap('D'));
    expect(s.future).toHaveLength(0);
    expect(s.past.map(labelOf)).toEqual(['A', 'D']);
  });
});

describe('límite del stack', () => {
  it('push 55 con limit=50: solo se conservan los últimos 50', () => {
    let s = createEmptyHistory(50);
    for (let i = 0; i < 55; i++) {
      s = pushSnapshot(s, snap(String(i)));
    }
    expect(s.past).toHaveLength(50);
    // Los primeros 5 deben haberse descartado (FIFO en past).
    // Conservamos labels "5".."54".
    expect(labelOf(s.past[0])).toBe('5');
    expect(labelOf(s.past[49])).toBe('54');
  });

  it('limit=1: solo el snapshot más reciente sobrevive', () => {
    let s = createEmptyHistory(1);
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = pushSnapshot(s, snap('C'));
    expect(s.past).toHaveLength(1);
    expect(labelOf(s.past[0])).toBe('C');
  });

  it('un push por debajo del límite no descarta nada', () => {
    let s = createEmptyHistory(3);
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    expect(s.past).toHaveLength(2);
  });
});

describe('clearHistory', () => {
  it('vacía past y future pero preserva el limit', () => {
    let s = createEmptyHistory(20);
    s = pushSnapshot(s, snap('A'));
    s = pushSnapshot(s, snap('B'));
    s = undoSnapshot(s).state;
    expect(s.past.length).toBe(1);
    expect(s.future.length).toBe(1);

    s = clearHistory(s);
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.limit).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Deep clone / sanitización
// ────────────────────────────────────────────────────────────────────────────
//
// El hook real usa cloneSnapshot dentro de push(). Validamos que la
// sanitización strippa funciones/símbolos sin romper estructuras anidadas,
// y que structuredClone no arroja DataCloneError.

describe('sanitizeForClone', () => {
  const { sanitizeForClone, cloneSnapshot } = __internal;

  it('strippa funciones en el top level', () => {
    const input = { a: 1, b: () => 42 };
    const out = sanitizeForClone(input);
    expect(out).toEqual({ a: 1 });
  });

  it('strippa funciones en objetos anidados', () => {
    const input = {
      id: 'n1',
      data: {
        label: 'hola',
        onClick: () => {},
        nested: { cb: () => {}, keep: 'yes' },
      },
    };
    const out = sanitizeForClone(input) as { id: string; data: { label: string; nested: { keep: string } } };
    expect(out.id).toBe('n1');
    expect(out.data.label).toBe('hola');
    expect(out.data.nested.keep).toBe('yes');
    expect('onClick' in out.data).toBe(false);
    expect('cb' in out.data.nested).toBe(false);
  });

  it('strippa funciones dentro de arrays', () => {
    const input = [1, () => {}, { fn: () => {}, v: 2 }, 'x'];
    const out = sanitizeForClone(input) as unknown[];
    expect(out[0]).toBe(1);
    expect(out[1]).toBeUndefined();
    expect(out[2]).toEqual({ v: 2 });
    expect(out[3]).toBe('x');
  });

  it('preserva null, undefined, strings, números, booleanos', () => {
    expect(sanitizeForClone(null)).toBeNull();
    expect(sanitizeForClone(undefined)).toBeUndefined();
    expect(sanitizeForClone('hola')).toBe('hola');
    expect(sanitizeForClone(42)).toBe(42);
    expect(sanitizeForClone(true)).toBe(true);
    expect(sanitizeForClone(false)).toBe(false);
  });

  it('cloneSnapshot NO arroja aunque data tenga callbacks (problema real de React Flow)', () => {
    const snapshot: DiagramSnapshot = {
      nodes: [
        {
          id: 'n1',
          type: 'serviceNode',
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            // Callbacks que structuredClone normalmente rechazaría.
            onRename: () => {},
            onDelete: () => {},
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          data: { onUpdate: () => {} },
        },
      ],
    };

    expect(() => cloneSnapshot(snapshot)).not.toThrow();
    const cloned = cloneSnapshot(snapshot);
    expect(cloned.nodes).toHaveLength(1);
    expect((cloned.nodes[0].data as { label: string }).label).toBe('A');
    expect('onRename' in (cloned.nodes[0].data as object)).toBe(false);
    expect(cloned.edges).toHaveLength(1);
  });

  it('cloneSnapshot produce una copia profunda (mutar el clon no afecta original)', () => {
    const original: DiagramSnapshot = {
      nodes: [
        { id: 'n1', type: 'serviceNode', position: { x: 10, y: 20 }, data: { label: 'X' } },
      ],
      edges: [],
    };
    const cloned = cloneSnapshot(original);
    // Mutamos el clon.
    cloned.nodes[0].position.x = 999;
    (cloned.nodes[0].data as { label: string }).label = 'MUTADO';
    // Original intacto.
    expect(original.nodes[0].position.x).toBe(10);
    expect((original.nodes[0].data as { label: string }).label).toBe('X');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Flujo integrado: simula el consumo del hook sin renderHook
// ────────────────────────────────────────────────────────────────────────────
//
// Emulamos el patrón callsite: el caller tiene nodes/edges, llama a push
// ANTES de mutar, y usa undo/redo para restaurar. Verifica que aplicando
// los snapshots devueltos por undo/redo al "estado del caller" obtenemos
// secuencias correctas.

describe('flujo integrado tipo callsite', () => {
  it('simula push -> mutar -> undo restaura estado pre-cambio', () => {
    const v0 = snap('v0');
    const v1 = snap('v1');

    let history: HistoryState = createEmptyHistory();
    let current = v0;

    // Caller captura v0 ANTES de aplicar v1.
    history = pushSnapshot(history, current);
    current = v1;

    // Undo debe devolver v0.
    const { state, applied } = undoSnapshot(history);
    expect(labelOf(applied)).toBe('v0');
    history = state;
    if (applied) current = applied;

    expect(labelOf(current)).toBe('v0');

    // Ahora redo debe devolvernos a v1 — pero ojo: para que redo funcione,
    // el caller debió haber puesto v1 en algún momento. En el modelo
    // "push-before-mutate", el redo sólo regresa al snapshot que undo
    // movió al future, que es v0. Si el caller quiere poder redo a v1,
    // debe push(v1) también antes de hacer undo. Verificamos ese patrón
    // en el siguiente test.
  });

  it('push-after-undo permite redo al estado intermedio', () => {
    // Modelo alternativo: el caller push snapshot del NUEVO estado
    // también. No es la convención principal pero valida la simetría.
    let history: HistoryState = createEmptyHistory();
    history = pushSnapshot(history, snap('v0'));
    history = pushSnapshot(history, snap('v1'));

    // Undo: aplica v1 (sale del past), lo manda al future.
    const r1 = undoSnapshot(history);
    expect(labelOf(r1.applied)).toBe('v1');
    history = r1.state;

    // Redo: aplica v1 de vuelta.
    const r2 = redoSnapshot(history);
    expect(labelOf(r2.applied)).toBe('v1');
  });
});
