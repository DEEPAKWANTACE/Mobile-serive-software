import { NavLink, Outlet } from 'react-router';
import { ROLE_LABELS } from '@msm/shared';
import { useAuth } from '@/features/auth/auth-context';
import { navForRole } from './navigation';

export function AppLayout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4 font-semibold">Service Manager</div>
        <nav className="flex-1 space-y-4 p-3">
          {navForRole(user.role).map((section, i) => (
            <div key={section.title ?? i} className="space-y-1">
              {section.title && (
                <div className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{section.title}</div>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">{user.branch ? `${user.branch.name} (${user.branch.code})` : 'All branches'}</div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <div className="font-medium">{user.name}</div>
              <div className="text-slate-500">{ROLE_LABELS[user.role]}</div>
            </div>
            <button onClick={() => void logout()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
