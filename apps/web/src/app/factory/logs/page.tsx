'use client';

import { LogViewer } from '@/components/factory/LogViewer';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactoryLogsPage() {
  useDocumentTitle('Logs');
  return <LogViewer />;
}
