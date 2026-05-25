/**
 * E2E tests para el módulo de Branding (CENZONTLE).
 *
 * Cubre tres capas:
 *  1. **API pública (request-level)** — GET del singleton + serving de assets
 *     vía la ruta proxy de Next.js. Sin auth, validable end-to-end.
 *  2. **Round-trip de upload (request-level, auth-aware)** — POST → GET →
 *     binary equality + cleanup. Requiere `BRANDING_TEST_BEARER` env var
 *     con un JWT de Auth0 válido para un usuario con MANAGE_BRANDING.
 *  3. **UI smoke (browser)** — el favicon del HTML inicial es el del
 *     branding (no el legacy `/Imagotipo.svg`). Sin login: usa la página
 *     pública `/auth/login` cuyo layout también emite el favicon.
 *
 * Para ejecutar TODO el suite con auth real:
 *   1. Login en la app, copia el access token del request al BFF (DevTools)
 *   2. `BRANDING_TEST_BEARER=<jwt> pnpm test:e2e`
 *
 * Para ejecutar solo el subset público (CI sin Auth0):
 *   `pnpm test:e2e --grep "public"`
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  BRANDING_ASSET_TYPES,
  type BrandingAssetType,
  type BrandingSettings,
} from '@cenzontle/shared';
import { makeTestPng, makeAltTestPng } from './fixtures/png-builder';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const TEST_BEARER = process.env.BRANDING_TEST_BEARER ?? '';
const TEST_ORIGIN = process.env.BRANDING_TEST_ORIGIN ?? 'http://localhost:3000';

/** Backend NestJS endpoint público — bypass BFF proxy para tests directos. */
const BACKEND_BRANDING = `${API_BASE}/api/branding-settings`;

/**
 * Wrapper que añade Authorization + Origin (CSRF defense) si tenemos JWT.
 * Sin JWT, devuelve la response cruda (caller decide si la request requería
 * auth). Origin es necesario en el controller (CSRF check); usamos un
 * localhost que típicamente está en el allowlist.
 */
async function callProtected(
  request: APIRequestContext,
  url: string,
  init: Parameters<APIRequestContext['fetch']>[1] = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = {
    Origin: TEST_ORIGIN,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (TEST_BEARER) headers.Authorization = `Bearer ${TEST_BEARER}`;
  return request.fetch(url, { ...init, headers });
}

/** Resuelve `BrandingAssetType` → field del shape público (URLs). */
function urlField(type: BrandingAssetType): 'logoUrl' | 'logoCollapsedUrl' | 'faviconUrl' {
  switch (type) {
    case 'logo':
      return 'logoUrl';
    case 'logoCollapsed':
      return 'logoCollapsedUrl';
    case 'favicon':
      return 'faviconUrl';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. API pública
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Branding API — public read (no auth)', () => {
  test('GET /branding-settings returns the singleton shape with valid defaults', async ({ request }) => {
    const res = await request.get(BACKEND_BRANDING);
    expect(res.status(), 'endpoint debe ser público').toBe(200);

    const body = (await res.json()) as BrandingSettings;

    // Shape contract — TODOS los campos públicos están presentes.
    expect(body).toHaveProperty('companyName');
    expect(body).toHaveProperty('logoUrl');
    expect(body).toHaveProperty('logoCollapsedUrl');
    expect(body).toHaveProperty('faviconUrl');
    expect(body).toHaveProperty('updatedAt');

    // updatedBy NO debe aparecer en el endpoint público — defense contra
    // enumeración de admins por atacantes anónimos.
    expect(body).not.toHaveProperty('updatedBy');

    // companyName siempre no-vacío (o el default 'CENZONTLE').
    expect(typeof body.companyName).toBe('string');
    expect(body.companyName.length).toBeGreaterThan(0);

    // URLs son string | null — defensa explícita contra undefined.
    for (const field of ['logoUrl', 'logoCollapsedUrl', 'faviconUrl'] as const) {
      const value = body[field];
      expect(value === null || typeof value === 'string', `${field} debe ser string|null`).toBe(true);
    }

    // updatedAt es ISO 8601 parseable.
    expect(() => new Date(body.updatedAt).toISOString()).not.toThrow();
  });

  test('GET con tipo de asset inválido devuelve 400 en el proxy del frontend', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/branding/asset/not-a-real-type`);
    expect(res.status()).toBe(400);
  });

  test('GET de asset inexistente devuelve 404 (no 502)', async ({ request, baseURL }) => {
    // Limpiamos primero si tenemos auth para garantizar estado vacío.
    if (TEST_BEARER) {
      await callProtected(request, `${BACKEND_BRANDING}/asset/favicon`, { method: 'DELETE' });
    }

    const res = await request.get(`${baseURL}/api/branding/asset/favicon?v=test`);
    // 404 estricto — si vemos 502, el backend está caído, eso debe fallar el
    // test (no enmascararse como "asset no existe").
    expect(res.status(), 'proxy debe propagar 404 del backend, no 502').toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Round-trip de upload (auth-aware)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Branding API — upload roundtrip (requires MANAGE_BRANDING)', () => {
  test.skip(
    !TEST_BEARER,
    'Skipping: no BRANDING_TEST_BEARER env var. Setea un JWT de Auth0 con MANAGE_BRANDING para correr este suite.',
  );

  // Cleanup hook: tras cada test, eliminar todos los assets para garantizar
  // que el siguiente arranca con estado limpio. Evita test interdependencias.
  test.afterEach(async ({ request }) => {
    for (const type of BRANDING_ASSET_TYPES) {
      await callProtected(request, `${BACKEND_BRANDING}/asset/${type}`, { method: 'DELETE' });
    }
    await callProtected(request, BACKEND_BRANDING, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ companyName: 'CENZONTLE' }),
    });
  });

  for (const assetType of BRANDING_ASSET_TYPES) {
    test(`upload + serve roundtrip para "${assetType}"`, async ({ request, baseURL }) => {
      const fileBuffer = makeTestPng();

      // 1. Upload via backend directo. El endpoint @Public NO está, pero el
      // proxy CSRF check sí — pasamos Origin via callProtected.
      const uploadRes = await callProtected(request, `${BACKEND_BRANDING}/upload/${assetType}`, {
        method: 'POST',
        multipart: {
          file: {
            name: `test-${assetType}.png`,
            mimeType: 'image/png',
            buffer: fileBuffer,
          },
        },
      });
      expect(uploadRes.status(), `upload de ${assetType} debe 200 (status real: ${uploadRes.status()})`).toBe(200);

      const updated = (await uploadRes.json()) as BrandingSettings;
      const newUrl = updated[urlField(assetType)];
      expect(newUrl, `${urlField(assetType)} no debe ser null tras upload`).toBeTruthy();
      expect(
        newUrl!.startsWith('/api/branding/asset/'),
        'URL debe apuntar al proxy del frontend (no a una URL hardcoded del backend)',
      ).toBe(true);
      expect(newUrl).toContain(`/${assetType}?v=`);

      // 2. Serve via Next.js proxy — el browser carga así el asset.
      const serveRes = await request.get(`${baseURL}${newUrl}`);
      expect(serveRes.status(), `serve de ${assetType} debe 200`).toBe(200);

      const served = await serveRes.body();
      expect(served.equals(fileBuffer), 'bytes servidos = bytes subidos').toBe(true);

      // 3. Content-Type + security headers correctos.
      expect(serveRes.headers()['content-type']).toContain('image/png');
      expect(serveRes.headers()['x-content-type-options']).toBe('nosniff');
    });
  }

  test('upload de archivo vacío es rechazado (400)', async ({ request }) => {
    const res = await callProtected(request, `${BACKEND_BRANDING}/upload/logo`, {
      method: 'POST',
      multipart: {
        file: {
          name: 'empty.png',
          mimeType: 'image/png',
          buffer: Buffer.alloc(0),
        },
      },
    });
    expect(res.status(), 'archivo vacío debe 400').toBe(400);
  });

  test('upload con magic bytes mismatch es rechazado (400)', async ({ request }) => {
    // Bytes que NO son PNG válidos pero el cliente declara image/png.
    // Esto valida la defensa contra MIME spoofing (CWE-434).
    const fakeBuffer = Buffer.from('<html><script>alert(1)</script></html>', 'utf-8');
    const res = await callProtected(request, `${BACKEND_BRANDING}/upload/logo`, {
      method: 'POST',
      multipart: {
        file: {
          name: 'fake.png',
          mimeType: 'image/png',
          buffer: fakeBuffer,
        },
      },
    });
    expect(res.status(), 'magic bytes mismatch debe 400').toBe(400);
  });

  test('SVG es rechazado por mimetype (XSS prevention)', async ({ request }) => {
    const svgBuffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf-8',
    );
    const res = await callProtected(request, `${BACKEND_BRANDING}/upload/logo`, {
      method: 'POST',
      multipart: {
        file: {
          name: 'evil.svg',
          mimeType: 'image/svg+xml',
          buffer: svgBuffer,
        },
      },
    });
    expect(res.status(), 'SVG no debe estar en el allowlist').toBe(400);
  });

  test('PATCH companyName persiste y se refleja en GET subsiguiente', async ({ request }) => {
    const testName = `Test Co ${Date.now()}`;

    const patchRes = await callProtected(request, BACKEND_BRANDING, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ companyName: testName }),
    });
    expect(patchRes.status()).toBe(200);

    const getRes = await request.get(BACKEND_BRANDING);
    const after = (await getRes.json()) as BrandingSettings;
    expect(after.companyName).toBe(testName);
  });

  test('PATCH companyName con whitespace solo es rechazado (400)', async ({ request }) => {
    const res = await callProtected(request, BACKEND_BRANDING, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ companyName: '   ' }),
    });
    expect(res.status(), 'DTO debe rechazar whitespace-only tras trim').toBe(400);
  });

  test('DELETE asset → GET devuelve URL null (vuelve a fallback)', async ({ request }) => {
    // Setup: subir un favicon de prueba en este test mismo (test isolation).
    const fileBuffer = makeAltTestPng();
    const uploadRes = await callProtected(request, `${BACKEND_BRANDING}/upload/favicon`, {
      method: 'POST',
      multipart: {
        file: { name: 'pre-delete.png', mimeType: 'image/png', buffer: fileBuffer },
      },
    });
    expect(uploadRes.status()).toBe(200);

    // Verificar que sí hay favicon ahora.
    const before = (await (await request.get(BACKEND_BRANDING)).json()) as BrandingSettings;
    expect(before.faviconUrl).toBeTruthy();

    // Delete.
    const delRes = await callProtected(request, `${BACKEND_BRANDING}/asset/favicon`, {
      method: 'DELETE',
    });
    expect(delRes.status()).toBe(200);

    const after = (await delRes.json()) as BrandingSettings;
    expect(after.faviconUrl).toBeNull();
  });

  test('DELETE asset es idempotente (200 cuando ya estaba en default)', async ({ request }) => {
    // Garantizar estado vacío.
    await callProtected(request, `${BACKEND_BRANDING}/asset/favicon`, { method: 'DELETE' });

    // Segunda DELETE — debe pasar sin error.
    const res = await callProtected(request, `${BACKEND_BRANDING}/asset/favicon`, {
      method: 'DELETE',
    });
    expect(res.status(), 'DELETE de asset inexistente debe 200 (idempotente)').toBe(200);
    const body = (await res.json()) as BrandingSettings;
    expect(body.faviconUrl).toBeNull();
  });

  test('CSRF defense: PATCH sin Origin/Referer del allowlist es rechazado (403)', async ({ request }) => {
    // Origin inválido — debe ser rechazado por el assertSameOrigin del controller.
    const res = await request.fetch(BACKEND_BRANDING, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TEST_BEARER}`,
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example.com',
      },
      data: JSON.stringify({ companyName: 'csrf-attempt' }),
    });
    expect(res.status(), 'Origin no en allowlist debe 403').toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. UI smoke
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Branding UI — favicon y title en HTML inicial', () => {
  test('layout raíz emite <link rel="icon"> derivado del singleton', async ({ page, request }) => {
    // Lee el singleton para conocer el favicon que esperamos en el HTML.
    const branding = (await (await request.get(BACKEND_BRANDING)).json()) as BrandingSettings;
    const expectedFavicon = branding.faviconUrl ?? '/Imagotipo.svg';

    // /auth/login es pública y aplica el layout raíz — perfecta para validar
    // metadata sin necesidad de session de Auth0.
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });

    const iconHref = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(iconHref, '<link rel="icon"> debe estar presente').toBeTruthy();

    // Next.js puede prefijar el href con `/_next/image?url=...` cuando usa
    // Image Optimization. Aceptamos ambos.
    expect(
      iconHref!.includes(expectedFavicon) || iconHref!.includes(encodeURIComponent(expectedFavicon)),
    ).toBe(true);
  });

  test('layout raíz emite <title> con companyName del singleton', async ({ page, request }) => {
    const branding = (await (await request.get(BACKEND_BRANDING)).json()) as BrandingSettings;

    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    expect(title).toContain(branding.companyName);
  });
});
