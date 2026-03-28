'use client';

import { usePathname } from 'next/navigation';
import { ConditionalSidebar } from '@/components/conditional-sidebar';
import { DashboardHeader } from '@/components/dashboard-header';

/**
 * Routes matching these patterns render fullscreen (no sidebar, no header).
 * Everything else gets the normal dashboard chrome.
 */
const FULLSCREEN_PATTERNS = ['/terminal'];

function isFullscreen(pathname: string | null): boolean {
  if (!pathname) return false;
  return FULLSCREEN_PATTERNS.some((p) => pathname.includes(p));
}

export function FullscreenOrChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isFullscreen(pathname)) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <>
      <ConditionalSidebar />
      <div className="flex flex-1 flex-col w-full h-screen overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 w-full overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </>
  );
}
