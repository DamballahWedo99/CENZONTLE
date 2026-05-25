'use client';

import { Suspense } from 'react';
import { SettingsDashboard } from '@/components/factory/settings/SettingsDashboard';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function FactorySettingsPage() {
  useDocumentTitle('Configuración');
  return (
    <Suspense>
      <SettingsDashboard />
    </Suspense>
  );
}
