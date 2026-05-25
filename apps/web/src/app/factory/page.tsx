'use client';

import { FactoryOverview } from '@/components/factory/FactoryOverview';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryPage() {
  useDocumentTitle('Factory');
  return <FactoryOverview />;
}
