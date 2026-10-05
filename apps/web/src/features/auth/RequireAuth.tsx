import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@msm/shared';
import { useAuth } from './auth-context';

/** Route guard: redirects to /login when signed out; shows 403 when the role is not allowed. */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { user, isLoading, signedOutManually } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace state={signedOutManually ? null : { from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-slate-600">Your role does not have access to this page.</p>
      </div>
    );
  }
  return <Outlet />;
}
