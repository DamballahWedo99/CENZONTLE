'use client';

import { useEffect, useState } from 'react';
import {
  getFactoryMetrics,
  type FactoryMetricsResponse,
} from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

/**
 * Hook que devuelve la respuesta de `GET /factory/metrics/timeseries` con
 * polling 30s. Devuelve `null` mientras carga, o si el fetch falla y no hay
 * data previa (los charts deciden si renderizar mock fallback en ese caso).
 *
 * Polling 30s es deliberadamente más lento que `useEffectiveResourcePool`
 * (5s):
 *  - Los charts son históricos por hora; data más fresca no cambia los
 *    primeros 23 buckets, solo el actual.
 *  - La agregación escanea ~240 runs y resuelve JSON en JS — caro vs
 *    `/factory/nodes` que es un SELECT directo.
 *  - El operador no espera ver el chart cambiar al segundo; el current-hour
 *    indicador "392K/hr" se beneficia más del refresh frecuente que el
 *    histórico, pero 30s sigue siendo razonable.
 *
 * Estrategia de errores: silenciamos 401 (lo maneja el client wrapper con
 * redirect a /auth/login). Otros errores se loguean y el hook conserva la
 * última respuesta válida — degradación graciosa similar a
 * `useEffectiveResourcePool`.
 */
export function useFactoryMetrics(): FactoryMetricsResponse | null {
  const [metrics, setMetrics] = useState<FactoryMetricsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAndUpdate = async () => {
      try {
        const data = await getFactoryMetrics();
        if (cancelled) return;
        setMetrics(data);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useFactoryMetrics] failed to fetch', err);
        }
      }
    };

    void fetchAndUpdate();
    const interval = setInterval(() => void fetchAndUpdate(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return metrics;
}
