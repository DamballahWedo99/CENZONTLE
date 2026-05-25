import type { Metadata } from 'next';
import { InitiativeFullPage } from '@/components/proyectos/overview/InitiativeFullPage';

// Title estático — el template del layout raíz añade el companyName.
export const metadata: Metadata = {
  title: 'Iniciativa',
};

export default async function InitiativePageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <InitiativeFullPage initiativeId={id} />
    </div>
  );
}
