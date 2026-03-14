'use client';

import { MatrizSeguimiento } from './matriz/MatrizSeguimiento';
import { ProyectosFilters } from './filters/ProyectosFilters';
import { Grid3X3 } from 'lucide-react';

export function MatrizPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Grid3X3 className="h-6 w-6" />
          Matriz de Seguimiento
        </h1>
        <p className="text-sm text-muted-foreground">
          Vista cruzada de épicas por POD con progreso detallado
        </p>
      </div>
      <ProyectosFilters />
      <MatrizSeguimiento />
    </div>
  );
}
