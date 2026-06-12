'use client';

import { Terminal } from 'lucide-react';

/**
 * Vista de logs del Forge (/factory/logs).
 *
 * No existe todavía un endpoint de log aggregation del factory — la
 * versión anterior de esta vista (filtros por source/level/rango, búsqueda
 * full-text, análisis de volumen) leía el slice mock `state.logs` del
 * FactoryContext, que tras la limpieza de mocks legacy quedó vacío para
 * siempre. Se redujo a un empty state honesto (2026-06-11; el historial de
 * git preserva la UI como referencia).
 *
 * Cuando exista la fuente real (p.ej. el shipper a Loki pendiente de
 * deploy, o un endpoint que exponga el output de los AgentRuns), reconectar
 * con el patrón de /factory/cost: contrato en el service + espejo en
 * `lib/api/factory.ts` + hook con polling (ver use-cost-analytics.ts).
 */
export function LogViewer() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
      <Terminal className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">
        Logs del Forge sin conectar
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        El dashboard aún no recibe logs agregados del factory. Esta vista se
        activará cuando exista la fuente real de log streaming.
      </p>
    </div>
  );
}
