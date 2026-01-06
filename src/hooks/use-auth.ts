/**
 * useAuth Hook
 *
 * Authentication hook for user management
 * Mock implementation - replace with real auth logic when backend is ready
 */

'use client';

import { useState } from 'react';

interface User {
  name: string;
  email: string;
  avatar?: string;
}

export function useAuth() {
  // Mock user data - replace with real authentication
  const [user] = useState<User>({
    name: 'Usuario Aeroméxico',
    email: 'usuario@aeromexico.com',
    avatar: '/avatars/user.jpg'
  });

  const logout = () => {
    // Mock logout - replace with real logout logic
    console.log('Logging out...');
    // In a real implementation, this would:
    // - Clear auth tokens
    // - Redirect to login page
    // - Clear user session
  };

  return {
    user,
    logout
  };
}
