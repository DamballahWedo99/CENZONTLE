import { UserRole, TeamMember } from '@cenzontle/shared';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN!;
const M2M_CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID!;
const M2M_CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET!;
const MGMT_AUDIENCE = `https://${AUTH0_DOMAIN}/api/v2/`;

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getManagementToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: MGMT_AUDIENCE,
    }),
  });

  if (!res.ok) throw new Error(`Failed to get management token: ${res.status}`);

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

async function mgmtFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const token = await getManagementToken();
  const res = await fetch(`https://${AUTH0_DOMAIN}/api/v2${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Auth0 API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface Auth0User {
  user_id: string;
  name: string;
  email: string;
  picture: string;
  created_at: string;
  last_login: string | null;
  blocked?: boolean;
  email_verified?: boolean;
  app_metadata?: {
    role?: string;
    pod_ids?: string[];
  };
}

const VALID_ROLES = Object.values(UserRole) as string[];

function mapToTeamMember(u: Auth0User): TeamMember {
  const role =
    u.app_metadata?.role && VALID_ROLES.includes(u.app_metadata.role)
      ? (u.app_metadata.role as UserRole)
      : UserRole.Viewer;

  return {
    id: u.user_id,
    name: u.name || u.email,
    email: u.email,
    avatarUrl: u.picture || '',
    role,
    status: u.blocked ? 'inactive' : u.last_login ? 'active' : 'pending',
    podIds: u.app_metadata?.pod_ids || [],
    invitedAt: u.created_at,
    lastActiveAt: u.last_login || null,
  };
}

/**
 * Obtiene el rol de un usuario directamente del app_metadata en Auth0.
 * Usado como fallback cuando el Post-Login Action no inyecta los claims
 * custom en el JWT (ej. action no configurada, binding perdido, etc.).
 * Cachea por 5 minutos para no hacer un API call por cada permission check.
 */
const roleCache = new Map<string, { role: UserRole; expiresAt: number }>();

export async function fetchUserRole(userId: string): Promise<UserRole> {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  try {
    const user = await mgmtFetch<Auth0User>(
      `/users/${encodeURIComponent(userId)}?fields=app_metadata`,
    );
    const roleClaim = user.app_metadata?.role;
    const role =
      roleClaim && VALID_ROLES.includes(roleClaim)
        ? (roleClaim as UserRole)
        : UserRole.Viewer;

    roleCache.set(userId, { role, expiresAt: Date.now() + 5 * 60 * 1000 });
    return role;
  } catch (err) {
    console.error('[fetchUserRole] Failed to fetch role from Management API:', err);
    return UserRole.Viewer;
  }
}

export async function fetchAllUsers(): Promise<TeamMember[]> {
  const users = await mgmtFetch<Auth0User[]>(
    '/users?per_page=100&include_totals=false&sort=created_at:-1',
  );
  return users.map(mapToTeamMember);
}

export async function createUser(
  email: string,
  name: string,
  role: UserRole,
  podIds: string[] = [],
): Promise<TeamMember> {
  const password = crypto.randomUUID() + 'Aa1!';

  const user = await mgmtFetch<Auth0User>('/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      name,
      password,
      connection: 'Username-Password-Authentication',
      email_verified: true,
      verify_email: false,
      app_metadata: { role, pod_ids: podIds },
    }),
  });

  // Trigger password reset email so the invited user can set their own password
  const resetRes = await fetch(`https://${AUTH0_DOMAIN}/dbconnections/change_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AUTH0_CLIENT_ID,
      email,
      connection: 'Username-Password-Authentication',
    }),
  });
  if (!resetRes.ok) {
    // Rollback: delete the user since they can't set their password
    const rollbackToken = await getManagementToken();
    await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(user.user_id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${rollbackToken}` } },
    );
    throw new Error('Failed to send password reset email. User creation rolled back.');
  }

  return mapToTeamMember(user);
}

export async function updateUserRole(
  userId: string,
  role: UserRole,
): Promise<void> {
  await mgmtFetch(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ app_metadata: { role } }),
  });
}

/**
 * Asigna las células (pods) del usuario en Auth0. Auth0 Management API hace
 * MERGE en `app_metadata`, así que enviar `{ pod_ids }` no toca `role` ni
 * otros campos — sólo reescribe la lista de pod IDs.
 *
 * Si quieres "quitar la célula", pasa array vacío. Si pasas N IDs, el usuario
 * queda con esa membresía exacta (no se acumula con la previa).
 *
 * El siguiente login del usuario emitirá un JWT con la nueva claim
 * `https://cenzontle.app/pod_ids` vía el Post-Login Action. Para tokens
 * vivos, los guards backend (assertUserCanAccessEpicPods) leen del JWT, así
 * que el efecto sólo se materializa en el próximo refresh del access token.
 */
export async function updateUserPods(
  userId: string,
  podIds: string[],
): Promise<void> {
  await mgmtFetch(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ app_metadata: { pod_ids: podIds } }),
  });
}

export async function blockUser(userId: string): Promise<void> {
  const encoded = encodeURIComponent(userId);

  // Block the user (prevents new logins)
  await mgmtFetch(`/users/${encoded}`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked: true }),
  });

  // Revoke all grants — prevents token refresh when access token expires
  const token = await getManagementToken();
  const grantRes = await fetch(
    `https://${AUTH0_DOMAIN}/api/v2/grants?user_id=${encoded}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!grantRes.ok && grantRes.status !== 204) {
    throw new Error(`Failed to revoke grants: ${grantRes.status}`);
  }
}

export async function unblockUser(userId: string): Promise<void> {
  await mgmtFetch(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked: false }),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  const encoded = encodeURIComponent(userId);
  const token = await getManagementToken();
  const headers = { Authorization: `Bearer ${token}` };

  // Revoke grants first so active sessions can't refresh
  await fetch(`https://${AUTH0_DOMAIN}/api/v2/grants?user_id=${encoded}`, {
    method: 'DELETE',
    headers,
  });

  // Then delete the user
  const res = await fetch(
    `https://${AUTH0_DOMAIN}/api/v2/users/${encoded}`,
    { method: 'DELETE', headers },
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete user: ${res.status}`);
  }
}
