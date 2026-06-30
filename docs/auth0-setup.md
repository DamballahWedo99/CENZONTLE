# How-to: Configurar Auth0

CENZONTLE usa Auth0 (OIDC) para login y roles. **Es obligatorio** — el frontend
falla cerrado (503) sin él, no hay bypass de dev. Esta guía cubre el setup mínimo
para correr en local. Tiempo: ~15 min la primera vez.

Todo se hace en el [dashboard de Auth0](https://manage.auth0.com) (cuenta gratis).

---

## 1. Crear la API

Auth0 Dashboard → **Applications → APIs → Create API**

- **Name:** `Cenzontle API`
- **Identifier (Audience):** `https://api.cenzontle.app`
  (es solo un identificador, no tiene que existir como URL)
- Signing Algorithm: `RS256`

Esto te da el **audience**. Va en:
- `apps/api/.env` → `AUTH0_AUDIENCE=https://api.cenzontle.app`
- `apps/web/.env.local` → `AUTH0_AUDIENCE=https://api.cenzontle.app`

---

## 2. Crear la Web Application

Auth0 Dashboard → **Applications → Applications → Create Application**

- **Name:** `Cenzontle Web`
- **Type:** `Regular Web Application`

En **Settings** de esa app, configura:

| Campo | Valor (dev) |
|---|---|
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| Allowed Web Origins | `http://localhost:3000` |

Copia **Domain**, **Client ID** y **Client Secret** a `apps/web/.env.local`:

```bash
AUTH0_DOMAIN=tu-tenant.auth0.com          # sin https://
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=                              # genera: openssl rand -hex 32
APP_BASE_URL=http://localhost:3000
```

Y el issuer en `apps/api/.env` (¡**con** slash final!):

```bash
AUTH0_ISSUER_URL=https://tu-tenant.auth0.com/
```

---

## 3. Crear la post-login Action (inyecta rol + pods)

Sin esto, el JWT no lleva el `role`/`pod_ids` y todos quedan como `viewer`.

Auth0 Dashboard → **Actions → Triggers → post-login → Create Action** (o "Add Action").
Pega este código y haz **Deploy**, luego arrástralo al flow post-login:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const ns = 'https://cenzontle.app';
  const role = event.user.app_metadata?.role || 'viewer';
  const podIds = event.user.app_metadata?.pod_ids || [];

  api.idToken.setCustomClaim(`${ns}/role`, role);
  api.idToken.setCustomClaim(`${ns}/pod_ids`, podIds);
  api.accessToken.setCustomClaim(`${ns}/role`, role);
  api.accessToken.setCustomClaim(`${ns}/pod_ids`, podIds);
  api.accessToken.setCustomClaim(`${ns}/email`, event.user.email);
  api.accessToken.setCustomClaim(`${ns}/name`, event.user.name);
  api.accessToken.setCustomClaim(`${ns}/picture`, event.user.picture);
};
```

---

## 4. Crear tu primer usuario admin

**No hay seed de usuarios** — se crean en Auth0.

1. Auth0 Dashboard → **User Management → Users → Create User**
   - Connection: `Username-Password-Authentication` (la Database connection)
   - Email + password
2. Abre el usuario → pestaña **app_metadata** (Details → Metadata) → pon:
   ```json
   { "role": "alta_gerencia" }
   ```
   (puedes agregar `"pod_ids": ["<podId>"]` después de crear pods)
3. Guarda. La próxima vez que ese usuario inicie sesión, la Action inyecta el rol.

**Roles disponibles** (valor de `role`): `alta_gerencia` (admin total),
`product_owner`, `tech_lead`, `qa`, `viewer`.

---

## 5. (Opcional) Step-up auth para acciones sensibles

VoBo de épicas y los gates del Forge piden re-confirmar la contraseña (ROPC).
Para habilitarlo:

1. En la Web App: **Settings → Advanced → Grant Types** → habilita **Password**.
2. **Tenant Settings → General → Default Directory** → pon el nombre de tu
   Database Connection (ej. `Username-Password-Authentication`).
3. Copia Client ID/Secret a `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET` en
   **ambos** `.env`.

> ROPC solo funciona con conexiones tipo Database (no SSO/Social). Si no lo
> configuras, `/auth/verify-password` devuelve 503 y el flujo de VoBo queda
> deshabilitado — la app igual corre.

---

## Verificación

- Inicia `pnpm dev`, abre http://localhost:3000.
- Debe redirigir a Auth0, dejarte loguear, y volver a `/proyectos`.
- Si ves **503** → falta alguna `AUTH0_*` en `apps/web/.env.local`
  (ver [troubleshooting.md](troubleshooting.md#503-al-abrir-la-app)).
- Si entras pero todo es read-only → la Action no está desplegada o el usuario no
  tiene `app_metadata.role`.
