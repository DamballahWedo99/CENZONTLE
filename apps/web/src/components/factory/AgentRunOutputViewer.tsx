'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  X,
  Terminal as TerminalIcon,
  Cpu,
  GitBranch,
  Clock,
  Check,
  Circle,
  XCircle,
} from 'lucide-react';
import type { CriterionEvent } from '@cenzontle/shared';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api/client';
import {
  getRunDetail,
  isCriterionEventArray,
  type RunDetailResponse,
} from '@/lib/api/factory';

interface Props {
  runId: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 5_000;


/**
 * Viewer del output de un AgentRun real (backend) — usado en la página
 * `/factory/agents/:runId/terminal` cuando el id corresponde a un runId
 * del backend (no a un mock del FactoryContext).
 *
 * UX: header con info del run (story, branch, node, status), body con
 * `lastOutput` truncado del backend (max ~8000 chars), polling 5s.
 *
 * NO es streaming en vivo — el `lastOutput` se actualiza solo cuando el
 * worker llama al progress endpoint (cada 30s). Para feedback más rápido
 * podríamos añadir SSE en Sprint 5+. Mientras tanto, el polling 5s del
 * frontend captura los snapshots cuando el backend los recibe.
 *
 * Auto-scroll al fondo cuando llega contenido nuevo, salvo que el user
 * haya scroleado manualmente hacia arriba (preserve user intent).
 */
export function AgentRunOutputViewer({ runId, onClose }: Props) {
  const [run, setRun] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const fetchRun = useCallback(async () => {
    try {
      const result = await getRunDetail(runId);
      setRun(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(`Run ${runId} no encontrado en el backend.`);
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Solo Alta Gerencia puede ver el output de runs.');
      } else if (err instanceof ApiError && err.status !== 401) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
    const interval = setInterval(() => void fetchRun(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRun]);

  // Auto-scroll al fondo cuando hay contenido nuevo, respetando si el
  // user scroleó manualmente para inspeccionar output anterior.
  useEffect(() => {
    if (!outputRef.current || userScrolledUpRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [run?.lastOutput]);

  // SEC (security-reviewer 2026-05-22, Finding 2 — defensa-en-profundidad
  // profiláctica para dead-code path): defensa contra una `ttydUrl` con
  // scheme no-http(s) que pudiera quedar en DB de algún run viejo previo al
  // fix server-side. Solo http/https pasan al `<iframe src>`; el sandbox
  // de más abajo es la otra capa.
  //
  // El hook vive ARRIBA de los early returns (loading / error) para que el
  // orden de hooks sea idéntico en todos los renders — la guarda de `run`
  // va adentro del `useMemo`, no afuera.
  const safeTtydUrl = useMemo(() => {
    if (!run?.ttydUrl) return null;
    try {
      const u = new URL(run.ttydUrl);
      return u.protocol === 'http:' || u.protocol === 'https:'
        ? run.ttydUrl
        : null;
    } catch {
      return null;
    }
  }, [run?.ttydUrl]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Tolerancia 50px — si está cerca del fondo, considera "auto-scroll on".
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUpRef.current = !isAtBottom;
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <TerminalIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h1 className="text-lg font-semibold text-foreground">Run no disponible</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error ?? `No se encontró el run ${runId}`}
          </p>
          <button
            onClick={onClose}
            className="mt-4 rounded-lg bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80 transition-colors"
          >
            Cerrar pestaña
          </button>
        </div>
      </div>
    );
  }

  const isActive = run.status === 'claimed' || run.status === 'running';
  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime();
  const durationStr = formatDuration(durationMs);

  const statusColor =
    run.status === 'completed'
      ? 'text-green-500'
      : run.status === 'running' || run.status === 'claimed'
        ? 'text-blue-500'
        : run.status === 'failed' || run.status === 'abandoned'
          ? 'text-red-500'
          : 'text-muted-foreground';

  const statusDot =
    run.status === 'completed'
      ? 'bg-green-500'
      : run.status === 'running' || run.status === 'claimed'
        ? 'bg-blue-500 animate-pulse'
        : 'bg-red-500';

  return (
    <div className="flex h-screen flex-col bg-background dark">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('h-2 w-2 rounded-full', statusDot)} />
              <span className={cn('text-xs font-semibold uppercase tracking-wide', statusColor)}>
                {run.status}
              </span>
              <span className="text-xs text-muted-foreground">
                · run <code className="font-mono">{run.runId.slice(0, 8)}</code>
              </span>
            </div>
            <h1 className="text-sm font-semibold text-foreground truncate" title={run.storyTitle}>
              {run.storyTitle}
            </h1>
            <p className="text-xs text-muted-foreground/70 truncate" title={run.epicTitle}>
              {run.epicTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            <code className="font-mono">{run.nodeName}</code>
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            <code className="font-mono truncate max-w-[300px]" title={run.branch}>
              {run.branch}
            </code>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {durationStr} · last progress {formatRelativeTime(new Date(run.lastProgressAt))}
          </span>
          {run.exitCode !== null && (
            <span>
              exit code <code className="font-mono">{run.exitCode}</code>
            </span>
          )}
          {run.prNumber !== null && (
            <span>
              PR #<code className="font-mono">{run.prNumber}</code>
            </span>
          )}
        </div>
        {isActive && run.ttydUrl ? (
          <p className="mt-2 text-[10px] text-emerald-400/80">
            ⚡ Terminal en vivo · ttyd {run.ttydUrl}
          </p>
        ) : isActive ? (
          <p className="mt-2 text-[10px] text-muted-foreground/50">
            ⚡ Polling cada {POLL_INTERVAL_MS / 1000}s · output truncado a últimos 8000 chars del worker
          </p>
        ) : null}
      </div>

      {/* HITO 1.6: timeline de criterios/milestones del run.
       *  Strip horizontal con todos los criterios (worker + agente) y su
       *  estado actual. Aparece entre el header y el body del terminal. */}
      <CriteriaStrip rawCriteria={run.criteriaProgress} prNumber={run.prNumber} />

      {/* HITO 1.5: si hay ttydUrl vivo, mostrar iframe del terminal interactivo
       *  en lugar del polling estático. Cuando el run termina, ttydUrl pasa
       *  a null y caemos al viewer estático con lastOutput. */}
      {isActive && safeTtydUrl ? (
        <div className="flex-1 bg-black">
          <iframe
            src={safeTtydUrl}
            title={`Terminal en vivo del run ${run.runId.slice(0, 8)}`}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      ) : (
      /* Fallback: viewer estático del lastOutput (con polling) */
      <div
        ref={outputRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-black px-4 py-3 font-mono text-xs text-green-400"
      >
        {/* Si hay errorMessage, mostrarlo PRIMERO (más relevante que el output) */}
        {run.errorMessage && (
          <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 p-3">
            <p className="text-red-300 font-semibold mb-1 not-italic font-sans text-sm">⚠ Error del run:</p>
            <pre className="whitespace-pre-wrap break-all text-red-200">{run.errorMessage}</pre>
          </div>
        )}

        {/* Output principal con contraste alto sobre bg-black */}
        {run.lastOutput ? (
          <pre className="whitespace-pre-wrap break-all">{run.lastOutput}</pre>
        ) : (
          <div className="rounded border border-zinc-800 bg-zinc-900/50 p-4 font-sans text-sm not-italic text-zinc-300">
            <p className="font-semibold mb-2 text-zinc-100">
              {isActive
                ? '⏳ Esperando primer snapshot del worker'
                : run.status === 'completed'
                  ? '✓ Run completado sin output capturado'
                  : run.status === 'failed'
                    ? '✗ Run falló sin output'
                    : run.status === 'abandoned'
                      ? '⊘ Run abandonado por el sweeper'
                      : '— Sin output disponible'}
            </p>
            <ul className="list-disc list-inside space-y-1 text-zinc-400 text-xs">
              <li>
                Status actual: <code className="text-zinc-200">{run.status}</code>
              </li>
              <li>
                El worker reporta <code>lastOutput</code> al backend cada ~30 segundos mientras
                claude corre.
              </li>
              {isActive && (
                <li>
                  Si claude acaba de empezar (último heartbeat hace pocos segundos), el primer
                  snapshot llega en máximo 30s. Ten paciencia.
                </li>
              )}
              {!isActive && run.completedAt && (
                <li>
                  Run terminó {formatRelativeTime(new Date(run.completedAt))}. Si claude no
                  produjo stdout (ej. error inmediato del spawn) este field queda vacío. Revisa
                  el campo <code>errorMessage</code> arriba.
                </li>
              )}
              <li>
                Para más detalle de runtime debug, mira los logs del worker daemon
                (<code>factory-worker start</code>) en su terminal.
              </li>
            </ul>
          </div>
        )}

        {/* Status indicator persistente al fondo cuando hay output (info útil) */}
        {run.lastOutput && !isActive && (
          <div className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 font-sans text-xs not-italic text-zinc-400">
            Run terminó · status <code className="text-zinc-200">{run.status}</code>
            {run.exitCode !== null && <> · exitCode <code className="text-zinc-200">{run.exitCode}</code></>}
            {run.completedAt && <> · {formatRelativeTime(new Date(run.completedAt))}</>}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatRelativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return `hace ${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  return `hace ${hr}h`;
}

/**
 * HITO 1.6 — Strip horizontal con la timeline de criterios del run.
 *
 * Combina dos fuentes:
 *  1. `rawCriteria` que viene de `run.criteriaProgress` (worker + agente)
 *  2. Pseudo-criterio derivado de `prNumber` para que el operador vea
 *     "PR abierto" sin que el worker lo emita explícitamente
 *
 * Si `rawCriteria` está vacío o malformado (run viejo sin tracking), el
 * strip no se renderea — el componente vuelve invisible para no agregar
 * ruido visual.
 */
function CriteriaStrip({
  rawCriteria,
  prNumber,
}: {
  rawCriteria: CriterionEvent[] | null;
  prNumber: number | null;
}) {
  // Guard sigue siendo necesario: el caller pasa el field tipado pero
  // ese tipo viene de un cast del API layer (Json column en Prisma). El
  // guard reconfirma el shape antes de iterar y descarta arrays vacíos.
  if (!isCriterionEventArray(rawCriteria) || rawCriteria.length === 0) {
    return null;
  }

  // Pseudo-criterio derivado: si el backend ya abrió un PR, mostrarlo en
  // la timeline aunque el worker no lo haya emitido (lo abre el backend).
  const enriched: CriterionEvent[] = [...rawCriteria];
  if (prNumber !== null) {
    enriched.push({
      id: 'pr.opened',
      label: `PR #${prNumber} abierto`,
      status: 'completed',
      source: 'worker',
    });
  }

  return (
    <div className="shrink-0 border-b border-border bg-card/40 px-5 py-2.5 overflow-x-auto">
      <div className="flex items-center gap-1.5 min-w-max">
        {enriched.map((c) => (
          <CriterionChip key={c.id} criterion={c} />
        ))}
      </div>
    </div>
  );
}

function CriterionChip({ criterion }: { criterion: CriterionEvent }) {
  const isCompleted = criterion.status === 'completed';
  const isInProgress = criterion.status === 'in_progress';
  const isFailed = criterion.status === 'failed';
  const isPending = criterion.status === 'pending';
  const isAgent = criterion.source === 'agent';

  const Icon = isCompleted
    ? Check
    : isFailed
      ? XCircle
      : isInProgress
        ? Loader2
        : Circle;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] border whitespace-nowrap',
        isCompleted && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        isInProgress && 'bg-blue-500/10 text-blue-400 border-blue-500/30',
        isFailed && 'bg-red-500/10 text-red-400 border-red-500/30',
        isPending && 'bg-zinc-800/40 text-zinc-500 border-zinc-700/50',
        isAgent && 'border-dashed', // Diferencia visual: criterios del agente con borde punteado
      )}
      title={
        `${criterion.source === 'agent' ? 'Reportado por el agente' : 'Reportado por el worker'} · ` +
        `Estado: ${criterion.status}` +
        (criterion.completedAt ? ` · ${formatRelativeTime(new Date(criterion.completedAt))}` : '')
      }
    >
      <Icon className={cn('h-3 w-3 shrink-0', isInProgress && 'animate-spin')} />
      <span className="font-medium">{criterion.label}</span>
    </div>
  );
}
