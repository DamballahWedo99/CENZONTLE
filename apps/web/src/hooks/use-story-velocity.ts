'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getVelocityAnalytics,
  type VelocityAnalyticsResponse,
  type VelocityBatch,
  type VelocityStoryBreakdown,
} from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

interface UseStoryVelocityParams {
  /** Lookup de breakdown por historia (badge en StoryFullPage). */
  storyId?: string;
  /** Lookup de batch por épica (mini-sección Velocity en EpicFullPage). */
  epicId?: string;
}

interface UseStoryVelocityResult {
  story: VelocityStoryBreakdown | null;
  batch: VelocityBatch | null;
  loading: boolean;
}

interface FetchState {
  /** Valor de `enabled` con el que arrancó este ciclo de fetch. */
  enabled: boolean;
  loading: boolean;
  data: VelocityAnalyticsResponse | null;
}

/**
 * Hook de lookup contra `GET /factory/velocity` para los indicadores
 * secundarios (badge de desviación estimado-vs-real en historia y épica).
 *
 * Fetch ÚNICO on-mount, sin polling: el dato es histórico (esfuerzo de
 * historias ya completadas) y no cambia mientras el usuario mira la página.
 *
 * Sin ids (`storyId`/`epicId` ambos undefined) NO fetchea — esto permite a
 * los consumidores "condicionar" el fetch sin condicionar el hook (las reglas
 * de hooks prohíben llamadas condicionales): pasan `undefined` mientras la
 * historia no está done y el hook se queda quieto.
 *
 * Estrategia de errores (mismo criterio que `useCostAnalytics`): 401 se
 * silencia (lo maneja el client wrapper con redirect a /auth/login); otros
 * errores se loguean con console.warn y el hook devuelve null — los badges
 * simplemente no aparecen, degradación correcta. Igual de correcto: si la
 * historia/épica quedó fuera de la ventana de 50 batches del backend, el
 * lookup no encuentra nada y devolvemos null sin ruido.
 */
export function useStoryVelocity({
  storyId,
  epicId,
}: UseStoryVelocityParams): UseStoryVelocityResult {
  const enabled = Boolean(storyId || epicId);

  // `loading` y `data` viven en un solo state junto al valor de `enabled` que
  // arrancó el ciclo. Cuando el hook se activa o se apaga, el ciclo se reinicia
  // DURANTE el render (no desde el effect): así el primer render con el hook
  // recién activado ya reporta `loading: true` en vez de pintar un frame con el
  // `loading` del ciclo anterior. El fetch solo escribe desde sus callbacks
  // asíncronos, que además preservan `data` en el reinicio (un apagado/encendido
  // no borra el dato ya traído).
  const [fetchState, setFetchState] = useState<FetchState>(() => ({
    enabled,
    loading: enabled,
    data: null,
  }));

  if (fetchState.enabled !== enabled) {
    setFetchState((prev) => ({ enabled, loading: enabled, data: prev.data }));
  }

  const { loading, data } = fetchState;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    getVelocityAnalytics()
      .then((fresh) => {
        if (!cancelled) setFetchState((prev) => ({ ...prev, data: fresh }));
      })
      .catch((err) => {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useStoryVelocity] failed to fetch', err);
        }
      })
      .finally(() => {
        if (!cancelled) setFetchState((prev) => ({ ...prev, loading: false }));
      });

    return () => {
      cancelled = true;
    };
    // Solo `enabled` como dep: un cambio de id con el hook ya activo no
    // re-fetchea (la respuesta trae TODA la ventana, el lookup es local).
  }, [enabled]);

  const story = useMemo(() => {
    if (!data || !storyId) return null;
    return data.stories.find((s) => s.storyId === storyId) ?? null;
  }, [data, storyId]);

  const batch = useMemo(() => {
    if (!data || !epicId) return null;
    // `batches` viene ASC por enqueuedAt — ante re-encolados de la misma
    // épica nos quedamos con el batch más reciente (último match).
    const matches = data.batches.filter((b) => b.epicId === epicId);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }, [data, epicId]);

  return { story, batch, loading };
}
