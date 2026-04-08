import { Injectable } from '@nestjs/common';
import {
  AuthenticatedUser,
  ROLE_PERMISSIONS,
  TeamMember,
} from '@cenzontle/shared';

@Injectable()
export class AuthService {
  getProfile(user: AuthenticatedUser): TeamMember {
    return {
      id: user.sub,
      name: user.name,
      email: user.email,
      avatarUrl: user.picture || '',
      role: user.role,
      status: 'active',
      podIds: user.podIds,
      invitedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
  }

  getPermissions(user: AuthenticatedUser) {
    return ROLE_PERMISSIONS[user.role] || [];
  }
}
