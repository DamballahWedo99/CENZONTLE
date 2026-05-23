'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Circle, X, Info, Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
 * Mapea el status del run + criterios al formato del DoD pill (igual al
 * componente AgentTerminal mock). Cuando HITO 2.5 (DoD ejecutable) esté
 * implementado, esto vendrá de `run.dodResults` real.
 */
function deriveDodFromRun(run: RunDetailResponse): { text: string; done: boolean }[] {
  return [
    { text: 'Code written', done: run.exitCode === 0 },
    { text: 'Tests ≥ 90%', done: run.exitCode === 0 }, // mock — HITO 2.5 lo reemplaza
    { text: 'PR merged', done: run.prNumber !== null },
    { text: 'No errors', done: run.exitCode === 0 && run.errorMessage === null },
  ];
}

/**
 * Convierte `run.criteriaProgress` al shape simple que el footer bar usa.
 * Si no hay criterios reportados, devuelve [] y el botón "milestones"
 * muestra `0/0`.
 */
function deriveMilestonesFromRun(run: RunDetailResponse): { text: string; done: boolean }[] {
  if (!isCriterionEventArray(run.criteriaProgress)) return [];
  return run.criteriaProgress.map((c) => ({
    text: c.label,
    done: c.status === 'completed',
  }));
}

const STATUS_COLORS: Record<RunDetailResponse['status'], string> = {
  claimed: 'text-amber-400',
  running: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  abandoned: 'text-muted-foreground/70',
};

const STATUS_LABELS: Record<RunDetailResponse['status'], string> = {
  claimed: 'Claimed',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  abandoned: 'Abandoned',
};

/**
 * AgentRunTerminal — viewer del run real con el mismo layout que el
 * AgentTerminal mock: header compacto con badges DoD/milestones, iframe
 * del ttyd vivo, footer toggleable.
 *
 * Usado por la página /factory/agents/[id]/terminal cuando el id es un
 * runId real del backend (no un agente mock).
 */
export function AgentRunTerminal({ runId, onClose }: Props) {
  const [run, setRun] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBar, setActiveBar] = useState<'dod' | 'milestones' | null>(null);

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

  function toggleBar(bar: 'dod' | 'milestones') {
    setActiveBar((prev) => (prev === bar ? null : bar));
  }

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

  const dod = deriveDodFromRun(run);
  const dodDone = dod.filter((c) => c.done).length;
  const milestones = deriveMilestonesFromRun(run);
  const msDone = milestones.filter((c) => c.done).length;

  // SEC (security-reviewer 2026-05-22, Finding 2): defensa-en-profundidad
  // contra una ttydUrl maliciosa que haya pasado la validación del backend
  // (bug futuro, race, valor legacy en DB pre-fix). Solo schemes http/https
  // pueden cargar en el <iframe src>. Si falla, queda null → fallback.
  const safeTtydUrl = useMemo(() => {
    if (!run.ttydUrl) return null;
    try {
      const u = new URL(run.ttydUrl);
      return u.protocol === 'http:' || u.protocol === 'https:'
        ? run.ttydUrl
        : null;
    } catch {
      return null;
    }
  }, [run.ttydUrl]);

  return (
    <div className="relative overflow-hidden flex flex-col h-full bg-card">
      {/* Header — replica del AgentTerminal mock */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Circle
              className={cn(
                'h-2.5 w-2.5 fill-current shrink-0',
                STATUS_COLORS[run.status],
              )}
            />
            <h3 className="text-sm font-semibold text-foreground truncate" title={run.storyTitle}>
              {run.storyTitle}
            </h3>
            <span
              className={cn(
                'text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
                STATUS_COLORS[run.status],
                'bg-current/10',
              )}
            >
              {STATUS_LABELS[run.status]}
            </span>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              run {run.runId.slice(0, 8)}
            </span>
            <span
              className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground shrink-0 truncate max-w-[260px]"
              title={run.branch}
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
              </svg>
              {run.branch}
            </span>
            {/* DoD pill — toggleable */}
            <button
              onClick={() => toggleBar('dod')}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                activeBar === 'dod'
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                  : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              title="Definition of Done — click para mostrar/ocultar"
            >
              <span className="font-medium">
                {dodDone}/{dod.length}
              </span>
              <span>DoD</span>
            </button>
            {/* Milestones pill — toggleable */}
            <button
              onClick={() => toggleBar('milestones')}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors shrink-0',
                activeBar === 'milestones'
                  ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                  : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              title="Milestones del run — click para mostrar/ocultar"
            >
              <span className="font-medium">
                {msDone}/{milestones.length}
              </span>
              <span>milestones</span>
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-3">
            {run.prNumber !== null && (
              <a
                href={`https://github.com/DamballahWedo99/AeroDemo-App/pull/${run.prNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors px-2 shrink-0"
                title="Abrir PR en GitHub"
              >
                PR #{run.prNumber}
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Run details"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Cerrar terminal"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Terminal */}
      {safeTtydUrl ? (
        <div className="relative flex-1 min-h-0">
          <iframe
            src={safeTtydUrl}
            className="absolute inset-0 w-full h-full border-0 bg-[#0d1117]"
            // SEC (Finding 2): sandbox del iframe. `allow-scripts` para
            // xterm.js; `allow-same-origin` para el WebSocket del ttyd. Sin
            // `allow-top-navigation` ni `allow-popups` — bloquea phishing
            // dentro del panel si la URL apuntase a contenido hostil.
            sandbox="allow-scripts allow-same-origin"
            allow="clipboard-read; clipboard-write"
            title={`Terminal en vivo del run ${run.runId.slice(0, 8)}`}
          />

          {/* Bottom bar — DoD or Milestones (mutually exclusive) */}
          {activeBar &&
            (() => {
              const items = activeBar === 'dod' ? dod : milestones;
              const doneCount = items.filter((c) => c.done).length;
              const label = activeBar === 'dod' ? 'Definition of Done' : 'Milestones';
              const accentColor = activeBar === 'dod' ? 'text-cyan-400' : 'text-blue-400';
              return (
                <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-card/90 backdrop-blur-sm border-t border-border">
                  <span
                    className={cn(
                      'text-[10px] font-medium uppercase tracking-wider shrink-0',
                      accentColor,
                    )}
                  >
                    {label}
                  </span>
                  <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-x-auto">
                    {items.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground/50 italic">
                        Sin {label.toLowerCase()} reportados aún
                      </span>
                    ) : (
                      items.map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5 min-w-0">
                          {c.done ? (
                            <svg
                              className="h-3 w-3 shrink-0 text-green-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : (
                            <div className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" />
                          )}
                          <span
                            className={cn(
                              'text-[11px] truncate max-w-[180px]',
                              c.done ? 'text-foreground/70' : 'text-muted-foreground/40',
                            )}
                            title={c.text}
                          >
                            {c.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0">
                    {doneCount}/{items.length}
                  </span>
                </div>
              );
            })()}
        </div>
      ) : (
        /* Fallback cuando no hay ttydUrl (run completed → ttyd ya no vivo).
         * Muestra el lastOutput estático en pre tag. */
        <div className="flex-1 overflow-auto bg-black px-4 py-3 font-mono text-xs text-green-400">
          {run.errorMessage && (
            <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 p-3">
              <p className="text-red-300 font-semibold mb-1 not-italic font-sans text-sm">
                ⚠ Error del run:
              </p>
              <pre className="whitespace-pre-wrap break-all text-red-200">
                {run.errorMessage}
              </pre>
            </div>
          )}
          {run.lastOutput ? (
            <pre className="whitespace-pre-wrap break-all">{run.lastOutput}</pre>
          ) : (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-4 font-sans text-sm not-italic text-zinc-300">
              <p className="font-semibold mb-2 text-zinc-100">
                {run.status === 'completed'
                  ? '✓ Run completado'
                  : run.status === 'failed'
                    ? '✗ Run falló'
                    : run.status === 'abandoned'
                      ? '⊘ Run abandonado'
                      : '— Sin output'}
              </p>
              <p className="text-zinc-400 text-xs">
                Status: <code className="text-zinc-200">{run.status}</code>
                {run.exitCode !== null && (
                  <>
                    {' · '}exit{' '}
                    <code className="text-zinc-200">{run.exitCode}</code>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
