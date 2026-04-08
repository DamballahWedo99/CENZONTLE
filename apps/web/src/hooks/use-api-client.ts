'use client';

import { useCallback } from 'react';
import { getAccessToken } from '@auth0/nextjs-auth0/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useApiClient() {
  const apiFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      let token: string | undefined;
      try {
        token = await getAccessToken();
      } catch {
        // Session might not have an access token (no audience configured)
      }

      return fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
          ...options?.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    [],
  );

  return { apiFetch };
}
