import type { Metadata } from 'next';
import { ProyectosDashboard } from '@/components/proyectos/ProyectosDashboard';

// Solo el sufijo de la página — el template `%s | {companyName}` del layout
// raíz añade el nombre de la organización automáticamente. Cambiar el
// branding desde settings actualiza el title sin tocar este archivo.
export const metadata: Metadata = {
  title: 'Seguimiento de Proyectos',
  description: 'Gestión y seguimiento de iniciativas, épicas e historias de usuario',
};

export default function ProyectosPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ProyectosDashboard />
    </div>
  );
}
