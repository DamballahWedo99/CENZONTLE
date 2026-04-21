import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { insertJumpConnectors } from '../useGroupedLayout';
import type { EdgeWithHandles } from '../useSmartHandles';

// Nota: `MAX_LAYER_DISTANCE` está actualmente en 999 (jumps desactivados
// por UX feedback). Los tests que dependían de la generación de jumps
// para edges >=3 layers están marcados como `.skip` — si se reactiva
// la feature (bajando MAX_LAYER_DISTANCE), quitar los skip.
const MAX_LAYER_DISTANCE = 3;

function makeNode(id: string, x: number, y: number, type = 'serviceNode'): Node {
  return {
    id,
    type,
    position: { x, y },
    data: { label: id },
  };
}

function makeRefNode(id: string, x: number, y: number, label = 'A'): Node {
  return {
    id,
    type: 'reference',
    position: { x, y },
    data: { label },
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<EdgeWithHandles> = {},
): EdgeWithHandles {
  return {
    id,
    source,
    target,
    label: 'calls',
    animated: false,
    sourceHandle: 'right',
    targetHandle: 'left',
    ...overrides,
  };
}

describe('insertJumpConnectors', () => {
  describe.skip('generación inicial (sin refs pre-existentes)', () => {
    it('parte un edge largo (distance >= 3) en pares con refs', () => {
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
      ];
      const edges: EdgeWithHandles[] = [
        makeEdge('e-long', 'a', 'd'),
      ];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
      });

      const refs = result.nodes.filter((n) => n.type === 'reference');
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.id).sort()).toEqual([
        '__jmp-in__e-long',
        '__jmp-out__e-long',
      ]);
      // Los edges del par deben existir en lugar del original
      const segmentIds = result.edges.map((e) => e.id).sort();
      expect(segmentIds).toContain('__jmp-out__e-long');
      expect(segmentIds).toContain('__jmp-in__e-long');
    });

    it('NO parte un edge corto (distance < MAX_LAYER_DISTANCE)', () => {
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
      ];
      const edges: EdgeWithHandles[] = [makeEdge('e-short', 'a', 'b')];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
      });

      expect(result.nodes.filter((n) => n.type === 'reference')).toHaveLength(0);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].id).toBe('e-short');
    });
  });

  describe.skip('idempotencia (refs pre-existentes)', () => {
    it('NO duplica refs cuando ya existen en el input', () => {
      // Simulamos un diagrama ya particionado: los refs están persistidos
      // como DiagramNode (rfNodes) y los 2 edges segmentados reemplazaron
      // al edge original. El input NO trae el edge original (fue reemplazado).
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
        makeRefNode('__jmp-out__e-long', 180, 0, 'A'),
        makeRefNode('__jmp-in__e-long', 580, 0, 'A'),
      ];
      const edges: EdgeWithHandles[] = [
        makeEdge('__jmp-out__e-long', 'a', '__jmp-out__e-long'),
        makeEdge('__jmp-in__e-long', '__jmp-in__e-long', 'd'),
      ];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
      });

      // Solo debe haber 2 refs (los pre-existentes), no 4.
      const refs = result.nodes.filter((n) => n.type === 'reference');
      expect(refs).toHaveLength(2);
    });
  });

  describe.skip('grafo mixto (algunos refs pre-existentes, otros no)', () => {
    it('solo genera pares para edges que aún no tienen refs', () => {
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
        makeNode('e', 800, 0),
        // Par pre-existente para un edge hipotético ya-particionado
        makeRefNode('__jmp-out__already', 180, 0, 'A'),
        makeRefNode('__jmp-in__already', 580, 0, 'A'),
      ];
      const edges: EdgeWithHandles[] = [
        // Edge largo NUEVO, sin par pre-existente
        makeEdge('e-new-long', 'a', 'e'),
      ];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
        ['e', 4],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
      });

      // 2 refs originales + 2 nuevos = 4
      const refs = result.nodes.filter((n) => n.type === 'reference');
      expect(refs).toHaveLength(4);
      expect(refs.map((r) => r.id).sort()).toEqual([
        '__jmp-in__already',
        '__jmp-in__e-new-long',
        '__jmp-out__already',
        '__jmp-out__e-new-long',
      ]);
    });
  });

  describe('ref huérfano (uno borrado del par)', () => {
    it('renderiza sin crash cuando solo sobrevive uno del par', () => {
      // Simula que el user borró __jmp-in__e-long. El __jmp-out__e-long
      // queda solitario (huérfano visual, comportamiento correcto).
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
        makeRefNode('__jmp-out__e-long', 180, 0, 'A'),
        // __jmp-in__e-long NO está — fue borrado
      ];
      const edges: EdgeWithHandles[] = [
        makeEdge('__jmp-out__e-long', 'a', '__jmp-out__e-long'),
      ];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
      ]);

      // El punto del test es que no crashea
      expect(() =>
        insertJumpConnectors({
          rfNodes,
          edges,
          depthById,
          direction: 'LR',
        }),
      ).not.toThrow();
    });
  });

  describe.skip('draggable propaga editing flag', () => {
    it('ref nodes creados en modo editing son draggable', () => {
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
      ];
      const edges: EdgeWithHandles[] = [makeEdge('e-long', 'a', 'd')];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
        editing: true,
      });

      const refs = result.nodes.filter((n) => n.type === 'reference');
      for (const ref of refs) {
        expect(ref.draggable).toBe(true);
        expect((ref.data as { editing?: boolean }).editing).toBe(true);
      }
    });

    it('ref nodes fuera de edición NO son draggable', () => {
      const rfNodes: Node[] = [
        makeNode('a', 0, 0),
        makeNode('b', 200, 0),
        makeNode('c', 400, 0),
        makeNode('d', 600, 0),
      ];
      const edges: EdgeWithHandles[] = [makeEdge('e-long', 'a', 'd')];
      const depthById = new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 3],
      ]);

      const result = insertJumpConnectors({
        rfNodes,
        edges,
        depthById,
        direction: 'LR',
        editing: false,
      });

      const refs = result.nodes.filter((n) => n.type === 'reference');
      for (const ref of refs) {
        expect(ref.draggable).toBe(false);
      }
    });
  });
});
