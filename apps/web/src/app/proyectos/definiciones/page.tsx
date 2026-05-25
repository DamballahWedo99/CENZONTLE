'use client';

import { Suspense } from 'react';
import { DefinicionesExplorer } from '@/components/definiciones/DefinicionesExplorer';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function DefinicionesPage() {
  useDocumentTitle('Vault');
  return (
    <Suspense>
      <DefinicionesExplorer />
    </Suspense>
  );
}
