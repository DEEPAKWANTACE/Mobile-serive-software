import type { AuthResponse } from '@msm/shared';

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// Access token lives in memory only; the refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
let onSessionExpired: (() => void) | null = null;
let onSessionChanged: ((session: AuthResponse) => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};
export const setSessionChangedHandler = (fn: ((session: AuthResponse) => void) | null) => {
  onSessionChanged = fn;
};

async function exchangeRefreshCookie(): Promise<AuthResponse | null> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse;
}

/**
 * The refresh cookie is shared by every tab and is rotated after each use.
 * A cross-tab lock prevents two tabs from submitting the same cookie at once.
 */
function exchangeRefreshCookieSafely(): Promise<AuthResponse | null> {
  if (navigator.locks) {
    return navigator.locks.request('msm-auth-refresh', exchangeRefreshCookie);
  }
  return exchangeRefreshCookie();
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= exchangeRefreshCookieSafely()
    .then((session) => {
      if (!session) return null;
      accessToken = session.accessToken;
      onSessionChanged?.(session);
      return session;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; responseType?: 'json' | 'blob' };

async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(path, options, false);
    accessToken = null;
    onSessionExpired?.();
  }

  if (res.status === 204) return undefined as T;
  if (res.ok && options.responseType === 'blob') return (await res.blob()) as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code, err.message ?? res.statusText, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, init?: RequestOptions) => request<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'DELETE' }),
  blob: (path: string) => request<Blob>(path, { method: 'GET', responseType: 'blob' }),
};
