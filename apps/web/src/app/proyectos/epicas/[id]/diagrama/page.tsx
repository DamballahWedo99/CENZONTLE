import type { Metadata } from 'next';
import { DiagramFullPage } from '@/components/proyectos/epicas/DiagramFullPage';

// Title estático — el template del layout raíz añade el companyName.
export const metadata: Metadata = {
  title: 'Diagrama',
};

export default async function DiagramPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="h-full min-h-0">
      <DiagramFullPage epicId={id} />
    </div>
  );
}
