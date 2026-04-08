import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthenticatedUser,
  Permission,
  ROLE_PERMISSIONS,
} from '@cenzontle/shared';
import { PERMISSIONS_KEY } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    const authenticated = user as AuthenticatedUser;

    if (!authenticated) throw new ForbiddenException('Not authenticated');

    const userPermissions = ROLE_PERMISSIONS[authenticated.role] || [];
    if (!required.every((p) => userPermissions.includes(p))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
