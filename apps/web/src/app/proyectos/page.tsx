import type { Metadata } from 'next';
import { ProyectosDashboard } from '@/components/proyectos/ProyectosDashboard';

export const metadata: Metadata = {
  title: 'Seguimiento de Proyectos | CENZONTLE',
  description: 'Gestión y seguimiento de iniciativas, épicas e historias de usuario',
};

export default function ProyectosPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <ProyectosDashboard />
    </div>
  );
}
