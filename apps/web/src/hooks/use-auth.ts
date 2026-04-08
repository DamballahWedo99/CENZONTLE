'use client';

import { useAuthContext } from '@/context/AuthContext';

export function useAuth() {
  const { currentUser, isLoading, logout } = useAuthContext();

  const user = currentUser
    ? {
        name: currentUser.name,
        email: currentUser.email,
        avatar: currentUser.avatarUrl || '/avatars/user.jpg',
      }
    : {
        name: 'Usuario',
        email: 'user@cenzontle.com',
        avatar: '/avatars/user.jpg',
      };

  return {
    user,
    isLoading,
    logout,
  };
}
