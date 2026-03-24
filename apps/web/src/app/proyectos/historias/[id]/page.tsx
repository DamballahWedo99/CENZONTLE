import { StoryFullPage } from '@/components/proyectos/historias/StoryFullPage';

export default async function StoryPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <StoryFullPage storyId={id} />
    </div>
  );
}
