'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramGenerationType, EpicDiagram } from '@cenzontle/shared';
import { saveEditedDiagram } from '@/lib/diagram-agent';

// ────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────────

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseDiagramAutoSaveArgs {
  epicId: string;
  type: DiagramGenerationType;
  /** Diagrama actual. Comparación por identidad — re-crea el objeto para disparar save. */
  diagram: EpicDiagram | null;
  /** Típicamente `isEditing`. Si `false`, no se programan ni ejecutan saves. */
  enabled: boolean;
  /** Default 500. Ventana tras la última mutación antes de persistir. */
  debounceMs?: number;
}

export interface UseDiagramAutoSaveReturn {
  status: AutoSaveStatus;
  /** Timestamp del último save exitoso (`Date.now()`) — `null` si aún no hubo. */
  lastSavedAt: number | null;
  /** Mensaje de error del último intento fallido — `null` si no hay error. */
  error: string | null;
  /** Save inmediato sin esperar el debounce. `true` si el save tuvo éxito. */
  forceSave: () => Promise<boolean>;
  /** Reintenta el último attempt fallido con el diagrama más reciente. */
  retry: () => Promise<boolean>;
}

// ────────────────────────────────────────────────────────────────────────────
// State machine pura (exportada para testing funcional sin React)
// ────────────────────────────────────────────────────────────────────────────
//
// Modelo: el estado del auto-save tiene 4 fases (`AutoSaveStatus`) + 2 flags
// auxiliares que viven en refs dentro del hook React (no en este state
// porque no requieren re-render):
//
//   - inFlight: hay un fetch en curso (status === 'saving').
//   - pending: llegó un cambio nuevo durante un inFlight → encolar.
//
// Transiciones relevantes:
//   saveStarted → status: 'saving', mantiene lastSavedAt/error previos.
//   saveSucceeded(ts) → status: 'saved', lastSavedAt: ts, error: null.
//   saveFailed(msg) → status: 'error', error: msg, mantiene lastSavedAt.
//
// La función pura devuelve el siguiente `AutoSaveState` sin mutar.

export interface AutoSaveState {
  status: AutoSaveStatus;
  lastSavedAt: number | null;
  error: string | null;
}

export const INITIAL_AUTO_SAVE_STATE: AutoSaveState = {
  status: 'idle',
  lastSavedAt: null,
  error: null,
};

export function saveStarted(state: AutoSaveState): AutoSaveState {
  return { ...state, status: 'saving', error: null };
}

export function saveSucceeded(state: AutoSaveState, timestamp: number): AutoSaveState {
  return { status: 'saved', lastSavedAt: timestamp, error: null };
}

export function saveFailed(state: AutoSaveState, message: string): AutoSaveState {
  return { ...state, status: 'error', error: message };
}

/**
 * Formatea un timestamp como "hace Xs" / "hace Xm" / "hace Xh" para el
 * indicador. Pequeño helper puro — vive aquí porque el SaveIndicator lo
 * consume y tests pueden cubrirlo sin montar el componente.
 */
export function formatRelativeTime(from: number, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - from);
  const seconds = Math.floor(deltaMs / 1000);

  if (seconds < 5) return 'hace un momento';
  if (seconds < 60) return `hace ${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;

  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

// Re-export para tests.
export const __internal = { saveStarted, saveSucceeded, saveFailed, formatRelativeTime };

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Auto-save con debounce para el editor de diagramas. Observa cambios de
 * `diagram` (por identidad de referencia) y persiste al backend tras un
 * período de inactividad.
 *
 * Concurrencia:
 *   - Solo hay UN save en vuelo a la vez.
 *   - Si llega un cambio nuevo mientras hay uno en vuelo, se marca
 *     `pendingRef` y, al completar el actual, se dispara el encolado con
 *     el último diagram conocido.
 *   - `forceSave`/`retry` respetan la misma regla: si ya hay uno en vuelo,
 *     encolan y esperan (resuelven con el resultado del save efectivo).
 *
 * Cancellation:
 *   - Al cambiar `enabled` a false, se cancela el timer pendiente.
 *   - Los saves ya en vuelo NO se abortan (el request completó su viaje y
 *     es preferible honrar el último dato enviado que quedar en estado
 *     inconsistente con el backend).
 *   - Al desmontar, se cancela el timer y se marca `isMountedRef = false`
 *     para evitar `setState` tras unmount.
 *
 * Intencionalmente fuera del scope:
 *   - Offline queue / retry automático exponencial — overkill para un
 *     editor manual; el user decide reintentar.
 *   - Versioning / optimistic locking — el backend acepta el último
 *     write; el cache Redis (TTL 5d) no necesita CAS.
 */
export function useDiagramAutoSave({
  epicId,
  type,
  diagram,
  enabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseDiagramAutoSaveArgs): UseDiagramAutoSaveReturn {
  const [state, setState] = useState<AutoSaveState>(INITIAL_AUTO_SAVE_STATE);

  // Ref del diagrama más reciente — se actualiza en cada render para que
  // `forceSave`/`retry` siempre envíen el dato más nuevo sin depender de
  // closures obsoletas.
  const diagramRef = useRef<EpicDiagram | null>(diagram);
  diagramRef.current = diagram;

  // Refs de args estables para callbacks (no re-crear forceSave/retry en
  // cada render, que invalidaría memoization del caller).
  const epicIdRef = useRef(epicId);
  const typeRef = useRef(type);
  const enabledRef = useRef(enabled);
  epicIdRef.current = epicId;
  typeRef.current = type;
  enabledRef.current = enabled;

  // Coordinación de concurrencia.
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Seguridad: guardamos el último `setState` en un ref con guard de mount
  // para evitar "can't perform state update on unmounted component".
  const safeSetState = useCallback((updater: (prev: AutoSaveState) => AutoSaveState) => {
    if (!isMountedRef.current) return;
    setState(updater);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Ejecuta un save ahora. Maneja coordinación de concurrencia:
   *   - Si ya hay uno en vuelo, encola (pendingRef=true) y espera al drain.
   *   - Si no, marca inFlight, llama al API, aplica la transición de state.
   *   - Al terminar, si pendingRef fue set durante el vuelo, re-dispara.
   *
   * Retorna:
   *   - `true` si el save efectivo tuvo éxito.
   *   - `false` si hubo error de red, respuesta inválida, o no hay diagram.
   *
   * NOTA: cuando se encola, la promesa resuelve con el resultado del save
   * encolado (no del actual). Esto es importante para `forceSave` — el
   * caller quiere saber si sus cambios se persistieron, no un save
   * previo.
   *
   * El drain del `pending` se expresa como loop (`continue`) en vez de
   * llamada recursiva: la recursión obligaba a referenciar `runSave` dentro
   * de su propio inicializador, y es equivalente porque la re-entrada
   * ocurría siempre en posición de cola y con `inFlightRef` ya liberado.
   */
  const runSave = useCallback(async (): Promise<boolean> => {
    for (;;) {
      if (!enabledRef.current) return false;

      const current = diagramRef.current;
      if (current === null) return false;

      // Si hay uno en vuelo, encolamos y esperamos al drain vía polling ligero.
      // Alternativa considerada: una cola de resolvers en array. Descartada
      // porque el contrato es "solo importa el último cambio" — no hay valor
      // en mantener múltiples promises esperando saves intermedios.
      if (inFlightRef.current) {
        pendingRef.current = true;
        return await waitForDrain(inFlightRef, pendingRef);
      }

      inFlightRef.current = true;
      safeSetState(saveStarted);

      try {
        const diagramToSave = diagramRef.current;
        if (diagramToSave === null) {
          inFlightRef.current = false;
          return false;
        }

        const result = await saveEditedDiagram(epicIdRef.current, typeRef.current, diagramToSave);

        if (result === null) {
          safeSetState((s) => saveFailed(s, 'No se pudo guardar el diagrama. Verifica tu conexión.'));
          inFlightRef.current = false;
          // Fix QA H8: en error NO reintentamos recursivamente. Descartamos el
          // pending — el próximo debounce natural (o `retry()` del user) lo
          // reintentará. Evita cascadas error → retry → error indefinidas.
          pendingRef.current = false;
          return false;
        }

        safeSetState((s) => saveSucceeded(s, Date.now()));
        inFlightRef.current = false;

        // En éxito sí procesamos pending (el user quiere persistir lo más
        // reciente si siguió editando durante el save).
        if (pendingRef.current) {
          pendingRef.current = false;
          continue;
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido al guardar.';
        safeSetState((s) => saveFailed(s, message));
        inFlightRef.current = false;
        // Fix QA H8: igual que el path de `result === null`, no recursamos.
        pendingRef.current = false;
        return false;
      }
    }
  }, [safeSetState]);

  // ─── Debounce effect ────────────────────────────────────────────────────
  //
  // Cuando cambia `diagram` (reference) y `enabled`, arranca el timer. Si
  // el `diagram` vuelve a cambiar antes del tick, clearTimer + reset. Si
  // `enabled` pasa a false, cancelamos sin guardar.
  //
  // IMPORTANTE: `runSave` NO está en las deps porque es estable (useCallback
  // sin deps reactivas). Pero lo incluimos igual para apaciguar eslint —
  // tiene identidad estable así que no re-dispara el efecto innecesariamente.

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    if (diagram === null) {
      clearTimer();
      return;
    }

    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, debounceMs);

    return () => {
      clearTimer();
    };
  }, [diagram, enabled, debounceMs, clearTimer, runSave]);

  // Cleanup al desmontar: evitar state-update-on-unmounted + drop timers.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  // ─── API pública ────────────────────────────────────────────────────────

  const forceSave = useCallback(async (): Promise<boolean> => {
    clearTimer();
    return await runSave();
  }, [clearTimer, runSave]);

  const retry = useCallback(async (): Promise<boolean> => {
    // `retry` es semánticamente idéntico a `forceSave` en este modelo:
    // ambos saltan el debounce y persisten el diagrama más reciente. Lo
    // exponemos como método aparte porque el intent del caller es
    // diferente (reintento manual tras error UI) y mantener API clara
    // facilita testing y analytics.
    clearTimer();
    return await runSave();
  }, [clearTimer, runSave]);

  return {
    status: state.status,
    lastSavedAt: state.lastSavedAt,
    error: state.error,
    forceSave,
    retry,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

/**
 * Espera a que un save en vuelo termine, y resuelve con el resultado del
 * drain (que puede incluir el save encolado del caller).
 *
 * Implementación: microtask loop. Revisamos cada tick si `inFlightRef` se
 * liberó. En ese momento, el save encolado ya habrá sido disparado por
 * `runSave`, que a su vez puede haber marcado `pendingRef` de nuevo. El
 * loop termina cuando ni está en vuelo ni queda pending.
 *
 * Alternativa considerada: un sistema de event emitter con resolvers
 * suscritos al "drain". Descartada por overkill — un polling de
 * microtasks pesa <1ms y no afecta UX.
 */
async function waitForDrain(
  inFlightRef: { current: boolean },
  pendingRef: { current: boolean },
): Promise<boolean> {
  // Espera hasta que el ciclo inFlight/pending termine. Timeout defensivo
  // de ~30s para no colgar la promesa ante bugs (cada 10ms → 3000 iter).
  const maxIter = 3000;
  for (let i = 0; i < maxIter; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (!inFlightRef.current && !pendingRef.current) {
      return true;
    }
  }
  // Timeout: no queremos dejar la promesa colgada. Reportamos false y que
  // el caller decida (el status del hook reflejará el estado real).
  return false;
}
