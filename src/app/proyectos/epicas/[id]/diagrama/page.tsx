import { DiagramFullPage } from '@/components/proyectos/epicas/DiagramFullPage';

export default async function DiagramPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="h-full min-h-0">
      <DiagramFullPage epicId={id} />
    </div>
  );
}
