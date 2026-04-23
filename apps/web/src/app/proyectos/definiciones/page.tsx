'use client';

import { Suspense } from 'react';
import { DefinicionesExplorer } from '@/components/definiciones/DefinicionesExplorer';

export default function DefinicionesPage() {
  return (
    <Suspense>
      <DefinicionesExplorer />
    </Suspense>
  );
}
