'use client';

import { FactoryProvider } from '@/context/FactoryContext';

export default function FactoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FactoryProvider>
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 has-[.settings-page]:p-0 has-[.settings-page]:overflow-hidden has-[.terminal-page]:p-0 has-[.terminal-page]:overflow-hidden">
          {children}
        </div>
      </div>
    </FactoryProvider>
  );
}
