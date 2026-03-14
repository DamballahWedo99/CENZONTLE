import type { Metadata } from 'next';
import { MatrizPage } from '@/components/proyectos/MatrizPage';

export const metadata: Metadata = {
  title: 'Matriz de Seguimiento | CENZONTLE',
  description: 'Matriz de seguimiento de épicas por POD',
};

export default function MatrizSeguimientoPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <MatrizPage />
    </div>
  );
}
