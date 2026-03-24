import type { Metadata } from 'next';
import { ChangelogPage } from '@/components/proyectos/ChangelogPage';

export const metadata: Metadata = {
  title: 'Changelog | CENZONTLE',
  description: 'Historial de cambios en épicas e historias de usuario',
};

export default function ChangelogPageRoute() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <ChangelogPage />
    </div>
  );
}
