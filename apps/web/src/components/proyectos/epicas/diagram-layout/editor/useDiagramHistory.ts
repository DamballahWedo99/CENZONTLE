'use client';

import { useCallback, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';

// ────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────────

export interface DiagramSnapshot {
  nodes: Node[];
  edges: Edge[];
}

export interface UseDiagramHistoryArgs {
  /** Estado actual para capturar en snapshots. */
  nodes: Node[];
  edges: Edge[];
  /** Setters para aplicar un snapshot al hacer undo/redo. */
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  /** Límite de entries en el stack. Default: 50. Más allá se descartan las más antiguas. */
  limit?: number;
}

export interface UseDiagramHistoryReturn {
  push: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Modelo del stack (exportado para testing funcional puro)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Estado inmutable del stack de historia. `past` y `future` son LIFO:
 *   - push: past <= past + snapshot; future = []
 *   - undo: future <= future + last(past); past <= init(past); aplica top(past) (o initial si vacío)
 *   - redo: past <= past + last(future); future <= init(future); aplica el movido
 *
 * NOTA: el "present" no se almacena aquí — es responsabilidad del caller
 * reflejarlo en su propio estado (setNodes/setEdges). Esto desacopla el
 * historial del render de React Flow.
 */
export interface HistoryState {
  past: DiagramSnapshot[];
  future: DiagramSnapshot[];
  limit: number;
}

export const DEFAULT_HISTORY_LIMIT = 50;

export function createEmptyHistory(limit: number = DEFAULT_HISTORY_LIMIT): HistoryState {
  return {
    past: [],
    future: [],
    limit: Math.max(1, limit | 0),
  };
}

/**
 * Empuja un snapshot al stack. Resetea el future (convención undo/redo:
 * cualquier rama "por deshacer" se descarta al hacer una nueva acción).
 * Si se excede el `limit`, se descartan las entradas más antiguas (FIFO
 * en past para no perder las acciones recientes).
 */
export function pushSnapshot(
  state: HistoryState,
  snapshot: DiagramSnapshot,
): HistoryState {
  const nextPast = [...state.past, snapshot];
  // Drop oldest si excedemos el límite.
  if (nextPast.length > state.limit) {
    nextPast.splice(0, nextPast.length - state.limit);
  }
  return {
    past: nextPast,
    future: [],
    limit: state.limit,
  };
}

export interface UndoResult {
  state: HistoryState;
  /** Snapshot a aplicar al estado del caller. `null` si no había nada que deshacer. */
  applied: DiagramSnapshot | null;
}

/**
 * Undo: saca el último del past y lo aplica. El caller es quien debe
 * mover su propio "present" al future ANTES de llamar a redo — este
 * modelo es "sin present" para simplificar (ver NOTA en HistoryState).
 *
 * En esta variante, cuando se hace undo guardamos el snapshot
 * "entrante" (top del past) también en el future, porque al redo
 * queremos poder volver al snapshot que acabamos de abandonar. Para
 * que redo devuelva "el estado previo al undo", el caller debe haber
 * llamado a `push()` con el present pre-undo. Mas simple: el caller
 * captura con push() ANTES de cada mutación, y undo/redo se mueven
 * sobre ese stack.
 *
 * Semántica final implementada:
 *   - push: past.push(current); future = [].
 *   - undo: if past.length>0 -> applied = past.pop(); future.push(applied). Caller aplica.
 *   - redo: if future.length>0 -> applied = future.pop(); past.push(applied). Caller aplica.
 *
 * Esta simetría permite ir y venir sin perder snapshots.
 */
export function undoSnapshot(state: HistoryState): UndoResult {
  if (state.past.length === 0) {
    return { state, applied: null };
  }
  const nextPast = state.past.slice(0, -1);
  const applied = state.past[state.past.length - 1];
  const nextFuture = [...state.future, applied];
  return {
    state: { past: nextPast, future: nextFuture, limit: state.limit },
    applied,
  };
}

export function redoSnapshot(state: HistoryState): UndoResult {
  if (state.future.length === 0) {
    return { state, applied: null };
  }
  const applied = state.future[state.future.length - 1];
  const nextFuture = state.future.slice(0, -1);
  const nextPast = [...state.past, applied];
  return {
    state: { past: nextPast, future: nextFuture, limit: state.limit },
    applied,
  };
}

export function clearHistory(state: HistoryState): HistoryState {
  return { past: [], future: [], limit: state.limit };
}

// ────────────────────────────────────────────────────────────────────────────
// Deep clone seguro para snapshots de React Flow
// ────────────────────────────────────────────────────────────────────────────

/**
 * Clona un snapshot de forma segura. Los `data` de los nodes pueden contener
 * funciones (callbacks de edges, onClick, etc.) que `structuredClone` rechaza
 * con DataCloneError. Estrategia: sanitizar antes de clonar, reemplazando
 * valores no-clonables por `undefined`.
 *
 * Alternativas consideradas y descartadas:
 *   - `JSON.parse(JSON.stringify(...))`: pierde `undefined`, fechas se
 *     serializan a strings, y falla silenciosamente con referencias cíclicas.
 *   - Deep clone artesanal recursivo: reinventa la rueda, frágil ante edge
 *     cases (Map, Set, Date). `structuredClone` maneja todos esos.
 *   - Ignorar y aceptar el throw: rompe la UX en el primer undo con edges
 *     que tengan callbacks.
 *
 * La sanitización es conservadora: solo strip de funciones y símbolos. Todo
 * lo demás (incluidos objetos anidados) se preserva.
 */
function sanitizeForClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForClone(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeForClone(v);
      if (sanitized !== undefined) {
        out[k] = sanitized;
      }
    }
    return out as T;
  }
  return value;
}

function cloneSnapshot(snapshot: DiagramSnapshot): DiagramSnapshot {
  const sanitized = sanitizeForClone(snapshot);
  // structuredClone está disponible en Node 17+ y todos los browsers modernos
  // soportados por Next.js 16. Fallback defensivo para entornos antiguos.
  if (typeof structuredClone === 'function') {
    return structuredClone(sanitized);
  }
  return JSON.parse(JSON.stringify(sanitized)) as DiagramSnapshot;
}

// Re-export para tests.
export const __internal = { sanitizeForClone, cloneSnapshot };

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stack de undo/redo para el editor de diagramas. Independiente de
 * `useDiagramEditor`: el integrador final compone ambos. Se expone una
 * API minimalista (push/undo/redo/clear + flags) porque el callsite
 * conoce mejor cuándo capturar snapshots (antes de cada mutación atómica).
 *
 * Implementación:
 *   - El stack vive en `useRef` para no disparar re-renders en `push`
 *     (las mutaciones son frecuentes; un re-render por push es ruido).
 *   - `canUndo`/`canRedo` SÍ necesitan re-render — usamos un contador
 *     en `useState` que se incrementa en cada mutación del stack.
 *   - `nodes`/`edges` se leen via ref (para que las callbacks estables
 *     siempre vean el estado actual sin re-crearse por cambio de ese
 *     estado, lo que invalidaría referencias en efectos del caller).
 */
export function useDiagramHistory({
  nodes,
  edges,
  setNodes,
  setEdges,
  limit = DEFAULT_HISTORY_LIMIT,
}: UseDiagramHistoryArgs): UseDiagramHistoryReturn {
  const historyRef = useRef<HistoryState>(createEmptyHistory(limit));

  // Refs del estado actual para que las callbacks no dependan de nodes/edges.
  // Si dependieran, cada cambio de nodes recrearía push/undo/redo, invalidando
  // handlers de teclado del caller (Ctrl+Z) que los memorizan.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // Contador de versión: incrementa en cada mutación del stack. Su único
  // propósito es forzar re-render para actualizar canUndo/canRedo.
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const push = useCallback(() => {
    const snapshot = cloneSnapshot({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    historyRef.current = pushSnapshot(historyRef.current, snapshot);
    bumpVersion();
  }, [bumpVersion]);

  /*
   * MODELO DE UNDO/REDO (fix del QA review):
   *
   * Los helpers `undoSnapshot`/`redoSnapshot` mueven el snapshot entre past
   * y future, pero NO capturan el estado actual. Eso hacía redo no-op:
   *   Initial [A,B]; push; add C → [A,B,C]; undo → [A,B]; redo → [A,B] (bug)
   *
   * Fix: el hook ANTES de aplicar el snapshot del past captura el estado
   * actual (post-mutación) y lo empuja al future. Simétrico para redo. Así:
   *   undo → state = [A,B], future = [[A,B,C]]  (current fue al future)
   *   redo → state = [A,B,C], past = [..., [A,B]] (current fue al past)
   *
   * Los helpers puros se mantienen intactos (sus tests aún pasan) — la
   * corrección vive solo en el wrapper del hook.
   */
  const undo = useCallback(() => {
    if (historyRef.current.past.length === 0) return;
    const currentSnapshot = cloneSnapshot({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    const prevSnapshot = historyRef.current.past[historyRef.current.past.length - 1];
    historyRef.current = {
      past: historyRef.current.past.slice(0, -1),
      future: [...historyRef.current.future, currentSnapshot],
      limit: historyRef.current.limit,
    };
    const applied = cloneSnapshot(prevSnapshot);
    setNodes(applied.nodes);
    setEdges(applied.edges);
    bumpVersion();
  }, [setNodes, setEdges, bumpVersion]);

  const redo = useCallback(() => {
    if (historyRef.current.future.length === 0) return;
    const currentSnapshot = cloneSnapshot({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    const nextSnapshot = historyRef.current.future[historyRef.current.future.length - 1];
    historyRef.current = {
      past: [...historyRef.current.past, currentSnapshot],
      future: historyRef.current.future.slice(0, -1),
      limit: historyRef.current.limit,
    };
    const applied = cloneSnapshot(nextSnapshot);
    setNodes(applied.nodes);
    setEdges(applied.edges);
    bumpVersion();
  }, [setNodes, setEdges, bumpVersion]);

  const clear = useCallback(() => {
    historyRef.current = clearHistory(historyRef.current);
    bumpVersion();
  }, [bumpVersion]);

  // `version` se usa únicamente para que el snapshot de React vea el
  // cambio; canUndo/canRedo se leen del ref (fuente de verdad).
  void version;
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
  };
}
