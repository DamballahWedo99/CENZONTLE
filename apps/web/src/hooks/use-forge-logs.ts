'use client';

import { useEffect, useState } from 'react';
import { getForgeLogs, type ForgeLogEntry } from '@/lib/api/factory';
import { ApiError } from '@/lib/api/client';

const POLL_INTERVAL_MS = 15_000;

/**
 * Hook que devuelve el stream de `GET /factory/logs` con polling 15s.
 *
 * Polling 15s (mismo criterio que PRPipeline): los eventos nuevos aparecen
 * al ritmo de los POST /progress de los workers (~30s) y de los cambios de
 * la cola — refrescar a 5s solo quemaría queries sin mostrar nada nuevo.
 *
 * `loading` arranca en true y se apaga al resolver la PRIMERA carga (éxito
 * o error) — los polls posteriores NO lo reactivan, para que la vista no
 * parpadee a skeleton cada 15s.
 *
 * Robustez: ante un poll fallido el hook CONSERVA la última respuesta
 * válida y enciende `degraded` — la UI sigue mostrando el stream conocido
 * con un aviso de reconexión en lugar de vaciarse. `degraded` se apaga solo
 * en cuanto un poll vuelve a resolver. Silenciamos 401 (lo maneja el client
 * wrapper con redirect a /auth/login).
 */
export function useForgeLogs(): {
  /** Null hasta la primera respuesta exitosa (si todos los polls fallan). */
  logs: ForgeLogEntry[] | null;
  loading: boolean;
  /** true cuando el último poll falló pero hay datos previos en pantalla. */
  degraded: boolean;
  /** Epoch ms del último poll exitoso — reloj para filtros de rango
   *  temporal en la UI (react-hooks/purity prohíbe Date.now() en render).
   *  Null hasta la primera respuesta exitosa. */
  fetchedAt: number | null;
} {
  const [logs, setLogs] = useState<ForgeLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Generación por poll: si una respuesta tarda >15s, el siguiente tick
    // dispara un fetch concurrente — sin esto, la respuesta VIEJA podría
    // resolver al final y pisar los datos frescos (qa-reviewer 2026-06-11).
    let callSeq = 0;

    const fetchAndUpdate = async () => {
      const myCall = ++callSeq;
      try {
        const fresh = await getForgeLogs();
        if (cancelled || myCall !== callSeq) return;
        setLogs(fresh.logs);
        setFetchedAt(Date.now());
        setDegraded(false);
      } catch (err) {
        if (cancelled || myCall !== callSeq) return;
        setDegraded(true);
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn('[useForgeLogs] failed to fetch', err);
        }
      } finally {
        // Idempotente: tras la primera carga los polls re-setean false (no-op).
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAndUpdate();
    const interval = setInterval(() => void fetchAndUpdate(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { logs, loading, degraded, fetchedAt };
}
