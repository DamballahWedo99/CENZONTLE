/**
 * SidebarLogo Component
 *
 * Displays the logo when sidebar is collapsed. El asset se resuelve desde
 * el BrandingContext (puede ser custom subido por admin o el imagotipo
 * CENZONTLE default).
 */

'use client';

import * as React from 'react';
import Image from 'next/image';
import { useBranding } from '@/context/BrandingContext';

export function SidebarLogo() {
  const { branding, assetUrl } = useBranding();
  const src = assetUrl('logoCollapsed');
  return (
    <div
      className="flex h-10 w-10 items-center justify-center"
      data-testid="sidebar-logo-collapsed"
    >
      {/* Container 40×40px define el clickable area del icon; el imagotipo
          ocupa ~42% de esa caja (max-h-[17px]) — arbitrary value porque
          Tailwind salta de max-h-4 (16px, queda chico) a max-h-5 (20px,
          queda grande) y necesitamos el sweet spot entre ambos.
          width/height de la prop son hints para Next/Image — el render
          real lo controla max-h-* + w-auto + object-contain. */}
      <Image
        key={src}
        src={src}
        alt={`${branding.companyName} Logo`}
        width={19}
        height={15}
        unoptimized
        className="object-contain max-h-[17px] w-auto dark:invert"
      />
    </div>
  );
}
