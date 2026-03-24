'use client';

import { ChangelogTimeline } from './changelog/ChangelogTimeline';
import { History } from 'lucide-react';

export function ChangelogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6" />
          Changelog
        </h1>
        <p className="text-sm text-muted-foreground">
          Historial de cambios en épicas e historias de usuario
        </p>
      </div>
      <ChangelogTimeline />
    </div>
  );
}
