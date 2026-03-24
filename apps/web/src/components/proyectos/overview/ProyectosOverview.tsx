'use client';

import { useProyectos } from '@/context/ProyectosContext';
import { InitiativeProgress } from './InitiativeProgress';
import { PodWorkloadSummary } from './PodWorkloadSummary';

export function ProyectosOverview() {
  const { state } = useProyectos();

  return (
    <div className="space-y-6">
      {/* Initiatives */}
      <section>
        <div className="space-y-3">
          {state.initiatives.map((initiative) => (
            <InitiativeProgress key={initiative.id} initiative={initiative} />
          ))}
        </div>
      </section>

      {/* POD Workload */}
      <section aria-labelledby="pod-workload-heading">
        <h3 id="pod-workload-heading" className="text-lg font-semibold mb-3">Carga por POD</h3>
        <PodWorkloadSummary />
      </section>
    </div>
  );
}
