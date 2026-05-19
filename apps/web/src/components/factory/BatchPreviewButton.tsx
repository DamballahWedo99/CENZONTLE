'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  type PreviewStatus,
  type PreviewStatusResponse,
} from '@/lib/api/factory';
import { Play, Square, Loader2, ExternalLink, AlertCircle } from 'lucide-react';

interface BatchPreviewButtonProps {
  batchId: string;
  /** Disabled si el batchId está vacío o la branch no existe todavía. */
  disabled?: boolean;
}

/**
 * Botón que dispara/detiene el local dev server preview de un sprint-batch
 * branch. Estados visuales:
 *
 *   - idle/stopped:  ▶ Preview          (click → startPreview + abre URL al ready)
 *   - starting:      ⟳ Preparando...   (clone + install en curso, polling)
 *   - running:       ↗ Preview activo  (click → stopPreview)
 *   - error:         ⚠ Preview falló   (click → reintentar)
 *
 * Polling cada 1.5s mientras status='starting' hasta running/error/timeout.
 * Si el preview ya está running, abrir URL en nueva tab + cambiar a estado
 * "running" inmediato (no spawneamos otro).
 *
 * NOTA SECURITY: el backend ejecuta código untrusted del agente. Solo úsalo
 * en local dev. En producción debería estar gated por un permission/role.
 */
export function BatchPreviewButton({ batchId, disabled }: BatchPreviewButtonProps) {
  const [status, setStatus] = useState<PreviewStatus>('stopped');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Polling ref para clear on unmount o cuando status sale de 'starting'
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cargar status inicial al montar (por si el preview ya estaba corriendo
  // y se refrescó la página)
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    void getPreviewStatus(batchId)
      .then((res) => {
        if (cancelled) return;
        setStatus(res.status);
        if (res.url) setPreviewUrl(res.url);
        if (res.error) setError(res.error);
        // Si arrancamos viendo 'starting', empezamos polling
        if (res.status === 'starting') startPolling();
      })
      .catch(() => {
        // Si el endpoint falla (e.g., API no corre), default a stopped
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // Cleanup polling al unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res: PreviewStatusResponse = await getPreviewStatus(batchId);
        setStatus(res.status);
        if (res.url) setPreviewUrl(res.url);
        if (res.error) setError(res.error);
        // Si pasó a running o error, parar el polling
        if (res.status === 'running') {
          stopPolling();
          // Auto-abrir la URL en nueva tab cuando llega a running
          if (res.url) {
            window.open(res.url, '_blank', 'noopener,noreferrer');
          }
        } else if (res.status === 'error' || res.status === 'stopped') {
          stopPolling();
        }
      } catch {
        // Network blip — continuamos polling
      }
    }, 1500);
  }, [batchId, stopPolling]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await startPreview(batchId);
      setStatus(res.status);
      if (res.url) setPreviewUrl(res.url);
      // Si ya está running (idempotente), abrir directo
      if (res.status === 'running' && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else if (res.status === 'starting') {
        startPolling();
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  }, [batchId, startPolling]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await stopPreview(batchId);
      setStatus('stopped');
      setPreviewUrl(null);
      setError(null);
      stopPolling();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [batchId, stopPolling]);

  const handleClick = useCallback(() => {
    if (loading) return;
    if (status === 'running' && previewUrl) {
      // Re-abrir la URL en nueva tab (el usuario quizás cerró la pestaña)
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
    } else if (status === 'running') {
      void handleStop();
    } else if (status === 'starting') {
      // Click durante starting: cancel
      void handleStop();
    } else {
      void handleStart();
    }
  }, [loading, status, previewUrl, handleStart, handleStop]);

  // Long-press / right-click para stop cuando está running:
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (status === 'running') {
        e.preventDefault();
        void handleStop();
      }
    },
    [status, handleStop],
  );

  // ════════════════════════════════════════════════════════════════════════
  // Render — variants por status con label + icon + tooltip
  // ════════════════════════════════════════════════════════════════════════
  const variantConfig = {
    stopped: {
      label: 'Preview',
      Icon: Play,
      bg: 'bg-blue-500/10 hover:bg-blue-500/20',
      text: 'text-blue-400 hover:text-blue-300',
      border: 'border-blue-500/30',
      title: 'Iniciar dev server local del sprint-batch (clone + spawn)',
    },
    starting: {
      label: 'Preparando…',
      Icon: Loader2,
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      title: 'Clonando branch + instalando dependencias… (puede tomar ~1 min)',
    },
    running: {
      label: 'Preview activo',
      Icon: ExternalLink,
      bg: 'bg-green-500/10 hover:bg-green-500/20',
      text: 'text-green-400 hover:text-green-300',
      border: 'border-green-500/30',
      title: previewUrl
        ? `${previewUrl} (click para re-abrir, right-click para detener)`
        : 'Preview running',
    },
    error: {
      label: 'Preview falló',
      Icon: AlertCircle,
      bg: 'bg-red-500/10 hover:bg-red-500/20',
      text: 'text-red-400 hover:text-red-300',
      border: 'border-red-500/30',
      title: error ?? 'Click para reintentar',
    },
  } as const;

  const v = variantConfig[status];
  const isSpinning = status === 'starting' || loading;

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={disabled || loading}
      title={v.title}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
        v.bg,
        v.text,
        v.border,
        (disabled || loading) && 'cursor-not-allowed opacity-50',
      )}
    >
      <v.Icon className={cn('h-3.5 w-3.5', isSpinning && 'animate-spin')} aria-hidden="true" />
      <span>{v.label}</span>
    </button>
  );
}
