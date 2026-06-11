'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  TrendingUp,
  Minus,
  AlertTriangle,
  ShieldCheck,
  Lightbulb,
} from 'lucide-react';
import type {
  ExecutiveSummaryNarrative,
  ExecutiveSummaryTone,
  ExecutiveSummaryRiskSeverity,
} from '@cenzontle/shared';
import { HEALTH_THEME } from './charts/chart-theme';

// Overrides a nivel de módulo (no inline en JSX) para identidad estable —
// evita re-parseos innecesarios del markdown en cada render.
const OVERVIEW_MD_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="my-2 text-sm leading-relaxed text-foreground/80 first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-foreground/80">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-muted/60 px-1 font-mono text-[12px]">{children}</code>
  ),
  a: ({ href, children }) => (
    <a href={href} className="underline hover:text-foreground" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

const TONE_CONFIG: Record<ExecutiveSummaryTone, { icon: typeof TrendingUp; className: string }> = {
  positive: { icon: TrendingUp, className: 'text-emerald-500' },
  neutral: { icon: Minus, className: 'text-zinc-400' },
  warning: { icon: AlertTriangle, className: 'text-amber-500' },
};

const SEVERITY_CONFIG: Record<
  ExecutiveSummaryRiskSeverity,
  { label: string; border: string; badge: string }
> = {
  high: {
    label: 'Alto',
    border: 'border-l-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  medium: {
    label: 'Medio',
    border: 'border-l-amber-500',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  low: {
    label: 'Bajo',
    border: 'border-l-zinc-400',
    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
};

interface NarrativeProps {
  narrative: ExecutiveSummaryNarrative;
}

export function HealthBadge({ narrative }: NarrativeProps) {
  const theme = HEALTH_THEME[narrative.health];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${theme.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {theme.label}
    </span>
  );
}

/**
 * Apertura ejecutiva — semáforo, headline y lectura general. Es lo primero
 * que lee un director: la conclusión antes que los números.
 */
export function NarrativeHero({ narrative }: NarrativeProps) {
  return (
    <div className="min-w-0 flex-1">
      <HealthBadge narrative={narrative} />
      <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-tight">
        {narrative.headline}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{narrative.healthRationale}</p>
      <div className="mt-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={OVERVIEW_MD_COMPONENTS}>
          {narrative.overview}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Lectura cualitativa: puntos clave, riesgos con mitigación y recomendaciones. */
export function NarrativeInsights({ narrative }: NarrativeProps) {
  const { highlights, risks, recommendations } = narrative;

  return (
    <div className="space-y-10">
      {highlights.length > 0 && (
        <section>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Puntos clave
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((highlight, i) => {
              const tone = TONE_CONFIG[highlight.tone];
              const Icon = tone.icon;
              return (
                <div key={i} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start gap-2.5">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.className}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{highlight.title}</p>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {highlight.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {risks.length > 0 && (
        <section>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Riesgos
          </h3>
          <div className="space-y-3">
            {risks.map((risk, i) => {
              const severity = SEVERITY_CONFIG[risk.severity];
              return (
                <div
                  key={i}
                  className={`rounded-lg border border-l-4 bg-card p-4 ${severity.border}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{risk.title}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${severity.badge}`}
                    >
                      {severity.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {risk.detail}
                  </p>
                  {risk.mitigation && (
                    <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-foreground/70">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span>
                        <span className="font-medium">Mitigación:</span> {risk.mitigation}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {recommendations.length > 0 && (
        <section>
          <h3 className="mb-4 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" />
            Recomendaciones
          </h3>
          <ol className="space-y-3">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-medium leading-snug">{rec.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rec.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
