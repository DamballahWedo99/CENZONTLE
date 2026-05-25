import type { BrandingAssetType } from '@cenzontle/shared';

/**
 * Paths estáticos en `apps/web/public/` usados como fallback cuando el
 * branding no tiene asset configurado (URL nula en la BD).
 *
 * Vive aquí (no en `@cenzontle/shared`) porque son específicos del
 * frontend Next.js — el shared package se mantiene agnóstico de la
 * estructura de archivos de cada app.
 */
export const BRANDING_ASSET_FALLBACKS: Record<BrandingAssetType, string> = {
  logo: '/Logo.svg',
  logoCollapsed: '/Imagotipo.svg',
  favicon: '/Imagotipo.svg',
};
