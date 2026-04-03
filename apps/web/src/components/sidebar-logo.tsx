/**
 * SidebarLogo Component
 *
 * Displays the logo when sidebar is collapsed
 */

'use client';

import * as React from 'react';
import Image from 'next/image';

export function SidebarLogo() {
  return (
    <div className="flex h-10 w-10 items-center justify-center">
      <Image
        src="/Imagotipo.svg"
        alt="CENZONTLE Logo"
        width={24}
        height={19}
        className="object-contain dark:invert"
      />
    </div>
  );
}
