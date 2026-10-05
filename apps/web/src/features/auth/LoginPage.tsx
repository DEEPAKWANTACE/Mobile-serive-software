import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@msm/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from './auth-context';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = loginSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(parsed.data);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5 rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Mobile Service Management</p>
        </div>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Username</span>
          <input name="username" autoComplete="username" autoFocus required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </label>

        <button type="submit" disabled={submitting} className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
