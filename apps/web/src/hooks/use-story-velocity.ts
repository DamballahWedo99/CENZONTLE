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
  const [data, setData] = useState<VelocityAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getVelocityAnalytics()
      .then((fresh) => {
        if (!cancelled) setData(fresh);
      })
      .catch((err) => {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useStoryVelocity] failed to fetch', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
