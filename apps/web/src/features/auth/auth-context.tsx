import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, AuthUser, LoginInput } from '@msm/shared';
import { api, refreshSession, setAccessToken, setSessionChangedHandler, setSessionExpiredHandler } from '@/lib/api-client';

const AUTH_CHANNEL = 'msm-auth-session';
type AuthEvent = { type: 'LOGIN' } | { type: 'LOGOUT' };

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
  const channelRef = useRef<BroadcastChannel | null>(null);
  const userRef = useRef<AuthUser | null>(null);

  const applyUser = useCallback((nextUser: AuthUser | null) => {
    const previous = userRef.current;
    const accountChanged = previous && nextUser && (
      previous.id !== nextUser.id ||
      previous.role !== nextUser.role ||
      previous.branch?.id !== nextUser.branch?.id
    );
    if (accountChanged) queryClient.clear();
    userRef.current = nextUser;
    setUser(nextUser);
  }, [queryClient]);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    userRef.current = null;
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    setSessionChangedHandler((session) => applyUser(session.user));
    refreshSession()
      .then((session) => applyUser(session?.user ?? null))
      .finally(() => setIsLoading(false));
    return () => setSessionChangedHandler(null);
  }, [applyUser, clearSession]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<AuthEvent>) => {
      if (event.data?.type === 'LOGOUT') {
        setSignedOutManually(true);
        clearSession();
        return;
      }
      if (event.data?.type === 'LOGIN') {
        // Another login replaced the origin-wide refresh cookie. Stop using this
        // tab's old JWT and restore from the new cookie before rendering actions.
        setIsLoading(true);
        clearSession();
        refreshSession()
          .then((session) => applyUser(session?.user ?? null))
          .finally(() => setIsLoading(false));
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [applyUser, clearSession]);

  const login = useCallback(async (input: LoginInput) => {
    const session = await api.post<AuthResponse>('/auth/login', input);
    setAccessToken(session.accessToken);
    applyUser(session.user);
    setSignedOutManually(false);
    queryClient.clear();
    channelRef.current?.postMessage({ type: 'LOGIN' } satisfies AuthEvent);
    return session.user;
  }, [applyUser, queryClient]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSignedOutManually(true);
    clearSession();
    channelRef.current?.postMessage({ type: 'LOGOUT' } satisfies AuthEvent);
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
