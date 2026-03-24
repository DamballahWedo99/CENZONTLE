'use client';

import React, { createContext, useContext, useReducer, useMemo, useCallback, ReactNode } from 'react';
import { UserRole, Permission, ROLE_PERMISSIONS, TeamMember } from '@/types/auth';
import { mockTeamMembers, CURRENT_USER_ID } from '@/data/mock/users';

// === STATE ===
interface AuthState {
  currentUserId: string;
  members: TeamMember[];
}

const initialState: AuthState = {
  currentUserId: CURRENT_USER_ID,
  members: mockTeamMembers,
};

// === ACTIONS ===
type AuthAction =
  | { type: 'SET_CURRENT_USER'; payload: string }
  | { type: 'ADD_MEMBER'; payload: TeamMember }
  | { type: 'UPDATE_MEMBER'; payload: { id: string; changes: Partial<TeamMember> } }
  | { type: 'REMOVE_MEMBER'; payload: string }
  | { type: 'CHANGE_ROLE'; payload: { userId: string; role: UserRole } }
  | { type: 'DEACTIVATE_MEMBER'; payload: string }
  | { type: 'REACTIVATE_MEMBER'; payload: string };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.payload };
    case 'ADD_MEMBER':
      return { ...state, members: [...state.members, action.payload] };
    case 'UPDATE_MEMBER': {
      const { id, changes } = action.payload;
      return {
        ...state,
        members: state.members.map((m) => m.id === id ? { ...m, ...changes } : m),
      };
    }
    case 'REMOVE_MEMBER':
      return { ...state, members: state.members.filter((m) => m.id !== action.payload) };
    case 'CHANGE_ROLE': {
      const { userId, role } = action.payload;
      return {
        ...state,
        members: state.members.map((m) => m.id === userId ? { ...m, role } : m),
      };
    }
    case 'DEACTIVATE_MEMBER':
      return {
        ...state,
        members: state.members.map((m) => m.id === action.payload ? { ...m, status: 'inactive' as const } : m),
      };
    case 'REACTIVATE_MEMBER':
      return {
        ...state,
        members: state.members.map((m) => m.id === action.payload ? { ...m, status: 'active' as const } : m),
      };
    default:
      return state;
  }
}

// === CONTEXT ===
interface AuthContextValue {
  currentUser: TeamMember | null;
  members: TeamMember[];
  dispatch: React.Dispatch<AuthAction>;
  hasPermission: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
  canAccessPod: (podId: string) => boolean;
  switchUser: (userId: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// === PROVIDER ===
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  const currentUser = useMemo(() => {
    return state.members.find((m) => m.id === state.currentUserId) ?? null;
  }, [state.members, state.currentUserId]);

  const hasPermission = useCallback((permission: Permission): boolean => {
    if (!currentUser) return false;
    const permissions = ROLE_PERMISSIONS[currentUser.role];
    return permissions.includes(permission);
  }, [currentUser]);

  const hasRole = useCallback((role: UserRole): boolean => {
    if (!currentUser) return false;
    return currentUser.role === role;
  }, [currentUser]);

  const hasAnyRole = useCallback((roles: UserRole[]): boolean => {
    if (!currentUser) return false;
    return roles.includes(currentUser.role);
  }, [currentUser]);

  const canAccessPod = useCallback((podId: string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === UserRole.AltaGerencia) return true;
    return currentUser.podIds.includes(podId);
  }, [currentUser]);

  const switchUser = useCallback((userId: string) => {
    dispatch({ type: 'SET_CURRENT_USER', payload: userId });
  }, []);

  const logout = useCallback(() => {
    console.log('Logging out...');
  }, []);

  const value = useMemo(() => ({
    currentUser,
    members: state.members,
    dispatch,
    hasPermission,
    hasRole,
    hasAnyRole,
    canAccessPod,
    switchUser,
    logout,
  }), [currentUser, state.members, dispatch, hasPermission, hasRole, hasAnyRole, canAccessPod, switchUser, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
