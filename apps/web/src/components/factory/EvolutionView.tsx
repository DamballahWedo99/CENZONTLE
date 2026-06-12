'use client';

import { Dna } from 'lucide-react';

/**
 * Vista de evolución de prompts del Forge (/factory/evolution).
 *
 * El tracking de evolución (versiones de prompt, métricas por batch,
 * rejection rate por versión) todavía no tiene fuente de datos real en el
 * backend. La versión anterior de esta vista renderizaba cards, tablas y
 * comparativas alimentadas por el slice mock `state.evolution` del
 * FactoryContext — tras la limpieza de mocks legacy ese slice quedó vacío
 * para siempre y todas las secciones eran código inalcanzable, así que se
 * retiraron junto con el slice (2026-06-11; el historial de git las
 * preserva como referencia visual).
 *
 * Cuando exista el endpoint real, reconectar con el patrón de
 * /factory/cost: contrato en el service del backend + espejo en
 * `lib/api/factory.ts` + hook con polling (ver use-cost-analytics.ts).
 */
export function EvolutionView() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
      <Dna className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">
        Evolución de prompts sin conectar
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        El tracking de versiones de prompt y sus métricas por batch aún no
        está conectado al backend. Esta vista se activará cuando el Forge
        registre evolución real de prompts.
      </p>
    </div>
  );
}
