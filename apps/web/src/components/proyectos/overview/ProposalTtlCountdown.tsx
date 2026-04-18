'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { getCacheTtl } from '@/lib/api/epic-generation';

interface ProposalTtlCountdownProps {
  initiativeId: string;
  onExpired: () => void;
}

export function ProposalTtlCountdown({ initiativeId, onExpired }: ProposalTtlCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  const syncTtl = useCallback(async () => {
    const ttl = await getCacheTtl(initiativeId);
    if (ttl > 0) setRemaining(ttl);
    else if (ttl <= 0 && remaining !== null) onExpired();
  }, [initiativeId, onExpired, remaining]);

  // Initial fetch + periodic re-sync every 60s
  useEffect(() => {
    syncTtl();
    const syncInterval = setInterval(syncTtl, 60_000);
    return () => clearInterval(syncInterval);
  }, [syncTtl]);

  // Local countdown tick every second
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
  }, [remaining !== null]); // eslint-disable-line react-hooks/exhaustive-deps -- only restart when initial value arrives

  if (remaining === null || remaining <= 0) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = remaining > 0 ? (remaining / 1800) * 100 : 0;

  const barColor = pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-amber-500' : 'bg-destructive';

  return (
    <div className="flex items-center gap-2" aria-label={`Tiempo restante: ${mins} minutos ${secs} segundos`}>
      <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {mins}:{secs.toString().padStart(2, '0')}
      </span>
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
