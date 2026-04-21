import { describe, it, expect } from 'vitest';
import { inferHandle } from '../infer-handle';

describe('inferHandle', () => {
  const S = { x: 0, y: 0 };

  // 4 handles por nodo: top/right/bottom/left. Los source handles REALES
  // en serviceNode/actor/database/state son solo 'bottom' y 'right'. 'top'
  // y 'left' son target-only. El inferHandle valida contra esto y cae a un
  // source disponible si el cálculo ideal no existe.
  const VALID_SOURCE_NON_DECISION = new Set(['bottom', 'right']);
  const VALID_SOURCE_DECISION = new Set(['bottom', 'right', 'left-out']);
  const VALID_TARGET = new Set(['top', 'left']);

  it('target abajo → source bottom (disponible), target top', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: 0, y: 100 }, 'service', 'service');
    expect(sourceHandle).toBe('bottom');
    expect(targetHandle).toBe('top');
  });

  it('target derecha → source right, target left', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: 200, y: 0 }, 'service', 'service');
    expect(sourceHandle).toBe('right');
    expect(targetHandle).toBe('left');
  });

  it('target arriba → source cae a bottom (top no es source-handle)', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: 0, y: -100 }, 'service', 'service');
    expect(VALID_SOURCE_NON_DECISION.has(sourceHandle)).toBe(true);
    expect(VALID_TARGET.has(targetHandle)).toBe(true);
  });

  it('target izquierda → source cae a fallback (left no es source-handle en service)', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: -200, y: 0 }, 'service', 'service');
    expect(VALID_SOURCE_NON_DECISION.has(sourceHandle)).toBe(true);
    expect(VALID_TARGET.has(targetHandle)).toBe(true);
  });

  it('decision con target arriba-izquierda usa left-out', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: -150, y: -150 }, 'decision', 'service');
    expect(sourceHandle).toBe('left-out');
    expect(VALID_TARGET.has(targetHandle)).toBe(true);
  });

  it('service (no decision) nunca usa left-out', () => {
    const { sourceHandle } = inferHandle(S, { x: -150, y: -150 }, 'service', 'service');
    expect(sourceHandle).not.toBe('left-out');
  });

  it('edge diagonal donde dy >= dx prefiere handle bottom', () => {
    const { sourceHandle, targetHandle } = inferHandle(S, { x: 100, y: 150 }, 'service', 'database');
    expect(sourceHandle).toBe('bottom');
    expect(targetHandle).toBe('top');
  });

  it('sourceHandle devuelto SIEMPRE es un source válido para el shape', () => {
    const samples: Array<[number, number]> = [
      [100, 0], [-100, 0], [0, 100], [0, -100],
      [100, 50], [-100, 50], [50, 100], [50, -100],
      [-50, -50], [200, -20],
    ];
    for (const [x, y] of samples) {
      const { sourceHandle, targetHandle } = inferHandle(S, { x, y }, 'service', 'service');
      expect(VALID_SOURCE_NON_DECISION.has(sourceHandle)).toBe(true);
      expect(VALID_TARGET.has(targetHandle)).toBe(true);
    }
    for (const [x, y] of samples) {
      const { sourceHandle, targetHandle } = inferHandle(S, { x, y }, 'decision', 'service');
      expect(VALID_SOURCE_DECISION.has(sourceHandle)).toBe(true);
      expect(VALID_TARGET.has(targetHandle)).toBe(true);
    }
  });

  it('decision con target abajo usa bottom (no left-out)', () => {
    const { sourceHandle } = inferHandle(S, { x: 0, y: 100 }, 'decision', 'service');
    expect(sourceHandle).toBe('bottom');
  });
});
