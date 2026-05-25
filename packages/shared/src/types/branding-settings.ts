/**
 * Configuración singleton de identidad de marca (branding) de la organización.
 *
 * Editable desde `/factory/settings?section=branding` por usuarios con
 * permiso MANAGE_BRANDING (Alta Gerencia por default).
 *
 * Tres assets configurables:
 *  - logo:          versión expandida del logo (sidebar abierto)
 *  - logoCollapsed: versión imagotipo (sidebar colapsado, fallback favicon)
 *  - favicon:       icono de la pestaña del navegador
 *
 * Cuando un asset es `null`, el frontend cae al asset estático por defecto
 * en `/public` (Logo.svg / Imagotipo.svg). Esto permite que la organización
 * arranque con la marca CENZONTLE y la sustituya por la propia.
 *
 * El endpoint GET es PÚBLICO (sin auth) porque el layout raíz lo consume
 * en SSR antes de que Auth0 resuelva — el favicon debe estar en el HTML
 * inicial, no después de hidratación.
 */
export type BrandingAssetType = 'logo' | 'logoCollapsed' | 'favicon';

export const BRANDING_ASSET_TYPES: ReadonlyArray<BrandingAssetType> = [
  'logo',
  'logoCollapsed',
  'favicon',
] as const;

export const BRANDING_ASSET_LABELS: Record<BrandingAssetType, string> = {
  logo: 'Logo principal',
  logoCollapsed: 'Imagotipo (sidebar colapsado)',
  favicon: 'Favicon (pestaña del navegador)',
};

export const BRANDING_ASSET_DESCRIPTIONS: Record<BrandingAssetType, string> = {
  logo: 'Logo expandido. Aparece en la esquina superior izquierda cuando el sidebar está abierto. Recomendado: PNG/SVG horizontal, ~150×25px.',
  logoCollapsed: 'Versión imagotipo del logo. Aparece cuando el sidebar está colapsado. Recomendado: cuadrado, 24×24px o múltiplos.',
  favicon: 'Icono que aparece en la pestaña del navegador. Recomendado: PNG/SVG/ICO cuadrado, 32×32px o múltiplos.',
};

/**
 * Bounds para subida de assets. Espejo del límite que enforce el backend
 * vía multer (FileInterceptor). 2MB es suficiente para PNGs de alta
 * resolución y favicons; rechaza archivos accidentales como videos.
 *
 * Mínimo de 8 bytes — defensa contra archivos vacíos/casi-vacíos. Un PNG
 * válido tiene 8 bytes solo en el signature; este check es defensa en
 * profundidad además del `file.size === 0` en el service.
 */
export const BRANDING_ASSET_CONSTRAINTS = {
  maxFileSizeBytes: 2 * 1024 * 1024,
  minFileSizeBytes: 8,
  /**
   * Mimetypes aceptados — SOLO formatos raster.
   *
   * SECURITY: SVG fue EXCLUIDO intencionalmente. SVG es XML ejecutable: puede
   * contener `<script>`, `onload`, foreignObject con HTML, y otros vectores
   * XSS persistentes. Sanitizar SVG server-side (DOMPurify + jsdom) es
   * costoso y propenso a bypass; servir con sandbox CSP no protege en navegación
   * directa a la URL. La política aquí es "no aceptamos SVG" — la
   * organización puede convertir su logo a PNG/WebP con un convertidor
   * trivial y obtener mejor cross-browser compatibility.
   *
   * ICO se acepta porque favicons históricamente usan ese formato y es un
   * binario simple (no ejecutable).
   */
  acceptedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ] as const,
  /**
   * Magic bytes (signatures) por mimetype para validación server-side
   * contra MIME spoofing. El cliente puede mentir sobre `Content-Type`;
   * el server inspecciona los primeros bytes del archivo y rechaza si no
   * coinciden con ningún allowlist conocido.
   *
   * Formatos múltiples por mimetype porque ICO tiene dos variantes
   * (icon real + cursor que también es x-icon en algunos browsers).
   */
  magicBytes: {
    'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    'image/jpeg': [[0xff, 0xd8, 0xff]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]], // "RIFF" — completar con "WEBP" en byte 8
    'image/x-icon': [[0x00, 0x00, 0x01, 0x00], [0x00, 0x00, 0x02, 0x00]],
    'image/vnd.microsoft.icon': [[0x00, 0x00, 0x01, 0x00], [0x00, 0x00, 0x02, 0x00]],
  } as Record<string, ReadonlyArray<ReadonlyArray<number>>>,
} as const;

/**
 * Estado completo del branding. Todos los URL son relativos al backend
 * (e.g. `/api/branding-settings/asset/logo?v=12345`) o absolutos cuando
 * apuntan a un CDN futuro. Frontend NO debe asumir ningún prefijo.
 *
 * El query `?v=updatedAt.timestamp` actúa como cache buster — al actualizar
 * el asset, la URL cambia y el navegador invalida el cache (importante para
 * el favicon, que es agresivamente cacheado).
 */
export interface BrandingSettings {
  /** Nombre legible de la organización. Se inyecta en `<title>` y `aria-label`. */
  companyName: string;
  /** URL del logo expandido. `null` ⇒ fallback a `/Logo.svg` (CENZONTLE). */
  logoUrl: string | null;
  /** URL del imagotipo colapsado. `null` ⇒ fallback a `/Imagotipo.svg`. */
  logoCollapsedUrl: string | null;
  /** URL del favicon. `null` ⇒ fallback a `/Imagotipo.svg`. */
  faviconUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Default values que coinciden con los `@default(...)` del schema Prisma. */
export const DEFAULT_BRANDING_SETTINGS: Omit<BrandingSettings, 'updatedAt' | 'updatedBy'> = {
  companyName: 'CENZONTLE',
  logoUrl: null,
  logoCollapsedUrl: null,
  faviconUrl: null,
};

/**
 * Los paths de fallback estáticos (e.g. `/Logo.svg` en `apps/web/public/`)
 * NO viven aquí porque shared es agnóstico de la estructura de archivos del
 * frontend. Cada cliente (web) define sus propios fallbacks; ver
 * `apps/web/src/lib/branding-fallbacks.ts`.
 */
