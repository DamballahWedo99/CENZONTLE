'use client';

import { FactoryProvider } from '@/context/FactoryContext';

export default function FactoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FactoryProvider>
      <div className="flex flex-col h-full bg-[#0A0A0F] min-h-screen">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </FactoryProvider>
  );
}
