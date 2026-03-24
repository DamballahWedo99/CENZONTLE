'use client';

import { ProyectosProvider } from '@/context/ProyectosContext';

export default function ProyectosLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProyectosProvider>
      {children}
    </ProyectosProvider>
  );
}
