'use client';

import { PRPipeline } from '@/components/factory/PRPipeline';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryPRsPage() {
  useDocumentTitle('Pull Requests');
  return <PRPipeline />;
}
