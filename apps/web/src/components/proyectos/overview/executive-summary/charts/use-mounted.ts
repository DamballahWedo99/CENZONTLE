'use client';

import { useEffect, useState } from 'react';

/**
 * Devuelve false en el primer render y true un frame después de montar.
 *
 * Gatillo para las animaciones de entrada de los charts: el estado inicial
 * (width 0 / dashoffset completo) se pinta primero y la transición CSS corre
 * hacia el valor final. El requestAnimationFrame garantiza que el browser
 * commitea el estado inicial antes del target — sin él la transición puede
 * saltarse (ambos valores en el mismo paint).
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return mounted;
}
