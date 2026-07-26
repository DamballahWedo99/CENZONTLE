import type { Metadata } from 'next';
import { BRANDING_ASSET_FALLBACKS } from '@/lib/branding-fallbacks';
import { fetchBrandingSettingsSSR } from '@/lib/api/branding';

/**
 * Página pública de login — render server-side con branding dinámico (el
 * usuario ve el logo + nombre de SU organización, no el default CENZONTLE).
 *
 * Render path: el layout raíz YA fetchea el branding y lo hidrata en el
 * BrandingProvider, pero este page es server-only y no usa hooks. Fetcheamos
 * directo aquí — `fetch` con `next: { revalidate: 60 }` dedupea automáticamente
 * con el del layout, así que sigue siendo UN solo round-trip al backend.
 *
 * Metadata: title estático "Iniciar sesión" — el template del layout raíz
 * añade el companyName ("Iniciar sesión | Acme Corp"). Si el branding no
 * carga, layout cae a "Iniciar sesión | CENZONTLE".
 */
export const metadata: Metadata = {
  title: 'Iniciar sesión',
};

export default async function LoginPage() {
  const branding = await fetchBrandingSettingsSSR();
  const companyName = branding?.companyName ?? 'CENZONTLE';
  // Para login usamos el imagotipo (logo cuadrado/compacto) — el logo
  // expandido típicamente es horizontal y desproporcionado para esta vista.
  const logoSrc =
    branding?.logoCollapsedUrl ?? BRANDING_ASSET_FALLBACKS.logoCollapsed;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- src dinámico de origen variable (S3 o estático), Next/Image requeriría domain whitelist runtime que cambia */}
          <img
            src={logoSrc}
            alt={companyName}
            className="mx-auto h-16 w-auto dark:invert"
          />
          <h1 className="text-2xl font-bold tracking-tight">{companyName}</h1>
          <p className="text-sm text-muted-foreground">
            Software Factory &amp; Project Management
          </p>
        </div>
        <a
          href="/auth/login"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Iniciar sesión
        </a>
      </div>
    </div>
  );
}
