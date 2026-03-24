'use client';

import { ReactNode } from 'react';
import { Permission, UserRole } from '@/types/auth';
import { useAuthContext } from '@/context/AuthContext';

interface PermissionGateProps {
  permission?: Permission;
  permissions?: Permission[];
  role?: UserRole;
  roles?: UserRole[];
  requireAll?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({
  permission,
  permissions,
  role,
  roles,
  requireAll = false,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, hasRole, hasAnyRole } = useAuthContext();

  // Single role check
  if (role) {
    if (!hasRole(role)) return <>{fallback}</>;
    return <>{children}</>;
  }

  // Multiple roles check
  if (roles && roles.length > 0) {
    if (!hasAnyRole(roles)) return <>{fallback}</>;
    return <>{children}</>;
  }

  // Single permission check
  if (permission) {
    if (!hasPermission(permission)) return <>{fallback}</>;
    return <>{children}</>;
  }

  // Multiple permissions check
  if (permissions && permissions.length > 0) {
    const check = requireAll
      ? permissions.every((p) => hasPermission(p))
      : permissions.some((p) => hasPermission(p));
    if (!check) return <>{fallback}</>;
    return <>{children}</>;
  }

  return <>{children}</>;
}
