'use client';

import { TeamSection } from '@/components/factory/settings/TeamSection';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function EquipoPage() {
  useDocumentTitle('Equipo');
  return (
    <div className="p-6">
      <TeamSection />
    </div>
  );
}
