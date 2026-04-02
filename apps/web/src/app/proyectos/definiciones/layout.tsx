'use client';

import { DefinicionesProvider } from '@/context/DefinicionesContext';

export default function DefinicionesLayout({ children }: { children: React.ReactNode }) {
  return (
    <DefinicionesProvider>
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </DefinicionesProvider>
  );
}
