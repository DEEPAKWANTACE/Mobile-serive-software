import type { ReactNode } from 'react';
import { ROLE_LABELS, type AuthUser } from '@msm/shared';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Welcome band: greeting, role · branch, today's date and role-specific quick actions. */
export function DashboardHero({ user, actions, subtitle }: { user: AuthUser; actions?: ReactNode; subtitle?: string }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-800 px-6 py-6 text-white shadow-sm">
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 size-48 rounded-full bg-indigo-400/20 blur-2xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-brand-100">{today}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {greeting()}, {user.role === 'SUPER_ADMIN' ? user.name : user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-brand-100">
            {ROLE_LABELS[user.role]}
            {user.branch ? ` · ${user.branch.name}` : ''}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}

/** A translucent button for use inside the hero. */
export function HeroAction({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25">
      {children}
    </span>
  );
}
