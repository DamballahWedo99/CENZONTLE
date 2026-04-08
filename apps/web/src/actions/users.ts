'use server';

import { z } from 'zod';
import { UserRole, Permission, ROLE_PERMISSIONS, TeamMember } from '@cenzontle/shared';
import { auth0 } from '@/lib/auth0';
import {
  fetchAllUsers,
  createUser,
  updateUserRole,
  blockUser,
  unblockUser,
  deleteUser,
} from '@/lib/auth0-management';

// === Authorization gate ===

async function requireAuth(): Promise<string> {
  if (!auth0) throw new Error('Auth not configured');
  const session = await auth0.getSession();
  if (!session?.user) throw new Error('Not authenticated');
  return session.user.sub as string;
}

async function requirePermission(permission: Permission): Promise<string> {
  if (!auth0) throw new Error('Auth not configured');
  const session = await auth0.getSession();
  if (!session?.user) throw new Error('Not authenticated');

  const role = (session.user['https://cenzontle.app/role'] as UserRole) || UserRole.Viewer;
  const permissions = ROLE_PERMISSIONS[role] ?? [];

  if (!permissions.includes(permission)) {
    throw new Error('Forbidden: insufficient permissions');
  }

  return session.user.sub as string;
}

// === Schemas ===

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.nativeEnum(UserRole),
  podIds: z.array(z.string().min(1)).max(10).default([]),
});

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(UserRole),
});

const userIdSchema = z.string().min(1);

// === Actions ===

export async function getTeamMembers(): Promise<TeamMember[]> {
  await requireAuth();
  return fetchAllUsers();
}

export async function inviteMember(
  email: string,
  name: string,
  role: UserRole,
  podIds?: string[],
): Promise<TeamMember> {
  await requirePermission(Permission.MANAGE_USERS);
  const data = inviteSchema.parse({ email, name, role, podIds });
  return createUser(data.email, data.name, data.role, data.podIds);
}

export async function changeMemberRole(
  userId: string,
  role: UserRole,
): Promise<void> {
  const callerId = await requirePermission(Permission.MANAGE_USERS);
  const data = roleSchema.parse({ userId, role });

  if (data.userId === callerId) {
    throw new Error('Cannot change your own role');
  }

  return updateUserRole(data.userId, data.role);
}

export async function deactivateMember(userId: string): Promise<void> {
  const callerId = await requirePermission(Permission.MANAGE_USERS);
  const id = userIdSchema.parse(userId);

  if (id === callerId) {
    throw new Error('Cannot deactivate yourself');
  }

  return blockUser(id);
}

export async function reactivateMember(userId: string): Promise<void> {
  await requirePermission(Permission.MANAGE_USERS);
  return unblockUser(userIdSchema.parse(userId));
}

export async function removeMember(userId: string): Promise<void> {
  const callerId = await requirePermission(Permission.MANAGE_USERS);
  const id = userIdSchema.parse(userId);

  if (id === callerId) {
    throw new Error('Cannot delete yourself');
  }

  return deleteUser(id);
}
