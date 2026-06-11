'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import type { Components } from 'react-markdown';
import {
  Sparkles,
  Loader2,
  X,
  Check,
  ChevronDown,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  ExecutiveSummary,
  ExecutiveSummaryPhase,
  InitiativeMetrics,
} from '@cenzontle/shared';
import {
  streamExecutiveSummary,
  getCachedExecutiveSummary,
  cancelExecutiveSummaryRun,
} from '@/lib/executive-summary';
import { NarrativeHero, NarrativeInsights } from './NarrativeSections';
import { HealthDonut } from './charts/HealthDonut';
import { KpiCards } from './charts/KpiCards';
import { TimelineGauge } from './charts/TimelineGauge';
import { StatusStackedBar } from './charts/StatusStackedBar';
import { PodLoadChart } from './charts/PodLoadChart';
import { EpicProgressChart } from './charts/EpicProgressChart';

interface ExecutiveSummaryPanelProps {
  initiativeId: string;
}

// Cap del buffer de thinking — el panel solo muestra los últimos deltas, no
// necesita el razonamiento entero en memoria/DOM durante runs largos.
const MAX_THINKING_CHARS = 12_000;

const PHASES: { id: ExecutiveSummaryPhase; label: string }[] = [
  { id: 'collecting', label: 'Recolectando métricas' },
  { id: 'analyzing', label: 'Analizando' },
  { id: 'writing', label: 'Redactando' },
];

// Overrides a nivel de módulo para identidad estable (Streamdown memoiza por
// shallow-compare del prop `components`).
const THINKING_MD_COMPONENTS: Components = {
  h1: ({ children }) => <div className="font-semibold not-italic">{children}</div>,
  h2: ({ children }) => <div className="font-semibold not-italic">{children}</div>,
  h3: ({ children }) => <div className="font-semibold not-italic">{children}</div>,
  p: ({ children }) => <p className="my-0.5 whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="my-0.5 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-0.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold not-italic">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-muted/40 px-1 font-mono text-[11px] not-italic">{children}</code>
  ),
};

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function PhaseStepper({
  phase,
  currentLabel,
}: {
  phase: ExecutiveSummaryPhase | null;
  currentLabel: string | null;
}) {
  const currentIndex =
    phase === 'done' ? PHASES.length : PHASES.findIndex((p) => p.id === phase);

  return (
    <div className="flex items-center">
      {PHASES.map((p, i) => {
        const isDone = currentIndex > i;
        const isCurrent = currentIndex === i;
        return (
          <div key={p.id} className={`flex items-center ${i > 0 ? 'flex-1' : ''}`}>
            {i > 0 && (
              <div
                className={`mx-3 h-px flex-1 transition-colors duration-500 ${
                  isDone || isCurrent ? 'bg-primary/50' : 'bg-border'
                }`}
              />
            )}
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors duration-300 ${
                  isDone
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isCurrent
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground/50'
                }`}
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : isCurrent ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span
                className={`text-xs ${
                  isCurrent
                    ? 'font-medium text-foreground'
                    : isDone
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/50'
                }`}
              >
                {isCurrent && currentLabel ? currentLabel : p.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Orquestador del resumen ejecutivo de una iniciativa.
 *
 * Al montar recupera el último resumen persistido; al generar consume el SSE
 * del agente mostrando fase + thinking en vivo, y renderiza el resumen
 * completo (charts D3 + narrativa IA) cuando llega `summary_ready`.
 */
export function ExecutiveSummaryPanel({ initiativeId }: ExecutiveSummaryPanelProps) {
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loadingCached, setLoadingCached] = useState(true);
  const [mode, setMode] = useState<'idle' | 'streaming'>('idle');
  const [phase, setPhase] = useState<ExecutiveSummaryPhase | null>(null);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [thinking, setThinking] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [liveMetrics, setLiveMetrics] = useState<InitiativeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const thinkingRef = useRef<HTMLDivElement | null>(null);

  // Recupera el resumen persistido al montar (sobrevive refresh / cambio de tab).
  useEffect(() => {
    let cancelled = false;
    setLoadingCached(true);
    getCachedExecutiveSummary(initiativeId)
      .then((res) => {
        if (!cancelled) setSummary(res.summary);
      })
      .catch(() => {
        // Sin cache disponible — el empty state invita a generar.
      })
      .finally(() => {
        if (!cancelled) setLoadingCached(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initiativeId]);

  // Cierra el SSE local si el componente se desmonta a mitad de un run.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Auto-scroll del thinking — siempre pegado a los últimos deltas.
  useEffect(() => {
    const el = thinkingRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thinking, thinkingOpen]);

  const handleGenerate = useCallback(async () => {
    setMode('streaming');
    setError(null);
    setThinking('');
    setThinkingOpen(true);
    setLiveMetrics(null);
    setPhase('collecting');
    setPhaseLabel(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamExecutiveSummary(initiativeId, {
        signal: controller.signal,
      })) {
        switch (event.type) {
          case 'phase_change':
            setPhase(event.phase);
            setPhaseLabel(event.label);
            break;
          case 'thinking':
            setThinking((prev) => (prev + event.delta).slice(-MAX_THINKING_CHARS));
            break;
          case 'metrics_ready':
            setLiveMetrics(event.metrics);
            break;
          case 'summary_ready':
            setSummary(event.summary);
            break;
          case 'error':
            setError(event.message);
            break;
          default:
            break;
        }
      }
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Error generando el resumen ejecutivo');
      }
    } finally {
      abortRef.current = null;
      setMode('idle');
      setPhase(null);
      setPhaseLabel(null);
    }
  }, [initiativeId]);

  const handleCancel = useCallback(() => {
    // Doble cancelación (mismo patrón que el agente de épicas): abortar el
    // fetch local cierra el SSE de este cliente; el DELETE fire-and-forget
    // aborta el agente en el backend para que no siga corriendo en background.
    abortRef.current?.abort();
    abortRef.current = null;
    cancelExecutiveSummaryRun(initiativeId).catch(() => {});
    setMode('idle');
    setPhase(null);
    setPhaseLabel(null);
    setThinking('');
    setLiveMetrics(null);
  }, [initiativeId]);

  const streaming = mode === 'streaming';

  return (
    <section className="rounded-2xl border bg-card/50 p-6 sm:p-8">
      {/* ── Header del panel ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Resumen Ejecutivo
          </h3>
          {summary && !streaming && (
            <p className="mt-1 text-xs text-muted-foreground/70 tabular-nums">
              Generado el {formatGeneratedAt(summary.generatedAt)}
              {summary.generatedByName ? ` por ${summary.generatedByName}` : ''}
              {summary.model ? ` · ${summary.model}` : ''}
            </p>
          )}
        </div>
        {streaming ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Cancelar
          </Button>
        ) : summary && !loadingCached ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            className="gap-1.5 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Regenerar
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        {loadingCached ? (
          /* Skeleton mientras se consulta el cache */
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted/50" />
            <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted/40" />
            <div className="h-24 animate-pulse rounded-xl bg-muted/30" />
          </div>
        ) : streaming ? (
          /* ── Run en vivo: fases + thinking + preview de métricas ── */
          <div className="space-y-6">
            <div className="rounded-xl border bg-card p-5">
              <PhaseStepper phase={phase} currentLabel={phaseLabel} />
              {thinking && (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setThinkingOpen((o) => !o)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                  >
                    <ChevronDown
                      className={`h-3 w-3 transition-transform duration-200 ${thinkingOpen ? '' : '-rotate-90'}`}
                    />
                    Razonamiento del agente
                  </button>
                  {thinkingOpen && (
                    <div
                      ref={thinkingRef}
                      className="mt-2 max-h-40 overflow-y-auto rounded-lg border bg-muted/20 px-3 py-2 text-xs italic leading-relaxed text-muted-foreground/80"
                    >
                      <Streamdown parseIncompleteMarkdown components={THINKING_MD_COMPONENTS}>
                        {thinking}
                      </Streamdown>
                      <span className="ml-0.5 inline-block h-3 w-[2px] animate-[agent-cursor-blink_1s_steps(2)_infinite] bg-primary" />
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Las métricas deterministas llegan antes que la narrativa —
                se muestran de inmediato mientras la IA redacta. */}
            {liveMetrics && <KpiCards metrics={liveMetrics} />}
          </div>
        ) : (
          <div className="space-y-10">
            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">
                    No se pudo generar el resumen
                  </p>
                  <p className="mt-0.5 break-words text-xs text-red-600/80 dark:text-red-400/80">
                    {error}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  className="shrink-0 gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Reintentar
                </Button>
              </div>
            )}

            {summary ? (
              <>
                {/* ── Hero: la conclusión primero (narrativa + donut) ── */}
                <div className="flex flex-col-reverse items-center gap-8 sm:flex-row sm:items-start">
                  <NarrativeHero narrative={summary.narrative} />
                  <HealthDonut
                    progressPct={summary.metrics.totals.progressPct}
                    health={summary.narrative.health}
                  />
                </div>

                {/* ── Los números duros ── */}
                <KpiCards metrics={summary.metrics} />

                <ChartCard title="Calendario vs avance">
                  <TimelineGauge
                    timeline={summary.metrics.timeline}
                    progressPct={summary.metrics.totals.progressPct}
                  />
                </ChartCard>

                <div className="grid gap-3 lg:grid-cols-2">
                  <ChartCard title="Distribución de historias">
                    <StatusStackedBar distribution={summary.metrics.storyDistribution} />
                  </ChartCard>
                  <ChartCard title="Carga por pod">
                    <PodLoadChart pods={summary.metrics.pods} />
                  </ChartCard>
                </div>

                <ChartCard title="Progreso por épica">
                  <EpicProgressChart epics={summary.metrics.epics} />
                </ChartCard>

                {/* ── Lectura cualitativa al cierre ── */}
                <NarrativeInsights narrative={summary.narrative} />
              </>
            ) : !error ? (
              /* ── Empty state: invitar a generar ── */
              <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed py-12 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Aún no hay un resumen ejecutivo para esta iniciativa
                </p>
                <p className="max-w-md text-xs text-muted-foreground/70">
                  El agente analiza las métricas reales — épicas, historias, pods, fechas y
                  dependencias — y redacta una lectura ejecutiva con riesgos y recomendaciones
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  className="mt-1 gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generar resumen ejecutivo
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
