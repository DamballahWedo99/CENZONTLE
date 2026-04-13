'use client';

import { useProyectos } from '@/context/ProyectosContext';
import { useAuthContext } from '@/context/AuthContext';
import { Permission } from '@cenzontle/shared';
import { InitiativeProgress } from './InitiativeProgress';
import { PodWorkloadSummary } from './PodWorkloadSummary';
import { Rocket } from 'lucide-react';

export function ProyectosOverview() {
  const { state } = useProyectos();
  const { hasPermission } = useAuthContext();

  if (state.initiatives.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <Rocket className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center space-y-2 max-w-sm">
          <h3 className="text-lg font-semibold">Sin iniciativas</h3>
          <p className="text-sm text-muted-foreground">
            {hasPermission(Permission.CREATE_INITIATIVE)
              ? 'Crea tu primera iniciativa para comenzar a organizar épicas e historias de usuario.'
              : 'Aún no hay iniciativas creadas. Contacta a un director general para crear una.'}
          </p>
        </div>
      </div>
    );
  }

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

      {/* Célula Workload */}
      {state.pods.length > 0 && (
        <section aria-labelledby="pod-workload-heading">
          <h3 id="pod-workload-heading" className="text-lg font-semibold mb-3">Carga por Célula</h3>
          <PodWorkloadSummary />
        </section>
      )}
    </div>
  );
}
