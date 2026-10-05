import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, AuthUser, LoginInput } from '@msm/shared';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from '@/lib/api-client';

type AuthState = {
  user: AuthUser | null;
  /** True until the initial session restore (via refresh cookie) has completed. */
  isLoading: boolean;
  /** True after an explicit sign-out, so the next login starts at the dashboard instead of the previous page. */
  signedOutManually: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [signedOutManually, setSignedOutManually] = useState(false);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    refreshSession()
      .then((session) => setUser(session?.user ?? null))
      .finally(() => setIsLoading(false));
  }, [clearSession]);

  const login = useCallback(async (input: LoginInput) => {
    const session = await api.post<AuthResponse>('/auth/login', input);
    setAccessToken(session.accessToken);
    setUser(session.user);
    setSignedOutManually(false);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSignedOutManually(true);
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, isLoading, signedOutManually, login, logout }),
    [user, isLoading, signedOutManually, login, logout],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
