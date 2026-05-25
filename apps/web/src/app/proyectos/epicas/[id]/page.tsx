import type { Metadata } from 'next';
import { EpicFullPage } from '@/components/proyectos/epicas/EpicFullPage';

// Title estático — el template del layout raíz añade el companyName.
export const metadata: Metadata = {
  title: 'Épica',
};

export default async function EpicPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <EpicFullPage epicId={id} />
    </div>
  );
}
