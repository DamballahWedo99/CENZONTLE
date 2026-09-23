# How-to: Configure Auth0

CENZONTLE uses Auth0 (OIDC) for login and roles. **It is mandatory.** The frontend
fails closed: if `AUTH0_DOMAIN`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID` or
`AUTH0_CLIENT_SECRET` is missing, the Next.js middleware answers every route with a
503 and there is no way past it (`apps/web/src/lib/auth0.ts:3-8`,
`apps/web/src/middleware.ts:8-23`).

One piece does **not** fail closed outside production: step-up authentication. Read
[step 5](#5-optional-step-up-authentication-and-user-management) before you rely on
it.

This guide covers the minimum setup to run locally. Time: ~15 min the first time.

Everything happens in the [Auth0 dashboard](https://manage.auth0.com) (a free account
is enough).

---

## 1. Create the API

Auth0 Dashboard → **Applications → APIs → Create API** (*Applications* group in the
left rail).

- **Name:** `Cenzontle API`
- **Identifier (Audience):** `https://api.cenzontle.app`
  (an identifier only — it does not have to exist as a URL)
- Signing Algorithm: `RS256`

That gives you the **audience**. It goes in:

- `apps/api/.env` → `AUTH0_AUDIENCE=https://api.cenzontle.app`
- `apps/web/.env.local` → `AUTH0_AUDIENCE=https://api.cenzontle.app`

---

## 2. Create the Web Application

Auth0 Dashboard → **Applications → Applications → Create Application**

- **Name:** `Cenzontle Web`
- **Type:** `Regular Web Application`

Open the application and go to its **Settings** tab. The three fields below live in
the *Application URIs* block, about halfway down:

| Field | Value (dev) |
|---|---|
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| Allowed Web Origins | `http://localhost:3000` |

Copy **Domain**, **Client ID** and **Client Secret** — top of the same **Settings**
tab, in the *Basic Information* block — into `apps/web/.env.local`:

```bash
AUTH0_DOMAIN=your-tenant.auth0.com         # no https://
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=                              # generate with: openssl rand -hex 32
APP_BASE_URL=http://localhost:3000
```

And the issuer in `apps/api/.env` (**with** the trailing slash!):

```bash
AUTH0_ISSUER_URL=https://your-tenant.auth0.com/
```

The trailing slash is load-bearing: the API hands this value straight to `jwtVerify`
as the expected `iss`, and Auth0 mints tokens with the slash
(`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:23,45-48`). Drop it and every
request comes back 401.

---

## 3. Create the post-login Action (injects role + pods)

Without it the JWT carries no `role`/`pod_ids` claim, and the API guard falls back to
`viewer` for everyone (`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:53-59`).

Auth0 Dashboard → **Actions → Triggers → post-login → Create Action** (or "Add
Action"). Paste this code and hit **Deploy**, then drag it onto the post-login flow:

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

## 4. Create your first admin user

**There is no user seed** — users are created in Auth0.

1. Auth0 Dashboard → **User Management → Users → Create User**
   - Connection: `Username-Password-Authentication` (the Database connection)
   - Email + password
2. Open the user → **Details** tab → *Metadata* block → the **app_metadata** box (the
   second of the two, below *user_metadata*) → set:
   ```json
   { "role": "alta_gerencia" }
   ```
   You can add `"pod_ids": ["<podId>"]` later, once you have created pods in
   Settings ("Configuración") → Ecosistema → **Células** ("Pods")
   (`/factory/settings?section=pods`).
3. Save. The next time that user logs in, the Action injects the role.

**Available roles** (the `role` value): `alta_gerencia` (full admin),
`product_owner`, `tech_lead`, `qa`, `viewer`.

---

## 5. (Optional) Step-up authentication and user management

Two unrelated features hang off the same pair of variables,
`AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET`:

- **[Step-up authentication](glossary.md#step-up-authentication).** Epic
  [sign-offs](glossary.md#sign-off) (the **Dar VoBo** ("sign off") button), both Forge
  gates and DEV branch alignment re-confirm the current user's password through the
  ROPC grant. Used by the API.
- **The Team screen.** Settings → Ecosistema → **Equipo** ("Team")
  (`/factory/settings?section=team`) lists, invites, re-roles, deactivates and deletes
  users through the Auth0 Management API. Used by the web app.

### 5.1 Enable the grants

1. In the Web App: **Settings → Advanced Settings → Grant Types** (bottom of the
   Settings tab) → enable **Password** (for ROPC) and **Client Credentials** (for the
   Management API).
2. **Tenant Settings → General → API Authorization Settings → Default Directory** →
   the name of your Database Connection (e.g. `Username-Password-Authentication`).
   ROPC needs it to know where to look the user up.
3. Copy that same Client ID / Client Secret into `AUTH0_M2M_CLIENT_ID` /
   `AUTH0_M2M_CLIENT_SECRET` in **both** `.env` files.

### 5.2 Authorize the application against the Management API

Reusing the Web App credentials is not enough on its own. A Regular Web Application is
**not** authorized against the Auth0 Management API by default, and every Team screen
operation goes through it — the web app requests a `client_credentials` token for the
`https://<your-tenant>/api/v2/` audience with exactly these credentials
(`apps/web/src/lib/auth0-management.ts:3-24`).

Go to **Applications → APIs → Auth0 Management API → Machine to Machine
Applications**, find `Cenzontle Web`, toggle it on, expand the row and grant these
scopes:

| Scope | Needed by |
|---|---|
| `read:users` | listing the team and the role fallback (`fetchAllUsers`, `fetchUserRole`) |
| `read:users_app_metadata` | reading `role` / `pod_ids` off each user |
| `create:users` | inviting a member (`createUser`) |
| `update:users` | changing a role, deactivating, reactivating (`updateUserRole`, `blockUser`, `unblockUser`) |
| `update:users_app_metadata` | writing `role` / `pod_ids` back (`updateUserRole`, `updateUserPods`) |
| `delete:users` | removing a member (`deleteUser`) |
| `delete:grants` | revoking live sessions when you deactivate or remove someone |

Then click **Update**.

Skip this and the app still runs, but the Team screen degrades silently: the member
fetch throws, the context keeps its last valid value without surfacing an error
(`apps/web/src/context/AuthContext.tsx:161-163`), so you see an empty list — and every
write action fails with an Auth0 API error.

### 5.3 What happens if you skip step 5 entirely

ROPC only works with Database connections, not SSO/Social.

With `AUTH0_M2M_CLIENT_ID`/`AUTH0_M2M_CLIENT_SECRET` unset, password verification
behaves differently per environment
(`apps/api/src/modules/auth/auth.service.ts:88-116`):

| `NODE_ENV` | Behavior |
|---|---|
| `production` | 503. Step-up auth is unavailable, so sign-offs and both gates are blocked. Fail-closed, deliberately. |
| anything else — including unset, which the code reads as `development` | **Verification is skipped and the approval succeeds.** The API logs a `[DEV BYPASS]` warning and returns success without ever contacting Auth0. |

> ⚠️ The bypass keys off `NODE_ENV` alone — not off the hostname, not off the
> deployment. A staging or demo instance running with `NODE_ENV=development`, or with
> `NODE_ENV` simply unset, inherits it: anyone holding a valid session can sign off an
> epic (`epics.service.ts:2329`), approve the staging gate
> (`factory-queue.service.ts:1214`), approve the release gate
> (`qa-gate.service.ts:71`) and align the DEV branch
> (`branch-strategy.service.ts:395`) without typing a password. Set
> `NODE_ENV=production` on every deployment that is not your laptop, and configure the
> M2M credentials.

---

## Verification

- Run `pnpm dev` and open http://localhost:3000.
- It must redirect to Auth0, let you log in, and land you back on `/proyectos`.
- **503** → one of `AUTH0_DOMAIN`, `AUTH0_SECRET`, `AUTH0_CLIENT_ID`,
  `AUTH0_CLIENT_SECRET` is missing from `apps/web/.env.local`
  (see [troubleshooting.md](troubleshooting.md#503-when-you-open-the-app)).
- You get in but everything is read-only → the Action is not deployed, or the user has
  no `app_metadata.role`.
- Settings → Ecosistema → **Equipo** shows an empty list → the Management API
  authorization from
  [step 5.2](#52-authorize-the-application-against-the-management-api) is missing.
