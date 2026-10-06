import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LogOut, Menu, Smartphone, X } from 'lucide-react';
import { ROLE_LABELS } from '@msm/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useShopSettings } from '@/features/settings/useShopSettings';
import { navForRole } from './navigation';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { data: shop } = useShopSettings();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const appName = shop?.shopName ?? 'Mobile Service Management';

  // Close the mobile menu on navigation; keep the browser tab titled with the shop name.
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  if (!user) return null;

  const sidebar = (
    <>
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
          <Smartphone className="size-5" />
        </span>
        <span className="min-w-0 leading-tight font-semibold text-slate-900">{appName}</span>
        <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden">
          <X className="size-5" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3" aria-label="Main">
        {navForRole(user.role).map((section, i) => (
          <div key={section.title ?? i} className="space-y-1">
            {section.title && <div className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{section.title}</div>}
            {section.items.map((item) => (
              <NavLink
                key={item.to + item.label}
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
    </>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden min-h-0 w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex print:hidden">{sidebar}</aside>

      {/* Mobile / tablet drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden">
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 lg:hidden">{appName}</div>
              <div className="truncate text-xs text-slate-500 sm:text-sm">{user.branch ? `${user.branch.name} (${user.branch.code})` : 'All branches'}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden text-right text-sm sm:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-slate-500">{ROLE_LABELS[user.role]}</div>
            </div>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto print:overflow-visible">
          <div className="flex-1 p-4 sm:p-6 print:p-0">
            <Outlet />
          </div>
          <footer className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500 print:hidden">
            © {new Date().getFullYear()} {appName} · Repair management system
          </footer>
        </main>
      </div>
    </div>
  );
}
