'use client';

import type { ReactNode } from 'react';
import { Layers, ListChecks, Gauge, ShieldAlert, CalendarClock } from 'lucide-react';
import type { InitiativeMetrics } from '@cenzontle/shared';

interface KpiCardsProps {
  metrics: InitiativeMetrics;
}

interface KpiCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  detail?: ReactNode;
  accent?: string;
}

function KpiCard({ icon, value, label, detail, accent }: KpiCardProps) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className={`text-2xl font-bold tabular-nums tracking-tight ${accent ?? ''}`}>{value}</p>
        <span className="mt-0.5 text-muted-foreground/50">{icon}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      {detail && <p className="mt-1.5 text-[11px] text-muted-foreground/70">{detail}</p>}
    </div>
  );
}

/** Fila de KPIs ejecutivos — los números duros del snapshot, de un vistazo. */
export function KpiCards({ metrics }: KpiCardsProps) {
  const { totals, dependencies, timeline } = metrics;
  const blockers = totals.storiesBlocked + dependencies.technicalOpen;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        icon={<Layers className="h-4 w-4" />}
        value={totals.epics}
        label="Épicas"
        detail={`${totals.epicsByStatus.done ?? 0} completadas`}
      />
      <KpiCard
        icon={<ListChecks className="h-4 w-4" />}
        value={
          <>
            {totals.storiesDone}
            <span className="text-sm font-medium text-muted-foreground">/{totals.stories}</span>
          </>
        }
        label="Historias completadas"
        detail={`${totals.progressPct}% del total`}
      />
      <KpiCard
        icon={<Gauge className="h-4 w-4" />}
        value={
          <>
            {totals.pointsDone}
            <span className="text-sm font-medium text-muted-foreground">/{totals.points}</span>
          </>
        }
        label="Story points"
        detail={
          totals.points > 0
            ? `${Math.round((totals.pointsDone / totals.points) * 100)}% entregado`
            : 'Sin estimaciones'
        }
      />
      <KpiCard
        icon={<ShieldAlert className="h-4 w-4" />}
        value={blockers}
        label="Bloqueos activos"
        accent={blockers > 0 ? 'text-red-500' : undefined}
        detail={`${totals.storiesBlocked} historias · ${dependencies.technicalOpen} deps técnicas${
          dependencies.technicalBlocking > 0 ? ` (${dependencies.technicalBlocking} bloqueantes)` : ''
        }`}
      />
      <KpiCard
        icon={<CalendarClock className="h-4 w-4" />}
        value={timeline.daysRemaining ?? '—'}
        label="Días restantes"
        accent={
          timeline.daysRemaining !== null && timeline.daysRemaining < 0 ? 'text-red-500' : undefined
        }
        detail={
          timeline.daysRemaining === null
            ? 'Sin fecha objetivo'
            : timeline.daysRemaining < 0
              ? 'Fecha objetivo vencida'
              : 'para la fecha objetivo'
        }
      />
    </div>
  );
}
