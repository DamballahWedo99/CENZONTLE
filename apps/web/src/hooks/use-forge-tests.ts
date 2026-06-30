'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTestResults, type ForgeTestsResponse } from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

const POLL_INTERVAL_MS = 15_000;

/**
 * Hook del dashboard de QA (`GET /factory/tests`) con polling 15s. Mismo
 * patrón que useForgeLogs: `loading` solo en la primera carga, `degraded`
 * cuando un poll falla pero hay datos previos, y guardia de generación
 * (callSeq) para que una respuesta lenta no pise una fresca.
 *
 * Expone `refresh()` para re-fetch inmediato tras un rerun/approve.
 */
export function useForgeTests(): {
  data: ForgeTestsResponse | null;
  loading: boolean;
  degraded: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<ForgeTestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let callSeq = 0;

    const fetchAndUpdate = async () => {
      const myCall = ++callSeq;
      try {
        const fresh = await getTestResults();
        if (cancelled || myCall !== callSeq) return;
        setData(fresh);
        setDegraded(false);
      } catch (err) {
        if (cancelled || myCall !== callSeq) return;
        setDegraded(true);
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useForgeTests] failed to fetch', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAndUpdate();
    const interval = setInterval(() => void fetchAndUpdate(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [nonce]);

  return { data, loading, degraded, refresh };
}
