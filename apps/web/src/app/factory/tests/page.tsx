'use client';

import { TestResults } from '@/components/factory/TestResults';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryTestsPage() {
  useDocumentTitle('Tests');
  return <TestResults />;
}
