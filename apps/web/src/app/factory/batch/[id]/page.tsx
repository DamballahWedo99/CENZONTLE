'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { BatchDetail } from '@/components/factory/BatchDetail';
import { ApiError } from '@/lib/api/client';
import { getBatchDetail, type BatchDetailResponse } from '@/lib/api/factory';
import { ArrowLeft, PackageOpen, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useDocumentTitle } from '@/hooks/use-document-title';

const POLL_INTERVAL_MS = 5_000;

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Title con el ID del batch en el sufijo — útil cuando el operador tiene
  // varias pestañas abiertas de distintos batches: ahora distingue por title.
  useDocumentTitle(`Batch ${id.slice(0, 8)}`);
  const [batch, setBatch] = useState<BatchDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable ref del fetch para poder triggerar refetches imperativos (post-
  // approval) sin recrear el effect cada render. Sin esto, el callback
  // pasado al BatchDetail cambiaría de identidad cada render y no podríamos
  // memo-izarlo cleanly.
  const fetchBatchRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;

    const fetchBatch = async () => {
      try {
        const data = await getBatchDetail(id);
        if (cancelled) return;
        setBatch(data);
        setNotFound(false);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          setBatch(null);
        } else {
          setError(err instanceof Error ? err.message : 'Error desconocido');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBatchRef.current = () => void fetchBatch();

    void fetchBatch();
    const interval = setInterval(() => void fetchBatch(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  // Callback estable que el BatchDetail invoca tras un approval del staging
  // gate (u otra acción que cambie state persistido). Dispara un fetch
  // inmediato — el polling de 5s seguirá corriendo en paralelo, pero el
  // usuario ve el cambio al instante en vez de esperar al próximo tick.
  const handleRefetchRequested = useCallback(() => {
    fetchBatchRef.current();
  }, []);

  if (loading && !batch) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (notFound || (!batch && !loading)) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-card border border-border">
          <PackageOpen className="h-7 w-7 text-muted-foreground/70" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Batch no encontrado</h1>
        <p className="text-sm text-muted-foreground max-w-sm text-center">
          El batch <span className="font-mono text-foreground">{id}</span> no existe o ya fue
          procesado (mergeado a DEV → Staged).
        </p>
        <Link
          href="/factory"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al Factory
        </Link>
      </div>
    );
  }

  if (error && !batch) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <h1 className="text-lg font-semibold text-foreground">Error cargando el batch</h1>
        <p className="text-sm text-muted-foreground max-w-sm text-center font-mono">{error}</p>
        <Link
          href="/factory"
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al Factory
        </Link>
      </div>
    );
  }

  if (!batch) return null;

  return (
    <BatchDetail
      batchId={batch.batchId}
      realBatchData={batch}
      onRefetchRequested={handleRefetchRequested}
    />
  );
}
