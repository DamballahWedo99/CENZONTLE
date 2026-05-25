import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { FullscreenOrChrome } from "@/components/fullscreen-or-chrome";
import { ThemeProvider } from "@/components/theme-provider";
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { HeaderActionsProvider } from "@/context/HeaderActionsContext";
import { IntegrationsProvider } from "@/context/IntegrationsContext";
import { AuthProvider } from "@/context/AuthContext";
import { BrandingProvider } from "@/context/BrandingContext";
import { Toaster } from "sonner";
import { BRANDING_ASSET_FALLBACKS } from "@/lib/branding-fallbacks";
import { fetchBrandingSettingsSSR } from "@/lib/api/branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * generateMetadata (async) reemplaza el `metadata` estático para que el
 * <title> y <link rel="icon"> se derivan del singleton de branding.
 *
 * El fetch va al backend público (`API_INTERNAL_URL`) — NO al BFF proxy
 * (que requiere Auth0). Si el backend está caído, caemos a defaults
 * estáticos sin tirar el render.
 *
 * Patrón `metadata.title = { default, template }`:
 *  - `default`: usado cuando la página no define su propio title (e.g.
 *    redirect en `/`). Resultado: `"Aeroméxico"` (solo el nombre).
 *  - `template`: usado cuando una página exporta `metadata = { title: 'X' }`.
 *    El `%s` se reemplaza por el title de la página. Resultado:
 *    `"Factory | Aeroméxico"`, `"Settings | Aeroméxico"`, etc.
 *
 * Para client components (que no pueden exportar metadata), existe el hook
 * `useDocumentTitle('X')` que aplica el mismo formato dinámicamente y
 * REACCIONA a cambios en el branding (admin sube nuevo nombre → todas las
 * pestañas abiertas se actualizan sin reload).
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await fetchBrandingSettingsSSR();
  const companyName = branding?.companyName ?? 'CENZONTLE';
  const faviconUrl = branding?.faviconUrl ?? BRANDING_ASSET_FALLBACKS.favicon;
  return {
    title: {
      default: companyName,
      template: `%s | ${companyName}`,
    },
    description: `Sistema de gestión ${companyName}`,
    icons: {
      icon: faviconUrl,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Mismo fetch que generateMetadata — Next.js dedupe la request en el
  // mismo render, así que es UN solo round-trip al backend en SSR.
  const initialBranding = await fetchBrandingSettingsSSR();

  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <BrandingProvider initialBranding={initialBranding}>
            <Auth0Provider>
              <AuthProvider>
                <BreadcrumbProvider>
                  <HeaderActionsProvider>
                    <IntegrationsProvider>
                      <SidebarProvider defaultOpen={false}>
                        <FullscreenOrChrome>
                          {children}
                        </FullscreenOrChrome>
                      </SidebarProvider>
                    </IntegrationsProvider>
                  </HeaderActionsProvider>
                </BreadcrumbProvider>
              </AuthProvider>
            </Auth0Provider>
          </BrandingProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
