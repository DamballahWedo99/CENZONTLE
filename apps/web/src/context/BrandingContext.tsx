'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type BrandingAssetType,
  type BrandingSettings,
  DEFAULT_BRANDING_SETTINGS,
} from '@cenzontle/shared';
import { BRANDING_ASSET_FALLBACKS } from '@/lib/branding-fallbacks';
import { getBrandingSettings } from '@/lib/api/branding';

/**
 * Provider del branding global. Hidratado desde el SSR del layout raíz con
 * `initialBranding` (fetched antes de Auth0). El cliente lo consume para
 * renderizar el logo del sidebar y, via metadata estática del layout, el
 * favicon.
 *
 * `refresh()` se llama después de un PATCH/upload/delete exitoso desde la
 * UI de settings — refetcha el endpoint y propaga el nuevo branding al
 * sidebar SIN reload completo de la página.
 */
interface BrandingContextValue {
  branding: BrandingSettings;
  /** Resuelve la URL del asset, cayendo al fallback estático si es null. */
  assetUrl: (type: BrandingAssetType) => string;
  refresh: () => Promise<void>;
}

const FALLBACK_BRANDING: BrandingSettings = {
  ...DEFAULT_BRANDING_SETTINGS,
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({
  initialBranding,
  children,
}: {
  initialBranding: BrandingSettings | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [branding, setBranding] = useState<BrandingSettings>(
    initialBranding ?? FALLBACK_BRANDING,
  );

  const refresh = useCallback(async () => {
    try {
      const next = await getBrandingSettings();
      setBranding(next);
      // Forzar re-render del SSR de todas las server components cacheadas
      // en el client router cache de Next.js. SIN esto, las páginas server
      // (/proyectos, /proyectos/matriz, [id], etc.) seguirían mostrando el
      // companyName viejo en su `<title>` hasta que el user navegue a una
      // nueva ruta o haga hard reload. Las páginas client (factory/*) se
      // actualizan instantáneamente vía useDocumentTitle (reactivo al
      // setBranding de arriba).
      //
      // router.refresh() solo invalida cache server, NO descarta el state
      // local — el setBranding ya se aplicó arriba. Es la combinación
      // canónica del App Router para "datos del server cambiaron, re-fetch".
      router.refresh();
    } catch (err) {
      // No-throw: si el refetch falla, mantenemos el branding actual. El
      // user verá el feedback del error en el toast del componente que
      // hizo el PATCH/upload.
      console.warn('[BrandingContext] refresh failed:', (err as Error).message);
    }
  }, [router]);

  const assetUrl = useCallback(
    (type: BrandingAssetType): string => {
      const field = type === 'logo'
        ? branding.logoUrl
        : type === 'logoCollapsed'
        ? branding.logoCollapsedUrl
        : branding.faviconUrl;
      return field ?? BRANDING_ASSET_FALLBACKS[type];
    },
    [branding],
  );

  const value = useMemo<BrandingContextValue>(
    () => ({ branding, assetUrl, refresh }),
    [branding, assetUrl, refresh],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return ctx;
}
