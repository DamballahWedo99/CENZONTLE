'use client';

import { useEffect, useState } from 'react';

interface Result {
  blobUrl: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetchea un recurso protegido vía el BFF de streaming binario (/api/files/)
 * y devuelve un blob: URL temporal usable en <iframe src> o <img src>.
 *
 * - Inyecta JWT de Auth0 automáticamente desde la sesión del usuario.
 * - Libera el blob con URL.revokeObjectURL en el cleanup.
 * - Resetea blobUrl al cambiar `url` para evitar renderizar blobs ya revocados.
 * - No llama setState en el cleanup (el próximo effect setea el estado nuevo).
 */
export function useAuthenticatedBlob(url: string | null): Result {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    setBlobUrl(null);
    setError(null);
    setLoading(true);

    let cancelled = false;
    let createdUrl: string | null = null;

    // El documento puede venir con URL absoluta (legacy:
    // `http://localhost:3001/api/documents/file/...`) o relativa
    // (`/api/documents/file/...`). Normalizamos a pathname relativo
    // antes de construir la ruta del BFF.
    let relativePath: string;
    try {
      relativePath =
        url.startsWith('http://') || url.startsWith('https://')
          ? new URL(url).pathname
          : url;
    } catch {
      relativePath = url;
    }

    const proxyUrl = relativePath.startsWith('/')
      ? `/api/files${relativePath}`
      : `/api/files/${relativePath}`;

    (async () => {
      try {
        const res = await fetch(proxyUrl, { credentials: 'include' });
        if (!res.ok) {
          throw new Error(`Failed to fetch file: HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  return { blobUrl, loading, error };
}
