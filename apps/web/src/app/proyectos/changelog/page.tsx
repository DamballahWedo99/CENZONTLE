import type { Metadata } from 'next';
import { ChangelogPage } from '@/components/proyectos/ChangelogPage';

// Sufijo solo — el template del layout raíz aplica el companyName dinámico.
export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Historial de cambios en épicas e historias de usuario',
};

export default function ChangelogPageRoute() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ChangelogPage />
    </div>
  );
}
