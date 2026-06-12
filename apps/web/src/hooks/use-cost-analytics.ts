'use client';

import { useEffect, useState } from 'react';
import {
  getCostAnalytics,
  type CostAnalyticsResponse,
} from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

/**
 * Hook que devuelve la respuesta de `GET /factory/cost` con polling 30s.
 *
 * Polling 30s (mismo criterio que `useFactoryMetrics`):
 *  - El backend agrega usage across TODOS los AgentRuns — mismo orden de
 *    costo que `/factory/metrics/timeseries`, no es un SELECT barato como
 *    `/factory/nodes` (5s).
 *  - Los agregados cambian al ritmo de los runs del Forge (minutos), no al
 *    segundo; refrescar más rápido solo quema queries sin cambiar el chart.
 *
 * `loading` arranca en true y se apaga al resolver la PRIMERA carga (éxito
 * o error) — los polls posteriores NO lo reactivan, para que el dashboard
 * no parpadee a skeleton cada 30s.
 *
 * Estrategia de errores: silenciamos 401 (lo maneja el client wrapper con
 * redirect a /auth/login). Otros errores se loguean y el hook conserva la
 * última respuesta válida — degradación graciosa.
 */
export function useCostAnalytics(): {
  data: CostAnalyticsResponse | null;
  loading: boolean;
} {
  const [data, setData] = useState<CostAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAndUpdate = async () => {
      try {
        const fresh = await getCostAnalytics();
        if (cancelled) return;
        setData(fresh);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useCostAnalytics] failed to fetch', err);
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
