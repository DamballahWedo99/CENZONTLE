'use client';

import { useEffect } from 'react';
import { useBranding } from '@/context/BrandingContext';

/**
 * Hook para client components que necesitan setear el `<title>` de la
 * pestaña con el nombre de la organización actual.
 *
 * Por qué no usar `metadata`/`generateMetadata` de Next.js: solo funcionan
 * en server components. Cuando una page.tsx tiene `"use client"`, Next.js
 * ignora los exports `metadata` (y emite warning). Para esos casos el
 * patrón idiomático es manipular `document.title` en `useEffect`.
 *
 * Comportamiento:
 *  - Aplica el mismo formato que el `metadata.title.template` del layout
 *    raíz: `"{pageTitle} | {companyName}"`. Si `pageTitle` es undefined,
 *    aplica solo `companyName` (default).
 *  - REACTIVO: si el admin cambia el companyName desde settings, todas las
 *    pestañas con este hook se actualizan sin reload (gracias al
 *    BrandingContext.refresh tras el PATCH).
 *  - Cleanup: al desmontar el componente, restaura el title al default del
 *    layout raíz — evita "title fantasma" si navegas rápido entre páginas.
 *  - SAFE: nunca toca `document` durante SSR (effect-only).
 *
 * Uso:
 *   export default function FactoryPage() {
 *     useDocumentTitle('Factory');
 *     return <FactoryDashboard />;
 *   }
 *
 * Para títulos dinámicos basados en data (e.g. "Épica: Pagos QR | Acme Corp"),
 * usa el parámetro como expresión:
 *   useDocumentTitle(epic?.title ? `Épica: ${epic.title}` : 'Épica');
 */
export function useDocumentTitle(pageTitle: string | undefined): void {
  const { branding } = useBranding();
  const companyName = branding.companyName;

  useEffect(() => {
    if (typeof document === 'undefined') return; // safety net

    const previousTitle = document.title;
    const nextTitle = pageTitle && pageTitle.trim().length > 0
      ? `${pageTitle} | ${companyName}`
      : companyName;

    document.title = nextTitle;

    return () => {
      // Restauramos a un título neutro al desmontar — el siguiente page
      // que tenga el hook reasignará inmediatamente. Si el siguiente NO
      // tiene el hook (no debería pasar tras esta refactorización), al
      // menos vemos el companyName en vez de basura del page anterior.
      document.title = previousTitle;
    };
  }, [pageTitle, companyName]);
}
