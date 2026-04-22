'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock } from 'lucide-react';

interface ProposalTtlCountdownProps {
  /**
   * Función que recupera el TTL restante en segundos del cache.
   * Retorna número > 0 si quedan segundos, <= 0 si expiró, -1 si falló.
   * Permite que el mismo componente se use para épicas y para historias
   * pasando la api correspondiente (epic-generation / story-generation).
   */
  fetchTtl: () => Promise<number>;
  onExpired: () => void;
}

/**
 * Formatea segundos restantes al formato más corto legible según magnitud.
 *
 * - >= 1 día:    "5d 12h"
 * - >= 1 hora:   "3h 45m"
 * - >= 1 minuto: "12m 30s"
 * - < 1 minuto:  "45s"
 */
function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h.toString().padStart(2, '0')}h`;
}

export function ProposalTtlCountdown({ fetchTtl, onExpired }: ProposalTtlCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);
  // Captura el TTL inicial como referencia del 100%. Sin esto la barra
  // nunca se vería llena (dividiríamos por un valor arbitrario). Se actualiza
  // si vemos un valor mayor (ej: tras una regeneración que reinicia el TTL).
  const maxTtlRef = useRef<number | null>(null);

  const syncTtl = useCallback(async () => {
    const ttl = await fetchTtl();
    if (ttl > 0) {
      if (maxTtlRef.current === null || ttl > maxTtlRef.current) {
        maxTtlRef.current = ttl;
      }
      setRemaining(ttl);
    } else if (ttl <= 0) {
      setRemaining((prev) => (prev !== null ? 0 : prev));
      onExpired();
    }
  }, [fetchTtl, onExpired]);

  // Initial fetch + periodic re-sync every 60s (corrige drift entre el tick
  // local y el TTL real del Redis cuando ambos son mayores a un minuto).
  useEffect(() => {
    syncTtl();
    const syncInterval = setInterval(syncTtl, 60_000);
    return () => clearInterval(syncInterval);
  }, [syncTtl]);

  // Local countdown tick. Solo arranca cuando `remaining` tiene valor inicial.
  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const tick = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) {
          onExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [remaining !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (remaining === null || remaining <= 0) return null;

  const maxTtl = maxTtlRef.current ?? remaining;
  const pct = maxTtl > 0 ? (remaining / maxTtl) * 100 : 0;
  const barColor = pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-amber-500' : 'bg-destructive';
  const label = formatRemaining(remaining);

  return (
    <div className="flex items-center gap-2" aria-label={`Tiempo restante: ${label}`}>
      <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] text-muted-foreground tabular-nums">{label}</span>
      <div
        className="w-16 h-1 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Cache TTL restante"
      >
        <div
          className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
