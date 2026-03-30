'use client';

import { Suspense } from 'react';
import { SettingsDashboard } from '@/components/factory/settings/SettingsDashboard';

export default function FactorySettingsPage() {
  return (
    <Suspense>
      <SettingsDashboard />
    </Suspense>
  );
}
