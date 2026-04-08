'use server';

import { auth0 } from './auth0';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (!auth0) throw new Error('Auth0 is not configured');
  const { token } = await auth0.getAccessToken();

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
