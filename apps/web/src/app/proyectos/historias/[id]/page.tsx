import type { Metadata } from 'next';
import { StoryFullPage } from '@/components/proyectos/historias/StoryFullPage';

// Title estático — el template del layout raíz añade el companyName.
export const metadata: Metadata = {
  title: 'Historia',
};

export default async function StoryPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <StoryFullPage storyId={id} />
    </div>
  );
}
