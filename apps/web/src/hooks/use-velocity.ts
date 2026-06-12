'use client';

import { useEffect, useState } from 'react';
import {
  getVelocityAnalytics,
  type VelocityAnalyticsResponse,
} from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

/**
 * Hook que devuelve la respuesta de `GET /factory/velocity` con polling 30s.
 *
 * Polling 30s (mismo criterio que `useCostAnalytics`):
 *  - El backend cruza Story.storyPoints contra los agregados de TODOS los
 *    AgentRuns — mismo orden de costo que `/factory/cost`, no es un SELECT
 *    barato como `/factory/nodes` (5s).
 *  - La calibración cambia al ritmo de los runs del Forge (minutos), no al
 *    segundo; refrescar más rápido solo quema queries sin mover el chart.
 *
 * `loading` arranca en true y se apaga al resolver la PRIMERA carga (éxito
 * o error) — los polls posteriores NO lo reactivan, para que el dashboard
 * no parpadee a skeleton cada 30s.
 *
 * Estrategia de errores: silenciamos 401 (lo maneja el client wrapper con
 * redirect a /auth/login). Otros errores se loguean y el hook conserva la
 * última respuesta válida — degradación graciosa.
 */
export function useVelocity(): {
  data: VelocityAnalyticsResponse | null;
  loading: boolean;
} {
  const [data, setData] = useState<VelocityAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAndUpdate = async () => {
      try {
        const fresh = await getVelocityAnalytics();
        if (cancelled) return;
        setData(fresh);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useVelocity] failed to fetch', err);
        }
      } finally {
        // Idempotente: tras la primera carga los polls re-setean false (no-op).
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAndUpdate();
    const interval = setInterval(() => void fetchAndUpdate(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { data, loading };
}
