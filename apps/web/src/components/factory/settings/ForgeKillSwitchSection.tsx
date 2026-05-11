'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, Loader2, PauseCircle, PlayCircle, Skull } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import {
  getBranchStrategy,
  pauseForge,
  resumeForge,
  abortAllForgeRuns,
  type BranchStrategyResponse,
} from '@/lib/api/factory';

const inputClasses =
  'bg-muted border-border text-foreground placeholder:text-muted-foreground/70';

/**
 * Kill switch del Forge — control de emergencia para detener el spawn de
 * agentes claude. Tres operaciones:
 *
 *  1. **PAUSE**: bloquea futuros claim-story. Lo que ya está corriendo NO se
 *     mata. Útil cuando vas a cambiar config y no quieres más spawns.
 *  2. **RESUME**: deshace el pause. Worker vuelve a recibir claims.
 *  3. **ABORT ALL**: marca todos los runs activos como abandoned. El worker
 *     recibe 410 en próximo progress (~30s) y mata claude vía SIGTERM.
 *     **No se puede deshacer** — los runs abandonados no vuelven solos.
 *
 * Patrón UX: status visible (verde/rojo banner), botones grandes para
 * acción rápida en pánico, confirmación obligatoria solo para ABORT
 * (destructivo). PAUSE/RESUME son reversibles, no requieren confirmar.
 */
export function ForgeKillSwitchSection() {
  const [config, setConfig] = useState<BranchStrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'pause' | 'resume' | 'abort' | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [abortReason, setAbortReason] = useState('');

  const refetch = useCallback(async () => {
    try {
      const result = await getBranchStrategy();
      setConfig(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Solo Alta Gerencia puede controlar el Kill Switch');
      } else if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    // Polling 5s para reflejar cambios hechos por otro admin (o por boot
    // del backend con env var FORGE_PAUSED).
    const interval = setInterval(() => void refetch(), 5_000);
    return () => clearInterval(interval);
  }, [refetch]);

  const handlePause = async () => {
    setActionLoading('pause');
    try {
      const updated = await pauseForge(pauseReason.trim() || undefined);
      setConfig(updated);
      setPauseReason('');
      toast.success('Forge pausado — claim-story está bloqueado');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al pausar';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    setActionLoading('resume');
    try {
      const updated = await resumeForge();
      setConfig(updated);
      toast.success('Forge reanudado — claim-story aceptando requests');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al reanudar';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAbort = async () => {
    if (!abortReason.trim()) {
      toast.error('Razón es requerida para abort (audit trail)');
      return;
    }
    setActionLoading('abort');
    try {
      const result = await abortAllForgeRuns(abortReason.trim());
      if (result.aborted === 0) {
        toast.info('No había runs activos para abortar');
      } else {
        toast.success(
          `${result.aborted} run(s) abortado(s) — workers recibirán 410 en próximo progress (~30s) y matarán claude`,
        );
      }
      setShowAbortConfirm(false);
      setAbortReason('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al abortar runs';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3 py-8 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando estado del Forge...
        </div>
      </div>
    );
  }

  const isPaused = config?.forgePaused ?? false;

  return (
    <div className="space-y-4">
      {/* Header con explicación */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <Skull className="h-5 w-5 text-muted-foreground/70 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Kill Switch del Forge</h2>
            <p className="mt-1 text-xs text-muted-foreground/80">
              Control de emergencia para detener el spawn de agentes claude. Persistido en DB —
              sobrevive restarts del backend. Pause bloquea claims futuros (los runs corriendo
              continúan); Abort mata los runs activos.
            </p>
          </div>
        </div>
      </div>

      {/* Status banner */}
      <div
        className={cn(
          'rounded-lg border-2 px-5 py-4 flex items-center gap-4',
          isPaused
            ? 'border-red-500/50 bg-red-500/10'
            : 'border-green-500/30 bg-green-500/5',
        )}
      >
        {isPaused ? (
          <>
            <PauseCircle className="h-8 w-8 text-red-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-500">FORGE PAUSADO</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {config?.forgePausedReason && (
                  <>
                    Razón: <span className="font-mono">{config.forgePausedReason}</span>
                  </>
                )}
                {config?.forgePausedAt && (
                  <>
                    {config?.forgePausedReason ? ' · ' : ''}
                    Desde {new Date(config.forgePausedAt).toLocaleString('es-MX')}
                  </>
                )}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => void handleResume()}
              disabled={actionLoading !== null}
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            >
              {actionLoading === 'resume' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Reanudar
            </Button>
          </>
        ) : (
          <>
            <PlayCircle className="h-8 w-8 text-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-500">FORGE ACTIVO</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                claim-story aceptando requests. Si hay épicas encoladas + worker corriendo +
                Anthropic API key configurada, los agentes claude se ejecutarán.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Pause panel (solo si NO está pausado) */}
      {!isPaused && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Pausar Forge</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Bloquea futuros claim-story. Los runs que ya están corriendo NO se matan. Reversible
            con un click. Útil para validar setup sin gastar tokens.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Razón (opcional, audit trail) — ej: 'validando setup'"
              className={cn(inputClasses, 'h-8 text-xs flex-1')}
              disabled={actionLoading !== null}
              maxLength={500}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handlePause()}
              disabled={actionLoading !== null}
              className="border-amber-500/50 text-amber-500 hover:bg-amber-500/10 gap-1.5 shrink-0"
            >
              {actionLoading === 'pause' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              Pausar
            </Button>
          </div>
        </div>
      )}

      {/* Abort All panel — destructivo, siempre visible con confirmación */}
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-red-500" />
          <h3 className="text-sm font-semibold text-red-500">Emergency: Abort All Runs</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Marca TODOS los AgentRuns activos como abandoned. Workers reciben 410 en próximo progress
          (~30 segundos) y matan los procesos claude vía SIGTERM. <strong>No se puede deshacer</strong>
          — los runs abandonados no vuelven solos. Las stories asociadas se desmarcan
          (claimedAt=NULL) para que puedan re-reclamarse después.
        </p>

        {!showAbortConfirm ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAbortConfirm(true)}
            disabled={actionLoading !== null}
            className="border-red-500/50 text-red-500 hover:bg-red-500/10 gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Abortar todos los runs activos
          </Button>
        ) : (
          <div className="space-y-2 rounded-md bg-background/50 border border-red-500/40 p-3">
            <p className="text-xs font-medium text-red-500">
              ⚠️ Confirma — esta acción mata todos los runs activos
            </p>
            <Input
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              placeholder="Razón (REQUERIDA para audit)"
              className={cn(inputClasses, 'h-8 text-xs')}
              disabled={actionLoading !== null}
              maxLength={500}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAbortConfirm(false);
                  setAbortReason('');
                }}
                disabled={actionLoading !== null}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => void handleAbort()}
                disabled={actionLoading !== null || !abortReason.trim()}
                className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
              >
                {actionLoading === 'abort' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Skull className="h-3.5 w-3.5" />
                )}
                Sí, abortar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
