'use client';

import { useEffect, useState } from 'react';
import type { DiagramGenerationType } from '@cenzontle/shared';
import { useProyectos } from '@/context/ProyectosContext';
import { fetchCachedDiagram } from '@/lib/diagram-agent';

export interface DiagramCacheHydrationState {
  /**
   * `true` mientras la consulta a Redis está en vuelo. El caller lo usa
   * para mostrar un spinner en vez del estado "sin diagrama" durante la
   * ventana (~50-300 ms) entre el primer render y la llegada del cache.
   */
  isHydrating: boolean;
}

/**
 * Hidrata el estado de React Context con el diagrama cacheado en Redis
 * (TTL 5 días) para la épica dada. Operación idempotente:
 *
 *   - Si ya hay un diagrama del tipo pedido en memoria, no toca nada.
 *   - Si no lo hay, consulta `GET /cached` y dispatch `SAVE_EPIC_DIAGRAM`
 *     cuando Redis responde con un diagrama.
 *   - Si Redis responde `null` (cache vacío / TTL caducado), deja el estado
 *     intacto — el consumidor mostrará el estado "sin diagrama".
 *
 * Por qué vive como hook reutilizable:
 *   DRY. Hay al menos dos rutas que necesitan esta hidratación: el tab de
 *   diagrama dentro de `EpicFullPage` y la vista dedicada `DiagramFullPage`
 *   (abierta en tab aparte). Sin este hook, cualquier nueva ruta que
 *   renderice un diagrama tendría que copiar la lógica y arriesgarse a
 *   divergir. El hook garantiza una única fuente de verdad.
 *
 * El hook también maneja la race condition típica en tabs nuevas:
 *   1. Provider arranca → `state.epics = []`.
 *   2. Provider carga épicas desde API → rawEpic disponible.
 *   3. Este effect dispara → fetch al cache → dispatch si hay diagrama.
 *   El cleanup con `cancelled` evita setState sobre componente desmontado
 *   si el usuario navega a otra épica durante el fetch.
 */
export function useDiagramCacheHydration(
  epicId: string | undefined,
  type: DiagramGenerationType = 'business',
): DiagramCacheHydrationState {
  const { state, dispatch } = useProyectos();

  const rawEpic = epicId ? state.epics.find((e) => e.id === epicId) : undefined;
  const hasDiagram = rawEpic?.diagrams.some((d) => d.type === type) ?? false;

  const [isHydrating, setIsHydrating] = useState(false);

  useEffect(() => {
    // Skip cases: no épica objetivo, ya tenemos diagrama en memoria, o el
    // Provider aún no terminó la carga inicial de épicas (rawEpic undefined
    // con state.loading). En todos, aseguramos isHydrating=false.
    if (!epicId || hasDiagram || !rawEpic) {
      setIsHydrating(false);
      return;
    }

    let cancelled = false;
    setIsHydrating(true);
    void fetchCachedDiagram(epicId, type).then((diagram) => {
      if (cancelled) return;
      setIsHydrating(false);
      if (!diagram) return;
      dispatch({ type: 'SAVE_EPIC_DIAGRAM', payload: { epicId, diagram } });
    });
    return () => {
      cancelled = true;
    };
  }, [epicId, type, hasDiagram, rawEpic, dispatch]);

  return { isHydrating };
}
