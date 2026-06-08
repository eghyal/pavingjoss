import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/utils/api';

export type Role = 'FC' | 'ENGINEERING' | 'PURCHASING' | 'WAREHOUSE' | 'PRODUCTION' | 'SALES' | 'HR';
export type Level = 'STAFF' | 'MANAGER';

export interface User {
  id?: string;
  username: string;
  role: Role;
  level: Level;
  name: string;
  status?: string;
}

interface AuthContextType {
  user: User | null;
  login: (userData: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('erp_user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    } catch (err) {
      console.error("Failed to parse stored user", err);
      localStorage.removeItem('erp_user');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (user) {
        timeoutId = setTimeout(() => {
          logout();
          window.location.reload();
        }, 24 * 60 * 60 * 1000); // 24 hours
      }
    };

    const handleUnauthorized = () => {
      if (user) {
         logout();
         window.location.reload();
      }
    };

    if (user) {
      window.addEventListener('mousemove', resetTimeout);
      window.addEventListener('keydown', resetTimeout);
      window.addEventListener('click', resetTimeout);
      window.addEventListener('scroll', resetTimeout);
      window.addEventListener('api:unauthorized', handleUnauthorized);
      resetTimeout(); // Init
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimeout);
      window.removeEventListener('keydown', resetTimeout);
      window.removeEventListener('click', resetTimeout);
      window.removeEventListener('scroll', resetTimeout);
      window.removeEventListener('api:unauthorized', handleUnauthorized);
    };
  }, [user]);

  const login = (userData: User) => {
    setUser(userData);
    localStorage.setItem('erp_user', JSON.stringify(userData));
  };

  const logout = () => {
    if (user) {
      // Fire-and-forget logout API to clear online status fast without blocking UI
      apiFetch('/api/users/logout', { method: 'POST' }, user.username).catch(e => {
        console.error("Failed to clear local user status", e);
      });
    }
    setUser(null);
    localStorage.removeItem('erp_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {!isLoading ? children : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
