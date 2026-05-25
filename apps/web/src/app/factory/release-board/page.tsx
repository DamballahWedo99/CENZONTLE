'use client';

import { ReleaseBoard } from '@/components/factory/ReleaseBoard';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryReleaseBoardPage() {
  useDocumentTitle('Release Board');
  return <ReleaseBoard />;
}
