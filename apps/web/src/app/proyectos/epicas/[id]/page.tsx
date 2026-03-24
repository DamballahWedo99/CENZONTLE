import { EpicFullPage } from '@/components/proyectos/epicas/EpicFullPage';

export default async function EpicPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <EpicFullPage epicId={id} />
    </div>
  );
}
