'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import {
  UserRole,
  Permission,
  ROLE_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  TeamMember,
} from '@cenzontle/shared';
import {
  getTeamMembers,
  inviteMember,
  changeMemberRole,
  changeMemberPods,
  deactivateMember as deactivateAction,
  reactivateMember as reactivateAction,
  removeMember as removeAction,
} from '@/actions/users';

// === STATE ===
interface AuthState {
  members: TeamMember[];
  membersLoaded: boolean;
  rolePermissions: Record<UserRole, Permission[]>;
}

const initialState: AuthState = {
  members: [],
  membersLoaded: false,
  rolePermissions: { ...DEFAULT_ROLE_PERMISSIONS },
};

// === ACTIONS ===
type AuthAction =
  | { type: 'SET_MEMBERS'; payload: TeamMember[] }
  | { type: 'ADD_MEMBER'; payload: TeamMember }
  | { type: 'UPDATE_MEMBER'; payload: { id: string; changes: Partial<TeamMember> } }
  | { type: 'REMOVE_MEMBER'; payload: string }
  | { type: 'CHANGE_ROLE'; payload: { userId: string; role: UserRole } }
  | { type: 'CHANGE_PODS'; payload: { userId: string; podIds: string[] } }
  | { type: 'DEACTIVATE_MEMBER'; payload: string }
  | { type: 'REACTIVATE_MEMBER'; payload: string }
  | { type: 'SET_ROLE_PERMISSIONS'; payload: { role: UserRole; permissions: Permission[] } }
  | { type: 'RESET_ROLE_PERMISSIONS' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_MEMBERS':
      return { ...state, members: action.payload, membersLoaded: true };
    case 'ADD_MEMBER':
      return { ...state, members: [...state.members, action.payload] };
    case 'UPDATE_MEMBER': {
      const { id, changes } = action.payload;
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === id ? { ...m, ...changes } : m,
        ),
      };
    }
    case 'REMOVE_MEMBER':
      return {
        ...state,
        members: state.members.filter((m) => m.id !== action.payload),
      };
    case 'CHANGE_ROLE': {
      const { userId, role } = action.payload;
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === userId ? { ...m, role } : m,
        ),
      };
    }
    case 'CHANGE_PODS': {
      const { userId, podIds } = action.payload;
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === userId ? { ...m, podIds } : m,
        ),
      };
    }
    case 'DEACTIVATE_MEMBER':
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === action.payload ? { ...m, status: 'inactive' as const } : m,
        ),
      };
    case 'REACTIVATE_MEMBER':
      return {
        ...state,
        members: state.members.map((m) =>
          m.id === action.payload ? { ...m, status: 'active' as const } : m,
        ),
      };
    case 'SET_ROLE_PERMISSIONS': {
      const { role, permissions } = action.payload;
      return {
        ...state,
        rolePermissions: { ...state.rolePermissions, [role]: permissions },
      };
    }
    case 'RESET_ROLE_PERMISSIONS':
      return {
        ...state,
        rolePermissions: { ...DEFAULT_ROLE_PERMISSIONS },
      };
    default:
      return state;
  }
}

// === CONTEXT ===
interface AuthContextValue {
  currentUser: TeamMember | null;
  isLoading: boolean;
  members: TeamMember[];
  membersLoaded: boolean;
  rolePermissions: Record<UserRole, Permission[]>;
  dispatch: React.Dispatch<AuthAction>;
  // Auth0-backed operations
  handleInvite: (email: string, name: string, role: UserRole, podIds?: string[]) => Promise<TeamMember>;
  handleChangeRole: (userId: string, role: UserRole) => Promise<void>;
  handleChangePods: (userId: string, podIds: string[]) => Promise<void>;
  handleDeactivate: (userId: string) => Promise<void>;
  handleReactivate: (userId: string) => Promise<void>;
  handleRemove: (userId: string) => Promise<void>;
  refreshMembers: () => Promise<void>;
  // Permission checks
  hasPermission: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
  canAccessPod: (podId: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// === PROVIDER ===
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: auth0User, isLoading } = useUser();
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Fetch real users from Auth0 on mount
  const refreshMembers = useCallback(async () => {
    try {
      const members = await getTeamMembers();
      dispatch({ type: 'SET_MEMBERS', payload: members });
    } catch {
      /* fail-soft: state.members queda en el último valor válido */
    }
  }, []);

  useEffect(() => {
    if (auth0User && !state.membersLoaded) {
      refreshMembers();
    }
  }, [auth0User, state.membersLoaded, refreshMembers]);

  const currentUser: TeamMember | null = useMemo(() => {
    if (!auth0User?.sub) return null;

    // Prefer role/data from Management API (authoritative) over ID token claims
    const apiMember = state.members.find((m) => m.id === auth0User.sub);

    return {
      id: auth0User.sub,
      name: auth0User.name || 'Usuario',
      email: auth0User.email || '',
      avatarUrl: auth0User.picture || '',
      role:
        apiMember?.role ||
        (auth0User['https://cenzontle.app/role'] as UserRole) ||
        UserRole.Viewer,
      status: apiMember?.status ?? ('active' as const),
      podIds:
        apiMember?.podIds ||
        (auth0User['https://cenzontle.app/pod_ids'] as string[]) ||
        [],
      invitedAt: apiMember?.invitedAt || new Date().toISOString(),
      lastActiveAt: apiMember?.lastActiveAt || null,
    };
  }, [auth0User, state.members]);

  // === Auth0-backed member operations ===
  const handleInvite = useCallback(
    async (email: string, name: string, role: UserRole, podIds?: string[]) => {
      const member = await inviteMember(email, name, role, podIds);
      dispatch({ type: 'ADD_MEMBER', payload: member });
      return member;
    },
    [],
  );

  const handleChangeRole = useCallback(
    async (userId: string, role: UserRole) => {
      await changeMemberRole(userId, role);
      dispatch({ type: 'CHANGE_ROLE', payload: { userId, role } });
    },
    [],
  );

  const handleChangePods = useCallback(
    async (userId: string, podIds: string[]) => {
      await changeMemberPods(userId, podIds);
      dispatch({ type: 'CHANGE_PODS', payload: { userId, podIds } });
    },
    [],
  );

  const handleDeactivate = useCallback(async (userId: string) => {
    await deactivateAction(userId);
    dispatch({ type: 'DEACTIVATE_MEMBER', payload: userId });
  }, []);

  const handleReactivate = useCallback(async (userId: string) => {
    await reactivateAction(userId);
    dispatch({ type: 'REACTIVATE_MEMBER', payload: userId });
  }, []);

  const handleRemove = useCallback(async (userId: string) => {
    await removeAction(userId);
    dispatch({ type: 'REMOVE_MEMBER', payload: userId });
  }, []);

  // === Permission checks ===
  const hasPermission = useCallback(
    (permission: Permission): boolean => {
      if (!currentUser) return false;
      const permissions = state.rolePermissions[currentUser.role];
      return permissions.includes(permission);
    },
    [currentUser, state.rolePermissions],
  );

  const hasRole = useCallback(
    (role: UserRole): boolean => {
      if (!currentUser) return false;
      return currentUser.role === role;
    },
    [currentUser],
  );

  const hasAnyRole = useCallback(
    (roles: UserRole[]): boolean => {
      if (!currentUser) return false;
      return roles.includes(currentUser.role);
    },
    [currentUser],
  );

  const canAccessPod = useCallback(
    (podId: string): boolean => {
      if (!currentUser) return false;
      if (currentUser.role === UserRole.AltaGerencia) return true;
      return currentUser.podIds.includes(podId);
    },
    [currentUser],
  );

  const logout = useCallback(() => {
    window.location.href = '/auth/logout';
  }, []);

  // Auth está "cargando" hasta que AMBOS el hook de Auth0 Y el fetch de members terminaron.
  // Sin esto, isLoading=false llega ~200ms antes que membersLoaded=true, y durante esa
  // ventana currentUser.role es el fallback 'viewer' (incorrecto) porque el Management API
  // aún no resolvió el rol real.
  const isFullyLoaded = !isLoading && (!auth0User || state.membersLoaded);

  const value = useMemo(
    () => ({
      currentUser,
      isLoading: !isFullyLoaded,
      members: state.members,
      membersLoaded: state.membersLoaded,
      rolePermissions: state.rolePermissions,
      dispatch,
      handleInvite,
      handleChangeRole,
      handleChangePods,
      handleDeactivate,
      handleReactivate,
      handleRemove,
      refreshMembers,
      hasPermission,
      hasRole,
      hasAnyRole,
      canAccessPod,
      logout,
    }),
    [
      currentUser,
      isLoading,
      state.members,
      state.membersLoaded,
      state.rolePermissions,
      dispatch,
      handleInvite,
      handleChangeRole,
      handleChangePods,
      handleDeactivate,
      handleReactivate,
      handleRemove,
      refreshMembers,
      hasPermission,
      hasRole,
      hasAnyRole,
      canAccessPod,
      logout,
    ],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
