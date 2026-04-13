export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch wrapper — TODOS los requests pasan por el BFF proxy (/api/proxy/...).
 *
 * El proxy extrae el access token de Auth0 de la sesión del usuario y lo
 * reenvía como Authorization: Bearer al backend NestJS. El backend valida
 * el JWT y aplica el rol REAL del usuario para cada request.
 *
 * Ningún endpoint del backend es accesible sin autenticación.
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `/api/proxy${path}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));

      // Si el proxy devuelve 401 (session expirada / sin refresh token),
      // redirigir al login para obtener una nueva sesión con tokens frescos.
      if (res.status === 401 && typeof window !== 'undefined') {
        window.location.href = '/auth/login';
        // Nunca se resuelve — evita que callers procesen el error
        return new Promise<never>(() => {});
      }

      throw new ApiError(res.status, body.message || res.statusText);
    }

    if (res.status === 204) return undefined as T;
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw err;
  }
}
