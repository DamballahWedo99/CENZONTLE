'use client';

import { FlaskConical } from 'lucide-react';

/**
 * Vista de resultados de tests del Forge (/factory/tests).
 *
 * No existe todavía un endpoint que reporte test runs del factory — la
 * versión anterior de esta vista (summaries por categoría, pass rates,
 * coverage) leía el slice mock `state.tests` del FactoryContext, que tras
 * la limpieza de mocks legacy quedó vacío para siempre; todas sus
 * secciones renderizaban tablas vacías fingiendo funcionalidad. Se redujo
 * a un empty state honesto (2026-06-11; el historial de git preserva la
 * UI como referencia).
 *
 * Cuando el backend reporte resultados reales (p.ej. del DoD verifier o
 * de un test runner por batch), reconectar con el patrón de /factory/cost:
 * contrato en el service + espejo en `lib/api/factory.ts` + hook con
 * polling (ver use-cost-analytics.ts).
 */
export function TestResults() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 flex flex-col items-center text-center gap-3">
      <FlaskConical className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">
        Resultados de tests sin conectar
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        El Forge aún no reporta resultados de tests al dashboard. Esta vista
        se activará cuando exista el endpoint de test runs por batch.
      </p>
    </div>
  );
}
